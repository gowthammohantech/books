/**
 * tests/myMoney.test.ts
 *
 * Unit tests for the My Money controller logic.
 *
 * Strategy: We test the bucketing, broughtForward, and tax-year windowing logic
 * directly by importing the controller and mocking `prisma` so we never need a
 * real DB. The mock returns seeded BankTransaction rows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock prisma BEFORE importing the controller.
// Use vi.hoisted to declare mocks that survive the hoisting of vi.mock().
// ---------------------------------------------------------------------------

const { mockFindFirst, mockTxnFindMany, mockExpenseFindMany } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockTxnFindMany: vi.fn(),
  mockExpenseFindMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: { findFirst: mockFindFirst },
    bankTransaction: { findMany: mockTxnFindMany },
    expense: { findMany: mockExpenseFindMany },
  },
}));

// We import the controller AFTER the mock is in place so the module picks up
// the mocked prisma. We use the named export directly.
import { getMyMoney } from '../controllers/myMoneyController';

// ---------------------------------------------------------------------------
// Helpers to build fake bank transactions
// ---------------------------------------------------------------------------

interface FakeTxn {
  id: string;
  transactionDate: Date;
  type: string;
  amount: string;
  explainStatus: string;
  isReconciled: boolean;
  postedSourceType: string | null;
  postedSourceId: string | null;
  transactionTypeKey: string | null;
  userPaymentReason: string | null;
  explainedDescription: string | null;
  remarks: string | null;
}

function makeTxn(overrides: Partial<FakeTxn> & { amount: string }): FakeTxn {
  return {
    id: `txn-${Math.random().toString(36).slice(2)}`,
    // Default date is within 2025/26 (6 Apr 2025 – 5 Apr 2026)
    transactionDate: new Date('2025-09-01T00:00:00Z'),
    type: 'PAYMENT',
    explainStatus: 'EXPLAINED',
    isReconciled: true,
    postedSourceType: 'BankTxnExplain',
    postedSourceId: 'src-1',
    transactionTypeKey: null,
    userPaymentReason: null,
    explainedDescription: null,
    remarks: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper to build a mock req/res pair
// ---------------------------------------------------------------------------

function makeReqRes(userId: string, params: { userId: string }, query: Record<string, string> = {}) {
  const req = {
    user: userId,
    tenantId: userId,
    params,
    query,
    body: {},
  } as unknown as import('express').Request;

  let responseData: unknown = null;
  let responseStatus = 0;

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
// Tests
// ---------------------------------------------------------------------------

describe('getMyMoney controller', () => {
  const OWNER_ID = 'owner-1';
  const TARGET_ID = 'target-user-1';
  const OTHER_TARGET_ID = 'other-owner-target';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default user mock — found in workspace
    mockFindFirst.mockResolvedValue({
      id: TARGET_ID,
      firstName: 'Alice',
      lastName: 'Smith',
    });

    // Default expense mock — no reimbursable expenses (pre-M3 tests expect expensesOwed = 0)
    mockExpenseFindMany.mockResolvedValue([]);
  });

  // -------------------------------------------------------------------------
  // Basic shape
  // -------------------------------------------------------------------------

  it('returns the expected top-level shape', async () => {
    mockTxnFindMany.mockResolvedValue([]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { status, data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    expect(status).toBe(200);
    const d = (data as { success: boolean; data: unknown }).data as Record<string, unknown>;
    expect(d).toHaveProperty('user');
    expect(d).toHaveProperty('taxYear');
    expect(d).toHaveProperty('salary');
    expect(d).toHaveProperty('dividends');
    expect(d).toHaveProperty('directorLoan');
    expect(d).toHaveProperty('shareCapital');
    expect(d).toHaveProperty('expensesOwed');
  });

  it('returns 404 when user is not in this workspace', async () => {
    mockFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes(OWNER_ID, { userId: OTHER_TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { status } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    expect(status).toBe(404);
  });

  it('returns 400 for a malformed taxYear label', async () => {
    mockTxnFindMany.mockResolvedValue([]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: 'bad-label' });
    await getMyMoney(req, res as import('express').Response);
    const { status } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    expect(status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Salary bucketing — new reason-based type
  // -------------------------------------------------------------------------

  it('sums net_salary (new money_paid_to_user reason) into salary.totalPaid', async () => {
    mockTxnFindMany.mockResolvedValue([
      makeTxn({ amount: '1500.00', transactionTypeKey: 'money_paid_to_user', userPaymentReason: 'net_salary', explainedDescription: 'Salary Jan' }),
      makeTxn({ amount: '200.00', transactionTypeKey: 'money_paid_to_user', userPaymentReason: 'benefit_in_kind', explainedDescription: 'BIK' }),
    ]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const salary = d.salary as { entries: unknown[]; totalPaid: number };
    expect(salary.totalPaid).toBeCloseTo(1700.0);
    expect(salary.entries).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Salary bucketing — legacy type keys
  // -------------------------------------------------------------------------

  it('sums legacy net_salary type key into salary.totalPaid', async () => {
    mockTxnFindMany.mockResolvedValue([
      makeTxn({ amount: '2000.00', transactionTypeKey: 'net_salary', userPaymentReason: null }),
    ]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const salary = d.salary as { totalPaid: number };
    expect(salary.totalPaid).toBeCloseTo(2000.0);
  });

  // -------------------------------------------------------------------------
  // Dividend bucketing
  // -------------------------------------------------------------------------

  it('sums dividend (new reason) into dividends.totalPaid', async () => {
    mockTxnFindMany.mockResolvedValue([
      makeTxn({ amount: '5000.00', transactionTypeKey: 'money_paid_to_user', userPaymentReason: 'dividend' }),
      makeTxn({ amount: '3000.00', transactionTypeKey: 'money_paid_to_user', userPaymentReason: 'dividend' }),
    ]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const dividends = d.dividends as { totalPaid: number };
    expect(dividends.totalPaid).toBeCloseTo(8000.0);
  });

  it('sums legacy dividend type key into dividends.totalPaid', async () => {
    mockTxnFindMany.mockResolvedValue([
      makeTxn({ amount: '4000.00', transactionTypeKey: 'dividend', userPaymentReason: null }),
    ]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const dividends = d.dividends as { totalPaid: number };
    expect(dividends.totalPaid).toBeCloseTo(4000.0);
  });

  // -------------------------------------------------------------------------
  // Director loan — in/out + broughtForward
  // -------------------------------------------------------------------------

  it('computes director-loan balance correctly for in-window txns', async () => {
    // All in-window: loan in 10000, repayment out 3000 → balance 7000, bf=0
    mockTxnFindMany.mockResolvedValue([
      makeTxn({ amount: '10000.00', transactionTypeKey: 'money_received_from_user', userPaymentReason: 'director_loan' }),
      makeTxn({ amount: '3000.00', transactionTypeKey: 'money_paid_to_user', userPaymentReason: 'director_loan_repayment' }),
    ]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const dl = d.directorLoan as { broughtForward: number; balance: number; entries: unknown[] };
    expect(dl.broughtForward).toBeCloseTo(0);
    expect(dl.balance).toBeCloseTo(7000);
    expect(dl.entries).toHaveLength(2);
  });

  it('includes broughtForward from txns before tax year start', async () => {
    // Two txns: one BEFORE the 2025/26 window (loan in 5000), one IN window (repayment 2000)
    // 2025/26 starts 2025-04-06
    const beforeDate = new Date('2025-04-05T00:00:00Z'); // 5 Apr 2025 — in 2024/25
    const inDate = new Date('2025-04-06T00:00:00Z');     // 6 Apr 2025 — in 2025/26

    mockTxnFindMany.mockResolvedValue([
      makeTxn({
        amount: '5000.00',
        transactionDate: beforeDate,
        transactionTypeKey: 'money_received_from_user',
        userPaymentReason: 'director_loan',
      }),
      makeTxn({
        amount: '2000.00',
        transactionDate: inDate,
        transactionTypeKey: 'money_paid_to_user',
        userPaymentReason: 'director_loan_repayment',
      }),
    ]);

    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const dl = d.directorLoan as { broughtForward: number; balance: number };
    expect(dl.broughtForward).toBeCloseTo(5000);
    expect(dl.balance).toBeCloseTo(3000); // 5000 bf + 0 in − 2000 out
  });

  // -------------------------------------------------------------------------
  // Tax-year windowing: boundary dates
  // -------------------------------------------------------------------------

  it('assigns 5 Apr txn to the previous tax year (not in 2025/26)', async () => {
    // 5 Apr 2025 = last day of 2024/25; should go to beforeWindow for 2025/26
    const on5Apr = new Date('2025-04-05T23:59:59Z');
    mockTxnFindMany.mockResolvedValue([
      makeTxn({
        amount: '1000.00',
        transactionDate: on5Apr,
        transactionTypeKey: 'money_paid_to_user',
        userPaymentReason: 'net_salary',
      }),
    ]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const salary = d.salary as { totalPaid: number };
    // The 5 Apr txn lands in before-window — salary total for 2025/26 is 0
    expect(salary.totalPaid).toBeCloseTo(0);
  });

  it('assigns 6 Apr txn to the current tax year (in 2025/26)', async () => {
    // 6 Apr 2025 = first day of 2025/26
    const on6Apr = new Date('2025-04-06T00:00:00Z');
    mockTxnFindMany.mockResolvedValue([
      makeTxn({
        amount: '1000.00',
        transactionDate: on6Apr,
        transactionTypeKey: 'money_paid_to_user',
        userPaymentReason: 'net_salary',
      }),
    ]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const salary = d.salary as { totalPaid: number };
    expect(salary.totalPaid).toBeCloseTo(1000);
  });

  // -------------------------------------------------------------------------
  // Owner scoping — another tenant's txns excluded
  // -------------------------------------------------------------------------

  it('returns empty data when no txns are returned (owner scoping)', async () => {
    // prisma filters by bankAccount.userId = tenantId already; we simulate by returning []
    mockTxnFindMany.mockResolvedValue([]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const salary = d.salary as { totalPaid: number };
    const dividends = d.dividends as { totalPaid: number };
    expect(salary.totalPaid).toBe(0);
    expect(dividends.totalPaid).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Share capital
  // -------------------------------------------------------------------------

  it('sums share_capital_introduced (new reason) into shareCapital.totalIn', async () => {
    mockTxnFindMany.mockResolvedValue([
      makeTxn({ amount: '50000.00', transactionTypeKey: 'money_received_from_user', userPaymentReason: 'share_capital_introduced' }),
      makeTxn({ amount: '10000.00', transactionTypeKey: 'money_received_from_user', userPaymentReason: 'unpaid_shares' }),
    ]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const sc = d.shareCapital as { totalIn: number; entries: unknown[] };
    expect(sc.totalIn).toBeCloseTo(60000);
    expect(sc.entries).toHaveLength(2);
  });

  it('sums legacy share_capital and unpaid_shares type keys into shareCapital.totalIn', async () => {
    mockTxnFindMany.mockResolvedValue([
      makeTxn({ amount: '25000.00', transactionTypeKey: 'share_capital', userPaymentReason: null }),
      makeTxn({ amount: '5000.00', transactionTypeKey: 'unpaid_shares', userPaymentReason: null }),
    ]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const sc = d.shareCapital as { totalIn: number };
    expect(sc.totalIn).toBeCloseTo(30000);
  });

  // -------------------------------------------------------------------------
  // Unposted txns excluded
  // -------------------------------------------------------------------------

  it('ignores txns that are explained but not posted (postedSourceId=null, isReconciled=false)', async () => {
    mockTxnFindMany.mockResolvedValue([
      makeTxn({
        amount: '9999.00',
        transactionTypeKey: 'money_paid_to_user',
        userPaymentReason: 'net_salary',
        isReconciled: false,
        postedSourceId: null,
      }),
    ]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const salary = d.salary as { totalPaid: number };
    expect(salary.totalPaid).toBeCloseTo(0);
  });

  // -------------------------------------------------------------------------
  // expensesOwed placeholder
  // -------------------------------------------------------------------------

  it('returns empty expensesOwed placeholder', async () => {
    mockTxnFindMany.mockResolvedValue([]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const eo = d.expensesOwed as { owed: number; reimbursed: number; outstanding: number; entries: unknown[] };
    expect(eo.owed).toBe(0);
    expect(eo.reimbursed).toBe(0);
    expect(eo.outstanding).toBe(0);
    expect(eo.entries).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Mix of new + legacy across two tax years
  // -------------------------------------------------------------------------

  it('correctly aggregates a mix of new and legacy txns across tax years', async () => {
    // Tax year 2025/26: 2025-04-06 to 2026-04-05
    // Before window: legacy net_salary 500 (2024/25), director_loan_in 2000 (2024/25)
    // In window: new net_salary 1500, new dividend 3000, new director_loan_repayment 500

    mockTxnFindMany.mockResolvedValue([
      // Before 2025/26 window
      makeTxn({
        id: 'bf-salary',
        amount: '500.00',
        transactionDate: new Date('2024-10-01T00:00:00Z'), // 2024/25
        transactionTypeKey: 'net_salary',
        userPaymentReason: null,
      }),
      makeTxn({
        id: 'bf-dl',
        amount: '2000.00',
        transactionDate: new Date('2024-12-01T00:00:00Z'), // 2024/25
        transactionTypeKey: 'owner_loan_in',
        userPaymentReason: null,
      }),
      // In 2025/26 window
      makeTxn({
        id: 'in-salary',
        amount: '1500.00',
        transactionDate: new Date('2025-06-01T00:00:00Z'),
        transactionTypeKey: 'money_paid_to_user',
        userPaymentReason: 'net_salary',
      }),
      makeTxn({
        id: 'in-dividend',
        amount: '3000.00',
        transactionDate: new Date('2025-07-01T00:00:00Z'),
        transactionTypeKey: 'money_paid_to_user',
        userPaymentReason: 'dividend',
      }),
      makeTxn({
        id: 'in-dl-repay',
        amount: '500.00',
        transactionDate: new Date('2025-08-01T00:00:00Z'),
        transactionTypeKey: 'money_paid_to_user',
        userPaymentReason: 'director_loan_repayment',
      }),
    ]);

    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2025/26' });
    await getMyMoney(req, res as import('express').Response);
    const { status, data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    expect(status).toBe(200);

    const d = (data as { data: Record<string, unknown> }).data;
    const salary = d.salary as { totalPaid: number };
    const dividends = d.dividends as { totalPaid: number };
    const dl = d.directorLoan as { broughtForward: number; balance: number };

    // Salary: only 2025/26 window txn (1500); bf-salary was before window
    expect(salary.totalPaid).toBeCloseTo(1500);
    expect(dividends.totalPaid).toBeCloseTo(3000);

    // Director loan: bf from 2024/25 = 2000; in-window repayment 500 → balance 1500
    expect(dl.broughtForward).toBeCloseTo(2000);
    expect(dl.balance).toBeCloseTo(1500);
  });

  // -------------------------------------------------------------------------
  // taxYear label in response
  // -------------------------------------------------------------------------

  it('reflects the requested tax year label in the response', async () => {
    mockTxnFindMany.mockResolvedValue([]);
    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: '2024/25' });
    await getMyMoney(req, res as import('express').Response);
    const { data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    const d = (data as { data: Record<string, unknown> }).data;
    const ty = d.taxYear as { label: string };
    expect(ty.label).toBe('2024/25');
  });
});
