import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { getRevenueSummary, getExpenseSummary } from '../lib/financialQueries';
import { profitLossFrom, balanceSheetFrom, trialBalanceFrom, type AccountBalance } from '../lib/ledger/statements';
import { cashBasisProfitLoss } from '../lib/ledger/cashBasis';

async function gatherCashMovements(userId: string, from: Date, to: Date) {
  // Receipts: customer payments in period, allocated by their invoice's tax ratio.
  // InvoicePayment fields used: amount (Decimal), received_on (DateTime),
  //   invoice relation → taxableAmount, vat, TotalAmount.
  const invPayments = await prisma.invoicePayment.findMany({
    where: { invoice: { userId, isDeleted: false }, received_on: { gte: from, lte: to }, isVoided: false },
    select: { amount: true, invoice: { select: { taxableAmount: true, vat: true, TotalAmount: true } } },
  });
  const receipts = invPayments.map((p) => ({
    amount: String(p.amount ?? 0),
    doc: {
      net: String(p.invoice.taxableAmount ?? 0),
      tax: String(p.invoice.vat ?? 0),
      total: String(p.invoice.TotalAmount ?? 0),
    },
  }));

  // Cash-out: supplier payments (allocated by purchase tax ratio).
  // SupplierPayment fields used: paidAmount (Float), paymentDate (DateTime — dedicated
  //   payment-date field, preferred over createdAt), purchase relation →
  //   taxableAmount, totalTax, totalAmount.
  // Note: SupplierPayment has no direct userId; scoped via purchase.userId.
  const supPayments = await prisma.supplierPayment.findMany({
    where: { isDeleted: false, isVoided: false, purchase: { userId, isDeleted: false }, paymentDate: { gte: from, lte: to } },
    select: { paidAmount: true, purchase: { select: { taxableAmount: true, totalTax: true, totalAmount: true } } },
  });
  const supOut = supPayments.map((p) => ({
    amount: String(p.paidAmount ?? 0),
    doc: p.purchase
      ? {
          net: String(p.purchase.taxableAmount ?? 0),
          tax: String(p.purchase.totalTax ?? 0),
          total: String(p.purchase.totalAmount ?? 0),
        }
      : { net: String(p.paidAmount ?? 0), tax: '0', total: String(p.paidAmount ?? 0) },
  }));

  // Cash-out: expenses (no embedded tax ratio — all net).
  // Expense fields used: amount (Decimal), expenseDate (DateTime), paymentStatus enum PAID.
  const paidExpenses = await prisma.expense.findMany({
    where: { userId, isDeleted: false, paymentStatus: 'PAID', expenseDate: { gte: from, lte: to } },
    select: { amount: true },
  });
  const expOut = paidExpenses.map((e) => ({
    amount: String(e.amount ?? 0),
    doc: { net: String(e.amount ?? 0), tax: '0', total: String(e.amount ?? 0) },
  }));

  return { receipts, cashOut: [...supOut, ...expOut] };
}

function defaultDateRange(req: Request): { fromDate: Date; toDate: Date } {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const toDate = to ? new Date(to) : new Date();
  // Default range: current calendar year (Jan 1 to today). Fiscal year handling can be added later.
  const fromDate = from ? new Date(from) : new Date(toDate.getFullYear(), 0, 1);
  toDate.setHours(23, 59, 59, 999);
  fromDate.setHours(0, 0, 0, 0);
  return { fromDate, toDate };
}

async function loadAccountBalances(userId: string, opts: { from?: Date; to: Date }): Promise<AccountBalance[]> {
  const accounts = await prisma.account.findMany({
    where: { userId, isDeleted: false },
    include: {
      journalLines: {
        where: { journalEntry: { userId, isDeleted: false, entryDate: opts.from ? { gte: opts.from, lte: opts.to } : { lte: opts.to } } },
        // Statements are in the tenant's functional currency, so aggregate the
        // BASE amounts (debit/credit are transaction-currency; equal to base at
        // rate 1, but differ for foreign-currency entries — Spec G).
        select: { baseDebit: true, baseCredit: true },
      },
      roleMappings: { select: { roleKey: true } },
    },
    orderBy: { code: 'asc' },
  });
  return accounts.map((a) => {
    const debit = a.journalLines.reduce((s, l) => s.plus(l.baseDebit), new Prisma.Decimal(0));
    const credit = a.journalLines.reduce((s, l) => s.plus(l.baseCredit), new Prisma.Decimal(0));
    return { id: a.id, code: a.code, name: a.name, accountType: a.accountType, parentId: a.parentId ?? null, debit: debit.toString(), credit: credit.toString(), role: a.roleMappings[0]?.roleKey ?? null };
  });
}

async function ledgerLive(userId: string): Promise<boolean> {
  const s = await prisma.companySettings.findFirst({ where: { userId }, select: { ledgerInitialized: true } });
  return !!s?.ledgerInitialized;
}

/**
 * GET /api/admin/reports/profit-loss?from=&to=
 */
export async function profitLoss(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { fromDate, toDate } = defaultDateRange(req);

    // Cash-basis mode: recognize revenue/expense when cash moves (§B.8)
    if ((req.query.basis as string) === 'cash') {
      const { receipts, cashOut } = await gatherCashMovements(userId, fromDate, toDate);
      const pl = cashBasisProfitLoss(receipts, cashOut);
      res.json({ success: true, data: { period: { from: fromDate, to: toDate }, ...pl } });
      return;
    }

    // GL-derived mode: when ledger is initialized, aggregate from journal lines
    if (await ledgerLive(userId)) {
      const balances = await loadAccountBalances(userId, { from: fromDate, to: toDate });
      const pl = profitLossFrom(balances);
      res.json({
        success: true,
        data: {
          period: { from: fromDate, to: toDate },
          ...pl,
          manualEntries: { income: 0, expense: 0, incomeByAccount: [], expenseByAccount: [] },
        },
      });
      return;
    }

    // Legacy subledger fallback (pre-ledger installs)
    // Revenue (taxable) + output tax: shared with the AI co-pilot's
    // get_revenue_summary tool via lib/financialQueries.
    const revenue = await getRevenueSummary(userId, fromDate, toDate);

    // Sales credit notes (returns) in the period reduce revenue and output tax.
    // Exclude cancelled CNs (already reversed). Mirrors getGstSummary's CDNR
    // netting and the GL P&L, where SALES_RETURNS is an INCOME contra that nets
    // revenue down — without this the legacy P&L over-states revenue by the CN.
    const salesCreditNotes = await prisma.creditNote.findMany({
      where: {
        userId,
        isDeleted: false,
        status: { not: 'CANCELLED' },
        creditNoteDate: { gte: fromDate, lte: toDate },
      },
      select: { taxableAmount: true, vat: true },
    });
    const creditNoteNet = salesCreditNotes.reduce((s, c) => s + Number(c.taxableAmount ?? 0), 0);
    const creditNoteTax = salesCreditNotes.reduce((s, c) => s + Number(c.vat ?? 0), 0);

    const salesRevenue = revenue.taxableRevenue - creditNoteNet;
    const outputTaxTotal = revenue.outputTax - creditNoteTax;

    // Cost of Goods Sold: sum Purchase taxableAmount in period
    const purchases = await prisma.purchase.findMany({
      where: {
        userId,
        isDeleted: false,
        purchaseDate: { gte: fromDate, lte: toDate },
      },
      select: { taxableAmount: true, totalTax: true },
    });
    const cogsTotal = purchases.reduce((s, p) => s + Number(p.taxableAmount ?? 0), 0);
    const inputTaxTotal = purchases.reduce((s, p) => s + Number(p.totalTax ?? 0), 0);

    // Operating Expenses by category: shared with the AI co-pilot's
    // get_expense_summary tool via lib/financialQueries.
    const expenseSummary = await getExpenseSummary(userId, fromDate, toDate);
    const opexTotal = expenseSummary.total;
    const operatingExpensesBy = expenseSummary.byCategory.map((c) => ({
      categoryId: c.categoryId,
      name: c.name,
      total: c.total,
    }));

    // Manual journal entries within the period — group by account
    const manualLines = await prisma.journalLine.findMany({
      where: {
        journalEntry: {
          userId,
          isDeleted: false,
          entryDate: { gte: fromDate, lte: toDate },
        },
      },
      include: { account: { select: { id: true, name: true, accountType: true } } },
    });
    let manualIncome = 0;
    let manualExpense = 0;
    const manualIncomeBy = new Map<string, { name: string; total: number }>();
    const manualExpenseBy = new Map<string, { name: string; total: number }>();
    for (const ln of manualLines) {
      const credit = Number(ln.credit ?? 0);
      const debit = Number(ln.debit ?? 0);
      if (ln.account.accountType === 'INCOME') {
        const net = credit - debit; // income normally credit-balance
        manualIncome += net;
        const cur = manualIncomeBy.get(ln.account.id);
        if (cur) cur.total += net;
        else manualIncomeBy.set(ln.account.id, { name: ln.account.name, total: net });
      } else if (ln.account.accountType === 'EXPENSE') {
        const net = debit - credit; // expense normally debit-balance
        manualExpense += net;
        const cur = manualExpenseBy.get(ln.account.id);
        if (cur) cur.total += net;
        else manualExpenseBy.set(ln.account.id, { name: ln.account.name, total: net });
      }
    }

    // Operating subtotals are OPERATING-ONLY so operating margin is not distorted
    // by non-operating manual entries. Previously manual income was folded INTO
    // revenue (above gross profit) while manual expense stayed below the line —
    // asymmetric, inflating grossProfit/operatingIncome. Now BOTH manual income
    // and manual expense sit BELOW operating income (the `manualEntries` grouping,
    // i.e. "Other income" / "Other expense"):
    //   revenueTotal = salesRevenue only  → revenue.total == Σ(byCategory) still
    //   netIncome    = operatingIncome + manualIncome − manualExpense
    const revenueTotal = salesRevenue;
    const grossProfit = revenueTotal - cogsTotal;
    const operatingIncome = grossProfit - opexTotal;
    const netIncome = operatingIncome + manualIncome - manualExpense;

    res.json({
      success: true,
      data: {
        period: { from: fromDate, to: toDate },
        revenue: {
          total: revenueTotal,
          byCategory: [
            // Operating revenue only. Manual/other income is reported below the
            // line under `manualEntries` so revenue.total == Σ(byCategory).
            { name: 'Sales Revenue', total: salesRevenue },
          ],
        },
        costOfGoodsSold: { total: cogsTotal },
        grossProfit,
        operatingExpenses: { total: opexTotal, byCategory: operatingExpensesBy },
        operatingIncome,
        manualEntries: {
          income: manualIncome,
          expense: manualExpense,
          incomeByAccount: Array.from(manualIncomeBy.values()),
          expenseByAccount: Array.from(manualExpenseBy.values()),
        },
        netIncome,
        taxes: {
          outputTax: outputTaxTotal,
          inputTax: inputTaxTotal,
          netTax: outputTaxTotal - inputTaxTotal,
        },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('profitLoss error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute P&L' });
  }
}

/**
 * GET /api/admin/reports/balance-sheet?asOf=
 */
export async function balanceSheet(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const asOfStr = req.query.asOf as string | undefined;
    const asOf = asOfStr ? new Date(asOfStr) : new Date();
    asOf.setHours(23, 59, 59, 999);

    // GL-derived mode: when ledger is initialized, aggregate from journal lines
    if (await ledgerLive(userId)) {
      const balances = await loadAccountBalances(userId, { to: asOf });
      const bs = balanceSheetFrom(balances);
      const banks = await prisma.bankDetail.findMany({ where: { userId, isDeleted: false }, select: { id: true, bankName: true, currentBalance: true } });
      res.json({
        success: true,
        data: {
          asOf,
          ...bs,
          bankBreakdown: banks.map((b) => ({ id: b.id, name: b.bankName, balance: Number(b.currentBalance ?? 0) })),
        },
      });
      return;
    }

    // Legacy subledger fallback (pre-ledger installs)
    // ASSETS
    // Cash + Bank: sum of BankDetail.currentBalance for user's bank accounts
    const banks = await prisma.bankDetail.findMany({
      where: { userId, isDeleted: false },
      select: { id: true, bankName: true, currentBalance: true },
    });
    const cashAndBank = banks.reduce((s, b) => s + Number(b.currentBalance ?? 0), 0);

    // Receivables: unpaid invoice balances (Total - paid via InvoicePayment up to asOf)
    const unpaidInvoices = await prisma.invoice.findMany({
      where: {
        userId,
        isDeleted: false,
        invoiceType: 'INVOICE',
        invoiceDate: { lte: asOf },
        status: { in: ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE', 'SENT'] },
      },
      select: {
        TotalAmount: true,
        payments: { where: { isVoided: false }, select: { amount: true, received_on: true } },
      },
    });
    const receivables = unpaidInvoices.reduce((s, inv) => {
      const total = Number(inv.TotalAmount ?? 0);
      const paid = inv.payments
        .filter((p) => p.received_on <= asOf)
        .reduce((sp, p) => sp + Number(p.amount ?? 0), 0);
      return s + Math.max(0, total - paid);
    }, 0);

    // Inventory: sum of (inventory.quantity * product.purchase_price) — best effort.
    // Inventory has its own userId; Product does not (Product is a global catalogue entry).
    const inventoryRows = await prisma.inventory.findMany({
      where: { userId, isDeleted: false },
      select: {
        quantity: true,
        product: { select: { purchase_price: true } },
      },
    });
    const inventory = inventoryRows.reduce(
      (s, i) => s + Number(i.quantity ?? 0) * Number(i.product?.purchase_price ?? 0),
      0,
    );

    // LIABILITIES
    // Payables: unpaid purchase balances
    const unpaidPurchases = await prisma.purchase.findMany({
      where: {
        userId,
        isDeleted: false,
        purchaseDate: { lte: asOf },
        status: { in: ['new', 'pending', 'partially_paid'] },
      },
      select: { totalAmount: true, paidAmount: true, balanceAmount: true },
    });
    const payables = unpaidPurchases.reduce((s, p) => s + Number(p.balanceAmount ?? 0), 0);

    // Tax liability: net of collected output tax minus inward input tax (invoices/purchases up to asOf)
    const allInvoices = await prisma.invoice.findMany({
      where: { userId, isDeleted: false, invoiceDate: { lte: asOf } },
      select: { vat: true },
    });
    const allPurchases = await prisma.purchase.findMany({
      where: { userId, isDeleted: false, purchaseDate: { lte: asOf } },
      select: { totalTax: true },
    });
    const outputTax = allInvoices.reduce((s, i) => s + Number(i.vat ?? 0), 0);
    const inputTax = allPurchases.reduce((s, p) => s + Number(p.totalTax ?? 0), 0);
    const taxLiability = Math.max(0, outputTax - inputTax);

    // EQUITY: assets - liabilities (plug to balance for v1)
    const totalAssets = cashAndBank + receivables + inventory;
    const totalLiabilities = payables + taxLiability;
    const equity = totalAssets - totalLiabilities;

    res.json({
      success: true,
      data: {
        asOf,
        assets: {
          current: {
            cashAndBank,
            receivables,
            inventory,
          },
          fixed: { total: 0 },
          total: totalAssets,
        },
        liabilities: {
          current: { payables, taxLiability },
          longTerm: { total: 0 },
          total: totalLiabilities,
        },
        equity: {
          ownerEquity: 0,
          retainedEarnings: equity,
          total: equity,
        },
        totalLiabilitiesAndEquity: totalLiabilities + equity,
        bankBreakdown: banks.map((b) => ({
          id: b.id,
          name: b.bankName,
          balance: Number(b.currentBalance ?? 0),
        })),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('balanceSheet error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute balance sheet' });
  }
}

/**
 * GET /api/admin/reports/trial-balance?asOf=
 */
export async function trialBalance(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const asOfStr = req.query.asOf as string | undefined;
    const asOf = asOfStr ? new Date(asOfStr) : new Date();
    asOf.setHours(23, 59, 59, 999);

    // Decimal-safe aggregation shared with P&L/BS (loadAccountBalances sums via
    // Prisma.Decimal); trialBalanceFrom is the same logic the golden tests cover.
    const balances = await loadAccountBalances(userId, { to: asOf });
    const tb = trialBalanceFrom(balances);

    res.json({
      success: true,
      data: {
        asOf,
        accounts: tb.accounts,
        totals: tb.totals,
        balanced: tb.balanced,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('trialBalance error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute trial balance' });
  }
}

const handlers = { profitLoss, balanceSheet, trialBalance };
module.exports = handlers;
module.exports.default = handlers;
