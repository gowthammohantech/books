/**
 * Task 4 — server-authoritative document totals (controller-level).
 *
 * Asserts createInvoice IGNORES a bogus client-sent grandTotal/subTotal/totalTax
 * and persists the SERVER-recomputed figures (derived from the line items). This
 * is the security-critical case: a client posting items worth 236 with
 * grandTotal 1 must NOT get an invoice (and GL) worth 1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { captured, mocks } = vi.hoisted(() => ({
  captured: {} as { invoice?: Record<string, unknown> },
  mocks: {
    contactFindFirst: vi.fn(),
    invoiceCreate: vi.fn(),
    companySettingsFindFirst: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => {
  const db: Record<string, unknown> = {
    generalSetting: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    invoice: { findFirst: vi.fn().mockResolvedValue(null), create: mocks.invoiceCreate },
    contact: { findFirst: mocks.contactFindFirst },
    companySettings: { findFirst: mocks.companySettingsFindFirst },
    product: { findUnique: vi.fn().mockResolvedValue(null) },
    inventory: { findFirst: vi.fn().mockResolvedValue(null) },
    customFieldValue: { createMany: vi.fn() },
    invoicePayment: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { prisma: db };
});

vi.mock('../utils/mailer', () => ({ sendMail: vi.fn() }));

import { createInvoice } from '../controllers/Admin/Invoice/invoiceController';

function makeReqRes(body: Record<string, unknown>) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    params: {},
    query: {},
    body,
    file: undefined,
    files: [],
    protocol: 'http',
    get: vi.fn().mockReturnValue('localhost'),
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  captured.invoice = undefined;
  mocks.contactFindFirst.mockResolvedValue({ id: 'c1', currencyCode: null, defaultTaxTreatment: null });
  // approvalsEnabled=true defers GL posting so the test focuses on persisted totals.
  mocks.companySettingsFindFirst.mockResolvedValue({ approvalsEnabled: true, taxRegime: 'GST_INDIA' });
  mocks.invoiceCreate.mockImplementation(async (arg: { data: Record<string, unknown> }) => {
    captured.invoice = arg.data;
    return { id: 'inv-new', referenceNo: '', ...arg.data };
  });
});

describe('createInvoice — server-authoritative totals override a bogus client grandTotal', () => {
  it('persists server-recomputed subTotal/vat/TotalAmount, not the client-sent values', async () => {
    // Two items: 2 × 100 = 200 base, CGST 9% + SGST 9% = 36 tax → grand 236.
    const { req, res } = makeReqRes({
      contactId: 'c1',
      billFrom: TENANT_ID,
      status: 'DRAFT',
      items: [{ qty: 2, rate: 100, taxes: [{ percent: 9 }, { percent: 9 }] }],
      // Bogus client totals — must all be ignored.
      subTotal: 1,
      totalTax: 0,
      totalDiscount: 0,
      grandTotal: 1,
    });

    await createInvoice(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(captured.invoice).toBeDefined();
    expect(Number(captured.invoice!.taxableAmount)).toBe(200);
    expect(Number(captured.invoice!.vat)).toBe(36);
    expect(Number(captured.invoice!.totalDiscount)).toBe(0);
    expect(Number(captured.invoice!.TotalAmount)).toBe(236);
  });
});
