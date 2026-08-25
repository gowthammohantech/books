/**
 * tests/bankDetailController.tenantScope.test.ts
 *
 * Task 3 carryover: controllers/bankDetailController.ts had several
 * unscoped by-id / list gaps of the same class the P0-2b tenant-scoping
 * pass fixes elsewhere:
 *  - updateBankDetail / updateBankDetailStatus / deleteBankDetail loaded
 *    the existing BankDetail by `id` only (no `userId`), so any
 *    authenticated user could rewrite/disable/soft-delete another
 *    tenant's bank account.
 *  - reconcileTransaction / getBankTransactionDetails loaded the
 *    BankTransaction by `id` only; both now go through the owning
 *    `bankAccount.userId`.
 *  - listBankTransactions / listBankTransactionsReconciled listed ALL
 *    transactions across every tenant (only `isDeleted: false`); both now
 *    filter on `bankAccount: { userId }`.
 *  - listFinancialDetails computed "today vs last day" totals by scanning
 *    `bankDetail`/`pettyCash` "across users"; both now scope by tenant
 *    (PettyCash via its Task 2 `userId` column, strict — no null fallback).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const {
  mockBankDetailFindFirst,
  mockBankDetailFindMany,
  mockBankDetailUpdate,
  mockBankTransactionFindFirst,
  mockBankTransactionFindMany,
  mockBankTransactionCount,
  mockBankTransactionUpdate,
  mockPettyCashFindMany,
  mockSupplierPaymentFindUnique,
} = vi.hoisted(() => ({
  mockBankDetailFindFirst: vi.fn(),
  mockBankDetailFindMany: vi.fn(),
  mockBankDetailUpdate: vi.fn(),
  mockBankTransactionFindFirst: vi.fn(),
  mockBankTransactionFindMany: vi.fn(),
  mockBankTransactionCount: vi.fn(),
  mockBankTransactionUpdate: vi.fn(),
  mockPettyCashFindMany: vi.fn(),
  mockSupplierPaymentFindUnique: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    bankDetail: {
      findFirst: mockBankDetailFindFirst,
      findMany: mockBankDetailFindMany,
      update: mockBankDetailUpdate,
    },
    bankTransaction: {
      findFirst: mockBankTransactionFindFirst,
      findMany: mockBankTransactionFindMany,
      count: mockBankTransactionCount,
      update: mockBankTransactionUpdate,
    },
    pettyCash: { findMany: mockPettyCashFindMany },
    supplierPayment: { findUnique: mockSupplierPaymentFindUnique },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ bankDetail: { update: mockBankDetailUpdate } }),
    ),
  },
}));

import {
  updateBankDetail,
  updateBankDetailStatus,
  deleteBankDetail,
  reconcileTransaction,
  getBankTransactionDetails,
  listBankTransactions,
  listBankTransactionsReconciled,
  listFinancialDetails,
} from '../controllers/bankDetailController';

function makeReqRes(
  params: Record<string, unknown> = {},
  body: Record<string, unknown> = {},
  query: Record<string, unknown> = {},
) {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, params, body, query } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

/** Tripwire: fails if any where-object anywhere carries a null-userId OR
 * branch — a cross-tenant leak shape. Recurses into arrays/objects. */
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
  mockBankDetailFindFirst.mockResolvedValue(null);
  mockBankDetailFindMany.mockResolvedValue([]);
  mockBankDetailUpdate.mockResolvedValue({ id: 'bank-1', status: true });
  mockBankTransactionFindFirst.mockResolvedValue(null);
  mockBankTransactionFindMany.mockResolvedValue([]);
  mockBankTransactionCount.mockResolvedValue(0);
  mockBankTransactionUpdate.mockResolvedValue({});
  mockPettyCashFindMany.mockResolvedValue([]);
  mockSupplierPaymentFindUnique.mockResolvedValue(null);
});

describe('bankDetailController — tenant scoping', () => {
  it('updateBankDetail 404s on a foreign id (findFirst scoped by userId)', async () => {
    const { req, res } = makeReqRes({ id: 'foreign-bank' }, { bankName: 'X' });
    await updateBankDetail(req, res);

    expect(mockBankDetailFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'foreign-bank', userId: TENANT_ID }) }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
    assertNoNullUserIdBranch(mockBankDetailFindFirst.mock.calls[0][0].where);
  });

  it('updateBankDetailStatus 404s on a foreign id (findFirst scoped by userId)', async () => {
    const { req, res } = makeReqRes({ id: 'foreign-bank' }, { status: true });
    await updateBankDetailStatus(req, res);

    expect(mockBankDetailFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'foreign-bank', userId: TENANT_ID }) }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('deleteBankDetail 404s on a foreign id (findFirst scoped by userId)', async () => {
    const { req, res } = makeReqRes({ id: 'foreign-bank' });
    await deleteBankDetail(req, res);

    expect(mockBankDetailFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'foreign-bank', userId: TENANT_ID } }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('reconcileTransaction 404s on a foreign id (findFirst scoped via bankAccount.userId)', async () => {
    const { req, res } = makeReqRes({ id: 'foreign-txn' }, { isReconciled: true });
    await reconcileTransaction(req, res);

    expect(mockBankTransactionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'foreign-txn', bankAccount: { userId: TENANT_ID } },
      }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('getBankTransactionDetails 404s on a foreign id (findFirst scoped via bankAccount.userId)', async () => {
    const { req, res } = makeReqRes({ id: 'foreign-txn' });
    await getBankTransactionDetails(req, res);

    expect(mockBankTransactionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'foreign-txn', bankAccount: { userId: TENANT_ID } },
      }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('getBankTransactionDetails resolves the supplier name contact-first when the legacy supplier is null', async () => {
    // Reproduces the "Deleted User" bug: a SUPPLIER_PAYMENT created via the
    // unified-contact flow carries contactId but no legacy supplierId, so
    // resolving from `payment.supplier` alone yields a blank name.
    mockBankTransactionFindFirst.mockResolvedValueOnce({
      id: 'txn-1',
      relatedType: 'SUPPLIER_PAYMENT',
      relatedId: 'payment-1',
    });
    mockSupplierPaymentFindUnique.mockResolvedValueOnce({
      id: 'payment-1',
      supplier: null,
      contact: {
        id: 'contact-1',
        firstName: 'Jordan',
        lastName: 'Rivera',
        organisation: null,
        email: 'jordan@example.com',
        mobile: '555-0100',
        telephone: null,
        image: null,
      },
      purchase: null,
    });

    const { req, res } = makeReqRes({ id: 'txn-1' });
    await getBankTransactionDetails(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      data: { supplierId: { supplier_name: string } };
    };
    expect(payload.data.supplierId.supplier_name).toBe('Jordan Rivera');
  });

  it('listBankTransactions scopes both findMany and count by bankAccount.userId', async () => {
    const { req, res } = makeReqRes({}, {}, {});
    await listBankTransactions(req, res);

    expect(mockBankTransactionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ bankAccount: { userId: TENANT_ID } }) }),
    );
    expect(mockBankTransactionCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ bankAccount: { userId: TENANT_ID } }) }),
    );
  });

  it('listBankTransactionsReconciled scopes both findMany and count by bankAccount.userId', async () => {
    const { req, res } = makeReqRes({}, {}, {});
    await listBankTransactionsReconciled(req, res);

    expect(mockBankTransactionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ bankAccount: { userId: TENANT_ID } }) }),
    );
    expect(mockBankTransactionCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ bankAccount: { userId: TENANT_ID } }) }),
    );
  });

  it('listFinancialDetails scopes the "all rows" bankDetail + pettyCash totals by tenant (strict, no null fallback)', async () => {
    const { req, res } = makeReqRes({}, {}, {});
    await listFinancialDetails(req, res);

    // First findMany call is the paginated/searched list; the second is the
    // "all rows for totals" query — both must carry userId.
    for (const call of mockBankDetailFindMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
    }
    expect(mockPettyCashFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    assertNoNullUserIdBranch(mockPettyCashFindMany.mock.calls[0][0].where);
  });
});
