/**
 * tests/transactionReportController.tenantScope.test.ts
 *
 * P0-2a regression tripwire: every report in transactionReportController.ts
 * previously aggregated across ALL tenants (zero userId usage anywhere in
 * the file). These tests mock prisma and assert that the `where` object
 * passed to every list/count/summary query carries the tenant's userId (or,
 * for InvoicePayment/SupplierPayment which have no own userId column, the
 * parent-relation `invoice: { userId }` / `purchase: { userId }` pattern).
 *
 * This is intentionally lightweight — it is not a full behavioural
 * simulation, just a guard against the tenant filter silently regressing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const {
  mockInvoiceFindMany,
  mockInvoiceCount,
  mockCreditNoteFindMany,
  mockCreditNoteCount,
  mockPurchaseFindMany,
  mockPurchaseCount,
  mockPurchaseOrderFindMany,
  mockPurchaseOrderCount,
  mockDebitNoteFindMany,
  mockDebitNoteCount,
  mockQuotationFindMany,
  mockQuotationCount,
  mockInvoicePaymentFindMany,
  mockSupplierPaymentFindMany,
  mockProductFindMany,
} = vi.hoisted(() => ({
  mockInvoiceFindMany: vi.fn(),
  mockInvoiceCount: vi.fn(),
  mockCreditNoteFindMany: vi.fn(),
  mockCreditNoteCount: vi.fn(),
  mockPurchaseFindMany: vi.fn(),
  mockPurchaseCount: vi.fn(),
  mockPurchaseOrderFindMany: vi.fn(),
  mockPurchaseOrderCount: vi.fn(),
  mockDebitNoteFindMany: vi.fn(),
  mockDebitNoteCount: vi.fn(),
  mockQuotationFindMany: vi.fn(),
  mockQuotationCount: vi.fn(),
  mockInvoicePaymentFindMany: vi.fn(),
  mockSupplierPaymentFindMany: vi.fn(),
  mockProductFindMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    invoice: { findMany: mockInvoiceFindMany, count: mockInvoiceCount },
    creditNote: { findMany: mockCreditNoteFindMany, count: mockCreditNoteCount },
    purchase: { findMany: mockPurchaseFindMany, count: mockPurchaseCount },
    purchaseOrder: { findMany: mockPurchaseOrderFindMany, count: mockPurchaseOrderCount },
    debitNote: { findMany: mockDebitNoteFindMany, count: mockDebitNoteCount },
    quotation: { findMany: mockQuotationFindMany, count: mockQuotationCount },
    invoicePayment: { findMany: mockInvoicePaymentFindMany },
    supplierPayment: { findMany: mockSupplierPaymentFindMany },
    product: { findMany: mockProductFindMany },
  },
}));

import {
  getInvoiceSalesReport,
  getCreditNoteSalesReport,
  getPurchaseReport,
  getPurchaseOrderReport,
  getDebitNoteReport,
  getQuotationSalesReport,
} from '../controllers/transactionReportController';

function makeReqRes(query: Record<string, unknown> = {}) {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, query } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

// A single fake invoice row, reused across current/previous/paginated calls
// so the payments pre-fetch (allInvoiceIds.length > 0) actually fires.
const fakeInvoice = {
  id: 'inv-1',
  invoiceNumber: 'INV-1',
  items: [],
  TotalAmount: 100,
  currencyCode: null,
  createdAt: new Date(),
  invoiceDate: new Date(),
  status: 'UNPAID',
  contact: null,
  billToCustomer: null,
};

// A single fake purchase row, reused across current/previous/paginated calls
// so the supplierPayment pre-fetch (purchaseIds.length > 0) actually fires.
const fakePurchase = {
  id: 'pur-1',
  purchaseId: 'PUR-1',
  items: [],
  totalAmount: 50,
  currencyCode: null,
  createdAt: new Date(),
  purchaseDate: new Date(),
  status: 'UNPAID',
  contact: null,
  supplier: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoiceFindMany.mockResolvedValue([fakeInvoice]);
  mockInvoiceCount.mockResolvedValue(0);
  mockCreditNoteFindMany.mockResolvedValue([]);
  mockCreditNoteCount.mockResolvedValue(0);
  mockPurchaseFindMany.mockResolvedValue([fakePurchase]);
  mockPurchaseCount.mockResolvedValue(0);
  mockPurchaseOrderFindMany.mockResolvedValue([]);
  mockPurchaseOrderCount.mockResolvedValue(0);
  mockDebitNoteFindMany.mockResolvedValue([]);
  mockDebitNoteCount.mockResolvedValue(0);
  mockQuotationFindMany.mockResolvedValue([]);
  mockQuotationCount.mockResolvedValue(0);
  mockInvoicePaymentFindMany.mockResolvedValue([]);
  mockSupplierPaymentFindMany.mockResolvedValue([]);
  mockProductFindMany.mockResolvedValue([]);
});

describe('transactionReportController — tenant scoping', () => {
  it('getInvoiceSalesReport scopes every invoice query and the payments pre-fetch by tenant', async () => {
    const { req, res } = makeReqRes();
    await getInvoiceSalesReport(req, res);

    expect(res.status).not.toHaveBeenCalledWith(401);

    // Count + all three findMany calls (current/previous/paginated) must carry userId.
    expect(mockInvoiceCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    for (const call of mockInvoiceFindMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
    }

    // InvoicePayment has no own userId — must scope via the parent invoice relation.
    expect(mockInvoicePaymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ invoice: { userId: TENANT_ID } }),
      }),
    );
  });

  it('getCreditNoteSalesReport scopes every credit note query by tenant', async () => {
    const { req, res } = makeReqRes();
    await getCreditNoteSalesReport(req, res);

    expect(mockCreditNoteCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    for (const call of mockCreditNoteFindMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
    }
  });

  it('getPurchaseReport scopes purchase queries and the supplierPayment pre-fetch by tenant', async () => {
    const { req, res } = makeReqRes();
    await getPurchaseReport(req, res);

    expect(mockPurchaseCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    for (const call of mockPurchaseFindMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
    }
    // SupplierPayment has no own userId — must scope via the parent purchase relation.
    expect(mockSupplierPaymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ purchase: { userId: TENANT_ID } }),
      }),
    );
  });

  it('getPurchaseOrderReport scopes every purchase order query by tenant', async () => {
    const { req, res } = makeReqRes();
    await getPurchaseOrderReport(req, res);

    expect(mockPurchaseOrderCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    for (const call of mockPurchaseOrderFindMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
    }
  });

  it('getDebitNoteReport scopes every debit note query by tenant', async () => {
    const { req, res } = makeReqRes();
    await getDebitNoteReport(req, res);

    expect(mockDebitNoteCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    for (const call of mockDebitNoteFindMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
    }
  });

  it('getQuotationSalesReport scopes every quotation query by tenant', async () => {
    const { req, res } = makeReqRes();
    await getQuotationSalesReport(req, res);

    expect(mockQuotationCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    for (const call of mockQuotationFindMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
    }
  });
});
