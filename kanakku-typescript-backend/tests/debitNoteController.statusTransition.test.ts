/**
 * tests/debitNoteController.statusTransition.test.ts
 *
 * P1-4 fix round 1 (Important, code review of Task 4 inventory cost work):
 * `updateDebitNoteStatus` previously wrote ONLY status/payment/signature
 * fields and never touched stock or the GL. DebitNote defaults to `new`
 * (schema `@default(new)`), and createDebitNote's status gate (bug 2a) means
 * a DN created `new` moves no stock and posts no GL — so a DN created `new`
 * and later transitioned to `completed`/`paid` via this endpoint silently
 * never decremented inventory or posted GL (stock-loss / missing GL hole).
 *
 * This mirrors updatePurchaseStatus's new->stocked / stocked->cancelled
 * transition handling (Task 6 / P0-4). These tests assert:
 *   - new -> completed applies stock_out + posts GL (same split as create).
 *   - completed -> cancelled reverses stock (stock_in at resolveRestockUnitCost)
 *     and voids the GL entry (voidDocument, not reverseDocument).
 *   - same-status and stocked<->stocked transitions are no-ops (idempotent —
 *     stock/GL must not be re-applied on e.g. completed -> paid).
 *   - new -> cancelled (both unstocked) is a no-op.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';
const DN_ID = 'dn-1';

const {
  mockDebitNoteFindFirst,
  mockTxDebitNoteUpdate,
  mockTxProductFindUnique,
  mockApplyStockAdjustment,
  mockResolveRestockUnitCost,
  mockPostDebitNoteIssued,
  mockVoidDocument,
  mockReverseDocument,
} = vi.hoisted(() => ({
  mockDebitNoteFindFirst: vi.fn(),
  mockTxDebitNoteUpdate: vi.fn(),
  mockTxProductFindUnique: vi.fn(),
  mockApplyStockAdjustment: vi.fn(),
  mockResolveRestockUnitCost: vi.fn(),
  mockPostDebitNoteIssued: vi.fn(),
  mockVoidDocument: vi.fn(),
  mockReverseDocument: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const tx = {
    debitNote: { update: mockTxDebitNoteUpdate },
    product: { findUnique: mockTxProductFindUnique },
  };
  return {
    prisma: {
      debitNote: { findFirst: mockDebitNoteFindFirst },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-1' }) },
      contact: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('../lib/ledger/ledgerPosting', () => ({
  postDebitNoteIssued: mockPostDebitNoteIssued,
  voidDocument: mockVoidDocument,
  reverseDocument: mockReverseDocument,
}));
vi.mock('../lib/inventory/stockAdjust', () => ({
  applyStockAdjustment: mockApplyStockAdjustment,
  resolveRestockUnitCost: mockResolveRestockUnitCost,
}));
vi.mock('../utils/mailer', () => ({
  sendMail: vi.fn(),
}));
vi.mock('express-validator', () => ({
  validationResult: vi.fn(() => ({ isEmpty: () => true, array: () => [] })),
}));

import { updateDebitNoteStatus } from '../controllers/Admin/Purchases/debitNoteController';

function makeReqRes(overrides: { params?: Record<string, unknown>; body?: Record<string, unknown> } = {}) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    params: overrides.params ?? { id: DN_ID },
    query: {},
    body: overrides.body ?? {},
    protocol: 'http',
    get: () => 'localhost',
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

function baseDebitNote(status: string) {
  return {
    id: DN_ID,
    userId: TENANT_ID,
    isDeleted: false,
    status,
    items: [{ productId: 'prod-1', quantity: 2, amount: 200 }],
    totalAmount: 200,
    totalTax: 0,
    contactId: null,
    taxTreatment: null,
    debitNoteDate: new Date('2026-01-01'),
    signatureImage: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTxProductFindUnique.mockResolvedValue({ item_type: 'Product' });
  mockResolveRestockUnitCost.mockResolvedValue(50);
  mockTxDebitNoteUpdate.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
      ...baseDebitNote((data.status as string) ?? 'new'),
      id: where.id,
      approvedByUser: null,
    }),
  );
});

describe('updateDebitNoteStatus — stock/GL on status transition (P1-4)', () => {
  it('new -> completed applies stock_out and posts GL (mirrors createDebitNote)', async () => {
    mockDebitNoteFindFirst.mockResolvedValue(baseDebitNote('new'));
    const { req, res } = makeReqRes({ body: { status: 'completed' } });

    await updateDebitNoteStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockApplyStockAdjustment).toHaveBeenCalledTimes(1);
    expect(mockApplyStockAdjustment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        productId: 'prod-1',
        qtyDelta: -2,
        type: 'stock_out',
        referenceType: 'purchase_return',
        referenceId: DN_ID,
      }),
    );
    expect(mockPostDebitNoteIssued).toHaveBeenCalledTimes(1);
    expect(mockPostDebitNoteIssued).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        debitNoteId: DN_ID,
        total: '200',
        tax: '0',
        inventoryNet: '200',
        expenseNet: '0',
      }),
    );
    expect(mockVoidDocument).not.toHaveBeenCalled();
  });

  it('completed -> cancelled reverses stock at resolveRestockUnitCost and voids GL', async () => {
    mockDebitNoteFindFirst.mockResolvedValue(baseDebitNote('completed'));
    const { req, res } = makeReqRes({ body: { status: 'cancelled' } });

    await updateDebitNoteStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockResolveRestockUnitCost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ productId: 'prod-1' }),
    );
    expect(mockApplyStockAdjustment).toHaveBeenCalledTimes(1);
    expect(mockApplyStockAdjustment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        productId: 'prod-1',
        qtyDelta: 2,
        type: 'stock_in',
        referenceType: 'purchase_return',
        referenceId: DN_ID,
        unitCost: 50,
      }),
    );
    expect(mockVoidDocument).toHaveBeenCalledTimes(1);
    expect(mockVoidDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceType: 'DebitNote', sourceId: DN_ID, event: 'issued' }),
    );
    expect(mockPostDebitNoteIssued).not.toHaveBeenCalled();
    // Reversal must use voidDocument (frees the idempotency slot), never
    // reverseDocument (which would leave a live forward entry + a mirror).
    expect(mockReverseDocument).not.toHaveBeenCalled();
  });

  it('completed -> paid (stocked -> stocked) is a no-op for stock/GL (idempotent)', async () => {
    mockDebitNoteFindFirst.mockResolvedValue(baseDebitNote('completed'));
    const { req, res } = makeReqRes({ body: { status: 'paid', paidAmount: 200 } });

    await updateDebitNoteStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockApplyStockAdjustment).not.toHaveBeenCalled();
    expect(mockPostDebitNoteIssued).not.toHaveBeenCalled();
    expect(mockVoidDocument).not.toHaveBeenCalled();
  });

  it('completed -> completed (same status repeated) is a no-op (idempotent repeat)', async () => {
    mockDebitNoteFindFirst.mockResolvedValue(baseDebitNote('completed'));
    const { req, res } = makeReqRes({ body: { status: 'completed' } });

    await updateDebitNoteStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockApplyStockAdjustment).not.toHaveBeenCalled();
    expect(mockPostDebitNoteIssued).not.toHaveBeenCalled();
    expect(mockVoidDocument).not.toHaveBeenCalled();
  });

  it('new -> cancelled (both unstocked) is a no-op', async () => {
    mockDebitNoteFindFirst.mockResolvedValue(baseDebitNote('new'));
    const { req, res } = makeReqRes({ body: { status: 'cancelled' } });

    await updateDebitNoteStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockApplyStockAdjustment).not.toHaveBeenCalled();
    expect(mockPostDebitNoteIssued).not.toHaveBeenCalled();
    expect(mockVoidDocument).not.toHaveBeenCalled();
  });

  it('skips Service-type items for stock (still posts GL)', async () => {
    mockTxProductFindUnique.mockResolvedValue({ item_type: 'Service' });
    mockDebitNoteFindFirst.mockResolvedValue(baseDebitNote('new'));
    const { req, res } = makeReqRes({ body: { status: 'completed' } });

    await updateDebitNoteStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockApplyStockAdjustment).not.toHaveBeenCalled();
    expect(mockPostDebitNoteIssued).toHaveBeenCalledTimes(1);
  });
});
