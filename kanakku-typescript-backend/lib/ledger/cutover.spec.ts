// lib/ledger/cutover.spec.ts
import { describe, it, expect } from 'vitest';
import { buildOpeningInstructions, type OpeningSummary } from './cutover';
import { toDecimal, sumDecimals } from './money';
import type { LineInstruction } from './types';

const balanced = (lines: LineInstruction[]) => {
  const d = sumDecimals(lines.filter((l) => l.side === 'debit').map((l) => toDecimal(l.amount)));
  const c = sumDecimals(lines.filter((l) => l.side === 'credit').map((l) => toDecimal(l.amount)));
  return d.equals(c);
};

describe('buildOpeningInstructions', () => {
  it('assets debit, liabilities credit, residual to OBE (positive equity → credit)', () => {
    const s: OpeningSummary = { bank: '1000', cash: '100', ar: '500', inventory: '400', ap: '300' };
    const lines = buildOpeningInstructions(s);
    const byRole = Object.fromEntries(lines.map((l) => [l.roleKey, l]));
    expect(byRole['BANK']).toMatchObject({ side: 'debit', amount: '1000' });
    expect(byRole['CASH']).toMatchObject({ side: 'debit', amount: '100' });
    expect(byRole['AR']).toMatchObject({ side: 'debit', amount: '500' });
    expect(byRole['INVENTORY']).toMatchObject({ side: 'debit', amount: '400' });
    expect(byRole['AP']).toMatchObject({ side: 'credit', amount: '300' });
    // equity = (1000+100+500+400) - 300 = 1700 → credit OBE
    expect(byRole['OPENING_BALANCE_EQUITY']).toMatchObject({ side: 'credit', amount: '1700' });
    expect(balanced(lines)).toBe(true);
  });

  it('negative net equity → OBE on the debit side', () => {
    const s: OpeningSummary = { bank: '0', cash: '0', ar: '0', inventory: '0', ap: '500' };
    const lines = buildOpeningInstructions(s);
    const obe = lines.find((l) => l.roleKey === 'OPENING_BALANCE_EQUITY')!;
    expect(obe).toMatchObject({ side: 'debit', amount: '500' });
    expect(balanced(lines)).toBe(true);
  });

  it('omits zero-amount asset/liability lines', () => {
    const s: OpeningSummary = { bank: '100', cash: '0', ar: '0', inventory: '0', ap: '0' };
    const lines = buildOpeningInstructions(s);
    expect(lines.find((l) => l.roleKey === 'CASH')).toBeUndefined();
    expect(lines.find((l) => l.roleKey === 'AR')).toBeUndefined();
    expect(balanced(lines)).toBe(true);
  });

  it('all-zero summary yields no lines', () => {
    const lines = buildOpeningInstructions({ bank: '0', cash: '0', ar: '0', inventory: '0', ap: '0' });
    expect(lines).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Task 2: computeOpeningSummary + previewCutover + commitCutover
// ---------------------------------------------------------------------------
import { vi } from 'vitest';
import { computeOpeningSummary, previewCutover, commitCutover } from './cutover';

function fakeTx(opts: { initialized?: boolean; existingOpening?: boolean; goLive?: string } = {}) {
  const createCalls: any[] = [];
  return {
    createCalls,
    companySettings: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'cs1', ledgerInitialized: opts.initialized ?? false,
        functionalCurrency: 'INR', goLiveDate: new Date(opts.goLive ?? '2026-04-01'),
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    // No bank/petty transactions ≤ asOf → as-of balance falls back to openingBalance.
    bankDetail: { findMany: vi.fn().mockResolvedValue([{ id: 'b1', openingBalance: '1000', currentBalance: '1000', accountType: 'current' }]) },
    bankTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    pettyCash: { findFirst: vi.fn().mockResolvedValue({ id: 'pc1', openingBalance: '100', currentBalance: '100' }) },
    pettyCashTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    invoice: { findMany: vi.fn().mockResolvedValue([{ TotalAmount: '500', payments: [] }]) },
    purchase: { findMany: vi.fn().mockResolvedValue([{ totalAmount: '300', supplierPayments: [] }]) },
    creditNote: { findMany: vi.fn().mockResolvedValue([]) },
    inventory: { findMany: vi.fn().mockResolvedValue([{ quantityOnHand: '10', avgCost: '40' }]) }, // 400
    ledgerAccountMapping: { findMany: vi.fn().mockResolvedValue([
      { roleKey: 'BANK', accountId: 'a-bank' }, { roleKey: 'CASH', accountId: 'a-cash' },
      { roleKey: 'AR', accountId: 'a-ar' }, { roleKey: 'INVENTORY', accountId: 'a-inv' },
      { roleKey: 'AP', accountId: 'a-ap' }, { roleKey: 'OPENING_BALANCE_EQUITY', accountId: 'a-obe' },
    ]) },
    accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    journalEntry: {
      findFirst: vi.fn().mockResolvedValue(opts.existingOpening ? { id: 'je-open' } : null),
      create: vi.fn().mockImplementation(async ({ data }: any) => { createCalls.push(data); return { id: 'je-open', ...data }; }),
    },
  };
}

describe('computeOpeningSummary', () => {
  it('aggregates bank, cash, AR, AP, inventory', async () => {
    const tx = fakeTx();
    const s = await computeOpeningSummary(tx as never, 'u1', new Date('2026-03-31'));
    expect(s.bank).toBe('1000'); expect(s.cash).toBe('100');
    expect(s.ar).toBe('500'); expect(s.ap).toBe('300'); expect(s.inventory).toBe('400');
  });
});

// ---------------------------------------------------------------------------
// P2-2: point-in-time integrity — commit AFTER go-live must not double-count
// cash / understate AR. These fakes HONOR the date filters the code passes, so
// a missing `received_on <= asOf` / `transactionDate <= asOf` filter fails them.
// ---------------------------------------------------------------------------
describe('computeOpeningSummary — point-in-time as-of', () => {
  const asOf = new Date('2026-03-31T23:59:59.999Z');

  const le = (d: Date, cutoff: Date) => d.getTime() <= cutoff.getTime();

  it('a payment dated AFTER asOf is excluded → opening AR keeps the still-open invoice and opening bank excludes the post-asOf receipt', async () => {
    const tx = {
      bankDetail: { findMany: async () => [{ id: 'b1', openingBalance: '0', currentBalance: '500' }] },
      bankTransaction: {
        findFirst: async ({ where }: any) => {
          const cutoff = where.transactionDate.lte as Date;
          // The only bank txn is the post-asOf receipt that took the balance 0 → 500.
          const txns = [{ transactionDate: new Date('2026-04-05'), balanceAfter: '500' }];
          const kept = txns.filter((t) => le(t.transactionDate, cutoff));
          return kept.length ? { balanceAfter: kept[kept.length - 1].balanceAfter } : null;
        },
      },
      pettyCash: { findFirst: async () => null },
      pettyCashTransaction: { findFirst: async () => null },
      invoice: {
        findMany: async ({ select }: any) => {
          const cutoff = select.payments.where.received_on.lte as Date;
          const all = [{ amount: '500', received_on: new Date('2026-04-05'), isVoided: false }];
          const kept = all.filter((p) => !p.isVoided && le(p.received_on, cutoff));
          return [{ TotalAmount: '500', payments: kept.map((p) => ({ amount: p.amount })) }];
        },
      },
      purchase: { findMany: async () => [] },
      creditNote: { findMany: async () => [] },
      inventory: { findMany: async () => [] },
    };
    const s = await computeOpeningSummary(tx as never, 'u1', asOf);
    // Buggy (current-balance / undated-payments) code would give ar=0, bank=500.
    expect(s.ar).toBe('500');
    expect(s.bank).toBe('0');
  });

  it('open (PENDING) credit notes dated ≤ asOf net against opening AR; cancelled and post-asOf CNs do not', async () => {
    const tx = {
      bankDetail: { findMany: async () => [] },
      bankTransaction: { findFirst: async () => null },
      pettyCash: { findFirst: async () => null },
      pettyCashTransaction: { findFirst: async () => null },
      invoice: { findMany: async () => [{ TotalAmount: '1000', payments: [] }] },
      purchase: { findMany: async () => [] },
      creditNote: {
        findMany: async ({ where }: any) => {
          const cutoff = where.creditNoteDate.lte as Date;
          const all = [
            { totalAmount: '300', status: 'PENDING', creditNoteDate: new Date('2026-03-01') },
            { totalAmount: '100', status: 'PENDING', creditNoteDate: new Date('2026-04-10') }, // after asOf
            { totalAmount: '50', status: 'CANCELLED', creditNoteDate: new Date('2026-03-01') },
          ];
          return all
            .filter((c) => c.status === where.status && le(c.creditNoteDate, cutoff))
            .map((c) => ({ totalAmount: c.totalAmount }));
        },
      },
      inventory: { findMany: async () => [] },
    };
    const s = await computeOpeningSummary(tx as never, 'u1', asOf);
    // 1000 gross AR − 300 open CN = 700 (the +100 post-asOf and 50 cancelled excluded).
    expect(s.ar).toBe('700');
  });

  it('AP uses supplier payments dated ≤ asOf only (a payment after asOf keeps the bill open)', async () => {
    const tx = {
      bankDetail: { findMany: async () => [] },
      bankTransaction: { findFirst: async () => null },
      pettyCash: { findFirst: async () => null },
      pettyCashTransaction: { findFirst: async () => null },
      invoice: { findMany: async () => [] },
      purchase: {
        findMany: async ({ select }: any) => {
          const cutoff = select.supplierPayments.where.paymentDate.lte as Date;
          const all = [{ amount: '800', paymentDate: new Date('2026-04-09'), isVoided: false, isDeleted: false }];
          const kept = all.filter((p) => !p.isVoided && !p.isDeleted && le(p.paymentDate, cutoff));
          return [{ totalAmount: '800', supplierPayments: kept.map((p) => ({ amount: p.amount })) }];
        },
      },
      creditNote: { findMany: async () => [] },
      inventory: { findMany: async () => [] },
    };
    const s = await computeOpeningSummary(tx as never, 'u1', asOf);
    expect(s.ap).toBe('800'); // post-asOf payment excluded → bill still fully open
  });

  it('bank as-of uses the latest running balance at/before asOf, not the current balance', async () => {
    const tx = {
      bankDetail: { findMany: async () => [{ id: 'b1', openingBalance: '0', currentBalance: '9999' }] },
      bankTransaction: {
        findFirst: async ({ where }: any) => {
          const cutoff = where.transactionDate.lte as Date;
          const txns = [
            { transactionDate: new Date('2026-02-10'), balanceAfter: '200' },
            { transactionDate: new Date('2026-03-20'), balanceAfter: '350' }, // last ≤ asOf
            { transactionDate: new Date('2026-04-15'), balanceAfter: '9999' }, // after asOf
          ].filter((t) => le(t.transactionDate, cutoff));
          return txns.length ? { balanceAfter: txns[txns.length - 1].balanceAfter } : null;
        },
      },
      pettyCash: { findFirst: async () => null },
      pettyCashTransaction: { findFirst: async () => null },
      invoice: { findMany: async () => [] },
      purchase: { findMany: async () => [] },
      creditNote: { findMany: async () => [] },
      inventory: { findMany: async () => [] },
    };
    const s = await computeOpeningSummary(tx as never, 'u1', asOf);
    expect(s.bank).toBe('350');
  });
});

describe('previewCutover', () => {
  it('returns the summary + draft lines + balanced flag, writes nothing', async () => {
    const tx = fakeTx();
    const r = await previewCutover(tx as never, 'u1');
    expect(r.balanced).toBe(true);
    expect(r.lines.length).toBeGreaterThan(0);
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });
});

describe('commitCutover', () => {
  it('posts one opening entry dated goLive-1 and sets ledgerInitialized', async () => {
    const tx = fakeTx();
    await commitCutover(tx as never, 'u1');
    expect(tx.journalEntry.create).toHaveBeenCalledOnce();
    const data = tx.createCalls[0];
    expect(data).toMatchObject({ isOpeningBalance: true, sourceType: 'Cutover', event: 'opening' });
    expect(tx.companySettings.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ledgerInitialized: true }) }));
  });
  it('is idempotent: no new entry, but still ensures ledgerInitialized is true', async () => {
    const tx = fakeTx({ existingOpening: true });
    await commitCutover(tx as never, 'u1');
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
    // even on the early-return path the flag must be (re-)set true to repair partial failures
    expect(tx.companySettings.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ledgerInitialized: true }) }),
    );
  });
});
