/**
 * tests/debitNoteController.tenantScope.test.ts
 *
 * P0-2b regression tripwire: controllers/Admin/Purchases/debitNoteController.ts's
 * by-id handlers (getDebitNoteById, updateDebitNoteStatus) loaded the DebitNote
 * row with `findUnique({ where: { id } })` — no `userId` filter — letting any
 * authenticated tenant read/mutate another tenant's debit note by guessing an
 * id. getAllDebitNotes's list query was missing `userId` too. createDebitNote's
 * source-Purchase lookup and the debit-note numbering sequence were also
 * unscoped (sibling gaps fixed alongside the brief items).
 *
 * These tests mock prisma and assert every fixed handler's lookup carries
 * `userId` (the authenticated tenant) and 404s when the mocked lookup
 * returns null (simulating a foreign-tenant id).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const {
  mockDebitNoteFindFirst,
  mockDebitNoteFindMany,
  mockDebitNoteCount,
  mockDebitNoteCreate,
  mockDebitNoteUpdate,
  mockTxDebitNoteFindFirst,
  mockPurchaseFindFirst,
  mockUserFindUnique,
  mockContactFindFirst,
} = vi.hoisted(() => ({
  mockDebitNoteFindFirst: vi.fn(),
  mockDebitNoteFindMany: vi.fn(),
  mockDebitNoteCount: vi.fn(),
  mockDebitNoteCreate: vi.fn(),
  mockDebitNoteUpdate: vi.fn(),
  mockTxDebitNoteFindFirst: vi.fn(),
  mockPurchaseFindFirst: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockContactFindFirst: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const tx = {
    debitNote: { findFirst: mockTxDebitNoteFindFirst, create: mockDebitNoteCreate, update: mockDebitNoteUpdate },
    product: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  return {
    prisma: {
      debitNote: {
        findFirst: mockDebitNoteFindFirst,
        findMany: mockDebitNoteFindMany,
        count: mockDebitNoteCount,
      },
      purchase: { findFirst: mockPurchaseFindFirst },
      user: { findUnique: mockUserFindUnique },
      contact: { findFirst: mockContactFindFirst },
      supplier: { findFirst: vi.fn().mockResolvedValue(null) },
      currency: { findFirst: vi.fn().mockResolvedValue({ code: 'USD' }) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('../lib/ledger/ledgerPosting', () => ({
  postDebitNoteIssued: vi.fn(),
  reverseDocument: vi.fn(),
  voidDocument: vi.fn(),
}));
vi.mock('../lib/inventory/stockAdjust', () => ({
  applyStockAdjustment: vi.fn(),
  resolveRestockUnitCost: vi.fn().mockResolvedValue(0),
}));
vi.mock('../utils/mailer', () => ({
  sendMail: vi.fn(),
}));
vi.mock('express-validator', () => ({
  validationResult: vi.fn(() => ({ isEmpty: () => true, array: () => [] })),
}));

import {
  createDebitNote,
  getAllDebitNotes,
  getDebitNoteById,
  updateDebitNoteStatus,
  deleteDebitNote,
} from '../controllers/Admin/Purchases/debitNoteController';

function makeReqRes(overrides: { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: Record<string, unknown> } = {}) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    params: overrides.params ?? {},
    query: overrides.query ?? {},
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

/** Tripwire: fails if any where-object carries a null-userId OR branch. */
function assertNoNullUserIdBranch(value: unknown, path = 'where'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoNullUserIdBranch(v, `${path}[${i}]`));
    return;
  }
  const obj = value as Record<string, unknown>;
  if ('userId' in obj && obj.userId === null) {
    throw new Error(`found userId: null at ${path} — cross-tenant leak`);
  }
  for (const [key, val] of Object.entries(obj)) {
    assertNoNullUserIdBranch(val, `${path}.${key}`);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDebitNoteFindFirst.mockResolvedValue(null);
  mockDebitNoteFindMany.mockResolvedValue([]);
  mockDebitNoteCount.mockResolvedValue(0);
  mockTxDebitNoteFindFirst.mockResolvedValue(null);
  mockPurchaseFindFirst.mockResolvedValue({ id: 'purchase-1', supplierId: null, contactId: 'contact-1' });
  mockUserFindUnique.mockResolvedValue({ id: 'user-1' });
  mockContactFindFirst.mockResolvedValue({ id: 'contact-1', defaultTaxTreatment: null });
  mockDebitNoteCreate.mockResolvedValue({
    id: 'dn-1',
    debitNoteId: 'DN-000001',
    debitNoteDate: new Date('2026-01-01'),
    totalAmount: 100,
    totalTax: 0,
    referenceNo: 'REF-1',
  });
  mockDebitNoteUpdate.mockResolvedValue({ id: 'dn-1' });
});

describe('debitNoteController — tenant scoping (P0-2b)', () => {
  it('getAllDebitNotes scopes the list + count queries by tenant', async () => {
    const { req, res } = makeReqRes();
    await getAllDebitNotes(req, res);

    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(mockDebitNoteCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    expect(mockDebitNoteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    assertNoNullUserIdBranch(mockDebitNoteFindMany.mock.calls[0][0].where);
    assertNoNullUserIdBranch(mockDebitNoteCount.mock.calls[0][0].where);
  });

  it('getDebitNoteById 404s on a foreign id and scopes the load by tenant', async () => {
    mockDebitNoteFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({ params: { id: 'dn-foreign' } });
    await getDebitNoteById(req, res);

    expect(mockDebitNoteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'dn-foreign', userId: TENANT_ID } }),
    );
    assertNoNullUserIdBranch(mockDebitNoteFindFirst.mock.calls[0][0].where);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('updateDebitNoteStatus 404s on a foreign id without writing', async () => {
    mockDebitNoteFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({ params: { id: 'dn-foreign' }, body: { status: 'completed' } });
    await updateDebitNoteStatus(req, res);

    expect(mockDebitNoteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'dn-foreign', userId: TENANT_ID } }),
    );
    assertNoNullUserIdBranch(mockDebitNoteFindFirst.mock.calls[0][0].where);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockDebitNoteUpdate).not.toHaveBeenCalled();
  });

  it('deleteDebitNote 404s on a foreign id without deleting (already-scoped guard, regression check)', async () => {
    mockDebitNoteFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({ params: { id: 'dn-foreign' } });
    await deleteDebitNote(req, res);

    expect(mockDebitNoteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'dn-foreign', userId: TENANT_ID, isDeleted: false } }),
    );
    assertNoNullUserIdBranch(mockDebitNoteFindFirst.mock.calls[0][0].where);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('createDebitNote 404s when the source purchase belongs to another tenant (sibling gap fix)', async () => {
    mockPurchaseFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({
      body: { purchaseId: 'purchase-foreign', billFrom: 'user-1', items: [] },
    });
    await createDebitNote(req, res);

    expect(mockPurchaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'purchase-foreign', userId: TENANT_ID }) }),
    );
    assertNoNullUserIdBranch(mockPurchaseFindFirst.mock.calls[0][0].where);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockDebitNoteCreate).not.toHaveBeenCalled();
  });

  it('createDebitNote scopes the debit-note numbering query by tenant (sibling gap fix)', async () => {
    const { req, res } = makeReqRes({
      body: { purchaseId: 'purchase-1', billFrom: 'user-1', items: [] },
    });
    await createDebitNote(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockTxDebitNoteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ debitNoteId: { not: null }, userId: TENANT_ID }),
      }),
    );
    assertNoNullUserIdBranch(mockTxDebitNoteFindFirst.mock.calls[0][0].where);
    expect(mockDebitNoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ user: { connect: { id: TENANT_ID } } }) }),
    );
  });

  it('createDebitNote numbering falls back to the install-wide highest + 1 when the tenant candidate clashes (debitNoteId is globally @unique)', async () => {
    mockTxDebitNoteFindFirst.mockImplementation(
      async (args: { where: Record<string, unknown> }) => {
        // Tenant-scoped sequence lookup → fresh tenant, no rows yet.
        if ('userId' in args.where) return null;
        // Clash check: DN-000001 already held by another tenant.
        if (args.where.debitNoteId === 'DN-000001') return { id: 'dn-other-tenant' };
        // Install-wide highest lookup.
        return { debitNoteId: 'DN-000042' };
      },
    );
    const { req, res } = makeReqRes({
      body: { purchaseId: 'purchase-1', billFrom: 'user-1', items: [] },
    });
    await createDebitNote(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockDebitNoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ debitNoteId: 'DN-000043' }) }),
    );
  });
});
