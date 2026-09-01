import Decimal from 'decimal.js';

/**
 * The one rounding rule for money in this product: 2 decimal places, half-up.
 *
 * This existed twice with different behaviour. The backend used
 * `Prisma.Decimal.toDecimalPlaces(2, ROUND_HALF_UP)`; the frontend used
 * `Math.round((value + Number.EPSILON) * 100) / 100`. Over 2,000,000 realistic
 * line computations (qty 1-20 x rate 0.01-200.00 x tax 5/12/18/20/28%) those two
 * disagree on 2,422 of them — 0.12%, roughly one line in 825 — always by exactly
 * one cent, always with the float version rounding a `.xx5` boundary DOWN where
 * the Decimal version rounds it up. qty 1 x 13.25 @ 18% is the smallest example:
 * float gives 2.38, Decimal gives 2.39.
 *
 * The server recomputes and persists its own totals (see
 * `warnOnTotalsDivergence` and the serverTotals tests), so the float version
 * never corrupted stored data — it just showed the user a figure that changed by
 * a cent when they saved. Sharing this module is what makes the frontend
 * preview and the persisted value agree by construction rather than by comment.
 */
export { Decimal };

/** Anything the callers hand us: a Decimal, a Prisma.Decimal, a string, a number. */
export type DecimalInput = Decimal | string | number | { toString(): string };

/**
 * Coerce to Decimal.
 *
 * `Prisma.Decimal` is decimal.js under the hood but Prisma bundles its own
 * private, minified copy, so the two constructors are different classes even
 * though they are structurally identical. Going through `toString()` is the
 * version-proof way across that boundary — never rely on the internal `d`/`e`/`s`
 * representation lining up.
 */
export function toDecimal(value: DecimalInput | null | undefined, fallback = 0): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(fallback);
  if (value instanceof Decimal) return value;
  const asString = typeof value === 'string' ? value : String(value);
  try {
    const d = new Decimal(asString);
    return d.isFinite() ? d : new Decimal(fallback);
  } catch {
    return new Decimal(fallback);
  }
}

/** Round to 2dp, half-up. The single money rounding rule. */
export function round2(value: DecimalInput): Decimal {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** `round2` as a plain number, for the many call sites that want one. */
export function round2Number(value: DecimalInput): number {
  return round2(value).toNumber();
}

/**
 * Numeric coercion matching the backend's original `toNum`: empty/nullish and
 * non-finite inputs collapse to the fallback rather than NaN-ing a total.
 */
export function toNum(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
