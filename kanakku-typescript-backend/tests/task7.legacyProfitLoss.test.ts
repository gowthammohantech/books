/**
 * tests/task7.legacyProfitLoss.test.ts
 *
 * P1 Task 7, bug 4a: the legacy (pre-ledger) P&L must satisfy
 *   revenue.total === Σ(revenue.byCategory)
 * (manual-journal income was previously in byCategory but not in total), and it
 * must net non-cancelled sales credit notes out of revenue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const {
  mockCompanySettingsFindFirst,
  mockInvoiceFindMany,
  mockInvoicePaymentAggregate,
  mockCreditNoteFindMany,
  mockPurchaseFindMany,
  mockExpenseFindMany,
  mockJournalLineFindMany,
} = vi.hoisted(() => ({
  mockCompanySettingsFindFirst: vi.fn(),
  mockInvoiceFindMany: vi.fn(),
  mockInvoicePaymentAggregate: vi.fn(),
  mockCreditNoteFindMany: vi.fn(),
  mockPurchaseFindMany: vi.fn(),
  mockExpenseFindMany: vi.fn(),
  mockJournalLineFindMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    companySettings: { findFirst: mockCompanySettingsFindFirst },
    invoice: { findMany: mockInvoiceFindMany },
    invoicePayment: { aggregate: mockInvoicePaymentAggregate },
    creditNote: { findMany: mockCreditNoteFindMany },
    purchase: { findMany: mockPurchaseFindMany },
    expense: { findMany: mockExpenseFindMany },
    journalLine: { findMany: mockJournalLineFindMany },
  },
}));

import { profitLoss } from '../controllers/financialStatementsController';

function makeReqRes() {
  const req = { tenantId: 't1', query: {} } as unknown as Request;
  const json = vi.fn().mockReturnThis();
  const res = { status: vi.fn().mockReturnThis(), json } as unknown as Response;
  return { req, res, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCompanySettingsFindFirst.mockResolvedValue({ ledgerInitialized: false }); // legacy path
  mockInvoiceFindMany.mockResolvedValue([
    { TotalAmount: 1000, taxableAmount: 1000, vat: 0, payments: [] },
  ]);
  mockInvoicePaymentAggregate.mockResolvedValue({ _sum: { amount: 0 } });
  mockCreditNoteFindMany.mockResolvedValue([{ taxableAmount: 100, vat: 0 }]); // a return of 100
  mockPurchaseFindMany.mockResolvedValue([]);
  mockExpenseFindMany.mockResolvedValue([]);
  mockJournalLineFindMany.mockResolvedValue([
    { credit: 200, debit: 0, account: { id: 'inc1', name: 'Interest Income', accountType: 'INCOME' } },
  ]);
});

describe('legacy profitLoss — revenue reconciliation (bug 4a)', () => {
  it('revenue.total equals Σ(byCategory) and nets sales credit notes', async () => {
    const { req, res, json } = makeReqRes();
    await profitLoss(req, res);

    const data = json.mock.calls[0][0].data;
    const byCategorySum = data.revenue.byCategory.reduce(
      (s: number, c: { total: number }) => s + c.total,
      0,
    );

    // Sales revenue is net of the 100 credit note. Manual/other income (200) is
    // now reported BELOW operating income (manualEntries), NOT folded into
    // revenue — so operating margin stays operating-only (finding 4).
    const salesLine = data.revenue.byCategory.find(
      (c: { name: string }) => c.name === 'Sales Revenue',
    );
    expect(salesLine.total).toBe(900); // 1000 − 100 CN
    expect(data.revenue.total).toBe(900); // operating revenue only (no manual income)
    expect(byCategorySum).toBe(data.revenue.total); // reconciles by construction

    // Manual income sits below the line; netIncome still reconciles.
    expect(data.manualEntries.income).toBe(200);
    expect(data.grossProfit).toBe(900); // operating-only (900 − 0 COGS)
    expect(data.operatingIncome).toBe(900); // 900 − 0 opex
    expect(data.netIncome).toBe(1100); // 900 operating + 200 other income − 0 expense
  });
});
