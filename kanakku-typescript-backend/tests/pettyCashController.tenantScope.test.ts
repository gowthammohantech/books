/**
 * tests/pettyCashController.tenantScope.test.ts
 *
 * P0-2a regression tripwire: PettyCash was historically a true unscoped
 * singleton (`tx.pettyCash.findFirst({})` — no `where` at all), shared and
 * leaked across every tenant. This adds a `PettyCash.userId` column
 * (migration: prisma/migrations/20260702000001_pettycash_tenant_scope),
 * whose backfill guarantees every existing row is assigned a concrete owner
 * (bank/expense/supplier-payment-derived, falling back to the install's
 * primary admin), and every touch-point is scoped with a **strict**
 * `{ userId }` match — no OR-null fallback. A null-userId branch anywhere in
 * these where objects would mean a row is readable/writable by more than one
 * tenant, so several tests explicitly assert its absence.
 *
 * These tests mock prisma (including $transaction) and assert the where/data
 * objects passed to every pettyCash-touching call carry the tenant filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const {
  mockPettyCashFindFirst,
  mockPettyCashCreate,
  mockPettyCashUpdate,
  mockPettyCashAggregate,
  mockPettyCashTransactionFindMany,
  mockPettyCashTransactionCount,
  mockPettyCashTransactionCreate,
  mockBankDetailAggregate,
  mockBankDetailFindUnique,
  mockBankDetailUpdate,
  mockBankTransactionFindMany,
  mockBankTransactionCreate,
  mockPaymentModeFindUnique,
} = vi.hoisted(() => ({
  mockPettyCashFindFirst: vi.fn(),
  mockPettyCashCreate: vi.fn(),
  mockPettyCashUpdate: vi.fn(),
  mockPettyCashAggregate: vi.fn(),
  mockPettyCashTransactionFindMany: vi.fn(),
  mockPettyCashTransactionCount: vi.fn(),
  mockPettyCashTransactionCreate: vi.fn(),
  mockBankDetailAggregate: vi.fn(),
  mockBankDetailFindUnique: vi.fn(),
  mockBankDetailUpdate: vi.fn(),
  mockBankTransactionFindMany: vi.fn(),
  mockBankTransactionCreate: vi.fn(),
  mockPaymentModeFindUnique: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const tx = {
    pettyCash: {
      findFirst: mockPettyCashFindFirst,
      create: mockPettyCashCreate,
      update: mockPettyCashUpdate,
    },
    pettyCashTransaction: { create: mockPettyCashTransactionCreate },
    bankDetail: { findUnique: mockBankDetailFindUnique, update: mockBankDetailUpdate },
    bankTransaction: { create: mockBankTransactionCreate },
    paymentMode: { findUnique: mockPaymentModeFindUnique },
  };
  return {
    prisma: {
      pettyCash: {
        findFirst: mockPettyCashFindFirst,
        aggregate: mockPettyCashAggregate,
      },
      pettyCashTransaction: {
        findMany: mockPettyCashTransactionFindMany,
        count: mockPettyCashTransactionCount,
      },
      bankDetail: { aggregate: mockBankDetailAggregate },
      bankTransaction: { findMany: mockBankTransactionFindMany },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
});

import {
  createPettyCash,
  listPettyCash,
  listPettyCashTransactions,
  getFinancialSummary,
  returnPettyCash,
} from '../controllers/pettyCashController';

function makeReqRes(body: Record<string, unknown> = {}) {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, query: {}, body } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPettyCashFindFirst.mockResolvedValue(null);
  mockPettyCashCreate.mockResolvedValue({ id: 'pc-1', currentBalance: 100, openingBalance: 100 });
  mockPettyCashUpdate.mockResolvedValue({ id: 'pc-1', currentBalance: 100 });
  mockPettyCashAggregate.mockResolvedValue({ _sum: { currentBalance: 0 } });
  mockPettyCashTransactionFindMany.mockResolvedValue([]);
  mockPettyCashTransactionCount.mockResolvedValue(0);
  mockPettyCashTransactionCreate.mockResolvedValue({ id: 'pct-1' });
  mockBankDetailAggregate.mockResolvedValue({ _sum: { currentBalance: 0 } });
  mockBankDetailFindUnique.mockResolvedValue({
    id: 'bank-1',
    isDeleted: false,
    currentBalance: 1000,
  });
  mockBankDetailUpdate.mockResolvedValue({});
  mockBankTransactionFindMany.mockResolvedValue([]);
  mockBankTransactionCreate.mockResolvedValue({ id: 'btx-1' });
  mockPaymentModeFindUnique.mockResolvedValue({ id: 'pm-1', name: 'Cash', slug: 'cash' });
});

/** Tripwire: fails if any where-object anywhere carries a null-userId OR
 * branch — the exact shape of the cross-tenant leak this suite guards
 * against. Recurses into arrays/objects since Prisma where clauses nest. */
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

describe('pettyCashController — tenant scoping', () => {
  it('listPettyCash scopes the findFirst strictly by tenant (no null-userId fallback)', async () => {
    const { req, res } = makeReqRes();
    await listPettyCash(req, res);

    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(mockPettyCashFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TENANT_ID }),
      }),
    );
    assertNoNullUserIdBranch(mockPettyCashFindFirst.mock.calls[0][0].where);
  });

  it('createPettyCash finds strictly by tenant and stamps userId on create', async () => {
    const { req, res } = makeReqRes({
      bankAccountId: 'bank-1',
      amount: 50,
      paymentModeId: 'pm-1',
    });
    await createPettyCash(req, res);

    expect(mockPettyCashFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: TENANT_ID },
      }),
    );
    assertNoNullUserIdBranch(mockPettyCashFindFirst.mock.calls[0][0].where);
    // No existing row (mocked null) → create path; must stamp userId.
    expect(mockPettyCashCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: TENANT_ID }) }),
    );
  });

  it('listPettyCashTransactions scopes by the tenant petty cash relation (strict, no null fallback)', async () => {
    const { req, res } = makeReqRes();
    await listPettyCashTransactions(req, res);

    expect(mockPettyCashTransactionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pettyCash: { userId: TENANT_ID },
        }),
      }),
    );
    expect(mockPettyCashTransactionCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pettyCash: { userId: TENANT_ID },
        }),
      }),
    );
    assertNoNullUserIdBranch(mockPettyCashTransactionFindMany.mock.calls[0][0].where);
    assertNoNullUserIdBranch(mockPettyCashTransactionCount.mock.calls[0][0].where);
  });

  it('getFinancialSummary scopes bankDetail/bankTransaction and pettyCash strictly by tenant', async () => {
    const { req, res } = makeReqRes();
    await getFinancialSummary(req, res);

    expect(mockBankDetailAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    expect(mockPettyCashAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: TENANT_ID }),
      }),
    );
    assertNoNullUserIdBranch(mockPettyCashAggregate.mock.calls[0][0].where);
    for (const call of mockBankTransactionFindMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ bankAccount: { userId: TENANT_ID } }));
    }
    for (const call of mockPettyCashTransactionFindMany.mock.calls) {
      expect(call[0].where).toEqual(
        expect.objectContaining({ pettyCash: { userId: TENANT_ID } }),
      );
      assertNoNullUserIdBranch(call[0].where);
    }
  });

  it('returnPettyCash finds the tenant petty cash strictly by userId (no null-userId fallback)', async () => {
    mockPettyCashFindFirst.mockResolvedValue({ id: 'pc-1', currentBalance: 500 });
    mockPettyCashUpdate.mockResolvedValue({ id: 'pc-1', currentBalance: 450 });

    const { req, res } = makeReqRes({
      bankAccountId: 'bank-1',
      amount: 50,
      paymentModeId: 'pm-1',
    });
    await returnPettyCash(req, res);

    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(mockPettyCashFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: TENANT_ID } }),
    );
    assertNoNullUserIdBranch(mockPettyCashFindFirst.mock.calls[0][0].where);
  });
});
