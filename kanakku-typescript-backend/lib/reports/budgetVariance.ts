// lib/reports/budgetVariance.ts
import { Prisma } from '@prisma/client';

export interface VarianceInputRow {
  accountId: string;
  accountName: string;
  /** AccountType string value (e.g. 'INCOME', 'EXPENSE', 'ASSET', …) */
  accountType: string;
  /** Decimal string — budget amount for the period */
  budget: string;
  /** Decimal string — actual amount for the period */
  actual: string;
}

export interface VarianceRow extends VarianceInputRow {
  /** actual − budget (signed Decimal string) */
  variance: string;
  /** variance / |budget| * 100 — null when budget = 0 */
  variancePct: string | null;
  /** true when the variance is financially beneficial:
   *  INCOME: actual ≥ budget (higher revenue is good)
   *  EXPENSE + all others: actual ≤ budget (lower cost is good)
   */
  favorable: boolean;
}

export interface VarianceResult {
  rows: VarianceRow[];
  totals: {
    totalBudget: string;
    totalActual: string;
    totalVariance: string;
  };
}

const ZERO = new Prisma.Decimal(0);

/**
 * Pure function — enriches each row with variance, variancePct, and favorable.
 * All arithmetic uses Prisma.Decimal for exact decimal math.
 */
export function computeVariance(rows: VarianceInputRow[]): VarianceResult {
  let totalBudget = ZERO;
  let totalActual = ZERO;
  let totalVariance = ZERO;

  const enriched: VarianceRow[] = rows.map((row) => {
    const budget = new Prisma.Decimal(row.budget);
    const actual = new Prisma.Decimal(row.actual);

    // variance = actual − budget (positive = actual exceeded budget)
    const variance = actual.minus(budget);

    // variancePct = variance / |budget| * 100; null when budget = 0
    let variancePct: string | null = null;
    if (!budget.isZero()) {
      variancePct = variance.div(budget.abs()).mul(100).toFixed(4);
    }

    // Favorable direction differs by account type
    const isIncome = row.accountType === 'INCOME';
    // INCOME: favorable when actual ≥ budget (variance ≥ 0)
    // EXPENSE (and others): favorable when actual ≤ budget (variance ≤ 0)
    const favorable = isIncome ? variance.gte(0) : variance.lte(0);

    totalBudget = totalBudget.plus(budget);
    totalActual = totalActual.plus(actual);
    totalVariance = totalVariance.plus(variance);

    return {
      ...row,
      variance: variance.toFixed(4),
      variancePct,
      favorable,
    };
  });

  return {
    rows: enriched,
    totals: {
      totalBudget: totalBudget.toFixed(4),
      totalActual: totalActual.toFixed(4),
      totalVariance: totalVariance.toFixed(4),
    },
  };
}
