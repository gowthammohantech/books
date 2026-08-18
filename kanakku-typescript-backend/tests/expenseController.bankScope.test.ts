/**
 * tests/expenseController.bankScope.test.ts
 *
 * Sweep finding from the Task 3 (P0-2b) self-review: createExpense/updateExpense
 * loaded a client-supplied `bankId` via `bankDetail.findUnique({ where: { id } })`
 * with no ownership check — the same tenant-isolation gap already fixed for
 * bank lookups in supplierPaymentController/invoiceController. A caller could
 * supply another tenant's bankId and have their balance debited/credited.
 * Every `bankId`-from-request lookup is now `findFirst({ where: { id, userId } })`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';
const CATEGORY_ID = 'cat-1';

const {
  mockBankDetailFindFirst,
  mockBankDetailUpdate,
  mockBankTransactionCreate,
  mockExpenseCreate,
  mockPaymentModeFindUnique,
  mockCompanySettingsFindFirst,
  mockValidationResult,
  mockResolveFxRate,
} = vi.hoisted(() => ({
  mockBankDetailFindFirst: vi.fn(),
  mockBankDetailUpdate: vi.fn(),
  mockBankTransactionCreate: vi.fn(),
  mockExpenseCreate: vi.fn(),
  mockPaymentModeFindUnique: vi.fn(),
  mockCompanySettingsFindFirst: vi.fn(),
  mockValidationResult: vi.fn(),
  mockResolveFxRate: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const tx = {
    companySettings: { findFirst: mockCompanySettingsFindFirst },
    expense: { create: mockExpenseCreate, findFirst: vi.fn().mockResolvedValue(null) },
    bankDetail: { findFirst: mockBankDetailFindFirst, update: mockBankDetailUpdate },
    bankTransaction: { create: mockBankTransactionCreate },
    paymentMode: { findUnique: mockPaymentModeFindUnique },
    customFieldValue: { createMany: vi.fn() },
  };
  return {
    prisma: {
      bankDetail: { findFirst: mockBankDetailFindFirst },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('express-validator', () => ({ validationResult: mockValidationResult }));
vi.mock('../lib/ledger/expenseFxGuard', () => ({ resolveExpenseFxRate: mockResolveFxRate }));
vi.mock('../lib/ledger/ledgerPosting', () => ({
  postExpense: vi.fn(),
  reverseDocument: vi.fn(),
  voidDocument: vi.fn(),
}));
vi.mock('../lib/moneyFlow/explainedBankFields', () => ({ explainedBankFields: vi.fn().mockReturnValue({}) }));

import { createExpense } from '../controllers/expenseController';

function makeReqRes(body: Record<string, unknown>) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    params: {},
    query: {},
    body,
    file: undefined,
    files: undefined,
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValidationResult.mockReturnValue({ isEmpty: () => true, array: () => [] });
  mockResolveFxRate.mockResolvedValue({ rate: undefined, error: undefined });
  mockCompanySettingsFindFirst.mockResolvedValue({ approvalsEnabled: false });
  mockPaymentModeFindUnique.mockResolvedValue({ id: 'pm-1', slug: 'cash' });
  mockBankDetailUpdate.mockResolvedValue({});
  mockBankTransactionCreate.mockResolvedValue({ id: 'btx-1' });
  mockExpenseCreate.mockResolvedValue({ id: 'exp-1' });
});

describe('expenseController — BankDetail tenant scoping (createExpense)', () => {
  it('scopes the pre-flight BANK balance check by tenant', async () => {
    mockBankDetailFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({
      sourceType: 'BANK',
      bankId: 'bank-1',
      paymentMode: 'pm-1',
      amount: 50,
      expenseDate: '2026-01-15',
      expenseCategoryId: CATEGORY_ID,
    });

    await createExpense(req, res);

    expect(mockBankDetailFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'bank-1', userId: TENANT_ID }) }),
    );
    // Foreign/missing bank -> not a successful create.
    expect(res.status).not.toHaveBeenCalledWith(201);
  });

  it('scopes the in-transaction BANK debit by tenant', async () => {
    mockBankDetailFindFirst.mockResolvedValue({ id: 'bank-1', currentBalance: 1000 });
    const { req, res } = makeReqRes({
      sourceType: 'BANK',
      bankId: 'bank-1',
      paymentMode: 'pm-1',
      amount: 50,
      expenseDate: '2026-01-15',
      expenseCategoryId: CATEGORY_ID,
    });

    await createExpense(req, res);

    for (const call of mockBankDetailFindFirst.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ id: 'bank-1', userId: TENANT_ID }));
    }
    expect(mockBankDetailFindFirst.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('expenseController — FX bank register (createExpense)', () => {
  it('reduces the base-currency bank by amount × rate (USD 100 @ 83 → base 8300), not the raw 100', async () => {
    // FX guard resolves rate 83 for the USD expense.
    mockResolveFxRate.mockResolvedValue({ rate: new Prisma.Decimal('83'), error: undefined });
    mockBankDetailFindFirst.mockResolvedValue({ id: 'bank-1', currentBalance: 100000 });
    mockPaymentModeFindUnique.mockResolvedValue({ id: 'pm-1', slug: 'neft' });

    const { req, res } = makeReqRes({
      sourceType: 'BANK',
      bankId: 'bank-1',
      paymentMode: 'pm-1',
      amount: 100,
      currencyCode: 'USD',
      expenseDate: '2026-01-15',
      expenseCategoryId: CATEGORY_ID,
    });

    await createExpense(req, res);

    // Register deducts the BASE amount (100 × 83 = 8300): 100000 − 8300 = 91700.
    const balUpdate = mockBankDetailUpdate.mock.calls.at(-1)?.[0];
    expect(Number(balUpdate.data.currentBalance)).toBe(91700);
    // The reversing bankTransaction records the base amount too.
    const btx = mockBankTransactionCreate.mock.calls.at(-1)?.[0];
    expect(Number(btx.data.amount)).toBe(8300);
  });
});
