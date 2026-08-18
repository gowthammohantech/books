/**
 * tests/supplierPaymentReadController.tenantScope.test.ts
 *
 * P0-2b regression tripwire: read/void endpoints in
 * controllers/Admin/Purchases/supplierPaymentReadController.ts must scope
 * every by-id load by tenant. `Purchase`/`SupplierPayment` are scoped via the
 * Purchase's `userId` (SupplierPayment has no direct userId column); the
 * PettyCash read inside voidSupplierPayment is scoped with a strict
 * `{ userId }` match (no OR-null fallback) per the P0-2a PettyCash
 * tenant-scope work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const {
  mockPurchaseFindFirst,
  mockPurchaseUpdate,
  mockSupplierPaymentFindFirst,
  mockSupplierPaymentFindMany,
  mockSupplierPaymentUpdate,
  mockSupplierPaymentAggregate,
  mockAuditLogCount,
  mockAuditLogFindMany,
  mockBankDetailUpdate,
  mockBankTransactionCreate,
  mockPettyCashFindFirst,
  mockPettyCashUpdate,
  mockPettyCashTransactionCreate,
  mockBankTransactionFindFirst,
  mockPettyCashTransactionFindFirst,
} = vi.hoisted(() => ({
  mockPurchaseFindFirst: vi.fn(),
  mockPurchaseUpdate: vi.fn(),
  mockSupplierPaymentFindFirst: vi.fn(),
  mockSupplierPaymentFindMany: vi.fn(),
  mockSupplierPaymentUpdate: vi.fn(),
  mockSupplierPaymentAggregate: vi.fn(),
  mockAuditLogCount: vi.fn(),
  mockAuditLogFindMany: vi.fn(),
  mockBankDetailUpdate: vi.fn(),
  mockBankTransactionCreate: vi.fn(),
  mockPettyCashFindFirst: vi.fn(),
  mockPettyCashUpdate: vi.fn(),
  mockPettyCashTransactionCreate: vi.fn(),
  mockBankTransactionFindFirst: vi.fn(),
  mockPettyCashTransactionFindFirst: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const tx = {
    supplierPayment: {
      findFirst: mockSupplierPaymentFindFirst,
      update: mockSupplierPaymentUpdate,
      aggregate: mockSupplierPaymentAggregate,
    },
    purchase: { update: mockPurchaseUpdate },
    bankDetail: { update: mockBankDetailUpdate },
    bankTransaction: { create: mockBankTransactionCreate, findFirst: mockBankTransactionFindFirst },
    pettyCash: { findFirst: mockPettyCashFindFirst, update: mockPettyCashUpdate },
    pettyCashTransaction: { create: mockPettyCashTransactionCreate, findFirst: mockPettyCashTransactionFindFirst },
  };
  return {
    prisma: {
      purchase: { findFirst: mockPurchaseFindFirst },
      supplierPayment: { findMany: mockSupplierPaymentFindMany },
      auditLog: { count: mockAuditLogCount, findMany: mockAuditLogFindMany },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('../lib/ledger/ledgerPosting', () => ({
  reverseDocument: vi.fn().mockResolvedValue(undefined),
}));

import {
  listSupplierPaymentsForPurchase,
  purchaseActivity,
  voidSupplierPayment,
} from '../controllers/Admin/Purchases/supplierPaymentReadController';

function makeReqRes(params: Record<string, unknown> = {}, body: Record<string, unknown> = {}) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    query: {},
    params,
    body,
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

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
  mockPurchaseFindFirst.mockResolvedValue(null);
  mockPurchaseUpdate.mockResolvedValue({});
  mockSupplierPaymentFindFirst.mockResolvedValue(null);
  mockSupplierPaymentFindMany.mockResolvedValue([]);
  mockSupplierPaymentUpdate.mockResolvedValue({});
  mockSupplierPaymentAggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });
  mockAuditLogCount.mockResolvedValue(0);
  mockAuditLogFindMany.mockResolvedValue([]);
  mockBankDetailUpdate.mockResolvedValue({});
  mockBankTransactionCreate.mockResolvedValue({});
  // Finding-1 discriminator: record-path payments authored their own cash line,
  // so the register reversal must run — default the lookups to a truthy row.
  mockBankTransactionFindFirst.mockResolvedValue({ id: 'bt-self' });
  mockPettyCashTransactionFindFirst.mockResolvedValue({ id: 'pct-self' });
  mockPettyCashFindFirst.mockResolvedValue(null);
  mockPettyCashUpdate.mockResolvedValue({});
  mockPettyCashTransactionCreate.mockResolvedValue({});
});

describe('supplierPaymentReadController — tenant scoping', () => {
  it('listSupplierPaymentsForPurchase 404s on a foreign purchase id', async () => {
    mockPurchaseFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({ id: 'foreign-purchase' });

    await listSupplierPaymentsForPurchase(req, res);

    expect(mockPurchaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'foreign-purchase', userId: TENANT_ID }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockSupplierPaymentFindMany).not.toHaveBeenCalled();
  });

  it('purchaseActivity 404s on a foreign purchase id', async () => {
    mockPurchaseFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({ id: 'foreign-purchase' });

    await purchaseActivity(req, res);

    expect(mockPurchaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'foreign-purchase', userId: TENANT_ID }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockAuditLogFindMany).not.toHaveBeenCalled();
  });

  it('voidSupplierPayment 404s on a foreign payment id', async () => {
    mockSupplierPaymentFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({ paymentId: 'foreign-payment' });

    await voidSupplierPayment(req, res);

    expect(mockSupplierPaymentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'foreign-payment',
          purchase: { userId: TENANT_ID, isDeleted: false },
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('voidSupplierPayment scopes the PETTY_CASH reversal strictly by tenant (no null-userId fallback)', async () => {
    mockSupplierPaymentFindFirst.mockResolvedValue({
      id: 'sp-1',
      isVoided: false,
      paidAmount: 100,
      sourceType: 'PETTY_CASH',
      bank: null,
      paymentModeId: null,
      movedBankBalance: true, // record-path petty payment → reversal moves the register
      purchase: { id: 'purchase-1', userId: TENANT_ID, totalAmount: 100 },
    });
    mockPettyCashFindFirst.mockResolvedValue({ id: 'pc-1', currentBalance: 500 });

    const { req, res } = makeReqRes({ paymentId: 'sp-1' });

    await voidSupplierPayment(req, res);

    expect(mockPettyCashFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    assertNoNullUserIdBranch(mockPettyCashFindFirst.mock.calls[0][0].where);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
