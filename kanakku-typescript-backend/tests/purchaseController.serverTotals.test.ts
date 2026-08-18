/**
 * Task 4 — server-authoritative document totals (controller-level).
 *
 * Asserts createPurchase IGNORES a bogus client-sent grandTotal/subTotal/totalTax
 * and persists the SERVER-recomputed figures. Purchases post to the GL from the
 * persisted totalAmount/totalTax, so this is the ledger-integrity guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { captured, mocks } = vi.hoisted(() => ({
  captured: {} as { purchase?: Record<string, unknown> },
  mocks: {
    contactFindFirst: vi.fn(),
    purchaseCreate: vi.fn(),
    companySettingsFindFirst: vi.fn(),
    userFindUnique: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => {
  const db: Record<string, unknown> = {
    contact: { findFirst: mocks.contactFindFirst },
    companySettings: { findFirst: mocks.companySettingsFindFirst },
    user: { findUnique: mocks.userFindUnique },
    supplier: { findFirst: vi.fn().mockResolvedValue(null) },
    product: { findUnique: vi.fn().mockResolvedValue(null) },
    purchase: { create: mocks.purchaseCreate },
    purchaseOrder: { updateMany: vi.fn() },
    supplierPayment: { create: vi.fn() },
    customFieldValue: { createMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { prisma: db };
});

vi.mock('../utils/mailer', () => ({ sendMail: vi.fn() }));

import { createPurchase } from '../controllers/Admin/Purchases/purchaseController';

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
  captured.purchase = undefined;
  mocks.contactFindFirst.mockResolvedValue({ id: 'c1', currencyCode: null, defaultTaxTreatment: null });
  mocks.userFindUnique.mockResolvedValue({ id: 'u1' });
  // approvalsEnabled=true defers GL posting so the test focuses on persisted totals.
  mocks.companySettingsFindFirst.mockResolvedValue({ approvalsEnabled: true, taxRegime: 'GST_INDIA' });
  mocks.purchaseCreate.mockImplementation(async (arg: { data: Record<string, unknown> }) => {
    captured.purchase = arg.data;
    return { id: 'pur-new', purchaseId: 'PUR-1', referenceNo: '', purchaseDate: new Date(), ...arg.data };
  });
});

describe('createPurchase — server-authoritative totals override a bogus client grandTotal', () => {
  it('persists server-recomputed taxableAmount/totalTax/totalAmount, not the client-sent values', async () => {
    // Two items: 2 × 100 = 200 base, CGST 9% + SGST 9% = 36 tax → grand 236.
    const { req, res } = makeReqRes({
      contactId: 'c1',
      billFrom: TENANT_ID,
      purchaseId: 'PUR-1',
      status: 'pending',
      items: [{ qty: 2, rate: 100, taxes: [{ percent: 9 }, { percent: 9 }] }],
      // Bogus client totals — must all be ignored.
      subTotal: 5,
      totalTax: 0,
      totalDiscount: 0,
      grandTotal: 5,
    });

    await createPurchase(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(captured.purchase).toBeDefined();
    expect(Number(captured.purchase!.taxableAmount)).toBe(200);
    expect(Number(captured.purchase!.totalTax)).toBe(36);
    expect(Number(captured.purchase!.totalDiscount)).toBe(0);
    expect(Number(captured.purchase!.totalAmount)).toBe(236);
  });
});
