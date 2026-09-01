/**
 * These assertions are the backend's existing golden numbers, restated against
 * the shared implementation. If the extraction changed the arithmetic, this file
 * fails — that is its whole job. `apps/api/tests/documentTotals.test.ts` keeps
 * its own copies so the backend suite proves the same thing from its side.
 */
import { describe, expect, it } from 'vitest';

import { computeDocumentTotals, lineTaxableBase } from './documentTotals.js';

describe('lineDiscount', () => {
  it('percent discount = value% of the line subtotal', () => {
    const t = computeDocumentTotals([
      { qty: 2, rate: 100, discount_type: 'Percentage', discount_value: 10 },
    ]);
    expect(t.perLine[0].discount).toBe(20);
    expect(t.perLine[0].taxable).toBe(180);
  });

  it('clamps a percent discount to [0, 100]', () => {
    expect(
      computeDocumentTotals([
        { qty: 1, rate: 100, discount_type: 'Percentage', discount_value: 150 },
      ]).perLine[0].discount,
    ).toBe(100);
    expect(
      computeDocumentTotals([
        { qty: 1, rate: 100, discount_type: 'Percentage', discount_value: -5 },
      ]).perLine[0].discount,
    ).toBe(0);
  });

  it('fixed discount is absolute and clamped to the line subtotal', () => {
    const t = computeDocumentTotals([
      { qty: 1, rate: 50, discount_type: 'Fixed', discount_value: 500 },
    ]);
    expect(t.perLine[0].discount).toBe(50);
    expect(t.perLine[0].taxable).toBe(0);
  });

  it('falls back to an absolute `discount` for legacy clients (no discount_value)', () => {
    const t = computeDocumentTotals([{ qty: 1, rate: 100, discount: 15 }]);
    expect(t.perLine[0].discount).toBe(15);
    expect(t.perLine[0].taxable).toBe(85);
  });

  it('treats an untyped discount_value as ABSOLUTE, never as a percentage', () => {
    // The safer default: reading "50" as 50% would silently halve the line.
    const t = computeDocumentTotals([{ qty: 1, rate: 100, discount_value: 50 }]);
    expect(t.perLine[0].discount).toBe(50);
  });
});

describe('lineTax', () => {
  it('tax group: sums per-component amounts recomputed from percent x discounted base', () => {
    const t = computeDocumentTotals([
      { qty: 1, rate: 100, taxes: [{ percent: 9 }, { percent: 9 }] },
    ]);
    expect(t.perLine[0].tax).toBe(18);
  });

  it('rounds each component individually, not the summed rate', () => {
    // Two 2.5% components on 0.03: round2(0.00075) twice = 0, not round2(0.0015).
    const t = computeDocumentTotals([
      { qty: 1, rate: 0.03, taxes: [{ percent: 2.5 }, { percent: 2.5 }] },
    ]);
    expect(t.perLine[0].tax).toBe(0);
  });

  it('flat tax percent (resolved rate): tax = discounted base x rate', () => {
    const t = computeDocumentTotals([{ qty: 1, rate: 200, taxRate: 5 }]);
    expect(t.perLine[0].tax).toBe(10);
  });

  it('tax is computed on the DISCOUNTED base, not the gross', () => {
    const t = computeDocumentTotals([
      { qty: 1, rate: 100, discount_type: 'Percentage', discount_value: 50, taxRate: 10 },
    ]);
    expect(t.perLine[0].taxable).toBe(50);
    expect(t.perLine[0].tax).toBe(5);
  });

  it('preserves a bare flat `tax` amount when no taxes[]/taxRate is available', () => {
    const t = computeDocumentTotals([{ qty: 1, rate: 100, tax: 7.5 }]);
    expect(t.perLine[0].tax).toBe(7.5);
    expect(t.grandTotal).toBe(107.5);
  });
});

describe('computeDocumentTotals', () => {
  it('3 x 9.99 @ 10% discount + 18% tax -> taxable 26.97, tax 4.86, total 31.83', () => {
    // The canonical case for "tax the UNROUNDED base": 26.973 x 18% = 4.85514,
    // which rounds to 4.86. Taxing the rounded 26.97 would give 4.85.
    const t = computeDocumentTotals([
      {
        qty: 3,
        rate: 9.99,
        discount_type: 'Percentage',
        discount_value: 10,
        taxes: [{ percent: 18 }],
      },
    ]);
    expect(t.perLine[0].taxable).toBe(26.97);
    expect(t.perLine[0].tax).toBe(4.86);
    expect(t.perLine[0].total).toBe(31.83);
  });

  it('accepts `quantity` as an alias for `qty` (debit note shape)', () => {
    const t = computeDocumentTotals([{ quantity: 2, rate: 25 }]);
    expect(t.perLine[0].gross).toBe(50);
  });

  it('zero-item document is all zeros', () => {
    const t = computeDocumentTotals([]);
    expect(t).toMatchObject({ subTotal: 0, totalDiscount: 0, totalTax: 0, grandTotal: 0 });
    expect(t.perLine).toEqual([]);
  });

  it('grandTotal = subTotal - totalDiscount + totalTax across several lines', () => {
    const t = computeDocumentTotals([
      { qty: 2, rate: 100, discount_type: 'Percentage', discount_value: 10, taxRate: 18 },
      { qty: 1, rate: 49.99, taxRate: 5 },
    ]);
    expect(t.subTotal).toBe(249.99);
    expect(t.totalDiscount).toBe(20);
    expect(t.grandTotal).toBe(t.subTotal - t.totalDiscount + t.totalTax);
  });
});

describe('lineTaxableBase', () => {
  it.each([
    ['structured percent discount', { qty: 3, rate: 9.99, discount_type: 'Percentage', discount_value: 10 }],
    ['structured fixed discount', { qty: 3, rate: 9.99, discount_type: 'Fixed', discount_value: 5 }],
    ['legacy absolute discount fallback', { qty: 3, rate: 9.99, discount: 5 }],
  ])('matches computeDocumentTotals perLine[0].taxable for a %s', (_label, item) => {
    expect(lineTaxableBase(item)).toBe(computeDocumentTotals([item]).perLine[0].taxable);
  });
});
