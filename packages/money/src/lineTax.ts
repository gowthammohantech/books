/**
 * Line-item tax recomputation, shared between the invoice/quotation/purchase
 * forms and the server-authoritative totals engine.
 *
 * These are the pure halves of what was apps/web/src/lib/lineTax.ts. The two
 * impure parts stay in the frontend: `resolveLineTaxByRateId` makes an HTTP
 * call, and `appendLineTaxFormData` builds a browser `FormData`.
 *
 * The arithmetic here is the same `documentTotals` path — deliberately. The
 * frontend copy used to carry the comment "Mirrors the backend component path
 * exactly — round2(base x percent/100) per component, on the unrounded base",
 * which was true only for as long as someone maintained it by hand. Both sides
 * now call this.
 */
import { Decimal, round2, toDecimal, toNum } from './decimal.js';

/** Minimal line shape the recompute needs. */
export interface LineTaxable {
  qty: number | string | null | undefined;
  rate: number | string | null | undefined;
  /** Absolute discount amount (already resolved from discount_value/type). */
  discount: number | string | null | undefined;
}

/**
 * One resolved tax component on a line.
 *
 * Generic over `kind` so a caller with a narrower vocabulary keeps it: the
 * frontend declares `TaxLine = TaxComponent<TaxKind | null>` and does not lose
 * the enum. This package deliberately does not depend on @elixirbooks/enums for
 * it — the shape is what matters here, not the vocabulary.
 */
export interface TaxComponent<Kind extends string | null = string | null> {
  taxRateId: string;
  name: string;
  kind: Kind;
  percent: number;
  amount: number;
}

/** The subset of a TaxRate row this module reads. */
export interface AppliedTaxRate<Kind extends string | null = string | null> {
  id: string;
  name: string;
  rate: number | string;
  taxKind?: Kind;
}

export interface RecomputeResult<Kind extends string | null = string | null> {
  taxes: TaxComponent<Kind>[];
  totalTax: number;
  /** Post-tax line total (taxable + totalTax). */
  amount: number;
}

/**
 * Full-precision discounted base: qty x rate - discount.
 *
 * NOT rounded. The tax is computed on the unrounded base and each component is
 * rounded afterwards; rounding the base first diverges by up to a cent
 * (26.97 x 18% = 4.85 vs 26.973 x 18% = 4.86).
 */
export function discountedBase(line: LineTaxable): Decimal {
  const qty = toDecimal(toNum(line.qty));
  const rate = toDecimal(toNum(line.rate));
  const discount = toDecimal(toNum(line.discount));
  return qty.times(rate).minus(discount);
}

/**
 * Given a line's taxable inputs and the TaxRate rows that apply, compute the
 * per-component taxes[] split, totalTax and line amount.
 */
export function recomputeLineTaxes<Kind extends string | null = string | null>(
  line: LineTaxable,
  appliedRates: AppliedTaxRate<Kind>[],
): RecomputeResult<Kind> {
  const base = discountedBase(line);

  const taxes: TaxComponent<Kind>[] = appliedRates.map((r) => ({
    taxRateId: r.id,
    name: r.name,
    kind: (r.taxKind ?? null) as Kind,
    percent: toNum(r.rate),
    amount: round2(base.times(toNum(r.rate)).div(100)).toNumber(),
  }));

  return finalise(base, taxes);
}

/**
 * Recompute an existing line's per-component tax amounts on a new discounted
 * base, PRESERVING each component's taxRateId/name/kind/percent.
 *
 * Used by the edit-item modal: when qty/rate/discount change but the tax
 * components were already resolved (tax group / resolve-line endpoint), each
 * component must be re-scaled rather than left stale.
 */
export function recomputeLineTaxesFromComponents<Kind extends string | null = string | null>(
  line: LineTaxable,
  components: TaxComponent<Kind>[],
): RecomputeResult<Kind> {
  const base = discountedBase(line);

  const taxes: TaxComponent<Kind>[] = components.map((t) => ({
    ...t,
    amount: round2(base.times(toNum(t.percent)).div(100)).toNumber(),
  }));

  return finalise(base, taxes);
}

/** Sum the (already 2dp) components and derive the line total. */
function finalise<Kind extends string | null>(
  base: Decimal,
  taxes: TaxComponent<Kind>[],
): RecomputeResult<Kind> {
  let sum = toDecimal(0);
  for (const t of taxes) sum = sum.plus(toDecimal(t.amount));
  const totalTax = round2(sum);
  return {
    taxes,
    totalTax: totalTax.toNumber(),
    amount: round2(base.plus(totalTax)).toNumber(),
  };
}

/**
 * Clamp a line's raw discount_value input to a valid range based on
 * discount_type, BEFORE it feeds the recompute pipeline. Percentage discounts
 * are bounded to [0, 100]; Fixed discounts are bounded to [0, qty*rate] (the
 * line's pre-tax subtotal) — matching `lineDiscount` in ./documentTotals.
 *
 * Single source of truth for this clamp: used by both the edit-item modal and
 * the inline row input so the two paths can't drift.
 */
export function clampDiscountValue(
  value: number | string | null | undefined,
  type: 'Fixed' | 'Percentage' | string | undefined,
  qty: number | string | null | undefined,
  rate: number | string | null | undefined,
): number {
  const raw = toNum(value);

  if (type === 'Percentage') {
    if (raw < 0) return 0;
    if (raw > 100) return 100;
    return raw;
  }

  const subtotal = toDecimal(toNum(qty)).times(toNum(rate)).toNumber();
  if (raw < 0) return 0;
  if (raw > subtotal) return subtotal;
  return raw;
}

/**
 * Resolve TaxRate objects from a library by id, then recompute. Ids missing
 * from the library are dropped.
 */
export function recomputeLineTaxesByIds<Kind extends string | null = string | null>(
  line: LineTaxable,
  appliedTaxRateIds: string[],
  taxRateLibrary: AppliedTaxRate<Kind>[],
): RecomputeResult<Kind> & { appliedTaxRateIds: string[] } {
  const appliedRates = appliedTaxRateIds
    .map((id) => taxRateLibrary.find((r) => r.id === id))
    .filter((r): r is AppliedTaxRate<Kind> => !!r);

  return { ...recomputeLineTaxes(line, appliedRates), appliedTaxRateIds };
}

/** Apply a single flat rate to a line, or clear the tax when given none. */
export function applyFlatRateToLine<Kind extends string | null = string | null>(
  line: LineTaxable,
  rate: AppliedTaxRate<Kind> | null,
): RecomputeResult<Kind> & { appliedTaxRateIds: string[] } {
  if (!rate) {
    return {
      taxes: [],
      totalTax: 0,
      amount: round2(discountedBase(line)).toNumber(),
      appliedTaxRateIds: [],
    };
  }
  return { ...recomputeLineTaxes(line, [rate]), appliedTaxRateIds: [rate.id] };
}
