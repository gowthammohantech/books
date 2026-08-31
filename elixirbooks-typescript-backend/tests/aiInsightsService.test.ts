/**
 * tests/aiInsightsService.test.ts
 *
 * Covers the Prisma port of services/ai/insightsService.getFinancialData, which
 * backs GET /api/ai/insights. Thirteen Mongo aggregation pipelines queried an
 * instance that no longer exists, so the endpoint returned zeroes for every
 * tenant.
 *
 * Two things are pinned here. First, the response shape: it is spread straight
 * into the endpoint's JSON *and* serialised into the narrative prompt, so a
 * renamed key silently degrades the AI's answer rather than failing loudly.
 * Second, that the revenue and expense figures come from lib/financialQueries —
 * the shared module the report controllers also use, which is what stops an AI
 * insight and a human report disagreeing about the same month.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetRevenueSummary,
  mockGetExpenseSummary,
  mockGetOutstandingInvoices,
  mockInvoiceGroupBy,
  mockInvoiceFindMany,
  mockExpenseFindMany,
  mockQuotationGroupBy,
  mockCustomerFindMany,
} = vi.hoisted(() => ({
  mockGetRevenueSummary: vi.fn(),
  mockGetExpenseSummary: vi.fn(),
  mockGetOutstandingInvoices: vi.fn(),
  mockInvoiceGroupBy: vi.fn(),
  mockInvoiceFindMany: vi.fn(),
  mockExpenseFindMany: vi.fn(),
  mockQuotationGroupBy: vi.fn(),
  mockCustomerFindMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const client = {
    invoice: { groupBy: mockInvoiceGroupBy, findMany: mockInvoiceFindMany },
    expense: { findMany: mockExpenseFindMany },
    quotation: { groupBy: mockQuotationGroupBy },
    customer: { findMany: mockCustomerFindMany },
  };
  return { prisma: client, prismaUnscoped: client };
});

vi.mock('../lib/financialQueries', () => ({
  getRevenueSummary: mockGetRevenueSummary,
  getExpenseSummary: mockGetExpenseSummary,
  getOutstandingInvoices: mockGetOutstandingInvoices,
}));

import { getFinancialData } from '../services/ai/insightsService';

const TENANT = 'tenant-a';

function revenue(totalInvoiced: number, invoiceCount = 1) {
  return { totalInvoiced, invoiceCount, taxableRevenue: 0, outputTax: 0, totalPaid: 0, outstanding: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRevenueSummary.mockResolvedValue(revenue(0, 0));
  mockGetExpenseSummary.mockResolvedValue({ total: 0, count: 0, byCategory: [] });
  mockGetOutstandingInvoices.mockResolvedValue({ invoices: [], totalOutstanding: 0 });
  mockInvoiceGroupBy.mockResolvedValue([]);
  mockInvoiceFindMany.mockResolvedValue([]);
  mockExpenseFindMany.mockResolvedValue([]);
  mockQuotationGroupBy.mockResolvedValue([]);
  mockCustomerFindMany.mockResolvedValue([]);
});

describe('getFinancialData — grounding and scope', () => {
  it('sources revenue and expenses from the shared financialQueries helpers', async () => {
    await getFinancialData(TENANT);

    // This month, last month, YTD.
    expect(mockGetRevenueSummary).toHaveBeenCalledTimes(3);
    expect(mockGetExpenseSummary).toHaveBeenCalledTimes(3);
    for (const call of mockGetRevenueSummary.mock.calls) {
      expect(call[0]).toBe(TENANT);
    }
  });

  it('scopes every direct Prisma query to the tenant', async () => {
    await getFinancialData(TENANT);

    const wheres = [
      ...mockInvoiceGroupBy.mock.calls.map((c) => c[0].where),
      ...mockInvoiceFindMany.mock.calls.map((c) => c[0].where),
      ...mockExpenseFindMany.mock.calls.map((c) => c[0].where),
      ...mockQuotationGroupBy.mock.calls.map((c) => c[0].where),
    ];
    expect(wheres.length).toBeGreaterThan(0);
    for (const where of wheres) {
      expect(where).toMatchObject({ tenantId: TENANT, isDeleted: false });
    }
  });
});

describe('getFinancialData — response contract', () => {
  it('returns every key the endpoint and narrative prompt expect', async () => {
    const data = await getFinancialData(TENANT);

    expect(Object.keys(data).sort()).toEqual(
      [
        'cashFlow',
        'expenses',
        'expensesByCategory',
        'expensesByMonth',
        'invoiceStatusBreakdown',
        'overdue',
        'quotationConversion',
        'recentInvoices',
        'revenue',
        'revenueByMonth',
        'topCustomers',
      ].sort(),
    );
  });

  it('computes month-over-month change and cash flow from the summaries', async () => {
    mockGetRevenueSummary
      .mockResolvedValueOnce(revenue(1500, 3)) // this month
      .mockResolvedValueOnce(revenue(1000, 2)) // last month
      .mockResolvedValueOnce(revenue(9000, 20)); // YTD
    mockGetExpenseSummary
      .mockResolvedValueOnce({ total: 500, count: 2, byCategory: [] })
      .mockResolvedValueOnce({ total: 400, count: 1, byCategory: [] })
      .mockResolvedValueOnce({ total: 3000, count: 12, byCategory: [] });

    const data = await getFinancialData(TENANT) as Record<string, Record<string, number>>;

    expect(data.revenue).toMatchObject({ thisMonth: 1500, lastMonth: 1000, yearToDate: 9000 });
    expect(data.revenue.monthOverMonthChange).toBeCloseTo(50);
    expect(data.expenses.monthOverMonthChange).toBeCloseTo(25);
    expect(data.cashFlow).toMatchObject({ thisMonth: 1000, lastMonth: 600 });
  });

  it('reports no change rather than dividing by zero when the prior month was empty', async () => {
    mockGetRevenueSummary.mockResolvedValue(revenue(500, 1));

    const data = await getFinancialData(TENANT) as Record<string, Record<string, number>>;

    expect(data.revenue.monthOverMonthChange).toBe(0);
    expect(Number.isFinite(data.revenue.monthOverMonthChange)).toBe(true);
  });

  it('resolves grouped customer ids to names, replacing the Mongo $lookup', async () => {
    mockInvoiceGroupBy.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === 'customerId'
        ? [{ customerId: 'cus-1', _sum: { TotalAmount: '4000.0000' }, _count: { _all: 4 } }]
        : [],
    );
    mockCustomerFindMany.mockResolvedValue([{ id: 'cus-1', name: 'Acme Ltd' }]);

    const data = await getFinancialData(TENANT) as Record<string, unknown[]>;

    expect(data.topCustomers[0]).toEqual({
      customerId: 'cus-1',
      customerName: 'Acme Ltd',
      totalRevenue: 4000,
      invoiceCount: 4,
    });
  });

  it('labels an unresolvable customer "Unknown" instead of dropping the row', async () => {
    mockInvoiceGroupBy.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === 'customerId'
        ? [{ customerId: null, _sum: { TotalAmount: '100.0000' }, _count: { _all: 1 } }]
        : [],
    );

    const data = await getFinancialData(TENANT) as Record<string, Array<{ customerName: string }>>;

    expect(data.topCustomers[0].customerName).toBe('Unknown');
    expect(mockCustomerFindMany).not.toHaveBeenCalled();
  });

  it('buckets six months of invoices by calendar month, in chronological order', async () => {
    mockInvoiceFindMany.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
      args.select?.invoiceDate
        ? [
            { invoiceDate: new Date(2026, 5, 10), TotalAmount: '100.0000' },
            { invoiceDate: new Date(2026, 5, 20), TotalAmount: '50.0000' },
            { invoiceDate: new Date(2026, 4, 3), TotalAmount: '70.0000' },
          ]
        : [],
    );

    const data = await getFinancialData(TENANT) as Record<string, Array<Record<string, number>>>;

    expect(data.revenueByMonth).toEqual([
      { year: 2026, month: 5, total: 70, count: 1 },
      { year: 2026, month: 6, total: 150, count: 2 },
    ]);
  });

  it('caps expense categories at ten, highest first', async () => {
    const byCategory = Array.from({ length: 14 }, (_, i) => ({
      categoryId: `cat-${i}`,
      name: `Category ${i}`,
      total: 1000 - i,
    }));
    mockGetExpenseSummary.mockResolvedValue({ total: 0, count: 0, byCategory });

    const data = await getFinancialData(TENANT) as Record<string, unknown[]>;

    expect(data.expensesByCategory).toHaveLength(10);
    expect(data.expensesByCategory[0]).toEqual({
      categoryId: 'cat-0',
      categoryName: 'Category 0',
      total: 1000,
    });
  });

  it('summarises overdue invoices net of payments, with the oldest due date', async () => {
    mockGetOutstandingInvoices.mockResolvedValue({
      totalOutstanding: 2500,
      invoices: [
        { dueDate: new Date('2026-07-01') },
        { dueDate: new Date('2026-05-15') },
        { dueDate: null },
      ],
    });

    const data = await getFinancialData(TENANT) as Record<string, Record<string, unknown>>;

    expect(data.overdue).toMatchObject({ total: 2500, count: 3 });
    expect(data.overdue.oldestDue).toEqual(new Date('2026-05-15'));
  });

  it('converts recent-invoice Decimals to numbers so the prompt gets plain JSON', async () => {
    mockInvoiceFindMany.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
      args.select?.invoiceNumber
        ? [
            {
              id: 'inv-1',
              invoiceNumber: 'INV-1',
              TotalAmount: '1234.5600',
              status: 'PAID',
              invoiceDate: new Date('2026-08-01'),
              dueDate: null,
            },
          ]
        : [],
    );

    const data = await getFinancialData(TENANT) as Record<string, Array<Record<string, unknown>>>;

    expect(data.recentInvoices[0].TotalAmount).toBe(1234.56);
  });
});
