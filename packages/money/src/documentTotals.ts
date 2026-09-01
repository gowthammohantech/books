/**
 * Server-authoritative document totals — now shared with the frontend preview.
 *
 * WHY (backend): the legacy document controllers persisted client-supplied
 * subTotal/totalTax/grandTotal verbatim. A client could post items worth 10,000
 * with grandTotal 100 and the GL would take 100. This makes the SERVER the
 * source of truth: it recomputes from the line items, on the DISCOUNTED tax
 * base, rounding 2dp half-up per line, regardless of what the client sent.
 *
 * WHY (frontend): the same arithmetic was re-implemented in
 * apps/web/src/lib/lineTax.ts so the on-screen preview would match what the
 * server persists. That copy carried comments — "Do NOT round `base` here",
 * "Mirrors the backend component path exactly" — which are exactly the kind of
 * invariant that only holds while someone remembers to honour it. Sharing the
 * implementation makes it structural.
 *
 * SCOPE: shared by invoice / quotation / purchase / purchase order / debit note
 * (create AND update). It intentionally does NOT know about country tax regimes:
 *  - VAT_UK/VAT_EU/GST_AU/GST_NZ invoices additionally run through
 *    `serverAuthoritativeTax` (reverse-charge / OSS / rate clamping), which wins
 *    for the tax figure; the subTotal/discount here still stand.
 *
 * TAX SHAPES (verified against the frontend):
 *  - invoice / purchase lines carry a `taxes[]` component array (tax groups,
 *    e.g. CGST/SGST) with per-component `percent`. Authoritative: each component
 *    amount is recomputed as `round2(discountedBase x percent/100)` and summed.
 *  - quotation / PO / debit note lines carry a flat `tax` AMOUNT plus a
 *    `tax_group_id` (no per-line percent in the payload). `resolveItemTaxRates`
 *    — which stays in the backend because it hits the database — looks the
 *    group's rate up and attaches it as `taxRate` so tax is recomputed on the
 *    discounted base here too.
 *  - a bare flat `tax` amount with no taxes[]/taxRate is preserved as-is (legacy
 *    fallback) — the grandTotal is still derived, so it can never be spoofed.
 */
import { Decimal, round2, toDecimal, toNum } from './decimal.js';

/** Per-component tax entry (tax-group split). Only `percent` is authoritative. */
export interface TotalsItemTax {
  percent?: number | string | null;
  amount?: number | string | null;
  [key: string]: unknown;
}

/**
 * Fields needed to resolve a line's discounted taxable base (qty x rate,
 * minus the line discount). Deliberately has NO index signature — unlike
 * `TotalsItem` — so callers with their own narrower item shapes (e.g.
 * `RecomputeItem` in `lib/tax/serverAuthoritativeTax.ts`) can pass their items
 * straight through without needing a matching index signature of their own.
 */
export interface LineDiscountFields {
  qty?: number | string | null;
  /** Debit-note lines use `quantity`; treated as an alias for `qty`. */
  quantity?: number | string | null;
  rate?: number | string | null;
  /** Legacy absolute discount (used only when discount_value is absent). */
  discount?: number | string | null;
  discount_type?: string | null;
  discount_value?: number | string | null;
}

/** Minimal line shape the totals engine consumes across every document type. */
export interface TotalsItem extends LineDiscountFields {
  /** Flat tax AMOUNT (legacy fallback, used only when no taxes[]/taxRate). */
  tax?: number | string | null;
  /** Resolved flat tax rate (percent), e.g. from a tax group lookup. */
  taxRate?: number | string | null;
  /** Per-component tax percents (tax groups). Authoritative when present. */
  taxes?: TotalsItemTax[] | null;
  tax_group_id?: string | null;
  /** Direct TaxRate id (unified tax) — wins over tax_group_id when both present. */
  tax_rate_id?: string | null;
  [key: string]: unknown;
}

export interface PerLineTotal {
  /** qty x rate (pre-discount). */
  gross: number;
  /** absolute discount applied to the line, clamped to [0, gross]. */
  discount: number;
  /** net taxable base (gross - discount), 2dp. */
  taxable: number;
  /** per-line tax, 2dp. */
  tax: number;
  /** taxable + tax, 2dp. */
  total: number;
}

export interface DocumentTotals {
  /** Sum(qty x rate) — pre-discount gross, 2dp. */
  subTotal: number;
  /** Sum of line discounts, 2dp. */
  totalDiscount: number;
  /** Sum of per-line tax, 2dp. */
  totalTax: number;
  /** subTotal - totalDiscount + totalTax, 2dp. */
  grandTotal: number;
  perLine: PerLineTotal[];
}

function isPercentDiscount(type: string | null | undefined): boolean {
  if (!type) return false;
  return /perc|%/i.test(type);
}

/**
 * Resolve the absolute discount for a line (full precision, clamped to gross).
 * Honours discount_type/discount_value; falls back to a legacy absolute
 * `discount` when no discount_value is supplied.
 *
 * NOTE (discount_value without discount_type): a non-zero `discount_value`
 * with no `discount_type` (or a type that doesn't match the percent regex)
 * is NOT treated as a percentage — `isPercentDiscount` defaults to `false`
 * for a missing/unrecognised type, so `discount_value` falls into the `hasDv`
 * branch below and is applied as an ABSOLUTE amount. This is the safer
 * default: silently reading an untyped value as a percentage could turn a
 * "discount_value: 50" (intended as a flat 50) into a 50% discount.
 */
export function lineDiscount(item: LineDiscountFields, gross: Decimal): Decimal {
  const dv = item.discount_value;
  const hasDv = dv !== null && dv !== undefined && dv !== '' && toNum(dv) !== 0;

  let disc: Decimal;
  if (isPercentDiscount(item.discount_type)) {
    let pct = toNum(dv);
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    disc = gross.times(pct).div(100);
  } else if (hasDv) {
    disc = toDecimal(toNum(dv));
  } else {
    // Legacy clients: only an absolute `discount` amount was sent.
    disc = toDecimal(toNum(item.discount));
  }

  if (disc.lessThan(0)) disc = toDecimal(0);
  if (disc.greaterThan(gross)) disc = gross;
  return disc;
}

/**
 * Per-line tax on the (full-precision) discounted base, rounded 2dp per line.
 *
 * NOTE (component-wise vs summed-rate rounding): each tax-group component
 * (e.g. CGST 9% + SGST 9%) is rounded to 2dp INDIVIDUALLY before being summed,
 * rather than summing the percents (18%) and rounding once. This can differ
 * from a single-rate rounding by up to a cent on odd bases — intentional: it
 * mirrors how the tax-group UI presents and totals each component line, so the
 * persisted figure matches what the user sees broken out per tax component, not
 * a mathematically-collapsed single rate.
 */
export function lineTax(item: TotalsItem, base: Decimal): Decimal {
  const comps = item.taxes;
  if (Array.isArray(comps) && comps.length > 0) {
    let sum = toDecimal(0);
    for (const c of comps) {
      sum = sum.plus(round2(base.times(toNum(c.percent)).div(100)));
    }
    return sum;
  }
  if (item.taxRate !== null && item.taxRate !== undefined && item.taxRate !== '') {
    return round2(base.times(toNum(item.taxRate)).div(100));
  }
  // Legacy bare amount: preserve it (grandTotal is still derived below).
  return round2(toDecimal(toNum(item.tax)));
}

/** qty x rate at full precision. `quantity` is a debit-note alias for `qty`. */
export function lineGross(item: LineDiscountFields): Decimal {
  const qty = toDecimal(toNum(item.qty ?? item.quantity));
  const rate = toDecimal(toNum(item.rate));
  return qty.times(rate);
}

/**
 * Compute a single line's discounted taxable base (gross - discount), rounded
 * 2dp half-up — identically to what `computeDocumentTotals` uses internally
 * per line (`perLine[i].taxable`).
 *
 * WHY exported: the flat per-country tax packs (VAT_UK/VAT_EU/GST_AU/GST_NZ)
 * are recomputed server-side by `lib/tax/serverAuthoritativeTax.ts`, which
 * needs the SAME discounted base this helper's `totalDiscount`/`grandTotal`
 * are built on. Before this was exported, that module re-derived the base
 * from the legacy absolute `discount` field only — so a line using a
 * structured `discount_value`/`discount_type` (percent or fixed) got taxed on
 * the UNdiscounted gross while the total still subtracted the real discount,
 * overstating VAT and leaving the document internally inconsistent. Reusing
 * this single function keeps both figures derived from one source of truth.
 */
export function lineTaxableBase(item: LineDiscountFields): number {
  const gross = lineGross(item);
  const discount = lineDiscount(item, gross);
  return round2(gross.minus(discount)).toNumber();
}

/**
 * Recompute a document's totals from its line items. Pure and Decimal-based.
 */
export function computeDocumentTotals(items: TotalsItem[]): DocumentTotals {
  let subTotal = toDecimal(0);
  let totalDiscount = toDecimal(0);
  let totalTax = toDecimal(0);
  const perLine: PerLineTotal[] = [];

  for (const item of items ?? []) {
    const gross = lineGross(item);
    const discount = lineDiscount(item, gross);
    const base = gross.minus(discount);
    const tax = lineTax(item, base);

    subTotal = subTotal.plus(gross);
    totalDiscount = totalDiscount.plus(discount);
    totalTax = totalTax.plus(tax);

    perLine.push({
      gross: round2(gross).toNumber(),
      discount: round2(discount).toNumber(),
      taxable: round2(base).toNumber(),
      tax: round2(tax).toNumber(),
      total: round2(base.plus(tax)).toNumber(),
    });
  }

  const sub = round2(subTotal);
  const disc = round2(totalDiscount);
  const tx = round2(totalTax);
  const grand = round2(sub.minus(disc).plus(tx));

  return {
    subTotal: sub.toNumber(),
    totalDiscount: disc.toNumber(),
    totalTax: tx.toNumber(),
    grandTotal: grand.toNumber(),
    perLine,
  };
}
