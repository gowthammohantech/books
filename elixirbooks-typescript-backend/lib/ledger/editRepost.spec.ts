// lib/ledger/editRepost.spec.ts
//
// P0-1: edit flows must void the prior forward entry (not reverseDocument it)
// before re-posting, or the re-post's idempotency check on the same
// (userId, sourceType, sourceId, event) triple silently no-ops — net GL for
// the document goes to zero and any further edit/delete throws "journal
// entry <id> already reversed". See lib/ledger/ledgerPosting.ts voidDocument
// docstring for the full bug-class writeup.
//
// This spec exercises voidDocument (previously uncovered) driving the exact
// void -> post cycle the four edit controllers now perform.
import { describe, it, expect, vi } from 'vitest';
import { postExpense, voidDocument } from './ledgerPosting';
import { PeriodLockedError } from './buildLines';

/**
 * Stateful fake tx: unlike the fixed-mock fakeTx in ledgerPosting.spec.ts,
 * journalEntry.findFirst/create/update here operate over a real in-memory
 * array so that voidDocument's soft-delete + event-mangle is actually visible
 * to the subsequent post()'s idempotency lookup — the exact interaction this
 * bug lives in.
 */
function statefulFakeTx() {
  const entries: any[] = [];
  let seq = 0;
  return {
    entries,
    companySettings: {
      findFirst: vi.fn().mockResolvedValue({
        ledgerInitialized: true,
        goLiveDate: new Date('2026-01-01'),
      }),
    },
    ledgerAccountMapping: {
      findMany: vi.fn().mockResolvedValue([
        { roleKey: 'BANK', accountId: 'a-bank' },
        { roleKey: 'CASH', accountId: 'a-cash' },
        { roleKey: 'INPUT_TAX', accountId: 'a-itax' },
      ]),
    },
    accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    journalEntry: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        return (
          entries.find(
            (e) =>
              e.userId === where.userId &&
              e.sourceType === where.sourceType &&
              e.sourceId === where.sourceId &&
              e.event === where.event &&
              e.isDeleted === where.isDeleted,
          ) ?? null
        );
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        seq += 1;
        const entry = { id: `je${seq}`, isDeleted: false, ...data };
        entries.push(entry);
        return entry;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const entry = entries.find((e) => e.id === where.id);
        if (!entry) throw new Error(`journal entry ${where.id} not found`);
        Object.assign(entry, data);
        return entry;
      }),
    },
  };
}

const expenseKey = { userId: 'u1', sourceType: 'Expense', sourceId: 'exp1', event: 'recorded' };

describe('editRepost: void -> post cycle (P0-1 regression)', () => {
  it('posting, then voidDocument, then post again creates a NEW live JE with the edited amounts; the old one is soft-deleted with a mangled event', async () => {
    const tx = statefulFakeTx();

    await postExpense(tx as never, {
      userId: 'u1', expenseId: 'exp1', date: new Date('2026-06-01'),
      total: '100', tax: '0', expenseAccountId: 'a-rent', sourceType: 'BANK',
    });
    expect(tx.entries).toHaveLength(1);
    const original = tx.entries[0];
    expect(original.isDeleted).toBe(false);

    await voidDocument(tx as never, expenseKey);
    expect(original.isDeleted).toBe(true);
    expect(original.event).toBe(`recorded.voided.${original.id}`);

    // Edited amount on re-post.
    await postExpense(tx as never, {
      userId: 'u1', expenseId: 'exp1', date: new Date('2026-06-02'),
      total: '250', tax: '0', expenseAccountId: 'a-rent', sourceType: 'BANK',
    });

    const live = tx.entries.filter((e) => e.isDeleted === false);
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe(original.id);
    const byAcc = Object.fromEntries(live[0].lines.create.map((l: any) => [l.accountId, l]));
    expect(byAcc['a-rent']).toMatchObject({ debit: '250.0000' });
    expect(byAcc['a-bank']).toMatchObject({ credit: '250.0000' });
  });

  it('two successive void+post cycles succeed (regression for the "already reversed" brick)', async () => {
    const tx = statefulFakeTx();

    await postExpense(tx as never, {
      userId: 'u1', expenseId: 'exp1', date: new Date('2026-06-01'),
      total: '100', tax: '0', expenseAccountId: 'a-rent', sourceType: 'BANK',
    });

    // Cycle 1
    await voidDocument(tx as never, expenseKey);
    await postExpense(tx as never, {
      userId: 'u1', expenseId: 'exp1', date: new Date('2026-06-02'),
      total: '150', tax: '0', expenseAccountId: 'a-rent', sourceType: 'BANK',
    });

    // Cycle 2 — with reverseDocument this second void/post would throw
    // "journal entry <id> already reversed" on a THIRD edit; voidDocument
    // must keep freeing the idempotency slot indefinitely.
    await voidDocument(tx as never, expenseKey);
    await postExpense(tx as never, {
      userId: 'u1', expenseId: 'exp1', date: new Date('2026-06-03'),
      total: '175', tax: '0', expenseAccountId: 'a-rent', sourceType: 'BANK',
    });

    const live = tx.entries.filter((e) => e.isDeleted === false);
    expect(live).toHaveLength(1);
    const byAcc = Object.fromEntries(live[0].lines.create.map((l: any) => [l.accountId, l]));
    expect(byAcc['a-rent']).toMatchObject({ debit: '175.0000' });

    const voided = tx.entries.filter((e) => e.isDeleted === true);
    expect(voided).toHaveLength(2);
    for (const v of voided) {
      expect(v.event).toBe(`recorded.voided.${v.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// P2-2: voidDocument must enforce the period lock (parity with post()/reverse())
// ---------------------------------------------------------------------------
describe('voidDocument: period-lock enforcement', () => {
  it('throws PeriodLockedError and does NOT soft-delete when the entry date is in a locked period', async () => {
    const tx = statefulFakeTx();

    await postExpense(tx as never, {
      userId: 'u1', expenseId: 'exp1', date: new Date('2026-03-15'),
      total: '100', tax: '0', expenseAccountId: 'a-rent', sourceType: 'BANK',
    });
    const je = tx.entries[0];
    expect(je.isDeleted).toBe(false);

    // Lock the period covering the entry's date.
    tx.accountingPeriod.findFirst.mockResolvedValue({ id: 'p1', isLocked: true });

    await expect(voidDocument(tx as never, expenseKey)).rejects.toBeInstanceOf(PeriodLockedError);

    // The forward JE must remain LIVE and untouched (no soft-delete, no event mangle).
    expect(je.isDeleted).toBe(false);
    expect(je.event).toBe('recorded');
  });

  it('proceeds normally when the entry date is NOT in any locked period', async () => {
    const tx = statefulFakeTx();
    await postExpense(tx as never, {
      userId: 'u1', expenseId: 'exp1', date: new Date('2026-03-15'),
      total: '100', tax: '0', expenseAccountId: 'a-rent', sourceType: 'BANK',
    });
    // accountingPeriod.findFirst defaults to null (no lock) → void succeeds.
    await voidDocument(tx as never, expenseKey);
    expect(tx.entries[0].isDeleted).toBe(true);
    expect(tx.entries[0].event).toBe(`recorded.voided.${tx.entries[0].id}`);
  });
});
