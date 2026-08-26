/**
 * tests/creditNoteController.tenantScope.test.ts
 *
 * P0-2b regression tripwire: credit-note endpoints historically loaded rows
 * with `findUnique({ where: { id } })` / listed with `{ isDeleted: false }`
 * only — no tenant filter anywhere, so any authenticated user could read,
 * edit or hard-delete another tenant's credit notes by id. Every handler is
 * now scoped by `userId` (`findFirst({ where: { id, userId } })`, 404 on
 * miss; list/count/numbering queries carry `userId`). These tests mock
 * prisma and assert the where objects passed to every creditNote-touching
 * call carry the tenant filter, and that a foreign-id lookup (mocked null)
 * yields a 404 without any write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';
const FOREIGN_CN_ID = 'cn-owned-by-other-tenant';

const {
  mockCreditNoteFindFirst,
  mockCreditNoteFindMany,
  mockCreditNoteCount,
  mockCreditNoteCreate,
  mockCreditNoteUpdate,
  mockCreditNoteDelete,
  mockTxCreditNoteFindFirst,
  mockInvoiceFindFirst,
  mockUserFindUnique,
  mockContactFindFirst,
  mockCustomerFindFirst,
} = vi.hoisted(() => ({
  mockCreditNoteFindFirst: vi.fn(),
  mockCreditNoteFindMany: vi.fn(),
  mockCreditNoteCount: vi.fn(),
  mockCreditNoteCreate: vi.fn(),
  mockCreditNoteUpdate: vi.fn(),
  mockCreditNoteDelete: vi.fn(),
  mockTxCreditNoteFindFirst: vi.fn(),
  mockInvoiceFindFirst: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockContactFindFirst: vi.fn(),
  mockCustomerFindFirst: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const tx = {
    creditNote: {
      findFirst: mockTxCreditNoteFindFirst,
      create: mockCreditNoteCreate,
      update: mockCreditNoteUpdate,
      delete: mockCreditNoteDelete,
      // Task 2: recomputeInvoiceStatus reads applied CNs for the linked invoice.
      findMany: vi.fn().mockResolvedValue([]),
    },
    product: { findUnique: vi.fn().mockResolvedValue(null) },
    inventory: { findFirst: vi.fn().mockResolvedValue(null) },
    // Task 2: CN create/update/delete recompute the linked invoice's due/status.
    invoice: {
      findFirst: vi.fn().mockResolvedValue({ id: 'inv-1', TotalAmount: 100, status: 'UNPAID' }),
      update: vi.fn().mockResolvedValue({ id: 'inv-1', status: 'PARTIALLY_PAID' }),
    },
    invoicePayment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
  };
  return {
    prisma: {
      creditNote: {
        findFirst: mockCreditNoteFindFirst,
        findMany: mockCreditNoteFindMany,
        count: mockCreditNoteCount,
      },
      invoice: { findFirst: mockInvoiceFindFirst },
      user: { findUnique: mockUserFindUnique },
      contact: { findFirst: mockContactFindFirst },
      customer: { findFirst: mockCustomerFindFirst },
      currency: { findFirst: vi.fn().mockResolvedValue({ code: 'USD' }) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
});

// GL posting + stock adjustment are exercised elsewhere; no-op them so the
// scoping assertions don't need a full ledger fixture.
vi.mock('../lib/ledger/ledgerPosting', () => ({
  postCreditNoteIssued: vi.fn(),
  postReturnCogs: vi.fn(),
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

import {
  createCreditNote,
  getAllCreditNotes,
  getCreditNoteById,
  updateCreditNote,
  deleteCreditNote,
} from '../controllers/Admin/Invoice/creditNoteController';

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

/** Tripwire: fails if any where-object anywhere carries a null-userId OR
 * branch — the exact shape of a cross-tenant leak. Recurses into
 * arrays/objects since Prisma where clauses nest. */
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
  mockCreditNoteFindFirst.mockResolvedValue(null);
  mockCreditNoteFindMany.mockResolvedValue([]);
  mockCreditNoteCount.mockResolvedValue(0);
  mockTxCreditNoteFindFirst.mockResolvedValue(null);
  mockCreditNoteCreate.mockResolvedValue({
    id: 'cn-1',
    creditNoteNumber: 'CN-000001',
    creditNoteDate: new Date('2026-01-01'),
    totalAmount: 100,
    vat: 0,
    reason: 'OTHER',
    status: 'PENDING',
  });
  mockCreditNoteUpdate.mockResolvedValue({ id: 'cn-1', items: [], totalAmount: 100, vat: 0 });
  mockCreditNoteDelete.mockResolvedValue({ id: 'cn-1' });
  mockInvoiceFindFirst.mockResolvedValue({ id: 'inv-1', currencyCode: 'USD' });
  mockUserFindUnique.mockResolvedValue({ id: 'user-1' });
  mockContactFindFirst.mockResolvedValue({ id: 'contact-1', defaultTaxTreatment: null });
  mockCustomerFindFirst.mockResolvedValue({ id: 'cust-1' });
});

describe('creditNoteController — tenant scoping (P0-2b)', () => {
  it('getAllCreditNotes scopes list, count and next-number queries by tenant', async () => {
    const { req, res } = makeReqRes();
    await getAllCreditNotes(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockCreditNoteCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    expect(mockCreditNoteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    // Next-number lookup must not read another tenant's numbering sequence.
    expect(mockCreditNoteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    assertNoNullUserIdBranch(mockCreditNoteFindMany.mock.calls[0][0].where);
    assertNoNullUserIdBranch(mockCreditNoteCount.mock.calls[0][0].where);
    assertNoNullUserIdBranch(mockCreditNoteFindFirst.mock.calls[0][0].where);
  });

  it('getCreditNoteById 404s on a foreign id and scopes the load by tenant', async () => {
    mockCreditNoteFindFirst.mockResolvedValue(null); // foreign row → invisible
    const { req, res } = makeReqRes({ params: { id: FOREIGN_CN_ID } });
    await getCreditNoteById(req, res);

    expect(mockCreditNoteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: FOREIGN_CN_ID, userId: TENANT_ID }),
      }),
    );
    assertNoNullUserIdBranch(mockCreditNoteFindFirst.mock.calls[0][0].where);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Credit note not found' }),
    );
  });

  it('updateCreditNote 404s on a foreign id without writing', async () => {
    mockCreditNoteFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({ params: { id: FOREIGN_CN_ID }, body: { notes: 'hijack' } });
    await updateCreditNote(req, res);

    expect(mockCreditNoteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: FOREIGN_CN_ID, userId: TENANT_ID }),
      }),
    );
    assertNoNullUserIdBranch(mockCreditNoteFindFirst.mock.calls[0][0].where);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockCreditNoteUpdate).not.toHaveBeenCalled();
  });

  it('deleteCreditNote 404s on a foreign id without deleting', async () => {
    mockCreditNoteFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({ params: { id: FOREIGN_CN_ID } });
    await deleteCreditNote(req, res);

    expect(mockCreditNoteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: FOREIGN_CN_ID, userId: TENANT_ID }),
      }),
    );
    assertNoNullUserIdBranch(mockCreditNoteFindFirst.mock.calls[0][0].where);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockCreditNoteDelete).not.toHaveBeenCalled();
  });

  it('createCreditNote 404s when the source invoice belongs to another tenant', async () => {
    mockInvoiceFindFirst.mockResolvedValue(null); // foreign invoice → invisible
    const { req, res } = makeReqRes({
      body: { contactId: 'contact-1', invoiceId: 'inv-foreign', billFrom: 'user-1', items: [] },
    });
    await createCreditNote(req, res);

    expect(mockInvoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'inv-foreign', userId: TENANT_ID }),
      }),
    );
    assertNoNullUserIdBranch(mockInvoiceFindFirst.mock.calls[0][0].where);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockCreditNoteCreate).not.toHaveBeenCalled();
  });

  it('createCreditNote scopes the credit-note numbering query by tenant', async () => {
    const { req, res } = makeReqRes({
      body: { contactId: 'contact-1', invoiceId: 'inv-1', billFrom: 'user-1', items: [] },
    });
    await createCreditNote(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockTxCreditNoteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          creditNoteNumber: { not: null },
          userId: TENANT_ID,
        }),
      }),
    );
    assertNoNullUserIdBranch(mockTxCreditNoteFindFirst.mock.calls[0][0].where);
    // Created row must be stamped with the tenant id.
    expect(mockCreditNoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: TENANT_ID }) }),
    );
  });

  it('createCreditNote numbering falls back to the install-wide highest + 1 when the tenant candidate clashes (creditNoteNumber is globally @unique)', async () => {
    mockTxCreditNoteFindFirst.mockImplementation(
      async (args: { where: Record<string, unknown> }) => {
        // Tenant-scoped sequence lookup → fresh tenant, no rows yet.
        if ('userId' in args.where) return null;
        // Clash check: CN-000001 already held by another tenant.
        if (args.where.creditNoteNumber === 'CN-000001') return { id: 'cn-other-tenant' };
        // Install-wide highest lookup.
        return { creditNoteNumber: 'CN-000099' };
      },
    );
    const { req, res } = makeReqRes({
      body: { contactId: 'contact-1', invoiceId: 'inv-1', billFrom: 'user-1', items: [] },
    });
    await createCreditNote(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockCreditNoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ creditNoteNumber: 'CN-000100' }) }),
    );
  });
});
