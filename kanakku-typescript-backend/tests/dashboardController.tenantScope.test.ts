/**
 * tests/dashboardController.tenantScope.test.ts
 *
 * P0-2a regression tripwire: controllers/Admin/dashboardController.ts
 * previously aggregated counts, KPIs, graphs, and aging/top-debtor data
 * across ALL tenants (only the supplier count was scoped). These tests mock
 * prisma and assert that the `where` object passed to every tenant-owned
 * model's query carries the tenant's userId (directly, or via the parent
 * relation for InvoicePayment/SupplierPayment).
 *
 * Product is intentionally excluded — it is a shared catalog with no
 * tenant column in this schema, so its count/lookups stay global by design.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const {
  mockInvoiceCount,
  mockInvoiceFindMany,
  mockInvoiceAggregate,
  mockProductCount,
  mockProductFindMany,
  mockCustomerCount,
  mockCustomerFindMany,
  mockContactCount,
  mockContactFindMany,
  mockPurchaseFindMany,
  mockPurchaseAggregate,
  mockInvoicePaymentFindMany,
  mockInvoicePaymentAggregate,
  mockQuotationCount,
  mockSupplierPaymentAggregate,
  mockDebitNoteCount,
  mockCreditNoteFindMany,
} = vi.hoisted(() => ({
  mockInvoiceCount: vi.fn(),
  mockInvoiceFindMany: vi.fn(),
  mockInvoiceAggregate: vi.fn(),
  mockProductCount: vi.fn(),
  mockProductFindMany: vi.fn(),
  mockCustomerCount: vi.fn(),
  mockCustomerFindMany: vi.fn(),
  mockContactCount: vi.fn(),
  mockContactFindMany: vi.fn(),
  mockPurchaseFindMany: vi.fn(),
  mockPurchaseAggregate: vi.fn(),
  mockInvoicePaymentFindMany: vi.fn(),
  mockInvoicePaymentAggregate: vi.fn(),
  mockQuotationCount: vi.fn(),
  mockSupplierPaymentAggregate: vi.fn(),
  mockDebitNoteCount: vi.fn(),
  mockCreditNoteFindMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    invoice: {
      count: mockInvoiceCount,
      findMany: mockInvoiceFindMany,
      aggregate: mockInvoiceAggregate,
    },
    product: { count: mockProductCount, findMany: mockProductFindMany },
    customer: { count: mockCustomerCount, findMany: mockCustomerFindMany },
    contact: { count: mockContactCount, findMany: mockContactFindMany },
    purchase: { findMany: mockPurchaseFindMany, aggregate: mockPurchaseAggregate },
    invoicePayment: { findMany: mockInvoicePaymentFindMany, aggregate: mockInvoicePaymentAggregate },
    quotation: { count: mockQuotationCount },
    supplierPayment: { aggregate: mockSupplierPaymentAggregate },
    debitNote: { count: mockDebitNoteCount },
    creditNote: { findMany: mockCreditNoteFindMany },
  },
}));

import { getDashboard } from '../controllers/Admin/dashboardController';

function makeReqRes() {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, query: {} } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoiceCount.mockResolvedValue(0);
  mockInvoiceFindMany.mockResolvedValue([]);
  mockInvoiceAggregate.mockResolvedValue({ _sum: { TotalAmount: 0 } });
  mockProductCount.mockResolvedValue(0);
  mockProductFindMany.mockResolvedValue([]);
  mockCustomerCount.mockResolvedValue(0);
  mockCustomerFindMany.mockResolvedValue([]);
  mockContactCount.mockResolvedValue(0);
  mockContactFindMany.mockResolvedValue([]);
  mockPurchaseFindMany.mockResolvedValue([]);
  mockPurchaseAggregate.mockResolvedValue({ _sum: { totalAmount: 0, balanceAmount: 0 } });
  mockInvoicePaymentFindMany.mockResolvedValue([]);
  mockInvoicePaymentAggregate.mockResolvedValue({ _sum: { amount: 0 } });
  mockQuotationCount.mockResolvedValue(0);
  mockSupplierPaymentAggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });
  mockDebitNoteCount.mockResolvedValue(0);
  mockCreditNoteFindMany.mockResolvedValue([]);
});

describe('dashboardController.getDashboard — tenant scoping', () => {
  it('scopes the invoice count, last-5, KPI aggregates, graphs, and aging query by tenant', async () => {
    const { req, res } = makeReqRes();
    await getDashboard(req, res);

    expect(res.status).not.toHaveBeenCalledWith(401);

    // Every invoice.count / invoice.findMany / invoice.aggregate call must carry userId.
    for (const call of mockInvoiceCount.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
    }
    expect(mockInvoiceFindMany.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockInvoiceFindMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
    }
    expect(mockInvoiceAggregate.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockInvoiceAggregate.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
    }
  });

  it('scopes customer count/last-5 by tenant', async () => {
    const { req, res } = makeReqRes();
    await getDashboard(req, res);

    expect(mockCustomerCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    expect(mockCustomerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
  });

  it('scopes purchase KPI/last-5/graph queries by tenant', async () => {
    const { req, res } = makeReqRes();
    await getDashboard(req, res);

    expect(mockPurchaseFindMany.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockPurchaseFindMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
    }
    for (const call of mockPurchaseAggregate.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
    }
  });

  it('scopes InvoicePayment (last-5 payments + received KPI) via the parent invoice relation', async () => {
    const { req, res } = makeReqRes();
    await getDashboard(req, res);

    expect(mockInvoicePaymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ invoice: { userId: TENANT_ID } }),
      }),
    );
    expect(mockInvoicePaymentAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ invoice: { userId: TENANT_ID } }),
      }),
    );
  });

  it('scopes SupplierPayment aggregate via the parent purchase relation', async () => {
    const { req, res } = makeReqRes();
    await getDashboard(req, res);

    expect(mockSupplierPaymentAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ purchase: { userId: TENANT_ID } }),
      }),
    );
  });

  it('scopes quotationCount and debitNoteCount by tenant', async () => {
    const { req, res } = makeReqRes();
    await getDashboard(req, res);

    expect(mockQuotationCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    expect(mockDebitNoteCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
  });
});
