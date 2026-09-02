import { describe, expect, it } from 'vitest';

import { computeLineTotals, lineTaxPercent } from './documentLineMath';

const RATES = [
  { id: 'r-18', rate: 18 },
  { id: 'r-5', rate: '5' },
];
const GROUPS = [
  { id: 'g-18', total_tax_rate: 18 },
  { id: 'g-0', total_tax_rate: 0 },
  { id: 12, total_tax_rate: 12 },
];

describe('lineTaxPercent', () => {
  it('prefers a direct tax_rate_id over a legacy group', () => {
    expect(lineTaxPercent({ tax_rate_id: 'r-18', tax_group_id: 'g-0' }, RATES, GROUPS)).toBe(18);
  });

  it('falls back to the group when there is no direct rate', () => {
    expect(lineTaxPercent({ tax_group_id: 'g-18' }, RATES, GROUPS)).toBe(18);
  });

  // Group ids arrive as numbers from some endpoints and strings from others.
  it('matches a group id across string and number forms', () => {
    expect(lineTaxPercent({ tax_group_id: '12' }, RATES, GROUPS)).toBe(12);
  });

  it('coerces a rate that arrives as a string', () => {
    expect(lineTaxPercent({ tax_rate_id: 'r-5' }, RATES, GROUPS)).toBe(5);
  });

  it('is zero for an unlinked line, an unknown id, or a zero-rated group', () => {
    expect(lineTaxPercent({}, RATES, GROUPS)).toBe(0);
    expect(lineTaxPercent({ tax_rate_id: 'nope' }, RATES, GROUPS)).toBe(0);
    expect(lineTaxPercent({ tax_group_id: 'g-0' }, RATES, GROUPS)).toBe(0);
  });

  // A stale tax_rate_id must not silently swallow a valid group link.
  it('falls through to the group when the direct rate id does not resolve', () => {
    expect(lineTaxPercent({ tax_rate_id: 'gone', tax_group_id: 'g-18' }, RATES, GROUPS)).toBe(18);
  });
});

describe('computeLineTotals', () => {
  it('computes an undiscounted line', () => {
    expect(computeLineTotals({ qty: 2, rate: 100, taxPercent: 18 })).toMatchObject({
      subtotal: 200,
      discount: 0,
      taxable: 200,
      tax: 36,
      amount: 236,
    });
  });

  // The bug this module exists to kill: six pages taxed rate x qty, so this
  // line was charged 36 (18% of 200) rather than 27 (18% of 150).
  it('taxes the DISCOUNTED base, not the gross', () => {
    expect(
      computeLineTotals({
        qty: 2,
        rate: 100,
        discount_type: 'Percentage',
        discount_value: 25,
        taxPercent: 18,
      }),
    ).toMatchObject({ subtotal: 200, discount: 50, taxable: 150, tax: 27, amount: 177 });
  });

  it('applies a fixed discount on the discounted base too', () => {
    expect(
      computeLineTotals({
        qty: 1,
        rate: 100,
        discount_type: 'Fixed',
        discount_value: 40,
        taxPercent: 10,
      }),
    ).toMatchObject({ discount: 40, taxable: 60, tax: 6, amount: 66 });
  });

  // Unclamped, this produced a negative line and a negative document.
  it('clamps a fixed discount larger than the line', () => {
    const line = computeLineTotals({
      qty: 1,
      rate: 100,
      discount_type: 'Fixed',
      discount_value: 500,
      taxPercent: 18,
    });
    expect(line.discount).toBe(100);
    expect(line.taxable).toBe(0);
    expect(line.amount).toBe(0);
    // The corrected value goes back to the form, so the input shows what was charged.
    expect(line.discountValue).toBe(100);
  });

  it('clamps a percentage discount above 100 and below 0', () => {
    expect(
      computeLineTotals({ qty: 1, rate: 100, discount_type: 'Percentage', discount_value: 250, taxPercent: 0 }),
    ).toMatchObject({ discount: 100, taxable: 0, discountValue: 100 });
    expect(
      computeLineTotals({ qty: 1, rate: 100, discount_type: 'Percentage', discount_value: -5, taxPercent: 0 }),
    ).toMatchObject({ discount: 0, taxable: 100, discountValue: 0 });
  });

  // Rounding the base before taxing diverges by a cent; @elixirbooks/money's
  // discountedBase exists to prevent exactly that, and this pins it.
  it('taxes the full-precision base and rounds once, matching the server', () => {
    // 3 x 8.991 = 26.973. 18% of 26.973 = 4.85514 -> 4.86.
    // Rounding the base to 26.97 first would give 4.85.
    expect(computeLineTotals({ qty: 3, rate: 8.991, taxPercent: 18 }).tax).toBe(4.86);
  });

  it('rounds half up, as Decimal does, not as binary floats do', () => {
    // The case the money package was extracted over: 1 x 13.25 @ 18% is 2.385,
    // which float rounding takes down to 2.38.
    expect(computeLineTotals({ qty: 1, rate: 13.25, taxPercent: 18 }).tax).toBe(2.39);
  });

  it('treats missing, empty and non-numeric inputs as zero', () => {
    expect(computeLineTotals({ qty: undefined, rate: null, taxPercent: 18 })).toMatchObject({
      subtotal: 0,
      taxable: 0,
      tax: 0,
      amount: 0,
    });
    expect(computeLineTotals({ qty: 2, rate: 100, discount_value: null, taxPercent: 0 }).discount).toBe(0);
  });

  it('accepts numeric strings from form inputs', () => {
    expect(computeLineTotals({ qty: '2', rate: '100', taxPercent: 18 })).toMatchObject({
      subtotal: 200,
      tax: 36,
    });
  });

  // No discount_type means the value is an absolute amount, never a percentage —
  // the same choice lineDiscount makes server-side, and the safer one: reading an
  // untyped 50 as 50% would silently halve the line.
  it('treats an untyped discount value as an absolute amount', () => {
    expect(computeLineTotals({ qty: 1, rate: 100, discount_value: 50, taxPercent: 0 }).discount).toBe(50);
  });
});
