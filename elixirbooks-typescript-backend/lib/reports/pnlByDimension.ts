// lib/reports/pnlByDimension.ts
//
// Pivot a grouped JournalLine aggregate into a columnar departmental P&L:
// accounts down the rows, profit centres across the columns, plus a trailing
// "Common / Unallocated" column for lines that carry no centre.
//
// Pure — no Prisma, no I/O — so the reconciliation invariants can be tested
// without a database. The one that matters: every department column plus
// Common must sum to the same total as the unfiltered P&L for the period. If
// that does not tie out, the per-line posting is wrong.

import { Prisma } from '@prisma/client';

/** The literal column key for lines with no profit centre. */
export const UNALLOCATED_KEY = '__unallocated__';
export const UNALLOCATED_LABEL = 'Common / Unallocated';

export interface DimGroupRow {
  accountId: string;
  costCenterId: string | null;
  debit: string;
  credit: string;
}

export interface PnlAccount {
  id: string;
  code: string;
  name: string;
  accountType: 'INCOME' | 'EXPENSE' | string;
}

export interface PnlCentre {
  id: string;
  code: string;
  name: string;
}

export interface PnlColumn {
  key: string;
  code: string;
  name: string;
}

export interface PnlRow {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  /** Column key → net amount, 4dp string. */
  amounts: Record<string, string>;
  total: string;
}

export interface PnlByDimensionResult {
  columns: PnlColumn[];
  revenue: PnlRow[];
  expenses: PnlRow[];
  totals: {
    revenue: Record<string, string>;
    expenses: Record<string, string>;
    net: Record<string, string>;
    grandRevenue: string;
    grandExpenses: string;
    grandNet: string;
  };
}

const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v ?? 0);
const fmt = (d: Prisma.Decimal): string => d.toFixed(4);

/**
 * Build the columnar report.
 *
 * `centres` supplies the column order and labels. Any costCenterId present in
 * `rows` but ABSENT from `centres` — a soft-deleted centre, or a stale id — is
 * folded into Common / Unallocated rather than dropped. Dropping it would make
 * the row totals stop reconciling to the unfiltered P&L, which is exactly the
 * check this report exists to support.
 */
export function pivotPnlByDimension(
  rows: DimGroupRow[],
  accounts: PnlAccount[],
  centres: PnlCentre[],
): PnlByDimensionResult {
  const knownCentres = new Set(centres.map((c) => c.id));

  const columns: PnlColumn[] = [
    ...centres.map((c) => ({ key: c.id, code: c.code, name: c.name })),
    { key: UNALLOCATED_KEY, code: '—', name: UNALLOCATED_LABEL },
  ];

  // accountId → columnKey → net
  const cells = new Map<string, Map<string, Prisma.Decimal>>();
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  for (const row of rows) {
    const account = accountById.get(row.accountId);
    if (!account) continue; // not an INCOME/EXPENSE account — not part of a P&L

    const columnKey =
      row.costCenterId && knownCentres.has(row.costCenterId) ? row.costCenterId : UNALLOCATED_KEY;

    // INCOME is credit-positive, EXPENSE is debit-positive — the same sign
    // convention as lib/ledger/statements.ts, so the two reports agree.
    const net =
      account.accountType === 'INCOME'
        ? D(row.credit).minus(D(row.debit))
        : D(row.debit).minus(D(row.credit));

    if (!cells.has(row.accountId)) cells.set(row.accountId, new Map());
    const byColumn = cells.get(row.accountId) as Map<string, Prisma.Decimal>;
    byColumn.set(columnKey, (byColumn.get(columnKey) ?? D(0)).plus(net));
  }

  const buildRows = (type: 'INCOME' | 'EXPENSE'): PnlRow[] =>
    accounts
      .filter((a) => a.accountType === type)
      .map((a) => {
        const byColumn = cells.get(a.id) ?? new Map<string, Prisma.Decimal>();
        const amounts: Record<string, string> = {};
        let total = D(0);
        for (const col of columns) {
          const value = byColumn.get(col.key) ?? D(0);
          amounts[col.key] = fmt(value);
          total = total.plus(value);
        }
        return { accountId: a.id, code: a.code, name: a.name, accountType: a.accountType, amounts, total: fmt(total) };
      })
      // Drop accounts with no activity at all — an all-zero row is noise.
      .filter((r) => !D(r.total).isZero() || Object.values(r.amounts).some((v) => !D(v).isZero()));

  const revenue = buildRows('INCOME');
  const expenses = buildRows('EXPENSE');

  const sumColumns = (list: PnlRow[]): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const col of columns) {
      out[col.key] = fmt(list.reduce((s, r) => s.plus(D(r.amounts[col.key])), D(0)));
    }
    return out;
  };

  const revenueTotals = sumColumns(revenue);
  const expenseTotals = sumColumns(expenses);

  const netTotals: Record<string, string> = {};
  for (const col of columns) {
    netTotals[col.key] = fmt(D(revenueTotals[col.key]).minus(D(expenseTotals[col.key])));
  }

  const grandRevenue = revenue.reduce((s, r) => s.plus(D(r.total)), D(0));
  const grandExpenses = expenses.reduce((s, r) => s.plus(D(r.total)), D(0));

  return {
    columns,
    revenue,
    expenses,
    totals: {
      revenue: revenueTotals,
      expenses: expenseTotals,
      net: netTotals,
      grandRevenue: fmt(grandRevenue),
      grandExpenses: fmt(grandExpenses),
      grandNet: fmt(grandRevenue.minus(grandExpenses)),
    },
  };
}

/**
 * Roll child centres up into their parents, summing their columns.
 *
 * Used by `?rollup=parent` so a Division column shows the sum of its
 * Departments. Centres with no parent keep their own column.
 */
export function rollUpToParents(
  result: PnlByDimensionResult,
  parentOf: Map<string, string | null>,
  centreLabels: Map<string, { code: string; name: string }>,
): PnlByDimensionResult {
  const targetFor = (key: string): string => {
    if (key === UNALLOCATED_KEY) return key;
    return parentOf.get(key) ?? key;
  };

  const targetKeys: string[] = [];
  for (const col of result.columns) {
    const target = targetFor(col.key);
    if (!targetKeys.includes(target)) targetKeys.push(target);
  }

  const columns: PnlColumn[] = targetKeys.map((key) => {
    if (key === UNALLOCATED_KEY) return { key, code: '—', name: UNALLOCATED_LABEL };
    const label = centreLabels.get(key);
    return { key, code: label?.code ?? key, name: label?.name ?? key };
  });

  const foldRow = (row: PnlRow): PnlRow => {
    const amounts: Record<string, string> = {};
    for (const key of targetKeys) amounts[key] = fmt(D(0));
    for (const [key, value] of Object.entries(row.amounts)) {
      const target = targetFor(key);
      amounts[target] = fmt(D(amounts[target]).plus(D(value)));
    }
    return { ...row, amounts };
  };

  const foldTotals = (totals: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const key of targetKeys) out[key] = fmt(D(0));
    for (const [key, value] of Object.entries(totals)) {
      const target = targetFor(key);
      out[target] = fmt(D(out[target]).plus(D(value)));
    }
    return out;
  };

  return {
    columns,
    revenue: result.revenue.map(foldRow),
    expenses: result.expenses.map(foldRow),
    totals: {
      ...result.totals,
      revenue: foldTotals(result.totals.revenue),
      expenses: foldTotals(result.totals.expenses),
      net: foldTotals(result.totals.net),
    },
  };
}
