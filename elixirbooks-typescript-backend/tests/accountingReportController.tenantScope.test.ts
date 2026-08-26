/**
 * tests/accountingReportController.tenantScope.test.ts
 *
 * P0-2a regression tripwire: controllers/accountingReportController.ts called
 * requireUserId(req) but discarded the result, so getIncomeStats,
 * getPurchaseReport, and getPaymentSummaryReport all aggregated payments
 * across every tenant. InvoicePayment/SupplierPayment have no own userId
 * column, so scoping goes via the parent relation (`invoice: { userId }` /
 * `purchase: { userId }`), matching the pattern in financialStatementsController.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const {
  mockInvoicePaymentFindMany,
  mockInvoicePaymentCount,
  mockInvoicePaymentGroupBy,
  mockSupplierPaymentFindMany,
  mockSupplierPaymentCount,
  mockPaymentModeFindMany,
} = vi.hoisted(() => ({
  mockInvoicePaymentFindMany: vi.fn(),
  mockInvoicePaymentCount: vi.fn(),
  mockInvoicePaymentGroupBy: vi.fn(),
  mockSupplierPaymentFindMany: vi.fn(),
  mockSupplierPaymentCount: vi.fn(),
  mockPaymentModeFindMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    invoicePayment: {
      findMany: mockInvoicePaymentFindMany,
      count: mockInvoicePaymentCount,
      groupBy: mockInvoicePaymentGroupBy,
    },
    supplierPayment: {
      findMany: mockSupplierPaymentFindMany,
      count: mockSupplierPaymentCount,
    },
    paymentMode: { findMany: mockPaymentModeFindMany },
  },
}));

import {
  getIncomeStats,
  getPurchaseReport,
  getPaymentSummaryReport,
} from '../controllers/accountingReportController';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';

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
  mockInvoicePaymentFindMany.mockResolvedValue([]);
  mockInvoicePaymentCount.mockResolvedValue(0);
  mockInvoicePaymentGroupBy.mockResolvedValue([]);
  mockSupplierPaymentFindMany.mockResolvedValue([]);
  mockSupplierPaymentCount.mockResolvedValue(0);
  mockPaymentModeFindMany.mockResolvedValue([]);
});

describe('accountingReportController — tenant scoping', () => {
  it('getIncomeStats scopes every invoicePayment query via the parent invoice relation', async () => {
    const { req, res } = makeReqRes();
    await getIncomeStats(req, res);

    expect(res.status).not.toHaveBeenCalledWith(401);
    for (const call of mockInvoicePaymentFindMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ invoice: { userId: TENANT_ID } }));
    }
    expect(mockInvoicePaymentCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ invoice: { userId: TENANT_ID } }) }),
    );
  });

  it('getIncomeStats resolves the customer name from the unified contact when the legacy customer is null (no "Deleted User")', async () => {
    const contact = {
      id: 'contact-1', firstName: 'John', lastName: 'Doe', organisation: null,
      email: 'john@acme.test', mobile: '555-1', telephone: null, image: null,
    };
    const payment = {
      id: 'pay-1', received_on: new Date('2026-07-05'), amount: 100,
      currencyCode: 'INR', createdAt: new Date('2026-07-05'), paymentMode: null,
      invoice: {
        id: 'inv-1', invoiceNumber: 'INV-1', referenceNo: '', items: [],
        customer: null, contact, billToContact: null,
      },
    };
    mockInvoicePaymentFindMany.mockResolvedValue([payment]);
    mockInvoicePaymentCount.mockResolvedValue(1);

    const { req, res } = makeReqRes();
    await getIncomeStats(req, res);

    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      records: { customer: { name: string } }[];
    };
    const name = body.records[0].customer.name;
    expect(name).toBe(resolveDisplayName(contact));
    expect(name).not.toBe('');
  });

  it('getPurchaseReport scopes every supplierPayment query via the parent purchase relation', async () => {
    const { req, res } = makeReqRes();
    await getPurchaseReport(req, res);

    for (const call of mockSupplierPaymentFindMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ purchase: { userId: TENANT_ID } }));
    }
    expect(mockSupplierPaymentCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ purchase: { userId: TENANT_ID } }) }),
    );
  });

  it('getPaymentSummaryReport scopes groupBy, findMany and count via the parent invoice relation', async () => {
    const { req, res } = makeReqRes();
    await getPaymentSummaryReport(req, res);

    expect(mockInvoicePaymentGroupBy.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockInvoicePaymentGroupBy.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ invoice: { userId: TENANT_ID } }));
    }
    expect(mockInvoicePaymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ invoice: { userId: TENANT_ID } }) }),
    );
    expect(mockInvoicePaymentCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ invoice: { userId: TENANT_ID } }) }),
    );
  });
});
