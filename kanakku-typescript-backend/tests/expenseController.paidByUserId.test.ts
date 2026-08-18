/**
 * tests/expenseController.paidByUserId.test.ts
 *
 * Unit tests for the paidByUserId handling in updateExpense.
 *
 * We focus on the three new behaviours added to fix the GL tie-out bug:
 *   1. Switching to EMPLOYEE_PAID without paidByUserId → 400
 *   2. Switching to EMPLOYEE_PAID with valid paidByUserId → accepted (paidByUserId persisted)
 *   3. Switching away from EMPLOYEE_PAID (to BANK) → paidByUserId nulled out
 *
 * Strategy: mock prisma + express-validator + resolveExpenseFxRate so no DB is
 * needed. We exercise only as far as we need to confirm the validation/update
 * path fires correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before vi.mock() calls.
// ---------------------------------------------------------------------------

const {
  mockExpenseFindFirst,
  mockUserFindFirst,
  mockExpenseUpdate,
  mockLogCreate,
  mockCustomFieldValueUpsert,
  mockAuditCreate,
  mockValidationResult,
  mockResolveFxRate,
} = vi.hoisted(() => ({
  mockExpenseFindFirst: vi.fn(),
  mockUserFindFirst: vi.fn(),
  mockExpenseUpdate: vi.fn(),
  mockLogCreate: vi.fn(),
  mockCustomFieldValueUpsert: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockValidationResult: vi.fn(),
  mockResolveFxRate: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    expense: {
      findFirst: mockExpenseFindFirst,
      update: mockExpenseUpdate,
    },
    user: { findFirst: mockUserFindFirst },
    activityLog: { create: mockLogCreate },
    customFieldValue: { upsert: mockCustomFieldValueUpsert },
    auditLog: { create: mockAuditCreate },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Run the callback with a tx that has all the table mocks we need.
      const tx = {
        expense: { update: mockExpenseUpdate },
        customFieldValue: { upsert: mockCustomFieldValueUpsert },
        activityLog: { create: mockLogCreate },
      };
      return fn(tx);
    }),
  },
}));

vi.mock('express-validator', () => ({
  validationResult: mockValidationResult,
}));

vi.mock('../lib/ledger/expenseFxGuard', () => ({
  resolveExpenseFxRate: mockResolveFxRate,
}));

// Also mock audit extension and any other prisma extensions that may be called.
vi.mock('../lib/auditExtension', () => ({ withAudit: vi.fn((p: unknown) => p) }));

// Import the controller AFTER mocks are in place.
import { updateExpense } from '../controllers/expenseController';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER_ID = 'owner-uuid-1';
const PAID_BY_ID = 'employee-uuid-2';
const EXPENSE_ID = 'expense-uuid-3';
const CATEGORY_ID = 'cat-uuid-4';

/**
 * Build a minimal fake expense row (BANK source type by default).
 */
function makeExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPENSE_ID,
    userId: OWNER_ID,
    isDeleted: false,
    sourceType: 'BANK',
    bankId: 'bank-uuid-5',
    paymentModeId: 'mode-uuid-6',
    paymentStatus: 'PAID',
    amount: '100.00',
    expenseDate: new Date('2026-01-15'),
    referenceNo: 'REF-001',
    description: 'Office supplies',
    expenseCategoryId: CATEGORY_ID,
    attachment: null,
    paidByUserId: null,
    supplierId: null,
    isRecurring: false,
    repeatEvery: null,
    customIntervalNumber: null,
    customIntervalType: null,
    startOn: null,
    endsOn: null,
    neverExpire: false,
    stopped: false,
    lastRecurringDate: null,
    nextRecurringDate: null,
    currencyCode: 'GBP',
    exchangeRate: '1.0000',
    ...overrides,
  };
}

/**
 * Build a mock req/res pair for updateExpense.
 */
function makeReqRes(body: Record<string, unknown>, expenseId = EXPENSE_ID) {
  const req = {
    user: OWNER_ID,
    tenantId: OWNER_ID,
    params: { id: expenseId },
    body,
    file: undefined,
    files: undefined,
    query: {},
  } as unknown as import('express').Request;

  let responseStatus = 0;
  let responseData: unknown = null;

  const res = {
    status(code: number) {
      responseStatus = code;
      return this;
    },
    json(data: unknown) {
      responseData = data;
      return this;
    },
    _get() {
      return { status: responseStatus, data: responseData };
    },
  } as unknown as import('express').Response & { _get(): { status: number; data: unknown } };

  return { req, res };
}

// ---------------------------------------------------------------------------
// Setup defaults before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // express-validator: no errors by default.
  mockValidationResult.mockReturnValue({ isEmpty: () => true, array: () => [] });

  // FX rate guard: always resolves cleanly (no error).
  mockResolveFxRate.mockResolvedValue({ rate: undefined, error: undefined });

  // Default expense: BANK source type.
  mockExpenseFindFirst.mockResolvedValue(makeExpense());

  // Default user (paidBy): found in workspace.
  mockUserFindFirst.mockResolvedValue({ id: PAID_BY_ID });

  // Expense update: return updated row.
  mockExpenseUpdate.mockResolvedValue({
    ...makeExpense(),
    customFieldValues: [],
  });

  // Activity log + audit: no-ops.
  mockLogCreate.mockResolvedValue({});
  mockAuditCreate.mockResolvedValue({});
  mockCustomFieldValueUpsert.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('updateExpense — paidByUserId handling', () => {
  // -------------------------------------------------------------------------
  // 1. Switching TO EMPLOYEE_PAID without paidByUserId → 400
  // -------------------------------------------------------------------------

  it('rejects with 400 when switching to EMPLOYEE_PAID without paidByUserId', async () => {
    const { req, res } = makeReqRes({
      sourceType: 'EMPLOYEE_PAID',
      amount: '100.00',
      expenseDate: '2026-01-15',
      expenseCategoryId: CATEGORY_ID,
      // paidByUserId intentionally omitted
    });

    await updateExpense(req, res as import('express').Response);

    const { status, data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    expect(status).toBe(400);
    expect((data as { errors: { paidByUserId: string } }).errors.paidByUserId).toBeTruthy();
  });

  it('rejects with 400 when switching to EMPLOYEE_PAID with explicit null paidByUserId', async () => {
    const { req, res } = makeReqRes({
      sourceType: 'EMPLOYEE_PAID',
      amount: '100.00',
      expenseDate: '2026-01-15',
      expenseCategoryId: CATEGORY_ID,
      paidByUserId: null,
    });

    await updateExpense(req, res as import('express').Response);

    const { status, data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    expect(status).toBe(400);
    expect((data as { errors: { paidByUserId: string } }).errors.paidByUserId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 2. Switching TO EMPLOYEE_PAID with an unknown paidByUserId → 400
  // -------------------------------------------------------------------------

  it('rejects with 400 when paidByUserId is not found in workspace', async () => {
    // User lookup returns null → not in workspace.
    mockUserFindFirst.mockResolvedValue(null);

    const { req, res } = makeReqRes({
      sourceType: 'EMPLOYEE_PAID',
      amount: '100.00',
      expenseDate: '2026-01-15',
      expenseCategoryId: CATEGORY_ID,
      paidByUserId: 'unknown-user-id',
    });

    await updateExpense(req, res as import('express').Response);

    const { status, data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    expect(status).toBe(400);
    expect((data as { errors: { paidByUserId: string } }).errors.paidByUserId).toMatch(
      /not found in your workspace/i,
    );
  });

  // -------------------------------------------------------------------------
  // 3. Staying EMPLOYEE_PAID without sending paidByUserId → uses existing
  //    (no 400 because the row already has a valid paidByUserId)
  // -------------------------------------------------------------------------

  it('accepts update when expense is already EMPLOYEE_PAID and paidByUserId is not in body', async () => {
    // Expense already has paidByUserId set.
    mockExpenseFindFirst.mockResolvedValue(
      makeExpense({ sourceType: 'EMPLOYEE_PAID', bankId: null, paymentModeId: null, paidByUserId: PAID_BY_ID }),
    );

    const { req, res } = makeReqRes({
      // Not changing sourceType or paidByUserId — just updating description.
      description: 'Updated description',
      amount: '100.00',
      expenseDate: '2026-01-15',
      expenseCategoryId: CATEGORY_ID,
      // Note: no sourceType or paidByUserId in body
    });

    await updateExpense(req, res as import('express').Response);

    const { status } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    // Should NOT be 400 — the existing paidByUserId satisfies the requirement.
    expect(status).not.toBe(400);
  });

  // -------------------------------------------------------------------------
  // 4. EMPLOYEE_PAID → BANK: paidByUserId should be nulled in updateData
  // -------------------------------------------------------------------------

  it('nulls paidByUserId in updateData when switching away from EMPLOYEE_PAID to BANK', async () => {
    // Expense starts as EMPLOYEE_PAID with a paidByUserId.
    mockExpenseFindFirst.mockResolvedValue(
      makeExpense({
        sourceType: 'EMPLOYEE_PAID',
        bankId: null,
        paymentModeId: null,
        paidByUserId: PAID_BY_ID,
      }),
    );

    const { req, res } = makeReqRes({
      sourceType: 'BANK',
      bankId: 'bank-uuid-5',
      paymentMode: 'mode-uuid-6',
      amount: '100.00',
      expenseDate: '2026-01-15',
      expenseCategoryId: CATEGORY_ID,
    });

    await updateExpense(req, res as import('express').Response);

    // The update should have been called with paidByUserId = null.
    // We check the updateData argument passed to expense.update inside the tx.
    expect(mockExpenseUpdate).toHaveBeenCalledOnce();
    const callArg = mockExpenseUpdate.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(callArg.data.paidByUserId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 5. BANK → EMPLOYEE_PAID with valid paidByUserId: updateData has paidByUserId
  // -------------------------------------------------------------------------

  it('persists paidByUserId in updateData when switching BANK → EMPLOYEE_PAID', async () => {
    const { req, res } = makeReqRes({
      sourceType: 'EMPLOYEE_PAID',
      paidByUserId: PAID_BY_ID,
      amount: '100.00',
      expenseDate: '2026-01-15',
      expenseCategoryId: CATEGORY_ID,
    });

    await updateExpense(req, res as import('express').Response);

    expect(mockExpenseUpdate).toHaveBeenCalledOnce();
    const callArg = mockExpenseUpdate.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(callArg.data.paidByUserId).toBe(PAID_BY_ID);
  });
});
