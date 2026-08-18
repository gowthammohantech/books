/**
 * tests/task7.dashboardKpis.test.ts
 *
 * P1 Task 7, bug 1 (dashboard KPIs):
 *  - total sales excludes DRAFT/CANCELLED (status) and PROFORMA (invoiceType);
 *  - amount due is the OUTSTANDING receivable (Total − payments − credit notes),
 *    not the full TotalAmount (which double-counts the received portion);
 *  - graph2 is scoped to a single year (createdAt window) so month buckets from
 *    different years don't collapse together.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const H = vi.hoisted(() => ({
  invoiceCount: vi.fn(),
  invoiceFindMany: vi.fn(),
  invoiceAggregate: vi.fn(),
  productCount: vi.fn(),
  productFindMany: vi.fn(),
  customerCount: vi.fn(),
  customerFindMany: vi.fn(),
  contactCount: vi.fn(),
  contactFindMany: vi.fn(),
  purchaseFindMany: vi.fn(),
  purchaseAggregate: vi.fn(),
  invoicePaymentFindMany: vi.fn(),
  invoicePaymentAggregate: vi.fn(),
  quotationCount: vi.fn(),
  supplierPaymentAggregate: vi.fn(),
  debitNoteCount: vi.fn(),
  creditNoteFindMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    invoice: { count: H.invoiceCount, findMany: H.invoiceFindMany, aggregate: H.invoiceAggregate },
    product: { count: H.productCount, findMany: H.productFindMany },
    customer: { count: H.customerCount, findMany: H.customerFindMany },
    contact: { count: H.contactCount, findMany: H.contactFindMany },
    purchase: { findMany: H.purchaseFindMany, aggregate: H.purchaseAggregate },
    invoicePayment: { findMany: H.invoicePaymentFindMany, aggregate: H.invoicePaymentAggregate },
    quotation: { count: H.quotationCount },
    supplierPayment: { aggregate: H.supplierPaymentAggregate },
    debitNote: { count: H.debitNoteCount },
    creditNote: { findMany: H.creditNoteFindMany },
  },
}));

import { getDashboard } from '../controllers/Admin/dashboardController';

const AGING_INVOICE = {
  id: 'inv1',
  invoiceNumber: 'INV-1',
  invoiceDate: new Date('2026-01-10'),
  dueDate: new Date('2026-01-20'),
  TotalAmount: 1000,
  billTo: 'c1',
  billToCustomer: { id: 'c1', name: 'Acme' },
  payments: [{ amount: 400 }],
};

function makeReqRes(query: Record<string, unknown> = {}) {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, query } as unknown as Request;
  const json = vi.fn().mockReturnThis();
  const res = { status: vi.fn().mockReturnThis(), json } as unknown as Response;
  return { req, res, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.invoiceCount.mockResolvedValue(0);
  H.invoiceAggregate.mockResolvedValue({ _sum: { TotalAmount: 0 } });
  H.productCount.mockResolvedValue(0);
  H.productFindMany.mockResolvedValue([]);
  H.customerCount.mockResolvedValue(0);
  H.customerFindMany.mockResolvedValue([]);
  H.contactCount.mockResolvedValue(0);
  H.contactFindMany.mockResolvedValue([]);
  H.purchaseFindMany.mockResolvedValue([]);
  H.purchaseAggregate.mockResolvedValue({ _sum: { totalAmount: 0, balanceAmount: 0 } });
  H.invoicePaymentFindMany.mockResolvedValue([]);
  H.invoicePaymentAggregate.mockResolvedValue({ _sum: { amount: 0 } });
  H.quotationCount.mockResolvedValue(0);
  H.supplierPaymentAggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });
  H.debitNoteCount.mockResolvedValue(0);
  H.creditNoteFindMany.mockResolvedValue([]);

  // invoice.findMany fans out to last-5 / graph1 / graph2 / aging — key on select.
  H.invoiceFindMany.mockImplementation((args: { select?: Record<string, unknown> }) => {
    const select = args.select ?? {};
    if (select.payments) return Promise.resolve([AGING_INVOICE]); // aging
    return Promise.resolve([]); // last-5, graph1, graph2
  });
});

describe('dashboard KPIs (bug 1)', () => {
  it('total sales excludes DRAFT/CANCELLED and PROFORMA', async () => {
    const { req, res } = makeReqRes();
    await getDashboard(req, res);

    const salesCall = H.invoiceAggregate.mock.calls
      .map((c) => c[0])
      .find((a) => a.where?.invoiceType === 'INVOICE' && a.where?.status && !a.where?.createdAt);

    expect(salesCall).toBeDefined();
    const statuses = salesCall.where.status.in as string[];
    expect(statuses).not.toContain('DRAFT');
    expect(statuses).not.toContain('CANCELLED');
    expect(statuses).toEqual(expect.arrayContaining(['PAID', 'UNPAID']));
    expect(salesCall.where.invoiceType).toBe('INVOICE'); // excludes PROFORMA
  });

  it('amount due is outstanding (Total − payments − credit notes), not full total', async () => {
    // 100 credit note against the same invoice → outstanding = 1000 − 400 − 100.
    H.creditNoteFindMany.mockResolvedValue([{ invoiceId: 'inv1', totalAmount: 100 }]);

    const { req, res, json } = makeReqRes();
    await getDashboard(req, res);

    const data = json.mock.calls[0][0].data;
    expect(data.sales.totalDueAmount).toBe(500);
  });

  it('graph2 is scoped to a single calendar year via a createdAt window', async () => {
    const { req, res } = makeReqRes();
    await getDashboard(req, res);

    // The graph2 sales query selects exactly createdAt + TotalAmount.
    const graphCall = H.invoiceFindMany.mock.calls
      .map((c) => c[0])
      .find((a) => {
        const keys = Object.keys(a.select ?? {}).sort();
        return keys.length === 2 && keys[0] === 'TotalAmount' && keys[1] === 'createdAt';
      });

    expect(graphCall).toBeDefined();
    expect(graphCall.where.createdAt?.gte).toBeInstanceOf(Date);
    expect(graphCall.where.createdAt?.lte).toBeInstanceOf(Date);
    const currentYear = new Date().getFullYear();
    expect((graphCall.where.createdAt.gte as Date).getFullYear()).toBe(currentYear);
  });
});
