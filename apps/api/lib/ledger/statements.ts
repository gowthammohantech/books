// lib/ledger/statements.ts
import { toDecimal } from './money';

export interface AccountBalance {
  id: string; code: string; name: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  debit: string; credit: string;
  role?: string | null;
  /** parentId is optional — populated by A2-aware loaders so balanceSheetFrom
   *  can include per-bank/cash sub-accounts (children of BANK/CASH control
   *  accounts that carry no role mapping of their own). */
  parentId?: string | null;
}

const n = (v: string): number => Number(toDecimal(v).toFixed(4));
const debitNet = (a: AccountBalance): number => n(a.debit) - n(a.credit);   // asset/expense normal
const creditNet = (a: AccountBalance): number => n(a.credit) - n(a.debit);  // liability/equity/income normal

export function trialBalanceFrom(accounts: AccountBalance[]) {
  const rows = accounts.map((a) => ({
    id: a.id, code: a.code, name: a.name, accountType: a.accountType,
    totalDebit: n(a.debit), totalCredit: n(a.credit), net: n(a.debit) - n(a.credit),
  })).sort((x, y) => x.code.localeCompare(y.code));
  const totalDebit = rows.reduce((s, r) => s + r.totalDebit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.totalCredit, 0);
  return { accounts: rows, totals: { debit: totalDebit, credit: totalCredit }, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
}

function byRole(accounts: AccountBalance[], role: string): AccountBalance[] {
  return accounts.filter((a) => a.role === role);
}
function sumDebitNet(accounts: AccountBalance[]): number { return accounts.reduce((s, a) => s + debitNet(a), 0); }
function sumCreditNet(accounts: AccountBalance[]): number { return accounts.reduce((s, a) => s + creditNet(a), 0); }

/**
 * Combined GL bank+cash balance INCLUDING per-bank sub-accounts (A2 rollup).
 *
 * Banking A2 posts bank legs to BankDetail.accountId — child ASSET accounts
 * nested under the BANK control account. Those children carry no role mapping,
 * so a plain sumDebitNet(byRole('BANK') | byRole('CASH')) misses them.
 *
 * Strategy: collect the BANK/CASH role accounts as "roots"; then include every
 * account whose parent chain leads to one of those roots. Each account's own
 * debit-net is summed exactly once — no double-count because the root account
 * itself holds any balance NOT already held by a child line.
 *
 * When parentId is absent (old-style loaders without A2 awareness) the set of
 * in-scope accounts degrades gracefully to just the role-mapped roots, which is
 * the previous behaviour.
 */
export function sumBankCashWithChildren(accounts: AccountBalance[]): number {
  const roots = new Set(
    accounts.filter((a) => a.role === 'BANK' || a.role === 'CASH').map((a) => a.id),
  );
  if (roots.size === 0) return 0;
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const inScope = (a: AccountBalance): boolean => {
    if (roots.has(a.id)) return true;
    let cur: AccountBalance | undefined = a.parentId ? byId.get(a.parentId) : undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      if (roots.has(cur.id)) return true;
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  };

  return accounts.filter(inScope).reduce((s, a) => s + debitNet(a), 0);
}

export function profitLossFrom(accounts: AccountBalance[]) {
  const income = accounts.filter((a) => a.accountType === 'INCOME');
  const expenses = accounts.filter((a) => a.accountType === 'EXPENSE');
  const cogsAccts = expenses.filter((a) => a.role === 'COGS');
  // operating expenses = all EXPENSE accounts except COGS
  // (includes PURCHASES, ROUNDING, FX_GAIN_LOSS, INPUT_TAX-as-expense, and anything else EXPENSE-typed)
  const opex = expenses.filter((a) => a.role !== 'COGS');
  // revenue = net of all INCOME accounts (SALES_RETURNS is INCOME-typed contra, nets down)
  const revenueTotal = sumCreditNet(income);
  const cogsTotal = sumDebitNet(cogsAccts);
  const opexTotal = sumDebitNet(opex);
  const grossProfit = revenueTotal - cogsTotal;
  const operatingIncome = grossProfit - opexTotal;
  const outputTax = sumCreditNet(byRole(accounts, 'OUTPUT_TAX'));
  const inputTax = sumDebitNet(byRole(accounts, 'INPUT_TAX'));
  return {
    revenue: { total: revenueTotal, byCategory: income.map((a) => ({ name: a.name, total: creditNet(a) })) },
    costOfGoodsSold: { total: cogsTotal },
    grossProfit,
    operatingExpenses: { total: opexTotal, byCategory: opex.map((a) => ({ name: a.name, total: debitNet(a) })) },
    operatingIncome,
    netIncome: operatingIncome,
    taxes: { outputTax, inputTax, netTax: outputTax - inputTax },
  };
}

export function balanceSheetFrom(accounts: AccountBalance[]) {
  const assetsTotal = sumDebitNet(accounts.filter((a) => a.accountType === 'ASSET'));
  const liabilitiesTotal = sumCreditNet(accounts.filter((a) => a.accountType === 'LIABILITY'));
  const equityAccountsTotal = sumCreditNet(accounts.filter((a) => a.accountType === 'EQUITY'));
  const incomeTotal = sumCreditNet(accounts.filter((a) => a.accountType === 'INCOME'));
  const expenseTotal = sumDebitNet(accounts.filter((a) => a.accountType === 'EXPENSE'));
  const netIncome = incomeTotal - expenseTotal;
  const equityTotal = equityAccountsTotal + netIncome;

  const cashAndBank = sumBankCashWithChildren(accounts);
  const receivables = sumDebitNet(byRole(accounts, 'AR'));
  const inventory = sumDebitNet(byRole(accounts, 'INVENTORY'));
  const fixedAssets = sumDebitNet(byRole(accounts, 'FIXED_ASSET'));
  const payables = sumCreditNet(byRole(accounts, 'AP'));
  // Net output tax only against RECOVERABLE (asset-typed) input tax. In regimes
  // where input tax is a cost (e.g. US sales tax, inputTaxIsExpense), the
  // INPUT_TAX account is EXPENSE-typed and must NOT reduce the tax liability.
  const recoverableInputTax = byRole(accounts, 'INPUT_TAX').filter((a) => a.accountType === 'ASSET');
  const taxLiability = sumCreditNet(byRole(accounts, 'OUTPUT_TAX')) - sumDebitNet(recoverableInputTax);
  // Liabilities not captured by the named buckets (e.g. loans, accruals). Deriving
  // `other` as the residual against taxLiability (not the gross OUTPUT_TAX) keeps the
  // recoverable input-tax offset accounted for exactly once, so the sub-buckets
  // reconcile precisely to liabilities.total: payables + taxLiability + other == total.
  const otherLiabilities = liabilitiesTotal - payables - taxLiability;

  return {
    assets: { current: { cashAndBank, receivables, inventory }, fixed: { total: fixedAssets }, total: assetsTotal },
    liabilities: { current: { payables, taxLiability, other: otherLiabilities }, longTerm: { total: 0 }, total: liabilitiesTotal },
    equity: { ownerEquity: equityAccountsTotal, retainedEarnings: netIncome, total: equityTotal },
    totalLiabilitiesAndEquity: liabilitiesTotal + equityTotal,
  };
}
