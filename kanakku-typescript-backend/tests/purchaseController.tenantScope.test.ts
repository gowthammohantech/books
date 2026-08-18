/**
 * tests/purchaseController.tenantScope.test.ts
 *
 * P0-2b regression tripwire: several by-id/lookup handlers in
 * controllers/Admin/Purchases/purchaseController.ts loaded Purchase /
 * PurchaseOrder / SupplierPayment rows with no `userId` filter at all
 * (`findUnique({ where: { id } })`), letting any authenticated tenant
 * read/mutate another tenant's purchases by guessing/observing an id.
 * The legacy `createSupplierPayment` additionally trusted a client-supplied
 * `body.userId` instead of the authenticated session for both the lookup
 * and the `createdBy` stamp.
 *
 * These tests mock prisma and assert every fixed handler's lookup carries
 * `userId` (the authenticated tenant, never a client-supplied value) and
 * 404s when the mocked lookup returns null (simulating a foreign-tenant id).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';
const ATTACKER_ID = 'attacker-tenant';

const {
  mockPurchaseFindFirst,
  mockPurchaseFindUnique,
  mockPurchaseFindMany,
  mockPurchaseUpdate,
  mockPurchaseOrderFindFirst,
  mockSupplierPaymentFindMany,
  mockSupplierPaymentCreate,
  mockBankDetailFindFirst,
  mockPaymentModeFindUnique,
} = vi.hoisted(() => ({
  mockPurchaseFindFirst: vi.fn(),
  mockPurchaseFindUnique: vi.fn(),
  mockPurchaseFindMany: vi.fn(),
  mockPurchaseUpdate: vi.fn(),
  mockPurchaseOrderFindFirst: vi.fn(),
  mockSupplierPaymentFindMany: vi.fn(),
  mockSupplierPaymentCreate: vi.fn(),
  mockBankDetailFindFirst: vi.fn(),
  mockPaymentModeFindUnique: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const tx = {
    purchase: { findFirst: mockPurchaseFindFirst, update: mockPurchaseUpdate },
    purchaseOrder: { findFirst: mockPurchaseOrderFindFirst },
    supplierPayment: { create: mockSupplierPaymentCreate },
    bankDetail: { findFirst: mockBankDetailFindFirst },
    paymentMode: { findUnique: mockPaymentModeFindUnique },
  };
  return {
    prisma: {
      purchase: {
        findFirst: mockPurchaseFindFirst,
        findUnique: mockPurchaseFindUnique,
        findMany: mockPurchaseFindMany,
        update: mockPurchaseUpdate,
      },
      purchaseOrder: { findFirst: mockPurchaseOrderFindFirst },
      supplierPayment: { findMany: mockSupplierPaymentFindMany, create: mockSupplierPaymentCreate },
      bankDetail: { findFirst: mockBankDetailFindFirst },
      paymentMode: { findUnique: mockPaymentModeFindUnique },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
});

// utils/mailer is required (not imported) by the controller; stub it so the
// module loads without touching a real transport.
vi.mock('../utils/mailer', () => ({ sendMail: vi.fn() }));

import {
  createPurchaseFromPO,
  updatePurchaseStatus,
  deletePurchase,
  getPurchaseById,
  approvePurchase,
  rejectPurchase,
  getSupplierPayments,
  createSupplierPayment,
} from '../controllers/Admin/Purchases/purchaseController';

function makeReqRes(opts: {
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
} = {}) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    params: opts.params ?? {},
    query: opts.query ?? {},
    body: opts.body ?? {},
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
  mockPurchaseFindFirst.mockResolvedValue(null);
  mockPurchaseFindUnique.mockResolvedValue(null);
  mockPurchaseOrderFindFirst.mockResolvedValue(null);
  mockSupplierPaymentFindMany.mockResolvedValue([]);
});

describe('purchaseController — tenant scoping (404 on foreign-tenant id)', () => {
  it('createPurchaseFromPO scopes the PurchaseOrder lookup by tenant and 404s on a foreign id', async () => {
    const { req, res } = makeReqRes({ body: { purchaseOrderId: 'po-1' } });
    await createPurchaseFromPO(req, res);

    expect(mockPurchaseOrderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'po-1', userId: TENANT_ID }) }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('updatePurchaseStatus scopes the Purchase lookup by tenant and 404s on a foreign id', async () => {
    const { req, res } = makeReqRes({ params: { id: 'pur-1' }, body: { status: 'paid' } });
    await updatePurchaseStatus(req, res);

    expect(mockPurchaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pur-1', userId: TENANT_ID } }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('deletePurchase scopes the Purchase lookup by tenant and 404s on a foreign id', async () => {
    const { req, res } = makeReqRes({ params: { id: 'pur-1' } });
    await deletePurchase(req, res);

    expect(mockPurchaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pur-1', userId: TENANT_ID } }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('getPurchaseById scopes the Purchase lookup by tenant and 404s on a foreign id (sibling gap fix)', async () => {
    const { req, res } = makeReqRes({ params: { id: 'pur-1' } });
    await getPurchaseById(req, res);

    expect(mockPurchaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'pur-1', userId: TENANT_ID }) }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('approvePurchase scopes the Purchase lookup by tenant and 404s on a foreign id (sibling gap fix)', async () => {
    const { req, res } = makeReqRes({ params: { id: 'pur-1' } });
    await approvePurchase(req, res);

    expect(mockPurchaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'pur-1', userId: TENANT_ID }) }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rejectPurchase scopes the Purchase lookup by tenant and 404s on a foreign id (sibling gap fix)', async () => {
    const { req, res } = makeReqRes({ params: { id: 'pur-1' }, body: { reason: 'no' } });
    await rejectPurchase(req, res);

    expect(mockPurchaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'pur-1', userId: TENANT_ID }) }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('getSupplierPayments scopes the owning-Purchase check by tenant and 404s on a foreign purchaseId (sibling gap fix)', async () => {
    const { req, res } = makeReqRes({ params: { purchaseId: 'pur-1' } });
    await getSupplierPayments(req, res);

    expect(mockPurchaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pur-1', userId: TENANT_ID } }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockSupplierPaymentFindMany).not.toHaveBeenCalled();
  });

  it('legacy createSupplierPayment scopes the Purchase lookup by tenant and 404s on a foreign id', async () => {
    const { req, res } = makeReqRes({ body: { purchaseId: 'pur-1', amount: 100 } });
    await createSupplierPayment(req, res);

    expect(mockPurchaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pur-1', userId: TENANT_ID } }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('legacy createSupplierPayment ignores a spoofed body.userId — the lookup and createdBy stamp use the authenticated tenant', async () => {
    mockPurchaseFindFirst.mockResolvedValue({
      id: 'pur-1',
      purchaseId: 'PUR-000001',
      supplierId: 'sup-1',
      billTo: null,
      paidAmount: 0,
      totalAmount: 500,
      status: 'pending',
    });
    mockSupplierPaymentCreate.mockResolvedValue({ id: 'sp-1' });
    mockPurchaseUpdate.mockResolvedValue({});

    const { req, res } = makeReqRes({
      // no bankId -> the bank/paymentMode sub-branch is skipped entirely
      body: { purchaseId: 'pur-1', amount: 100, userId: ATTACKER_ID },
    });
    await createSupplierPayment(req, res);

    // The lookup used the authenticated tenant, not the spoofed body.userId.
    expect(mockPurchaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pur-1', userId: TENANT_ID } }),
    );
    expect(mockSupplierPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdBy: TENANT_ID }) }),
    );
    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
