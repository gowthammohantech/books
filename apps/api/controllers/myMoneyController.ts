/**
 * controllers/myMoneyController.ts
 *
 * GET /admin/my-money/:tenantId?taxYear=2026/27
 *
 * Per-user "My Money" consolidation — aggregates, per UK tax year, what the
 * company has PAID to / RECEIVED from a person via posted bank user-payments.
 *
 * Read-only: no ledger writes. Derives from BankTransaction data so the totals
 * reconcile to banking by construction.
 */

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireTenantId, UnauthorizedError } from '../lib/tenantScope';
import { currentTaxYear, taxYearByLabel } from '../lib/payroll/taxYear';
import { buildSalaryOwed } from '../lib/payroll/salaryOwed';
import { tenantMemberWhere } from '../lib/tenantMembers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNum(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** A bank txn is "posted" when explainStatus is EXPLAINED and either
 *  isReconciled=true OR postedSourceId is non-null (JE was written). */
function isPosted(txn: RawTxn): boolean {
  return (
    txn.explainStatus === 'EXPLAINED' &&
    (txn.isReconciled === true || txn.postedSourceId != null)
  );
}

interface RawTxn {
  id: string;
  transactionDate: Date;
  type: string;
  amount: Prisma.Decimal;
  explainStatus: string;
  isReconciled: boolean;
  postedSourceType: string | null;
  postedSourceId: string | null;
  transactionTypeKey: string | null;
  userPaymentReason: string | null;
  explainedDescription: string | null;
  remarks: string | null;
}

// ---------------------------------------------------------------------------
// Bucket classification
// ---------------------------------------------------------------------------

type Bucket = 'salary' | 'dividend' | 'director_loan_in' | 'director_loan_out' | 'share_capital' | 'expense_payment' | 'payroll_settlement' | null;

/**
 * Maps a txn's (transactionTypeKey, userPaymentReason) to a bucket.
 * Supports both new collapsed types and legacy hidden types.
 */
function classifyTxn(txn: RawTxn): Bucket {
  const key = txn.transactionTypeKey ?? '';
  const reason = txn.userPaymentReason ?? '';

  // New collapsed type: money_paid_to_user
  if (key === 'money_paid_to_user') {
    if (reason === 'net_salary' || reason === 'benefit_in_kind') return 'salary';
    if (reason === 'dividend') return 'dividend';
    if (reason === 'director_loan_repayment') return 'director_loan_out';
    if (reason === 'expense_payment') return 'expense_payment';
    if (reason === 'payroll_settlement') return 'payroll_settlement';
    return null;
  }

  // New collapsed type: money_received_from_user
  if (key === 'money_received_from_user') {
    if (reason === 'director_loan') return 'director_loan_in';
    if (reason === 'unpaid_shares' || reason === 'share_capital_introduced') return 'share_capital';
    return null;
  }

  // Legacy MONEY_OUT_USER types
  if (key === 'net_salary' || key === 'benefit_in_kind') return 'salary';
  if (key === 'dividend') return 'dividend';
  if (key === 'owner_loan_out') return 'director_loan_out';
  if (key === 'expense_payment') return 'expense_payment';
  if (key === 'payroll_settlement') return 'payroll_settlement';

  // Legacy MONEY_IN_USER types
  if (key === 'owner_loan_in') return 'director_loan_in';
  if (key === 'unpaid_shares' || key === 'share_capital') return 'share_capital';

  return null;
}

// ---------------------------------------------------------------------------
// expensesOwed (M3 reimbursable expenses)
// ---------------------------------------------------------------------------

export interface OwedExpenseRow { date: Date; description: string; amount: number }
export interface OwedSettlementRow { date: Date; description: string; amount: number }
export interface ExpensesOwedResult {
  entries: { date: Date; description: string; owed: number; reimbursed: number }[];
  owed: number;
  reimbursed: number;
  outstanding: number;
}

/** Build the per-user reimbursable owed/reimbursed/outstanding summary from
 *  in-window reimbursable expenses (credits to 9250) and in-window
 *  expense_payment bank settlements (debits to 9250). Pure — no I/O. */
export function buildExpensesOwed(
  reimbursableExpenses: OwedExpenseRow[],
  settlements: OwedSettlementRow[],
): ExpensesOwedResult {
  const entries = [
    ...reimbursableExpenses.map((e) => ({ date: e.date, description: e.description, owed: e.amount, reimbursed: 0 })),
    ...settlements.map((s) => ({ date: s.date, description: s.description, owed: 0, reimbursed: s.amount })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  const owed = reimbursableExpenses.reduce((s, e) => s + e.amount, 0);
  const reimbursed = settlements.reduce((s, e) => s + e.amount, 0);
  return { entries, owed, reimbursed, outstanding: owed - reimbursed };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export async function getMyMoney(req: Request, res: Response): Promise<void> {
  try {
    const tenantUserId = requireTenantId(req);
    const targetUserId = req.params.tenantId as string;
    const taxYearParam = req.query.taxYear as string | undefined;

    // Resolve tax year
    const now = new Date();
    const taxYear = taxYearParam ? taxYearByLabel(taxYearParam) : currentTaxYear(now);

    // Verify targetUserId belongs to this workspace, by membership.
    const targetUser = await prisma.user.findFirst({
      where: {
        ...tenantMemberWhere(tenantUserId),
        id: targetUserId,
        isDeleted: false,
      },
      select: { id: true, firstName: true, lastName: true },
    });

    if (!targetUser) {
      res.status(404).json({ success: false, message: 'User not found in your workspace' });
      return;
    }

    const userName = [targetUser.firstName, targetUser.lastName].filter(Boolean).join(' ');

    // Fetch ALL posted user-payment txns for this user (all time), scoped to
    // bank accounts owned by the tenant. We need all-time to compute
    // director-loan broughtForward.
    //
    // Tenant scoping: bank accounts belong to users in this tenant.
    // We join via bankAccount.tenantId (the account owner).
    // Note: `userPaymentReason` was added to the schema after the last `prisma generate`
    // in this local environment. The field exists in the DB and at runtime; we use a
    // cast through `unknown` so the local stale types don't block compilation.
    const allTxnsRaw = await (prisma.bankTransaction.findMany as (args: unknown) => Promise<unknown[]>)({
      where: {
        isDeleted: false,
        payToUserId: targetUserId,
        // Scope to the workspace. `BankDetail.tenantId` IS the workspace, so
        // this is the whole answer; the second branch this used to carry
        // (`user: { ownerId }`) named a relation P3 renamed away, which made
        // the entire query throw at runtime.
        bankAccount: {
          isDeleted: false,
          tenantId: tenantUserId,
        },
        // Only explained txns (posted ones filtered in JS below — isPosted check)
        explainStatus: 'EXPLAINED',
      },
      select: {
        id: true,
        transactionDate: true,
        type: true,
        amount: true,
        explainStatus: true,
        isReconciled: true,
        postedSourceType: true,
        postedSourceId: true,
        transactionTypeKey: true,
        userPaymentReason: true,
        explainedDescription: true,
        remarks: true,
      },
      orderBy: { transactionDate: 'asc' },
    });

    const allTxns = allTxnsRaw as RawTxn[];

    // Filter to only posted txns
    const postedTxns = allTxns.filter((t) => isPosted(t));

    // Split into before-window (for broughtForward) and in-window
    const beforeWindow: RawTxn[] = [];
    const inWindow: RawTxn[] = [];

    for (const txn of postedTxns) {
      if (txn.transactionDate < taxYear.start) {
        beforeWindow.push(txn);
      } else if (txn.transactionDate <= taxYear.end) {
        inWindow.push(txn);
      }
      // after window → ignored
    }

    // ---------------------------------------------------------------------------
    // Build buckets for in-window txns
    // ---------------------------------------------------------------------------

    const salaryEntries: { date: Date; description: string; paid: number }[] = [];
    const dividendEntries: { date: Date; description: string; paid: number }[] = [];
    const dlEntries: { date: Date; description: string; in: number; out: number }[] = [];
    const scEntries: { date: Date; description: string; in: number }[] = [];

    for (const txn of inWindow) {
      const bucket = classifyTxn(txn);
      if (bucket === null) continue;
      const amount = toNum(txn.amount);
      const desc = txn.explainedDescription ?? txn.remarks ?? '';

      if (bucket === 'salary') {
        salaryEntries.push({ date: txn.transactionDate, description: desc, paid: amount });
      } else if (bucket === 'dividend') {
        dividendEntries.push({ date: txn.transactionDate, description: desc, paid: amount });
      } else if (bucket === 'director_loan_in') {
        dlEntries.push({ date: txn.transactionDate, description: desc, in: amount, out: 0 });
      } else if (bucket === 'director_loan_out') {
        dlEntries.push({ date: txn.transactionDate, description: desc, in: 0, out: amount });
      } else if (bucket === 'share_capital') {
        scEntries.push({ date: txn.transactionDate, description: desc, in: amount });
      }
    }

    // ---------------------------------------------------------------------------
    // expensesOwed: settlements (expense_payment bank txns) + reimbursable expenses
    // ---------------------------------------------------------------------------

    const settlementRows: OwedSettlementRow[] = [];
    for (const txn of inWindow) {
      if (classifyTxn(txn) === 'expense_payment') {
        settlementRows.push({
          date: txn.transactionDate,
          description: txn.explainedDescription ?? txn.remarks ?? 'Reimbursement',
          amount: toNum(txn.amount),
        });
      }
    }

    const reimbursableExpensesRaw = await (prisma.expense.findMany as (args: unknown) => Promise<unknown[]>)({
      where: {
        isDeleted: false,
        sourceType: 'EMPLOYEE_PAID',
        paidByUserId: targetUserId,
        expenseDate: { gte: taxYear.start, lte: taxYear.end },
        // Same dead `user` relation as above — `Expense.tenantId` is the scope.
        tenantId: tenantUserId,
      },
      select: { expenseDate: true, amount: true, description: true, referenceNo: true },
    });
    const reimbursableRows = (reimbursableExpensesRaw as { expenseDate: Date | null; amount: Prisma.Decimal; description: string | null; referenceNo: string | null }[]).map((e) => ({
      date: e.expenseDate ?? taxYear.start,
      description: e.description || e.referenceNo || 'Reimbursable expense',
      amount: toNum(e.amount),
    }));

    const expensesOwedResult = buildExpensesOwed(reimbursableRows, settlementRows);

    // ---------------------------------------------------------------------------
    // salaryOwed: payroll_settlement bank txns + finalized PayRunLine nets
    // ---------------------------------------------------------------------------

    const salarySettlementRows: { date: Date; description: string; amount: number }[] = [];
    for (const txn of inWindow) {
      if (classifyTxn(txn) === 'payroll_settlement') {
        salarySettlementRows.push({
          date: txn.transactionDate,
          description: txn.explainedDescription ?? txn.remarks ?? 'Salary payment',
          amount: toNum(txn.amount),
        });
      }
    }

    const runLineRowsRaw = await ((prisma as unknown as { payRunLine: { findMany: (args: unknown) => Promise<unknown[]> } }).payRunLine.findMany)({
      where: {
        employeeUserId: targetUserId,
        payRun: { is: { tenantId: tenantUserId, status: 'FINALIZED', isDeleted: false } },
      },
      select: {
        net: true,
        payRun: { select: { periodEnd: true, taxMonth: true, taxYearLabel: true } },
      },
    });
    const runLineRows = (runLineRowsRaw as { net: Prisma.Decimal; payRun: { periodEnd: Date; taxMonth: number; taxYearLabel: string } }[])
      .filter((l) => l.payRun.periodEnd >= taxYear.start && l.payRun.periodEnd <= taxYear.end)
      .map((l) => ({
        date: l.payRun.periodEnd,
        description: `Pay run — month ${l.payRun.taxMonth} ${l.payRun.taxYearLabel}`,
        amount: toNum(l.net),
      }));

    const salaryOwedResult = buildSalaryOwed(runLineRows, salarySettlementRows);

    // ---------------------------------------------------------------------------
    // Director-loan: broughtForward from txns BEFORE this tax year
    // ---------------------------------------------------------------------------

    let dlBroughtForward = 0;
    for (const txn of beforeWindow) {
      const bucket = classifyTxn(txn);
      if (bucket === 'director_loan_in') dlBroughtForward += toNum(txn.amount);
      else if (bucket === 'director_loan_out') dlBroughtForward -= toNum(txn.amount);
    }

    const dlTotalIn = dlEntries.reduce((s, e) => s + e.in, 0);
    const dlTotalOut = dlEntries.reduce((s, e) => s + e.out, 0);
    const dlBalance = dlBroughtForward + dlTotalIn - dlTotalOut;

    // ---------------------------------------------------------------------------
    // Response
    // ---------------------------------------------------------------------------

    res.status(200).json({
      success: true,
      data: {
        user: { id: targetUser.id, name: userName },
        taxYear: {
          label: taxYear.label,
          start: taxYear.start,
          end: taxYear.end,
        },
        salary: {
          entries: salaryEntries,
          directPaid: salaryEntries.reduce((s, e) => s + e.paid, 0),
          owed: salaryOwedResult.owed,
          paid: salaryOwedResult.paid,
          outstanding: salaryOwedResult.outstanding,
          totalPaid: salaryOwedResult.paid + salaryEntries.reduce((s, e) => s + e.paid, 0),
          runEntries: salaryOwedResult.entries,
        },
        dividends: {
          entries: dividendEntries,
          totalPaid: dividendEntries.reduce((s, e) => s + e.paid, 0),
        },
        directorLoan: {
          entries: dlEntries,
          broughtForward: dlBroughtForward,
          balance: dlBalance,
        },
        shareCapital: {
          entries: scEntries,
          totalIn: scEntries.reduce((s, e) => s + e.in, 0),
        },
        expensesOwed: {
          entries: expensesOwedResult.entries,
          owed: expensesOwedResult.owed,
          reimbursed: expensesOwedResult.reimbursed,
          outstanding: expensesOwedResult.outstanding,
        },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(err.status).json({ success: false, message: err.message });
      return;
    }
    if (err instanceof Error && err.message.startsWith('Invalid tax year')) {
      res.status(400).json({ success: false, message: err.message });
      return;
    }
    console.error('[myMoney] error', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getMyMoney };
module.exports.getMyMoney = getMyMoney;
