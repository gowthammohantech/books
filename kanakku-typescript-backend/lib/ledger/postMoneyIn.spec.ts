// lib/ledger/postMoneyIn.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { postMoneyIn } from './postMoneyIn';

/** Minimal fake PostingTx that satisfies gating + engine + role-resolver. */
function fakeTx(opts: { initialized?: boolean; goLive?: string } = {}) {
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
        { roleKey: 'BANK', accountId: 'a-bank' },
        { roleKey: 'CASH', accountId: 'a-cash' },
        { roleKey: 'OUTPUT_TAX', accountId: 'a-otax' },
      ]),
    },
    accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    journalEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        createCalls.push(data);
        return { id: 'je1', ...data };
      }),
    },
  };
}

describe('postMoneyIn', () => {
  it('posts Dr Bank total, Cr income net, Cr output tax when tax > 0', async () => {
    const tx = fakeTx();
    await postMoneyIn(tx as never, {
      userId: 'u1',
      sourceType: 'BankTxnExplain',
      sourceId: 'b1',
      event: 'explained',
      date: new Date('2026-06-21'),
      total: '118',
      tax: '18',
      incomeAccountId: 'acc-income',
      currencyCode: 'INR',
    });

    expect(tx.createCalls).toHaveLength(1);
    const data = tx.createCalls[0];
    expect(data).toMatchObject({ sourceType: 'BankTxnExplain', sourceId: 'b1', event: 'explained' });

    const byAcc = Object.fromEntries(data.lines.create.map((l: any) => [l.accountId, l]));
    // Dr BANK = total (118)
    expect(byAcc['a-bank']).toMatchObject({ debit: '118.0000' });
    // Cr income account = net (100)
    expect(byAcc['acc-income']).toMatchObject({ credit: '100.0000' });
    // Cr OUTPUT_TAX = tax (18)
    expect(byAcc['a-otax']).toMatchObject({ credit: '18.0000', taxRoleKey: 'OUTPUT_TAX' });
  });

  it('omits the OUTPUT_TAX leg when tax is 0', async () => {
    const tx = fakeTx();
    await postMoneyIn(tx as never, {
      userId: 'u1',
      sourceType: 'BankTxnExplain',
      sourceId: 'b2',
      event: 'explained',
      date: new Date('2026-06-21'),
      total: '500',
      tax: '0',
      incomeAccountId: 'acc-income',
    });

    expect(tx.createCalls).toHaveLength(1);
    const data = tx.createCalls[0];
    const byAcc = Object.fromEntries(data.lines.create.map((l: any) => [l.accountId, l]));
    expect(byAcc['a-bank']).toMatchObject({ debit: '500.0000' });
    expect(byAcc['acc-income']).toMatchObject({ credit: '500.0000' });
    // No OUTPUT_TAX line
    expect(byAcc['a-otax']).toBeUndefined();
  });

  it('uses CASH role when paymentModeSlug contains "cash"', async () => {
    const tx = fakeTx();
    await postMoneyIn(tx as never, {
      userId: 'u1',
      sourceType: 'BankTxnExplain',
      sourceId: 'b3',
      event: 'explained',
      date: new Date('2026-06-21'),
      total: '200',
      tax: '0',
      incomeAccountId: 'acc-income',
      paymentModeSlug: 'cash',
    });

    const data = tx.createCalls[0];
    const byAcc = Object.fromEntries(data.lines.create.map((l: any) => [l.accountId, l]));
    expect(byAcc['a-cash']).toMatchObject({ debit: '200.0000' });
    expect(byAcc['acc-income']).toMatchObject({ credit: '200.0000' });
  });

  it('no-ops when ledger not initialized', async () => {
    const tx = fakeTx({ initialized: false });
    await postMoneyIn(tx as never, {
      userId: 'u1',
      sourceType: 'BankTxnExplain',
      sourceId: 'b4',
      event: 'explained',
      date: new Date('2026-06-21'),
      total: '100',
      tax: '0',
      incomeAccountId: 'acc-income',
    });
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });
});
