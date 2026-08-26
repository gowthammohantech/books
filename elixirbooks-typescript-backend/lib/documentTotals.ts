/**
 * Server-authoritative document totals.
 *
 * WHY: the legacy document controllers persisted client-supplied
 * subTotal/totalTax/grandTotal verbatim (server calc was only a fallback). A
 * client could post items worth 10,000 with grandTotal 100 and the GL would
 * take 100. This helper makes the SERVER the source of truth: it recomputes the
 * document totals from the line items, on the DISCOUNTED tax base, rounding 2dp
 * half-up per line — regardless of what the client sent.
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
 *    amount is recomputed as `round2(discountedBase × percent/100)` and summed.
 *  - quotation / PO / debit note lines carry a flat `tax` AMOUNT plus a
 *    `tax_group_id` (no per-line percent in the payload). `resolveItemTaxRates`
 *    looks the group's rate up (Σ of its tax_rates) and attaches it as `taxRate`
 *    so tax is recomputed on the discounted base here too.
 *  - a bare flat `tax` amount with no taxes[]/taxRate is preserved as-is (legacy
 *    fallback) — the grandTotal is still derived, so it can never be spoofed.
 */
import { Prisma } from '@prisma/client';

const ROUND_HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

function round2(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, ROUND_HALF_UP);
}

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Per-component tax entry (tax-group split). Only `percent` is authoritative. */
export interface TotalsItemTax {
  percent?: number | string | null;
  amount?: number | string | null;
  [key: string]: unknown;
}

/**
 * Fields needed to resolve a line's discounted taxable base (qty × rate,
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
  /** qty × rate (pre-discount). */
  gross: number;
  /** absolute discount applied to the line, clamped to [0, gross]. */
  discount: number;
  /** net taxable base (gross − discount), 2dp. */
  taxable: number;
  /** per-line tax, 2dp. */
  tax: number;
  /** taxable + tax, 2dp. */
  total: number;
}

export interface DocumentTotals {
  /** Σ(qty × rate) — pre-discount gross, 2dp. */
  subTotal: number;
  /** Σ line discount, 2dp. */
  totalDiscount: number;
  /** Σ per-line tax, 2dp. */
  totalTax: number;
  /** subTotal − totalDiscount + totalTax, 2dp. */
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
function lineDiscount(item: LineDiscountFields, gross: Prisma.Decimal): Prisma.Decimal {
  const dv = item.discount_value;
  const hasDv = dv !== null && dv !== undefined && dv !== '' && toNum(dv) !== 0;

  let disc: Prisma.Decimal;
  if (isPercentDiscount(item.discount_type)) {
    let pct = toNum(dv);
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    disc = gross.times(pct).div(100);
  } else if (hasDv) {
    disc = new Prisma.Decimal(toNum(dv));
  } else {
    // Legacy clients: only an absolute `discount` amount was sent.
    disc = new Prisma.Decimal(toNum(item.discount));
  }

  if (disc.lessThan(0)) disc = new Prisma.Decimal(0);
  if (disc.greaterThan(gross)) disc = gross;
  return disc;
}

/**
 * Per-line tax on the (full-precision) discounted base, rounded 2dp per line.
 *
 * NOTE (component-wise vs summed-rate rounding): each tax-group component
 * (e.g. CGST 9% + SGST 9%) is rounded to 2dp INDIVIDUALLY before being summed,
 * rather than summing the percents (18%) and rounding once. This can differ
 * from a single-rate rounding by up to a cent on odd bases (e.g. two 2.5%
 * components on a 0.03 base round to 0.00 + 0.00 = 0.00, whereas a combined
 * 5% would round to 0.00 too here, but the two can diverge on other bases) —
 * intentional: it mirrors how the frontend/tax-group UI presents and totals
 * each component line, so the persisted figure matches what the user sees
 * broken out per tax component, not a mathematically-collapsed single rate.
 */
function lineTax(item: TotalsItem, base: Prisma.Decimal): Prisma.Decimal {
  const comps = item.taxes;
  if (Array.isArray(comps) && comps.length > 0) {
    let sum = new Prisma.Decimal(0);
    for (const c of comps) {
      sum = sum.plus(round2(base.times(toNum(c.percent)).div(100)));
    }
    return sum;
  }
  if (item.taxRate !== null && item.taxRate !== undefined && item.taxRate !== '') {
    return round2(base.times(toNum(item.taxRate)).div(100));
  }
  // Legacy bare amount: preserve it (grandTotal is still derived below).
  return round2(new Prisma.Decimal(toNum(item.tax)));
}

/**
 * Compute a single line's discounted taxable base (gross − discount), rounded
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
  const qty = new Prisma.Decimal(toNum(item.qty ?? item.quantity));
  const rate = new Prisma.Decimal(toNum(item.rate));
  const gross = qty.times(rate);
  const discount = lineDiscount(item, gross);
  return round2(gross.minus(discount)).toNumber();
}

/**
 * Recompute a document's totals from its line items. Pure and Decimal-based.
 */
export function computeDocumentTotals(items: TotalsItem[]): DocumentTotals {
  let subTotal = new Prisma.Decimal(0);
  let totalDiscount = new Prisma.Decimal(0);
  let totalTax = new Prisma.Decimal(0);
  const perLine: PerLineTotal[] = [];

  for (const item of items ?? []) {
    const qty = new Prisma.Decimal(toNum(item.qty ?? item.quantity));
    const rate = new Prisma.Decimal(toNum(item.rate));
    const gross = qty.times(rate);
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

/**
 * Compare a client-sent grand total against the server value and warn (but
 * never throw) when they diverge by more than 0.05. The server value is ALWAYS
 * the one persisted; this only surfaces mis-behaving / stale clients in the log.
 */
export function warnOnTotalsDivergence(
  docType: string,
  docId: string,
  clientGrandTotal: number | null | undefined,
  serverGrandTotal: number,
): void {
  if (clientGrandTotal === null || clientGrandTotal === undefined || Number.isNaN(clientGrandTotal)) {
    return;
  }
  if (Math.abs(clientGrandTotal - serverGrandTotal) > 0.05) {
    // eslint-disable-next-line no-console
    console.warn(
      `[documentTotals] ${docType} ${docId}: client grandTotal ${clientGrandTotal} diverges from ` +
        `server ${serverGrandTotal}; persisting server value.`,
    );
  }
}

/** Read surface needed to look up a tax group's summed rate / a direct rate. */
export interface TaxGroupLookupDb {
  taxGroup: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: { id: true; tax_rates: { select: { rate: true; isActive: true; isDeleted: true } } };
    }) => Promise<Array<{ id: string; tax_rates: Array<{ rate: unknown; isActive?: boolean; isDeleted?: boolean }> }>>;
  };
  /** Optional so legacy narrow test doubles keep working; the real prisma client has it. */
  taxRate?: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: { id: true; rate: true; isActive: true; isDeleted: true };
    }) => Promise<Array<{ id: string; rate: unknown; isActive?: boolean; isDeleted?: boolean }>>;
  };
}

/**
 * For lines that carry a `tax_rate_id` (unified tax) or a legacy `tax_group_id`
 * but no per-component `taxes[]` (quotation / PO / debit note shape), resolve
 * the rate percent (direct rate, or Σ of the group's active tax_rates) and
 * attach it as `taxRate` so `computeDocumentTotals` can recompute tax on the
 * discounted base. `tax_rate_id` wins when both are present. Lines with
 * taxes[] or no linkage are returned as-is.
 *
 * Batched queries; a no-op (no query) when nothing needs resolving.
 */
export async function resolveItemTaxRates<T extends TotalsItem>(
  db: TaxGroupLookupDb,
  items: T[],
): Promise<T[]> {
  const groupIds = new Set<string>();
  const rateIds = new Set<string>();
  for (const item of items ?? []) {
    const hasComponents = Array.isArray(item.taxes) && item.taxes.length > 0;
    if (hasComponents) continue;
    if (item.tax_rate_id) rateIds.add(item.tax_rate_id);
    else if (item.tax_group_id) groupIds.add(item.tax_group_id);
  }
  if (groupIds.size === 0 && rateIds.size === 0) return items;

  const [groups, rates] = await Promise.all([
    groupIds.size > 0
      ? db.taxGroup.findMany({
          where: { id: { in: [...groupIds] } },
          select: { id: true, tax_rates: { select: { rate: true, isActive: true, isDeleted: true } } },
        })
      : Promise.resolve([]),
    rateIds.size > 0 && db.taxRate
      ? db.taxRate.findMany({
          where: { id: { in: [...rateIds] } },
          select: { id: true, rate: true, isActive: true, isDeleted: true },
        })
      : Promise.resolve([]),
  ]);

  const rateByGroup = new Map<string, number>();
  for (const g of groups) {
    const total = g.tax_rates
      .filter((r) => r.isActive !== false && r.isDeleted !== true)
      .reduce((sum, r) => sum + toNum(r.rate), 0);
    rateByGroup.set(g.id, total);
  }
  const rateById = new Map<string, number>();
  for (const r of rates) {
    if (r.isActive !== false && r.isDeleted !== true) rateById.set(r.id, toNum(r.rate));
  }

  return items.map((item) => {
    const hasComponents = Array.isArray(item.taxes) && item.taxes.length > 0;
    if (hasComponents) return item;
    if (item.tax_rate_id) {
      return rateById.has(item.tax_rate_id)
        ? { ...item, taxRate: rateById.get(item.tax_rate_id) }
        : item;
    }
    if (item.tax_group_id && rateByGroup.has(item.tax_group_id)) {
      return { ...item, taxRate: rateByGroup.get(item.tax_group_id) };
    }
    return item;
  });
}
