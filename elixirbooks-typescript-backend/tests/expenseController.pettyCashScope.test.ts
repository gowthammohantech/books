/**
 * tests/expenseController.pettyCashScope.test.ts
 *
 * Task 3 carryover (P0-2a review): controllers/expenseController.ts had five
 * `pettyCash.findFirst` call sites (the create-time balance check, the
 * create-time transactional spend, and three update-time sites — old-source
 * teardown, new-source setup, and same-source amount-diff) that queried
 * PettyCash with `{ isDeleted: false }` only, no `userId`. PettyCash has a
 * `userId` column (Task 2, migration 20260702000001_pettycash_tenant_scope)
 * and every read must be a strict `{ userId, ... }` match — no OR-null
 * fallback (see tests/pettyCashController.tenantScope.test.ts for the
 * enforced pattern this suite reuses).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const {
  mockExpenseFindFirst,
  mockExpenseCreate,
  mockExpenseUpdate,
  mockPettyCashFindFirst,
  mockPettyCashUpdate,
  mockPettyCashTransactionCreate,
  mockPettyCashTransactionDeleteMany,
  mockCompanySettingsFindFirst,
  mockCustomFieldValueDeleteMany,
  mockLedgerAccountMappingFindFirst,
  mockValidationResult,
  mockResolveFxRate,
} = vi.hoisted(() => ({
  mockExpenseFindFirst: vi.fn(),
  mockExpenseCreate: vi.fn(),
  mockExpenseUpdate: vi.fn(),
  mockPettyCashFindFirst: vi.fn(),
  mockPettyCashUpdate: vi.fn(),
  mockPettyCashTransactionCreate: vi.fn(),
  mockPettyCashTransactionDeleteMany: vi.fn(),
  mockCompanySettingsFindFirst: vi.fn(),
  mockCustomFieldValueDeleteMany: vi.fn(),
  mockLedgerAccountMappingFindFirst: vi.fn(),
  mockValidationResult: vi.fn(),
  mockResolveFxRate: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const tx = {
    companySettings: { findFirst: mockCompanySettingsFindFirst },
    expense: { create: mockExpenseCreate, update: mockExpenseUpdate, findFirst: vi.fn().mockResolvedValue(null) },
    pettyCash: { findFirst: mockPettyCashFindFirst, update: mockPettyCashUpdate },
    pettyCashTransaction: {
      create: mockPettyCashTransactionCreate,
      deleteMany: mockPettyCashTransactionDeleteMany,
    },
    bankDetail: { findUnique: vi.fn().mockResolvedValue({ id: 'bank-1', currentBalance: 1000 }), update: vi.fn() },
    bankTransaction: { deleteMany: vi.fn(), create: vi.fn() },
    paymentMode: { findUnique: vi.fn().mockResolvedValue({ id: 'pm-1', slug: 'cash' }) },
    account: { findFirst: vi.fn().mockResolvedValue({ id: 'acct-1' }) },
    customFieldValue: { deleteMany: mockCustomFieldValueDeleteMany, createMany: vi.fn() },
    ledgerAccountMapping: { findFirst: mockLedgerAccountMappingFindFirst },
    expenseChangeLog: { create: vi.fn() },
  };
  return {
    prisma: {
      pettyCash: { findFirst: mockPettyCashFindFirst },
      expense: { findFirst: mockExpenseFindFirst },
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'emp-1' }) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('express-validator', () => ({ validationResult: mockValidationResult }));
vi.mock('../lib/ledger/expenseFxGuard', () => ({ resolveExpenseFxRate: mockResolveFxRate }));
vi.mock('../lib/ledger/postingGate', () => ({ shouldPost: vi.fn().mockReturnValue(false) }));
vi.mock('../lib/ledger/approvals', () => ({
  initialApprovalStatus: vi.fn().mockReturnValue('APPROVED'),
  shouldPostOnCreate: vi.fn().mockReturnValue(false),
}));
vi.mock('../lib/ledger/ledgerPosting', () => ({
  postExpense: vi.fn().mockResolvedValue(undefined),
  reverseDocument: vi.fn().mockResolvedValue(undefined),
  voidDocument: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/ledger/bankAccount', () => ({ resolveBankGlAccountId: vi.fn().mockResolvedValue(null) }));
vi.mock('../lib/moneyFlow/explainedBankFields', () => ({ explainedBankFields: vi.fn().mockReturnValue({}) }));
vi.mock('../lib/recurringExpenseRunner', () => ({ runRecurringForExpense: vi.fn() }));

import { createExpense, updateExpense } from '../controllers/expenseController';

function makeReqRes(body: Record<string, unknown>, params: Record<string, unknown> = {}) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    params,
    body,
    file: undefined,
    files: undefined,
    query: {},
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

const EXPENSE_ID = 'expense-1';

function makeExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPENSE_ID,
    userId: TENANT_ID,
    isDeleted: false,
    sourceType: 'PETTY_CASH',
    bankId: null,
    paymentModeId: null,
    paymentStatus: 'PAID',
    amount: '50.00',
    expenseDate: new Date('2026-01-15'),
    referenceNo: 'REF-1',
    description: 'Snacks',
    expenseCategoryId: 'cat-1',
    attachment: null,
    paidByUserId: null,
    currencyCode: 'GBP',
    exchangeRate: '1.0000',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValidationResult.mockReturnValue({ isEmpty: () => true, array: () => [] });
  mockResolveFxRate.mockResolvedValue({ rate: undefined, error: undefined });
  mockCompanySettingsFindFirst.mockResolvedValue({ approvalsEnabled: false });
  mockLedgerAccountMappingFindFirst.mockResolvedValue(null); // skip postExpense internals
  mockPettyCashFindFirst.mockResolvedValue({ id: 'pc-1', currentBalance: 500 });
  mockPettyCashUpdate.mockResolvedValue({ id: 'pc-1', currentBalance: 450 });
  mockExpenseCreate.mockResolvedValue(makeExpense());
  mockExpenseUpdate.mockResolvedValue(makeExpense());
});

describe('expenseController — PettyCash tenant scoping', () => {
  it('createExpense scopes the pre-transaction PETTY_CASH balance check by tenant', async () => {
    const { req, res } = makeReqRes({
      sourceType: 'PETTY_CASH',
      amount: '50.00',
      expenseDate: '2026-01-15',
      expenseCategoryId: 'cat-1',
    });
    await createExpense(req, res);

    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(mockPettyCashFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    assertNoNullUserIdBranch(mockPettyCashFindFirst.mock.calls[0][0].where);
  });

  it('createExpense scopes the in-transaction PETTY_CASH spend by tenant', async () => {
    const { req, res } = makeReqRes({
      sourceType: 'PETTY_CASH',
      amount: '50.00',
      expenseDate: '2026-01-15',
      expenseCategoryId: 'cat-1',
    });
    await createExpense(req, res);

    // Two findFirst calls expected: the pre-check + the in-transaction read.
    expect(mockPettyCashFindFirst.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of mockPettyCashFindFirst.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
      assertNoNullUserIdBranch(call[0].where);
    }
  });

  it('updateExpense scopes the old-PETTY_CASH teardown read when switching sourceType away', async () => {
    mockExpenseFindFirst.mockResolvedValue(makeExpense({ sourceType: 'PETTY_CASH' }));
    const { req, res } = makeReqRes(
      {
        sourceType: 'EMPLOYEE_PAID',
        paidByUserId: 'emp-1',
        amount: '50.00',
        expenseDate: '2026-01-15',
        expenseCategoryId: 'cat-1',
      },
      { id: EXPENSE_ID },
    );
    await updateExpense(req, res);

    expect(mockPettyCashFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    assertNoNullUserIdBranch(mockPettyCashFindFirst.mock.calls[0][0].where);
  });

  it('updateExpense scopes the new-PETTY_CASH setup read when switching sourceType in', async () => {
    mockExpenseFindFirst.mockResolvedValue(makeExpense({ sourceType: 'BANK', bankId: 'bank-1', paymentModeId: 'pm-1' }));
    const { req, res } = makeReqRes(
      {
        sourceType: 'PETTY_CASH',
        amount: '50.00',
        expenseDate: '2026-01-15',
        expenseCategoryId: 'cat-1',
      },
      { id: EXPENSE_ID },
    );
    await updateExpense(req, res);

    expect(mockPettyCashFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    assertNoNullUserIdBranch(mockPettyCashFindFirst.mock.calls[0][0].where);
  });

  it('updateExpense scopes the same-source PETTY_CASH amount-diff read', async () => {
    mockExpenseFindFirst.mockResolvedValue(makeExpense({ sourceType: 'PETTY_CASH', amount: '50.00' }));
    const { req, res } = makeReqRes(
      {
        sourceType: 'PETTY_CASH',
        amount: '75.00',
        expenseDate: '2026-01-15',
        expenseCategoryId: 'cat-1',
      },
      { id: EXPENSE_ID },
    );
    await updateExpense(req, res);

    expect(mockPettyCashFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    assertNoNullUserIdBranch(mockPettyCashFindFirst.mock.calls[0][0].where);
  });
});
