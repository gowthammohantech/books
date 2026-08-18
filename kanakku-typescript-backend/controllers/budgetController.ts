// controllers/budgetController.ts
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { computeVariance } from '../lib/reports/budgetVariance';
import { forecastCashFlow } from '../lib/reports/cashFlowForecast';
import { sumBankCashWithChildren, type AccountBalance } from '../lib/ledger/statements';

// =============================================================================
// Helpers
// =============================================================================

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function parseDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// =============================================================================
// Budget CRUD
// =============================================================================

/**
 * GET /budgets
 * List all budgets for the authenticated tenant.
 */
export async function listBudgets(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const budgets = await prisma.budget.findMany({
      where: { userId },
      include: { account: { select: { id: true, code: true, name: true, accountType: true } } },
      orderBy: [{ periodStart: 'desc' }, { account: { code: 'asc' } }],
    });
    res.json({ success: true, data: budgets });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('listBudgets error:', err);
    res.status(500).json({ success: false, message: 'Failed to list budgets' });
  }
}

/**
 * POST /budgets
 * Body: { accountId, periodStart, periodEnd, amount }
 */
export async function createBudget(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { accountId, periodStart, periodEnd, amount } = req.body as {
      accountId?: string;
      periodStart?: string;
      periodEnd?: string;
      amount?: string | number;
    };

    if (!accountId || !periodStart || !periodEnd || amount == null) {
      res.status(400).json({ success: false, message: 'accountId, periodStart, periodEnd, and amount are required' });
      return;
    }

    const budget = await prisma.budget.create({
      data: {
        userId,
        accountId,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        amount: new Prisma.Decimal(String(amount)),
      },
      include: { account: { select: { id: true, code: true, name: true, accountType: true } } },
    });

    res.status(201).json({ success: true, data: budget });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('createBudget error:', err);
    res.status(500).json({ success: false, message: 'Failed to create budget' });
  }
}

/**
 * PUT /budgets/:id
 * Body: { accountId?, periodStart?, periodEnd?, amount? }
 */
export async function updateBudget(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = String(req.params.id);

    const existing = await prisma.budget.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Budget not found' });
      return;
    }

    const { accountId, periodStart, periodEnd, amount } = req.body as {
      accountId?: string;
      periodStart?: string;
      periodEnd?: string;
      amount?: string | number;
    };

    const budget = await prisma.budget.update({
      where: { id },
      data: {
        ...(accountId != null && { accountId }),
        ...(periodStart != null && { periodStart: new Date(periodStart) }),
        ...(periodEnd != null && { periodEnd: new Date(periodEnd) }),
        ...(amount != null && { amount: new Prisma.Decimal(String(amount)) }),
      },
      include: { account: { select: { id: true, code: true, name: true, accountType: true } } },
    });

    res.json({ success: true, data: budget });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('updateBudget error:', err);
    res.status(500).json({ success: false, message: 'Failed to update budget' });
  }
}

/**
 * DELETE /budgets/:id
 */
export async function deleteBudget(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = String(req.params.id);

    const existing = await prisma.budget.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Budget not found' });
      return;
    }

    await prisma.budget.delete({ where: { id } });
    res.json({ success: true, message: 'Budget deleted' });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('deleteBudget error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete budget' });
  }
}

// =============================================================================
// GET /reports/budget-variance?from=&to=
// =============================================================================

/**
 * Aggregate BASE journal-line amounts per account in the date range.
 * INCOME actual = Σ(baseCredit − baseDebit) per account
 * EXPENSE actual = Σ(baseDebit − baseCredit) per account
 */
async function loadActualsByAccount(
  userId: string,
  from: Date,
  to: Date,
): Promise<Map<string, { actual: Prisma.Decimal; accountName: string; accountType: string }>> {
  const accounts = await prisma.account.findMany({
    where: { userId, isDeleted: false, accountType: { in: ['INCOME', 'EXPENSE'] } },
    include: {
      journalLines: {
        where: {
          journalEntry: {
            userId,
            isDeleted: false,
            entryDate: { gte: from, lte: to },
          },
        },
        select: { baseDebit: true, baseCredit: true },
      },
    },
  });

  const map = new Map<string, { actual: Prisma.Decimal; accountName: string; accountType: string }>();
  for (const a of accounts) {
    const sumDebit = a.journalLines.reduce((s, l) => s.plus(l.baseDebit), new Prisma.Decimal(0));
    const sumCredit = a.journalLines.reduce((s, l) => s.plus(l.baseCredit), new Prisma.Decimal(0));
    // INCOME: actual = credit − debit (revenue is credit-normal)
    // EXPENSE: actual = debit − credit (expense is debit-normal)
    const actual =
      a.accountType === 'INCOME' ? sumCredit.minus(sumDebit) : sumDebit.minus(sumCredit);
    map.set(a.id, { actual, accountName: a.name, accountType: a.accountType });
  }
  return map;
}

export async function budgetVarianceReport(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const fromDate = parseDate(req.query.from);
    const toDateRaw = parseDate(req.query.to);
    const toDate = toDateRaw ?? new Date();
    toDate.setHours(23, 59, 59, 999);
    const fromDateFinal = fromDate ?? new Date(toDate.getFullYear(), 0, 1);
    fromDateFinal.setHours(0, 0, 0, 0);

    // Load budgets overlapping [from, to]
    const budgets = await prisma.budget.findMany({
      where: {
        userId,
        periodStart: { lte: toDate },
        periodEnd: { gte: fromDateFinal },
      },
      include: {
        account: { select: { id: true, name: true, accountType: true } },
      },
    });

    // Aggregate budgets by account (sum amounts for overlapping periods)
    const budgetByAccount = new Map<
      string,
      { budget: Prisma.Decimal; accountName: string; accountType: string }
    >();
    for (const b of budgets) {
      const existing = budgetByAccount.get(b.accountId);
      if (existing) {
        existing.budget = existing.budget.plus(b.amount);
      } else {
        budgetByAccount.set(b.accountId, {
          budget: new Prisma.Decimal(b.amount),
          accountName: b.account.name,
          accountType: b.account.accountType,
        });
      }
    }

    // Load actuals from GL base amounts
    const actuals = await loadActualsByAccount(userId, fromDateFinal, toDate);

    // Build combined set of all account IDs that have either a budget or an actual
    const allAccountIds = new Set([...budgetByAccount.keys(), ...actuals.keys()]);

    const rows = Array.from(allAccountIds).map((accountId) => {
      const budgetEntry = budgetByAccount.get(accountId);
      const actualEntry = actuals.get(accountId);
      const accountName = budgetEntry?.accountName ?? actualEntry?.accountName ?? '';
      const accountType = budgetEntry?.accountType ?? actualEntry?.accountType ?? '';
      return {
        accountId,
        accountName,
        accountType,
        budget: (budgetEntry?.budget ?? new Prisma.Decimal(0)).toFixed(4),
        actual: (actualEntry?.actual ?? new Prisma.Decimal(0)).toFixed(4),
      };
    });

    const result = computeVariance(rows);

    res.json({
      success: true,
      data: {
        period: { from: fromDateFinal, to: toDate },
        rows: result.rows,
        totals: result.totals,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('budgetVarianceReport error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute budget variance report' });
  }
}

// =============================================================================
// GET /reports/cash-flow-forecast?months=6
// =============================================================================

export async function cashFlowForecastReport(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const monthsParam = parseInt(String(req.query.months ?? '6'), 10);
    const months = Number.isFinite(monthsParam) && monthsParam > 0 ? monthsParam : 6;
    const fromMonthIndex = new Date();

    // Opening cash = combined BANK+CASH GL balance as-of today, INCLUDING per-bank
    // sub-accounts. Banking posts bank legs to child ASSET accounts nested under
    // the BANK control account; those children carry no role mapping, so filtering
    // by roleMappings alone (as this did before) misses every real bank balance.
    // sumBankCashWithChildren rolls the role-mapped roots plus their descendants,
    // matching the balance sheet's cashAndBank exactly.
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const accounts = await prisma.account.findMany({
      where: { userId, isDeleted: false },
      include: {
        journalLines: {
          where: { journalEntry: { userId, isDeleted: false, entryDate: { lte: today } } },
          select: { baseDebit: true, baseCredit: true },
        },
        roleMappings: { select: { roleKey: true } },
      },
    });

    const balances: AccountBalance[] = accounts.map((a) => {
      const debit = a.journalLines.reduce((s, l) => s.plus(l.baseDebit), new Prisma.Decimal(0));
      const credit = a.journalLines.reduce((s, l) => s.plus(l.baseCredit), new Prisma.Decimal(0));
      return {
        id: a.id,
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        parentId: a.parentId ?? null,
        debit: debit.toString(),
        credit: credit.toString(),
        role: a.roleMappings[0]?.roleKey ?? null,
      };
    });
    const openingCash = new Prisma.Decimal(sumBankCashWithChildren(balances)).toFixed(4);

    // Inflows: open invoices' outstanding (TotalAmount − Σ payments) by dueDate ?? invoiceDate
    const openInvoices = await prisma.invoice.findMany({
      where: {
        userId,
        isDeleted: false,
        invoiceType: 'INVOICE',
        status: { in: ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE', 'SENT'] },
      },
      select: {
        id: true,
        invoiceDate: true,
        dueDate: true,
        TotalAmount: true,
        payments: { where: { isVoided: false }, select: { amount: true } },
      },
    });

    const inflows = openInvoices
      .map((inv) => {
        const totalPaid = inv.payments.reduce(
          (acc, p) => acc.add(new Prisma.Decimal(p.amount.toString())),
          new Prisma.Decimal(0),
        );
        const outstanding = new Prisma.Decimal(inv.TotalAmount.toString()).sub(totalPaid);
        if (outstanding.lte(0)) return null;
        return {
          date: inv.dueDate ?? inv.invoiceDate,
          amount: outstanding.toString(),
        };
      })
      .filter((x): x is { date: Date; amount: string } => x !== null);

    // Outflows: open purchases' balanceAmount by dueDate
    const openPurchases = await prisma.purchase.findMany({
      where: {
        userId,
        isDeleted: false,
        balanceAmount: { gt: 0 },
      },
      select: {
        id: true,
        dueDate: true,
        balanceAmount: true,
      },
    });

    const outflows = openPurchases.map((p) => ({
      date: p.dueDate,
      amount: p.balanceAmount.toString(),
    }));

    const result = forecastCashFlow({
      openingCash,
      inflows,
      outflows,
      months,
      fromMonthIndex,
    });

    res.json({
      success: true,
      data: {
        openingCash,
        months,
        buckets: result.buckets.map((b) => ({
          monthStart: b.monthStart.toISOString(),
          inflow: b.inflow,
          outflow: b.outflow,
          net: b.net,
          runningCash: b.runningCash,
        })),
        droppedBeyondHorizon: result.droppedBeyondHorizon,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('cashFlowForecastReport error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute cash-flow forecast' });
  }
}
