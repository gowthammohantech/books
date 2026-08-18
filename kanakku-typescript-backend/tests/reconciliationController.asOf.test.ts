/**
 * tests/reconciliationController.asOf.test.ts
 *
 * Task 6 (P1) — the tally/reconciliation check date-filters the GL side
 * (journalEntry.entryDate <= asOf) but previously gated the AR/AP sub-ledger on
 * the CURRENT invoice status / purchase balanceAmount. For a back-dated asOf a
 * document settled AFTER asOf therefore vanished from the sub-ledger while it
 * still sat in the GL control → a false mismatch. The sub-ledger is now
 * point-in-time: now-PAID invoices open at asOf are kept (payments <= asOf),
 * and supplier payments after asOf are added back to the bill balance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT = 'tenant-rec';

const {
  mockAccountFindMany,
  mockInvoiceFindMany,
  mockCreditNoteFindMany,
  mockJournalEntryFindMany,
  mockPurchaseFindMany,
  mockBankDetailFindMany,
} = vi.hoisted(() => ({
  mockAccountFindMany: vi.fn(),
  mockInvoiceFindMany: vi.fn(),
  mockCreditNoteFindMany: vi.fn(),
  mockJournalEntryFindMany: vi.fn(),
  mockPurchaseFindMany: vi.fn(),
  mockBankDetailFindMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    account: { findMany: mockAccountFindMany },
    invoice: { findMany: mockInvoiceFindMany },
    creditNote: { findMany: mockCreditNoteFindMany },
    journalEntry: { findMany: mockJournalEntryFindMany },
    purchase: { findMany: mockPurchaseFindMany },
    bankDetail: { findMany: mockBankDetailFindMany },
  },
}));

import { tallyCheck } from '../controllers/reconciliationController';

const D = (s: string) => new Date(s);
const ASOF = '2024-06-15';

// Invoice now PAID, but its payment landed AFTER asOf → 1000 open at asOf.
const INVOICES = [
  { userId: TENANT, isDeleted: false, invoiceType: 'INVOICE', status: 'PAID',
    invoiceDate: D('2024-06-01'), TotalAmount: 1000,
    payments: [{ amount: 1000, isVoided: false, received_on: D('2024-07-01') }] },
];
// Purchase now fully paid (balance 0), payment AFTER asOf → 500 open at asOf.
const PURCHASES = [
  { userId: TENANT, isDeleted: false, status: 'paid', purchaseDate: D('2024-06-02'), balanceAmount: 0,
    supplierPayments: [{ amount: 500, isVoided: false, paymentDate: D('2024-07-05') }] },
];

const le = (d: Date, lte?: Date) => !lte || d <= lte;
const gt = (d: Date, g?: Date) => !g || d > g;

beforeEach(() => {
  vi.clearAllMocks();
  mockAccountFindMany.mockResolvedValue([]); // GL side empty (we assert the sub-ledger figure)
  mockCreditNoteFindMany.mockResolvedValue([]);
  mockJournalEntryFindMany.mockResolvedValue([]);
  mockBankDetailFindMany.mockResolvedValue([]);

  mockInvoiceFindMany.mockImplementation(async ({ where, select }: any) => {
    let list = INVOICES.filter((i) => i.userId === where.userId && !i.isDeleted && i.invoiceType === where.invoiceType);
    if (where.status?.notIn) list = list.filter((i) => !where.status.notIn.includes(i.status));
    if (where.invoiceDate?.lte) list = list.filter((i) => le(i.invoiceDate, where.invoiceDate.lte));
    const pw = select?.payments?.where;
    return list.map((i) => ({
      ...i,
      payments: i.payments.filter((p) => !p.isVoided && (!pw?.received_on?.lte || le(p.received_on, pw.received_on.lte))),
    }));
  });

  mockPurchaseFindMany.mockImplementation(async ({ where, select }: any) => {
    let list = PURCHASES.filter((p) => p.userId === where.userId && !p.isDeleted);
    if (where.status?.not) list = list.filter((p) => p.status !== where.status.not);
    if (where.purchaseDate?.lte) list = list.filter((p) => le(p.purchaseDate, where.purchaseDate.lte));
    const sw = select?.supplierPayments?.where;
    return list.map((p) => ({
      ...p,
      supplierPayments: p.supplierPayments.filter((sp) => !sp.isVoided && (!sw?.paymentDate?.gt || gt(sp.paymentDate, sw.paymentDate.gt))),
    }));
  });
});

function makeReq(): Request {
  return { tenantId: TENANT, user: TENANT, query: { asOf: ASOF } } as unknown as Request;
}
function makeRes(): Response & { body: any } {
  const res: any = { body: null };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  return res;
}

describe('tallyCheck — as-of sub-ledger is point-in-time', () => {
  it('keeps now-settled documents open at a back-dated asOf', async () => {
    const res = makeRes();
    await tallyCheck(makeReq(), res);
    const data = res.body.data;
    // The PAID invoice (cash after asOf) is still 1000 in the AR sub-ledger.
    expect(data.ar.subledgerOpenInvoices).toBe(1000);
    // The fully-paid bill (cash after asOf) is added back to 500 in the AP sub-ledger.
    expect(data.ap.subledgerOpenBills).toBe(500);
  });
});
