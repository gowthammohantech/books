// lib/recurringRunner.posting.spec.ts
//
// FIX 3 (audit-ledger): recurring invoice/expense runners must post to the GL via
// the SAME posting path the manual create endpoints use. These tests drive the
// runners' posting calls directly through a fake tx (the same harness shape used
// by ledgerPosting.spec.ts) and assert:
//   - balanced base-currency entries are produced (SUM(baseDebit) == SUM(baseCredit))
//   - posting is gated (no-op until ledger live)
//   - posting is idempotent (a duplicate sourceId/event returns the existing entry)
//
// We exercise postInvoiceIssued + postSaleCogs and postExpense — the exact
// functions the runners invoke on the freshly-cloned document.
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';

import {
  postInvoiceIssued,
  postSaleCogs,
  postExpense,
} from './ledger/ledgerPosting';

function fakeTx(opts: { initialized?: boolean; goLive?: string; existing?: boolean } = {}) {
  const createCalls: any[] = [];
  return {
    createCalls,
    companySettings: {
      findFirst: vi.fn().mockResolvedValue({
        ledgerInitialized: opts.initialized ?? true,
        goLiveDate: opts.goLive ? new Date(opts.goLive) : new Date('2026-01-01'),
      }),
    },
    ledgerAccountMapping: {
      findMany: vi.fn().mockResolvedValue([
        { roleKey: 'AR', accountId: 'a-ar' },
        { roleKey: 'SALES_REVENUE', accountId: 'a-rev' },
        { roleKey: 'OUTPUT_TAX', accountId: 'a-otax' },
        { roleKey: 'INPUT_TAX', accountId: 'a-itax' },
        { roleKey: 'COGS', accountId: 'a-cogs' },
        { roleKey: 'INVENTORY', accountId: 'a-inv' },
        { roleKey: 'BANK', accountId: 'a-bank' },
        { roleKey: 'CASH', accountId: 'a-cash' },
      ]),
    },
    accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    journalEntry: {
      findFirst: vi.fn().mockResolvedValue(opts.existing ? { id: 'pre-existing' } : null),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        createCalls.push(data);
        return { id: 'je1', ...data };
      }),
    },
  };
}

function sumBase(lines: any[]) {
  const dr = lines.reduce((s, l) => s.add(new Prisma.Decimal(l.baseDebit)), new Prisma.Decimal(0));
  const cr = lines.reduce((s, l) => s.add(new Prisma.Decimal(l.baseCredit)), new Prisma.Decimal(0));
  return { dr, cr };
}

describe('recurring invoice runner GL posting (FIX 3)', () => {
  it('posts a balanced invoice.issued entry for the cloned invoice', async () => {
    const tx = fakeTx();
    await postInvoiceIssued(tx as never, {
      userId: 'u1',
      invoiceId: 'clone-1',
      date: new Date('2026-06-01'),
      total: '118',
      tax: '18',
    });
    const data = tx.createCalls[0];
    expect(data).toMatchObject({ sourceType: 'Invoice', sourceId: 'clone-1', event: 'issued' });
    const { dr, cr } = sumBase(data.lines.create);
    expect(dr.toFixed(4)).toBe('118.0000');
    expect(dr.equals(cr)).toBe(true);
  });

  it('posts a balanced COGS entry when the clone carries stocked items', async () => {
    const tx = fakeTx();
    await postSaleCogs(tx as never, {
      userId: 'u1',
      invoiceId: 'clone-1',
      date: new Date('2026-06-01'),
      cost: '40',
    });
    const data = tx.createCalls[0];
    expect(data).toMatchObject({ event: 'cogs' });
    const { dr, cr } = sumBase(data.lines.create);
    expect(dr.equals(cr)).toBe(true);
    expect(dr.toFixed(4)).toBe('40.0000');
  });

  it('does NOT post when ledger is not live (gated)', async () => {
    const tx = fakeTx({ initialized: false });
    await postInvoiceIssued(tx as never, {
      userId: 'u1',
      invoiceId: 'clone-1',
      date: new Date('2026-06-01'),
      total: '118',
      tax: '18',
    });
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it('is idempotent: a re-run with an existing entry does not double-post', async () => {
    const tx = fakeTx({ existing: true });
    await postInvoiceIssued(tx as never, {
      userId: 'u1',
      invoiceId: 'clone-1',
      date: new Date('2026-06-01'),
      total: '118',
      tax: '18',
    });
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });
});

describe('recurring expense runner GL posting (FIX 3)', () => {
  it('posts a balanced expense entry for the cloned expense (BANK source)', async () => {
    const tx = fakeTx();
    await postExpense(tx as never, {
      userId: 'u1',
      expenseId: 'exp-clone-1',
      date: new Date('2026-06-01'),
      total: '110',
      tax: '10',
      expenseAccountId: 'a-pur',
      sourceType: 'BANK',
      paymentModeSlug: 'bank-transfer',
    });
    const data = tx.createCalls[0];
    expect(data).toMatchObject({ sourceType: 'Expense', sourceId: 'exp-clone-1', event: 'recorded' });
    const { dr, cr } = sumBase(data.lines.create);
    expect(dr.equals(cr)).toBe(true);
    expect(dr.toFixed(4)).toBe('110.0000');
  });

  it('is idempotent on the expense path too', async () => {
    const tx = fakeTx({ existing: true });
    await postExpense(tx as never, {
      userId: 'u1',
      expenseId: 'exp-clone-1',
      date: new Date('2026-06-01'),
      total: '110',
      tax: '10',
      expenseAccountId: 'a-pur',
      sourceType: 'BANK',
      paymentModeSlug: 'bank-transfer',
    });
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });
});
