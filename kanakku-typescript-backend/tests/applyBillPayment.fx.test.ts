/**
 * tests/applyBillPayment.fx.test.ts
 *
 * Task 5 (P1 bug 2): a bank-linked foreign-currency bill payment made through
 * the explain path (applyBillPayment) previously forwarded `currencyCode` but
 * never a rate, so postSupplierPayment relieved AP at rate 1 — the AP base
 * never cleared. The helper must now thread the bill's document rate so AP is
 * relieved at the rate it was originally booked (base = amount × rate).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyBillPayment, type ApplyBillPaymentDb } from '../lib/ledger/applyBillPayment';

const TENANT_ID = 'tenant-alpha';

function makeDb(): ApplyBillPaymentDb & { createCalls: any[] } {
  const createCalls: any[] = [];
  return {
    createCalls,
    purchase: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'purch-1',
        totalAmount: 1000,
        paidAmount: 0,
        balanceAmount: 1000,
        status: 'pending',
        userId: TENANT_ID,
        supplierId: 'sup-1',
        currencyCode: 'USD',
        exchangeRate: '83',
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    supplierPayment: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      create: vi.fn().mockResolvedValue({ id: 'sp-1' }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    companySettings: {
      findFirst: vi.fn().mockResolvedValue({ ledgerInitialized: true, goLiveDate: new Date('2026-01-01') }),
    },
    ledgerAccountMapping: {
      findMany: vi.fn().mockResolvedValue([
        { roleKey: 'AP', accountId: 'a-ap' },
        { roleKey: 'BANK', accountId: 'a-bank' },
        { roleKey: 'CASH', accountId: 'a-cash' },
        { roleKey: 'FX_GAIN_LOSS', accountId: 'a-fx' },
      ]),
    },
    journalEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => { createCalls.push(data); return { id: 'je-1', ...data }; }),
      update: vi.fn().mockResolvedValue({ id: 'je-1' }),
    },
    accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as ApplyBillPaymentDb & { createCalls: any[] };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('applyBillPayment — FX (foreign bill payment)', () => {
  it('relieves AP at the bill document rate (base = amount × 83), not rate 1', async () => {
    const db = makeDb();

    await applyBillPayment(db, {
      userId: TENANT_ID,
      purchaseId: 'purch-1',
      amount: '100',            // 100 USD
      date: new Date('2026-02-01'),
      bankAccountId: 'bank-1',
      currencyCode: 'USD',
    });

    const data = db.createCalls[0];
    expect(data).toMatchObject({ sourceType: 'SupplierPayment', event: 'payment' });
    const byAcc = Object.fromEntries(data.lines.create.map((l: any) => [l.accountId, l]));
    // AP debit relieved at the document rate → base 8300, NOT 100.
    expect(byAcc['a-ap']).toMatchObject({ debit: '100.0000', baseDebit: '8300.0000' });
    expect(byAcc['a-bank']).toMatchObject({ credit: '100.0000', baseCredit: '8300.0000' });
  });
});
