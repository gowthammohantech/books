import { describe, expect, it } from 'vitest';

import { computeDocumentTotals } from './documentTotals.js';
import {
  applyFlatRateToLine,
  clampDiscountValue,
  discountedBase,
  recomputeLineTaxes,
  recomputeLineTaxesByIds,
  recomputeLineTaxesFromComponents,
} from './lineTax.js';

const GST9 = { id: 'r1', name: 'CGST 9%', rate: 9, taxKind: 'CGST' };
const SGST9 = { id: 'r2', name: 'SGST 9%', rate: 9, taxKind: 'SGST' };

describe('discountedBase', () => {
  it('is qty x rate - discount at FULL precision, deliberately unrounded', () => {
    // 3 x 9.99 - 2.997 = 26.973. Rounding here to 26.97 before taxing is what
    // makes the frontend disagree with the server by a cent.
    expect(discountedBase({ qty: 3, rate: 9.99, discount: 2.997 }).toString()).toBe('26.973');
  });

  it('coerces empty/nullish inputs rather than producing NaN', () => {
    expect(discountedBase({ qty: null, rate: '', discount: undefined }).toNumber()).toBe(0);
  });
});

describe('recomputeLineTaxes', () => {
  it('splits per component and rounds each to 2dp', () => {
    const r = recomputeLineTaxes({ qty: 1, rate: 100, discount: 0 }, [GST9, SGST9]);
    expect(r.taxes.map((t) => t.amount)).toEqual([9, 9]);
    expect(r.totalTax).toBe(18);
    expect(r.amount).toBe(118);
  });

  it('carries taxRateId/name/kind/percent through onto each component', () => {
    const [first] = recomputeLineTaxes({ qty: 1, rate: 100, discount: 0 }, [GST9]).taxes;
    expect(first).toMatchObject({ taxRateId: 'r1', name: 'CGST 9%', kind: 'CGST', percent: 9 });
  });

  it('agrees with computeDocumentTotals on the canonical 3 x 9.99 @ 10% + 18% line', () => {
    // The frontend preview and the server-persisted figure must match; this is
    // the assertion that pins them together now that both call the same code.
    const line = { qty: 3, rate: 9.99, discount: 2.997 };
    const fe = recomputeLineTaxes(line, [{ id: 'r', name: 'GST 18%', rate: 18 }]);
    const be = computeDocumentTotals([
      { qty: 3, rate: 9.99, discount_type: 'Percentage', discount_value: 10, taxes: [{ percent: 18 }] },
    ]);
    expect(fe.totalTax).toBe(be.perLine[0].tax);
    expect(fe.amount).toBe(be.perLine[0].total);
    expect(fe.totalTax).toBe(4.86);
  });

  it('no applied rates means no tax', () => {
    const r = recomputeLineTaxes({ qty: 2, rate: 10, discount: 0 }, []);
    expect(r).toMatchObject({ taxes: [], totalTax: 0, amount: 20 });
  });
});

describe('recomputeLineTaxesFromComponents', () => {
  it('re-scales existing components on a new base, preserving their identity', () => {
    const existing = [
      { taxRateId: 'r1', name: 'CGST 9%', kind: 'CGST', percent: 9, amount: 9 },
    ];
    const r = recomputeLineTaxesFromComponents({ qty: 2, rate: 100, discount: 0 }, existing);
    expect(r.taxes[0]).toMatchObject({ taxRateId: 'r1', name: 'CGST 9%', percent: 9, amount: 18 });
    expect(r.totalTax).toBe(18);
  });
});

describe('clampDiscountValue', () => {
  it('bounds a percentage to [0, 100]', () => {
    expect(clampDiscountValue(150, 'Percentage', 1, 100)).toBe(100);
    expect(clampDiscountValue(-5, 'Percentage', 1, 100)).toBe(0);
    expect(clampDiscountValue(10, 'Percentage', 1, 100)).toBe(10);
  });

  it('bounds a fixed amount to [0, qty*rate]', () => {
    expect(clampDiscountValue(500, 'Fixed', 2, 100)).toBe(200);
    expect(clampDiscountValue(-5, 'Fixed', 2, 100)).toBe(0);
    expect(clampDiscountValue(50, 'Fixed', 2, 100)).toBe(50);
  });

  it('treats an unknown type as Fixed, matching lineDiscount', () => {
    expect(clampDiscountValue(500, undefined, 2, 100)).toBe(200);
  });
});

describe('recomputeLineTaxesByIds', () => {
  it('resolves ids from the library and drops ones it cannot find', () => {
    const r = recomputeLineTaxesByIds({ qty: 1, rate: 100, discount: 0 }, ['r1', 'nope'], [GST9, SGST9]);
    expect(r.taxes).toHaveLength(1);
    expect(r.appliedTaxRateIds).toEqual(['r1', 'nope']);
    expect(r.totalTax).toBe(9);
  });
});

describe('applyFlatRateToLine', () => {
  it('applies one rate', () => {
    const r = applyFlatRateToLine({ qty: 1, rate: 100, discount: 0 }, GST9);
    expect(r).toMatchObject({ totalTax: 9, amount: 109, appliedTaxRateIds: ['r1'] });
  });

  it('clears the tax when given none, keeping the rounded base as the amount', () => {
    const r = applyFlatRateToLine({ qty: 3, rate: 9.99, discount: 2.997 }, null);
    expect(r).toMatchObject({ taxes: [], totalTax: 0, amount: 26.97, appliedTaxRateIds: [] });
  });
});
