/**
 * tests/task7.purchaseReportTiles.test.ts
 *
 * P1 Task 7, bug 3: the purchase report SUMMARY TILES must be aggregated over
 * the whole filtered set, not the paginated slice, and the "pending/open" tile
 * must use real PurchaseStatus enum values (new/pending/partially_paid) — the
 * old code filtered on the nonexistent 'unpaid' value over the current page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { mockPurchaseFindMany, mockPurchaseCount, mockProductFindMany, mockSupplierPaymentFindMany } =
  vi.hoisted(() => ({
    mockPurchaseFindMany: vi.fn(),
    mockPurchaseCount: vi.fn(),
    mockProductFindMany: vi.fn(),
    mockSupplierPaymentFindMany: vi.fn(),
  }));

vi.mock('../lib/prisma', () => ({
  prisma: {
    purchase: { findMany: mockPurchaseFindMany, count: mockPurchaseCount },
    product: { findMany: mockProductFindMany },
    supplierPayment: { findMany: mockSupplierPaymentFindMany },
  },
}));

import { getPurchaseReport } from '../controllers/transactionReportController';

// The full filtered set (5 bills across every status) — what the summary tiles
// MUST be computed from.
const FULL_SET = [
  { status: 'new', totalAmount: 100 },
  { status: 'pending', totalAmount: 200 },
  { status: 'partially_paid', totalAmount: 50 },
  { status: 'paid', totalAmount: 1000 },
  { status: 'cancelled', totalAmount: 999 },
];

// A single paginated row (one page) — the old buggy code summed tiles from this.
const PAGE_ROW = {
  id: 'p-paid',
  purchaseId: 'PUR-PAID',
  totalAmount: 1000,
  status: 'paid',
  currencyCode: null,
  purchaseDate: new Date(),
  items: null,
  contact: null,
  supplier: null,
};

function makeReqRes() {
  const req = { tenantId: TENANT_ID, query: { page: '1', limit: '10' } } as unknown as Request;
  const json = vi.fn().mockReturnThis();
  const res = { status: vi.fn().mockReturnThis(), json } as unknown as Response;
  return { req, res, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPurchaseCount.mockResolvedValue(5);
  mockProductFindMany.mockResolvedValue([]);
  mockSupplierPaymentFindMany.mockResolvedValue([]);
  mockPurchaseFindMany.mockImplementation((args: { select?: unknown; include?: unknown; skip?: number }) => {
    // Summary query: select-only, no include (the un-paginated aggregate).
    if (args.select && !args.include) return Promise.resolve(FULL_SET);
    // Paginated records query.
    if (args.skip !== undefined) return Promise.resolve([PAGE_ROW]);
    // current/previous month card queries.
    return Promise.resolve([]);
  });
});

describe('getPurchaseReport — summary tiles (bug 3)', () => {
  it('computes the total tile over the full filtered set, not the page', async () => {
    const { req, res, json } = makeReqRes();
    await getPurchaseReport(req, res);

    const data = json.mock.calls[0][0].data;
    // 100 + 200 + 50 + 1000 + 999 = 2349 (NOT the single page row's 1000)
    expect(data.totalPurchases.totalAmount).toBe(2349);
  });

  it('the open/pending tile includes new + pending + partially_paid', async () => {
    const { req, res, json } = makeReqRes();
    await getPurchaseReport(req, res);

    const data = json.mock.calls[0][0].data;
    expect(data.pendingOrders.count).toBe(3);
    expect(data.pendingOrders.totalAmount).toBe(350); // 100 + 200 + 50
  });
});
