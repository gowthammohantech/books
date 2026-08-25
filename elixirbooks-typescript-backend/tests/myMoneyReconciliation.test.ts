/**
 * tests/myMoneyReconciliation.test.ts
 *
 * Reconciliation tests: My Money per-user totals MUST tie to the banking
 * user-payments that feed them, by construction.
 *
 * Assertions:
 * 1. Money-out reconciliation:
 *    salary.totalPaid + dividends.totalPaid + directorLoan(out) + shareCapital.totalIn
 *    + expensesOwed.reimbursed
 *    == Σ posted bank user-payments to that person (all buckets: out-flows summed)
 *
 * 2. Director-loan balance:
 *    directorLoan.balance == broughtForward + Σ in-window DL-in − Σ in-window DL-out
 *
 * 3. Expenses outstanding:
 *    expensesOwed.outstanding == Σ reimbursable expense gross − Σ expense_payment settlements
 *
 * The test seeds concrete numbers, drives the controller via mock prisma, then
 * asserts each reconciliation identity with real values.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock prisma BEFORE importing the controller.
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

import { getMyMoney, buildExpensesOwed } from '../controllers/myMoneyController';

// ---------------------------------------------------------------------------
// Helpers
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

/** Build a posted bank txn (default: in 2025/26 window). */
function makeTxn(overrides: Partial<FakeTxn> & { amount: string }): FakeTxn {
  return {
    id: `txn-${Math.random().toString(36).slice(2)}`,
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

/** Build a fake reimbursable Expense row (EMPLOYEE_PAID, maps to 9250 credit). */
function makeExpense(amount: string, date = new Date('2025-08-15T00:00:00Z'), description = 'Business travel') {
  return { expenseDate: date, amount, description, referenceNo: null };
}

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
    status(code: number) { responseStatus = code; return this; },
    json(data: unknown) { responseData = data; return this; },
    _get() { return { status: responseStatus, data: responseData }; },
  } as unknown as import('express').Response & { _get(): { status: number; data: unknown } };

  return { req, res };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('My Money reconciliation — totals tie to banking user-payments', () => {
  const OWNER_ID = 'owner-rec-1';
  const TARGET_ID = 'user-rec-1';
  const TAX_YEAR = '2025/26'; // 6 Apr 2025 – 5 Apr 2026

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockResolvedValue({ id: TARGET_ID, firstName: 'Bob', lastName: 'Builder' });
    // Default: no expenses
    mockExpenseFindMany.mockResolvedValue([]);
  });

  // -------------------------------------------------------------------------
  // 1. Full reconciliation: money-out to user == sum of bucketed bank txns
  // -------------------------------------------------------------------------

  it('money-out reconciliation: salary + dividends + DL-out + shareCapital + expensesReimbursed == bank txns sum', async () => {
    /**
     * Seed a realistic tax year for Bob:
     *   salary (net):         £3 000 × 2 = £6 000
     *   benefit_in_kind:      £500
     *   dividend:             £10 000
     *   director_loan_out:    £2 000  (repayment to Bob)
     *   share_capital_in:     £5 000  (Bob buys shares → money_received_from_user)
     *   expense_payment:      £320    (reimbursement bank txn)
     *
     * Banking "money out to Bob" = salary + BIK + dividend + DL-repayment + expense_payment
     *   = 6000 + 500 + 10000 + 2000 + 320 = 18 820
     *
     * My Money totals:
     *   salary.totalPaid     = 6 500
     *   dividends.totalPaid  = 10 000
     *   directorLoan DL-out  = 2 000
     *   expensesOwed.reimbursed = 320
     *   shareCapital.totalIn = 5 000   (this is money IN from Bob, NOT a payment to Bob)
     *
     * Note: share_capital_introduced is money the user paid INTO the company
     * (money_received_from_user), so it is NOT in the money-out-to-user sum.
     *
     * money-out reconciliation identity:
     *   salary.totalPaid + dividends.totalPaid + DL-out + expensesOwed.reimbursed
     *   == Σ bank txns that are outflows to user
     *   = 6500 + 10000 + 2000 + 320 = 18 820
     */

    const inWindowTxns = [
      // Salary — 2 payments
      makeTxn({ amount: '3000.00', transactionTypeKey: 'money_paid_to_user', userPaymentReason: 'net_salary',      explainedDescription: 'Salary Apr' }),
      makeTxn({ amount: '3000.00', transactionTypeKey: 'money_paid_to_user', userPaymentReason: 'net_salary',      explainedDescription: 'Salary May', transactionDate: new Date('2025-10-01T00:00:00Z') }),
      // BIK
      makeTxn({ amount: '500.00',  transactionTypeKey: 'money_paid_to_user', userPaymentReason: 'benefit_in_kind', explainedDescription: 'BIK' }),
      // Dividend
      makeTxn({ amount: '10000.00',transactionTypeKey: 'money_paid_to_user', userPaymentReason: 'dividend',        explainedDescription: 'Dividend Q1' }),
      // Director loan repayment (OUT to Bob)
      makeTxn({ amount: '2000.00', transactionTypeKey: 'money_paid_to_user', userPaymentReason: 'director_loan_repayment', explainedDescription: 'DL repay' }),
      // Expense reimbursement (OUT to Bob)
      makeTxn({ amount: '320.00',  transactionTypeKey: 'money_paid_to_user', userPaymentReason: 'expense_payment', explainedDescription: 'Expense reimbursement' }),
      // Share capital (IN from Bob — money_received_from_user, NOT counted in money-out)
      makeTxn({ amount: '5000.00', transactionTypeKey: 'money_received_from_user', userPaymentReason: 'share_capital_introduced', explainedDescription: 'Share capital' }),
    ];

    mockTxnFindMany.mockResolvedValue(inWindowTxns);

    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: TAX_YEAR });
    await getMyMoney(req, res as import('express').Response);
    const { status, data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    expect(status).toBe(200);

    const d = (data as { data: Record<string, unknown> }).data;
    const salary     = d.salary     as { totalPaid: number };
    const dividends  = d.dividends  as { totalPaid: number };
    const dl         = d.directorLoan as { entries: { in: number; out: number }[]; broughtForward: number; balance: number };
    const sc         = d.shareCapital as { totalIn: number };
    const eo         = d.expensesOwed as { reimbursed: number; outstanding: number };

    // My Money computed values
    expect(salary.totalPaid).toBeCloseTo(6500);
    expect(dividends.totalPaid).toBeCloseTo(10000);
    expect(sc.totalIn).toBeCloseTo(5000);
    expect(eo.reimbursed).toBeCloseTo(320);

    const dlOut = dl.entries.reduce((s, e) => s + e.out, 0);
    expect(dlOut).toBeCloseTo(2000);

    // -----------------------------------------------------------------------
    // RECONCILIATION IDENTITY 1:
    //   money_paid_to_user bank txns for this user
    //   == salary + dividends + DL-out + expensesOwed.reimbursed
    // -----------------------------------------------------------------------
    const bankMoneyOutToUser =
      inWindowTxns
        .filter((t) => t.transactionTypeKey === 'money_paid_to_user')
        .reduce((s, t) => s + Number(t.amount), 0);

    const myMoneyOutSum =
      salary.totalPaid +
      dividends.totalPaid +
      dlOut +
      eo.reimbursed;

    expect(bankMoneyOutToUser).toBeCloseTo(18820);
    expect(myMoneyOutSum).toBeCloseTo(18820);
    // The identity: My Money totals == bank user-payment outflows
    expect(myMoneyOutSum).toBeCloseTo(bankMoneyOutToUser);

    // -----------------------------------------------------------------------
    // RECONCILIATION IDENTITY 2 (share capital — money IN from user):
    //   shareCapital.totalIn == Σ money_received_from_user bank txns (sc reasons)
    // -----------------------------------------------------------------------
    const bankMoneyInFromUser =
      inWindowTxns
        .filter((t) => t.transactionTypeKey === 'money_received_from_user')
        .reduce((s, t) => s + Number(t.amount), 0);

    expect(sc.totalIn).toBeCloseTo(bankMoneyInFromUser);
  });

  // -------------------------------------------------------------------------
  // 2. Director-loan balance identity
  // -------------------------------------------------------------------------

  it('director-loan balance == broughtForward + Σ in-window DL-in − Σ in-window DL-out', async () => {
    /**
     * History:
     *   2024/25 (before window): DL-in £8 000 → broughtForward = 8 000
     *   2025/26 (in window):     DL-in £3 000, DL-out (repayment) £4 000
     *
     * Expected balance = 8 000 + 3 000 − 4 000 = 7 000
     */
    const beforeTxns = [
      makeTxn({
        amount: '8000.00',
        transactionDate: new Date('2024-11-01T00:00:00Z'), // before 2025/26
        transactionTypeKey: 'money_received_from_user',
        userPaymentReason: 'director_loan',
        explainedDescription: 'DL advance 2024/25',
      }),
    ];
    const inWindowTxns = [
      makeTxn({
        amount: '3000.00',
        transactionDate: new Date('2025-06-01T00:00:00Z'),
        transactionTypeKey: 'money_received_from_user',
        userPaymentReason: 'director_loan',
        explainedDescription: 'DL advance Jun',
      }),
      makeTxn({
        amount: '4000.00',
        transactionDate: new Date('2025-09-01T00:00:00Z'),
        transactionTypeKey: 'money_paid_to_user',
        userPaymentReason: 'director_loan_repayment',
        explainedDescription: 'DL repayment Sep',
      }),
    ];

    mockTxnFindMany.mockResolvedValue([...beforeTxns, ...inWindowTxns]);

    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: TAX_YEAR });
    await getMyMoney(req, res as import('express').Response);
    const { status, data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    expect(status).toBe(200);

    const d = (data as { data: Record<string, unknown> }).data;
    const dl = d.directorLoan as {
      entries: { in: number; out: number }[];
      broughtForward: number;
      balance: number;
    };

    const broughtForward = 8000;
    const dlInWindow     = 3000;
    const dlOutWindow    = 4000;
    const expectedBalance = broughtForward + dlInWindow - dlOutWindow; // 7000

    expect(dl.broughtForward).toBeCloseTo(broughtForward);
    const dlInSum  = dl.entries.reduce((s, e) => s + e.in, 0);
    const dlOutSum = dl.entries.reduce((s, e) => s + e.out, 0);
    expect(dlInSum).toBeCloseTo(dlInWindow);
    expect(dlOutSum).toBeCloseTo(dlOutWindow);

    // RECONCILIATION IDENTITY 2:
    //   balance == broughtForward + Σin − Σout
    expect(dl.balance).toBeCloseTo(expectedBalance);
    expect(dl.balance).toBeCloseTo(dl.broughtForward + dlInSum - dlOutSum);
  });

  // -------------------------------------------------------------------------
  // 3. expensesOwed.outstanding identity
  // -------------------------------------------------------------------------

  it('expensesOwed.outstanding == Σ reimbursable expenses − Σ expense_payment settlements', async () => {
    /**
     * Reimbursable expenses for Bob in 2025/26 (EMPLOYEE_PAID → credit 9250):
     *   travel £450, client meals £180, equipment £220 → owed = 850
     *
     * Expense-payment bank txns (bank debit settling 9250 → money out to Bob):
     *   settlement 1: £450, settlement 2: £180 → reimbursed = 630
     *
     * outstanding = 850 − 630 = 220 (£220 equipment still owed)
     */
    const expenseRows = [
      makeExpense('450.00', new Date('2025-05-10T00:00:00Z'), 'Business travel'),
      makeExpense('180.00', new Date('2025-06-20T00:00:00Z'), 'Client meals'),
      makeExpense('220.00', new Date('2025-07-15T00:00:00Z'), 'Equipment'),
    ];
    const settlementTxns = [
      makeTxn({ amount: '450.00', transactionDate: new Date('2025-05-31T00:00:00Z'), transactionTypeKey: 'money_paid_to_user', userPaymentReason: 'expense_payment', explainedDescription: 'Reimburse travel' }),
      makeTxn({ amount: '180.00', transactionDate: new Date('2025-06-30T00:00:00Z'), transactionTypeKey: 'money_paid_to_user', userPaymentReason: 'expense_payment', explainedDescription: 'Reimburse meals' }),
    ];

    mockTxnFindMany.mockResolvedValue(settlementTxns);
    mockExpenseFindMany.mockResolvedValue(expenseRows);

    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: TAX_YEAR });
    await getMyMoney(req, res as import('express').Response);
    const { status, data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    expect(status).toBe(200);

    const d = (data as { data: Record<string, unknown> }).data;
    const eo = d.expensesOwed as { owed: number; reimbursed: number; outstanding: number; entries: unknown[] };

    const totalOwed       = expenseRows.reduce((s, e) => s + Number(e.amount), 0); // 850
    const totalReimbursed = settlementTxns.reduce((s, t) => s + Number(t.amount), 0); // 630
    const expectedOutstanding = totalOwed - totalReimbursed; // 220

    expect(eo.owed).toBeCloseTo(totalOwed);
    expect(eo.reimbursed).toBeCloseTo(totalReimbursed);

    // RECONCILIATION IDENTITY 3:
    //   outstanding == Σ reimbursable expenses − Σ settlements
    expect(eo.outstanding).toBeCloseTo(expectedOutstanding);
    expect(eo.outstanding).toBeCloseTo(eo.owed - eo.reimbursed);
  });

  // -------------------------------------------------------------------------
  // 4. Pure helper: buildExpensesOwed ties out directly (no controller needed)
  // -------------------------------------------------------------------------

  it('buildExpensesOwed: outstanding == owed − reimbursed for arbitrary inputs', () => {
    const expenses = [
      { date: new Date('2025-04-10'), description: 'Hotel', amount: 350.00 },
      { date: new Date('2025-05-05'), description: 'Train', amount: 75.50 },
      { date: new Date('2025-07-20'), description: 'Taxi',  amount: 24.00 },
    ];
    const settlements = [
      { date: new Date('2025-04-30'), description: 'Part reimb', amount: 200.00 },
    ];

    const result = buildExpensesOwed(expenses, settlements);

    const expectedOwed       = 350 + 75.5 + 24;   // 449.50
    const expectedReimbursed = 200;
    const expectedOutstanding = expectedOwed - expectedReimbursed; // 249.50

    expect(result.owed).toBeCloseTo(expectedOwed);
    expect(result.reimbursed).toBeCloseTo(expectedReimbursed);
    // RECONCILIATION IDENTITY: outstanding == owed − reimbursed
    expect(result.outstanding).toBeCloseTo(expectedOutstanding);
    expect(result.outstanding).toBeCloseTo(result.owed - result.reimbursed);
    // Entries are sorted by date ascending
    expect(result.entries[0].date).toEqual(expenses[0].date);  // Hotel
    expect(result.entries[1].date).toEqual(settlements[0].date); // Part reimb
  });

  // -------------------------------------------------------------------------
  // 5. Full integration: all buckets present + expenses
  // -------------------------------------------------------------------------

  it('all-buckets full integration: each reconciliation identity holds simultaneously', async () => {
    /**
     * A complete tax year for Alice:
     *   Before window (2024/25): DL-in £12 000 → broughtForward = 12 000
     *
     *   In window (2025/26):
     *     salary:            £4 000 (net_salary)
     *     BIK:               £600   (benefit_in_kind)
     *     dividend:          £15 000
     *     DL-in:             £2 000 (director_loan)
     *     DL-out (repay):    £5 000 (director_loan_repayment)
     *     share capital:     £20 000 (share_capital_introduced, money FROM user)
     *     expense_payment:   £750 (reimbursement)
     *
     *   Reimbursable expenses: £900 total
     *
     *   Expected reconciliation:
     *     salary.totalPaid            = 4600  (4000 + 600)
     *     dividends.totalPaid         = 15000
     *     DL-out                      = 5000
     *     expensesOwed.reimbursed     = 750
     *     money-out bank sum          = 4600 + 15000 + 5000 + 750 = 25 350
     *
     *     shareCapital.totalIn        = 20 000
     *     money-in bank sum           = 2000 (DL-in) + 20000 (SC) = 22 000
     *       (DL-in is separately captured in directorLoan.entries, SC in shareCapital)
     *
     *     DL balance = 12000 + 2000 − 5000 = 9000
     *     expensesOwed.outstanding = 900 − 750 = 150
     */
    const beforeTxns = [
      makeTxn({
        amount: '12000.00',
        transactionDate: new Date('2024-08-01T00:00:00Z'),
        transactionTypeKey: 'money_received_from_user',
        userPaymentReason: 'director_loan',
        explainedDescription: 'DL advance 24/25',
      }),
    ];
    const inWindowTxns = [
      makeTxn({ amount: '4000.00',  transactionTypeKey: 'money_paid_to_user',      userPaymentReason: 'net_salary',              transactionDate: new Date('2025-06-01T00:00:00Z'), explainedDescription: 'Salary' }),
      makeTxn({ amount: '600.00',   transactionTypeKey: 'money_paid_to_user',      userPaymentReason: 'benefit_in_kind',         transactionDate: new Date('2025-06-01T00:00:00Z'), explainedDescription: 'BIK' }),
      makeTxn({ amount: '15000.00', transactionTypeKey: 'money_paid_to_user',      userPaymentReason: 'dividend',                transactionDate: new Date('2025-07-01T00:00:00Z'), explainedDescription: 'Dividend' }),
      makeTxn({ amount: '2000.00',  transactionTypeKey: 'money_received_from_user',userPaymentReason: 'director_loan',           transactionDate: new Date('2025-08-01T00:00:00Z'), explainedDescription: 'DL top-up' }),
      makeTxn({ amount: '5000.00',  transactionTypeKey: 'money_paid_to_user',      userPaymentReason: 'director_loan_repayment', transactionDate: new Date('2025-09-01T00:00:00Z'), explainedDescription: 'DL repay' }),
      makeTxn({ amount: '20000.00', transactionTypeKey: 'money_received_from_user',userPaymentReason: 'share_capital_introduced',transactionDate: new Date('2025-10-01T00:00:00Z'), explainedDescription: 'Share cap' }),
      makeTxn({ amount: '750.00',   transactionTypeKey: 'money_paid_to_user',      userPaymentReason: 'expense_payment',         transactionDate: new Date('2025-11-01T00:00:00Z'), explainedDescription: 'Expense reimb' }),
    ];

    const expenseRows = [
      makeExpense('400.00', new Date('2025-06-15T00:00:00Z'), 'Conference'),
      makeExpense('300.00', new Date('2025-07-10T00:00:00Z'), 'Software'),
      makeExpense('200.00', new Date('2025-10-20T00:00:00Z'), 'Books'),
    ];

    mockTxnFindMany.mockResolvedValue([...beforeTxns, ...inWindowTxns]);
    mockExpenseFindMany.mockResolvedValue(expenseRows);

    const { req, res } = makeReqRes(OWNER_ID, { userId: TARGET_ID }, { taxYear: TAX_YEAR });
    await getMyMoney(req, res as import('express').Response);
    const { status, data } = (res as ReturnType<typeof makeReqRes>['res'])._get();
    expect(status).toBe(200);

    const d = (data as { data: Record<string, unknown> }).data;
    const salary    = d.salary     as { totalPaid: number };
    const dividends = d.dividends  as { totalPaid: number };
    const dl        = d.directorLoan as { entries: { in: number; out: number }[]; broughtForward: number; balance: number };
    const sc        = d.shareCapital as { totalIn: number };
    const eo        = d.expensesOwed as { owed: number; reimbursed: number; outstanding: number };

    // Check individual computed values
    expect(salary.totalPaid).toBeCloseTo(4600);
    expect(dividends.totalPaid).toBeCloseTo(15000);
    expect(sc.totalIn).toBeCloseTo(20000);
    expect(eo.reimbursed).toBeCloseTo(750);
    expect(eo.owed).toBeCloseTo(900);
    expect(dl.broughtForward).toBeCloseTo(12000);

    const dlInSum  = dl.entries.reduce((s, e) => s + e.in, 0);
    const dlOutSum = dl.entries.reduce((s, e) => s + e.out, 0);
    expect(dlInSum).toBeCloseTo(2000);
    expect(dlOutSum).toBeCloseTo(5000);

    // RECONCILIATION IDENTITY 1: money-out to user
    const bankMoneyOut = inWindowTxns
      .filter((t) => t.transactionTypeKey === 'money_paid_to_user')
      .reduce((s, t) => s + Number(t.amount), 0); // 4000+600+15000+5000+750 = 25350

    const myMoneyOutSum = salary.totalPaid + dividends.totalPaid + dlOutSum + eo.reimbursed;
    expect(bankMoneyOut).toBeCloseTo(25350);
    expect(myMoneyOutSum).toBeCloseTo(25350);
    expect(myMoneyOutSum).toBeCloseTo(bankMoneyOut);

    // RECONCILIATION IDENTITY 2: DL balance
    expect(dl.balance).toBeCloseTo(dl.broughtForward + dlInSum - dlOutSum); // 12000+2000-5000=9000
    expect(dl.balance).toBeCloseTo(9000);

    // RECONCILIATION IDENTITY 3: expenses outstanding
    expect(eo.outstanding).toBeCloseTo(eo.owed - eo.reimbursed); // 900-750=150
    expect(eo.outstanding).toBeCloseTo(150);
  });
});
