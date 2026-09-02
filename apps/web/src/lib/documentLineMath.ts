/**
 * Per-line arithmetic for the document forms.
 *
 * WHY THIS EXISTS: `lineTaxPercent` was defined nine times, byte-identical, and
 * the per-line compute around it was written three times per page (edit modal,
 * inline row, quick-add) across fourteen pages — and had drifted. Seven pages
 * clamped the discount to its line and taxed the discounted base; six clamped
 * nothing and taxed `rate x qty`, so a discounted line was taxed on the
 * undiscounted amount and a discount larger than its line drove the document
 * negative.
 *
 * WHY IT IS A MODULE AND NOT A HOOK: apps/web runs Vitest with
 * `environment: 'node'` and no jsdom, so a component cannot be rendered in a
 * test. Pure functions here are the only place regression cover for this
 * arithmetic can live.
 *
 * The maths itself is not reimplemented — `clampDiscountValue` and
 * `discountedBase` come from @elixirbooks/money, the same code the server uses
 * to recompute and persist, so the preview and the stored figure derive from one
 * implementation rather than two kept in step by comment.
 */
import { clampDiscountValue, discountedBase } from '@lib/lineTax';
import { round2 } from '@utils/round2';

/** A TaxRate row as the forms hold it. */
export interface TaxRateOption {
  id: string;
  rate: number | string;
}

/** A tax group as the forms hold it, carrying the summed rate of its components. */
export interface TaxGroupOption {
  id: string | number;
  total_tax_rate?: number | null;
}

/** The tax linkage a document line carries. */
export interface TaxedLine {
  tax_rate_id?: string | null;
  tax_group_id?: string | null;
}

/**
 * The flat percent that applies to a line.
 *
 * A direct `tax_rate_id` wins; a legacy `tax_group_id` falls back to the group's
 * summed rate. Unlinked lines are untaxed.
 */
export function lineTaxPercent(
  line: TaxedLine,
  taxRateLibrary: TaxRateOption[],
  taxGroups: TaxGroupOption[],
): number {
  if (line.tax_rate_id) {
    const rate = taxRateLibrary.find((x) => x.id === line.tax_rate_id);
    if (rate) return Number(rate.rate);
  }
  const group = taxGroups.find((t) => String(t.id) === String(line.tax_group_id));
  return group?.total_tax_rate || 0;
}

export interface LineInput {
  qty: number | string | null | undefined;
  rate: number | string | null | undefined;
  discount_type?: 'Fixed' | 'Percentage' | string;
  discount_value?: number | string | null;
  /** Flat tax percent for the line — see `lineTaxPercent`. */
  taxPercent: number;
}

export interface LineTotals {
  /** qty x rate, before any discount. */
  subtotal: number;
  /** The discount actually applied, clamped to [0, subtotal]. */
  discount: number;
  /** subtotal - discount: what tax is charged on. */
  taxable: number;
  /** Tax on the discounted base, 2dp. */
  tax: number;
  /** taxable + tax. */
  amount: number;
  /**
   * `discount_value` after clamping — a percentage above 100 or a fixed amount
   * above the line total is corrected, and the corrected value is what the form
   * should store, so the input reflects what was charged.
   */
  discountValue: number;
}

/**
 * One line's totals.
 *
 * Tax is charged on the DISCOUNTED base. That is not a preference: the server
 * recomputes and persists on the discounted base, so any other choice here shows
 * the user a figure that changes when they save.
 */
export function computeLineTotals(input: LineInput): LineTotals {
  const qty = Number(input.qty) || 0;
  const rate = Number(input.rate) || 0;
  const subtotal = round2(qty * rate);

  const discountValue = clampDiscountValue(
    input.discount_value,
    input.discount_type,
    qty,
    rate,
  );

  const discountAmount =
    input.discount_type === 'Percentage' ? (qty * rate * discountValue) / 100 : discountValue;
  // clampDiscountValue already bounds a Fixed discount to the line and a
  // Percentage to 100, so this is belt-and-braces for a value arriving from
  // somewhere other than the form.
  const discount = round2(Math.min(Math.max(discountAmount, 0), qty * rate));

  // Full precision into the tax, rounded once after — rounding the base first
  // diverges by up to a cent (see discountedBase in @elixirbooks/money).
  const base = discountedBase({ qty, rate, discount });
  const tax = round2((base.toNumber() * (Number(input.taxPercent) || 0)) / 100);
  const taxable = round2(base.toNumber());

  return {
    subtotal,
    discount,
    taxable,
    tax,
    amount: round2(taxable + tax),
    discountValue,
  };
}
