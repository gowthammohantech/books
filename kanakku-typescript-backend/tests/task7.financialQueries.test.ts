/**
 * tests/task7.financialQueries.test.ts
 *
 * P1 Task 7, bug 4c:
 *  - getRevenueSummary.totalPaid must be cash RECEIVED IN PERIOD (a dedicated
 *    payment aggregate over received_on), not the sum of each period-dated
 *    invoice's full payment history.
 *  - getDashboardOverview.revenueMTD must be net of output tax (taxableRevenue),
 *    matching the ledger P&L — not the tax-inclusive totalInvoiced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockInvoiceFindMany,
  mockInvoicePaymentAggregate,
  mockPurchaseFindMany,
  mockExpenseFindMany,
  mockBankDetailFindMany,
} = vi.hoisted(() => ({
  mockInvoiceFindMany: vi.fn(),
  mockInvoicePaymentAggregate: vi.fn(),
  mockPurchaseFindMany: vi.fn(),
  mockExpenseFindMany: vi.fn(),
  mockBankDetailFindMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    invoice: { findMany: mockInvoiceFindMany },
    invoicePayment: { aggregate: mockInvoicePaymentAggregate },
    purchase: { findMany: mockPurchaseFindMany },
    expense: { findMany: mockExpenseFindMany },
    bankDetail: { findMany: mockBankDetailFindMany },
  },
}));

import { getRevenueSummary, getDashboardOverview } from '../lib/financialQueries';

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoiceFindMany.mockResolvedValue([]);
  mockInvoicePaymentAggregate.mockResolvedValue({ _sum: { amount: 0 } });
  mockPurchaseFindMany.mockResolvedValue([]);
  mockExpenseFindMany.mockResolvedValue([]);
  mockBankDetailFindMany.mockResolvedValue([]);
});

describe('getRevenueSummary — totalPaid is cash received in period (bug 4c)', () => {
  it('takes totalPaid from the received_on payment aggregate, not per-invoice history', async () => {
    // One invoice dated in the period, with an old payment of 200 in its history.
    mockInvoiceFindMany.mockResolvedValue([
      { TotalAmount: 1000, taxableAmount: 900, vat: 100, payments: [{ amount: 200 }] },
    ]);
    // Cash actually received in the period = 750 (could include other invoices).
    mockInvoicePaymentAggregate.mockResolvedValue({ _sum: { amount: 750 } });

    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    const r = await getRevenueSummary('t1', from, to);

    expect(r.totalPaid).toBe(750); // from the aggregate, NOT 200
    expect(r.taxableRevenue).toBe(900);
    expect(r.outstanding).toBe(800); // 1000 − 200 (full payment history)

    // The aggregate must be constrained to received_on within the period.
    const where = mockInvoicePaymentAggregate.mock.calls[0][0].where;
    expect(where.received_on.gte).toBeInstanceOf(Date);
    expect(where.received_on.lte).toBeInstanceOf(Date);
    expect(where.isVoided).toBe(false);
  });
});

describe('getDashboardOverview — revenueMTD net of tax (bug 4c)', () => {
  it('reports revenueMTD as taxableRevenue, not tax-inclusive totalInvoiced', async () => {
    mockInvoiceFindMany.mockImplementation((args: { select?: Record<string, unknown> }) => {
      // getRevenueSummary selects taxableAmount; the receivables query does not.
      if (args.select?.taxableAmount) {
        return Promise.resolve([
          { TotalAmount: 1000, taxableAmount: 900, vat: 100, payments: [] },
        ]);
      }
      return Promise.resolve([]);
    });

    const overview = await getDashboardOverview('t1');
    expect(overview.revenueMTD).toBe(900); // net of the 100 output tax
    expect(overview.netMTD).toBe(900); // 900 − 0 expenses
  });
});
