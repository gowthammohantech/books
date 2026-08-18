// lib/ledger/depreciation.ts
// Pure straight-line depreciation helpers — no DB I/O, no side effects.
import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The subset of FixedAsset fields the depreciation helpers need. */
export interface DepreciationAsset {
  cost: Prisma.Decimal;
  salvageValue: Prisma.Decimal;
  usefulLifeMonths: number;
  acquisitionDate: Date;
  accumulatedDepreciation: Prisma.Decimal;
  lastDepreciatedOn: Date | null;
}

export interface DepreciationDueResult {
  /** Whole calendar months elapsed since the last depreciation (or acquisition). */
  months: number;
  /** String representation of the depreciation amount due (Decimal-safe). '0' when nothing due. */
  amount: string;
}

// ---------------------------------------------------------------------------
// monthlyDepreciation
// ---------------------------------------------------------------------------

/**
 * Computes the monthly straight-line depreciation charge.
 *
 * `(cost − salvageValue) / usefulLifeMonths`
 *
 * Returns 0 when `usefulLifeMonths` is 0 (guard against division by zero).
 */
export function monthlyDepreciation(
  cost: Prisma.Decimal,
  salvageValue: Prisma.Decimal,
  usefulLifeMonths: number,
): Prisma.Decimal {
  if (usefulLifeMonths <= 0) return new Prisma.Decimal(0);
  return cost.minus(salvageValue).dividedBy(usefulLifeMonths);
}

// ---------------------------------------------------------------------------
// wholeMonthsElapsed
// ---------------------------------------------------------------------------

/**
 * Counts whole calendar months from `from` to `to`.
 * Uses (year diff × 12 + month diff), ignoring day components —
 * same behaviour as most straight-line schedules in accounting software.
 */
function wholeMonthsElapsed(from: Date, to: Date): number {
  const yearDiff = to.getFullYear() - from.getFullYear();
  const monthDiff = to.getMonth() - from.getMonth();
  return Math.max(0, yearDiff * 12 + monthDiff);
}

// ---------------------------------------------------------------------------
// depreciationDue
// ---------------------------------------------------------------------------

/**
 * Returns the depreciation amount due as of `asOf`.
 *
 * - Counts whole months elapsed from `lastDepreciatedOn ?? acquisitionDate` to `asOf`.
 * - Multiplies by `monthlyDepreciation(cost, salvageValue, usefulLifeMonths)`.
 * - **Caps** the result so that `accumulatedDepreciation + amount ≤ cost − salvageValue`
 *   (the asset is never depreciated below its salvage value).
 * - Returns `{ months: 0, amount: '0' }` when nothing is due.
 */
export function depreciationDue(asset: DepreciationAsset, asOf: Date): DepreciationDueResult {
  const depreciableBase = asset.cost.minus(asset.salvageValue);

  // Already fully depreciated — nothing to post
  if (asset.accumulatedDepreciation.greaterThanOrEqualTo(depreciableBase)) {
    return { months: 0, amount: '0' };
  }

  const from = asset.lastDepreciatedOn ?? asset.acquisitionDate;
  const months = wholeMonthsElapsed(from, asOf);

  if (months <= 0) {
    return { months: 0, amount: '0' };
  }

  const monthly = monthlyDepreciation(asset.cost, asset.salvageValue, asset.usefulLifeMonths);
  const gross = monthly.times(months);

  // Remaining depreciable base after already-accumulated depreciation
  const remaining = depreciableBase.minus(asset.accumulatedDepreciation);

  // Cap: never post more than what's left to depreciate
  const amount = gross.greaterThan(remaining) ? remaining : gross;

  if (amount.lessThanOrEqualTo(0)) {
    return { months: 0, amount: '0' };
  }

  return { months, amount: amount.toString() };
}
