import { describe, it, expect, vi } from 'vitest';
import {
  computeDocumentTotals,
  warnOnTotalsDivergence,
  resolveItemTaxRates,
  lineTaxableBase,
  type TotalsItem,
} from '../lib/documentTotals';

/**
 * Task 4 — server-authoritative document totals.
 *
 * The shared helper recomputes subTotal / totalDiscount / totalTax / grandTotal
 * from the line items, on the DISCOUNTED base, 2dp half-up per line. It is the
 * single source of truth for invoice / quotation / purchase / PO / debit note.
 */

describe('computeDocumentTotals — discount semantics', () => {
  it('percent discount = value% of the line subtotal', () => {
    const t = computeDocumentTotals([
      { qty: 1, rate: 100, discount_type: 'Percentage', discount_value: 10 },
    ]);
    expect(t.subTotal).toBe(100);
    expect(t.totalDiscount).toBe(10);
    expect(t.totalTax).toBe(0);
    expect(t.grandTotal).toBe(90);
  });

  it('fixed discount is absolute and clamped to the line subtotal', () => {
    const t = computeDocumentTotals([
      // 150 fixed discount on a 100 line clamps to 100 (never negative).
      { qty: 1, rate: 100, discount_type: 'Fixed', discount_value: 150 },
    ]);
    expect(t.subTotal).toBe(100);
    expect(t.totalDiscount).toBe(100);
    expect(t.grandTotal).toBe(0);
  });

  it('falls back to an absolute `discount` for legacy clients (no discount_value)', () => {
    const t = computeDocumentTotals([{ qty: 2, rate: 50, discount: 15 }]);
    expect(t.subTotal).toBe(100);
    expect(t.totalDiscount).toBe(15);
    expect(t.grandTotal).toBe(85);
  });
});

describe('computeDocumentTotals — tax', () => {
  it('tax group: sums per-component amounts recomputed from percent × discounted base', () => {
    // CGST 9% + SGST 9% on a 100 base = 9 + 9 = 18.
    const t = computeDocumentTotals([
      { qty: 1, rate: 100, taxes: [{ percent: 9 }, { percent: 9 }] },
    ]);
    expect(t.totalTax).toBe(18);
    expect(t.grandTotal).toBe(118);
  });

  it('flat tax percent (resolved rate): tax = discounted base × rate', () => {
    const t = computeDocumentTotals([{ qty: 1, rate: 100, taxRate: 18 }]);
    expect(t.totalTax).toBe(18);
    expect(t.grandTotal).toBe(118);
  });

  it('tax is computed on the DISCOUNTED base, not the gross', () => {
    // 100 gross - 20 discount = 80 base; 10% tax = 8.
    const t = computeDocumentTotals([
      { qty: 1, rate: 100, discount_type: 'Fixed', discount_value: 20, taxRate: 10 },
    ]);
    expect(t.subTotal).toBe(100);
    expect(t.totalDiscount).toBe(20);
    expect(t.totalTax).toBe(8);
    expect(t.grandTotal).toBe(88);
  });

  it('preserves a bare flat `tax` amount when no taxes[]/taxRate is available', () => {
    const t = computeDocumentTotals([{ qty: 1, rate: 100, tax: 12 }]);
    expect(t.totalTax).toBe(12);
    expect(t.grandTotal).toBe(112);
  });
});

describe('computeDocumentTotals — rounding (per-line 2dp half-up on the discounted base)', () => {
  it('3 × 9.99 @ 10% discount + 18% tax → taxable 26.97, tax 4.86, total 31.83', () => {
    const t = computeDocumentTotals([
      { qty: 3, rate: 9.99, discount_type: 'Percentage', discount_value: 10, taxRate: 18 },
    ]);
    expect(t.subTotal).toBe(29.97);
    expect(t.totalDiscount).toBe(3.0);
    expect(t.perLine[0].taxable).toBe(26.97);
    expect(t.totalTax).toBe(4.86);
    expect(t.grandTotal).toBe(31.83);
  });
});

describe('computeDocumentTotals — quantity alias + zero-item docs', () => {
  it('accepts `quantity` as an alias for `qty` (debit note shape)', () => {
    const t = computeDocumentTotals([{ quantity: 2, rate: 50, taxRate: 10 }]);
    expect(t.subTotal).toBe(100);
    expect(t.totalTax).toBe(10);
    expect(t.grandTotal).toBe(110);
  });

  it('zero-item document is all zeros', () => {
    const t = computeDocumentTotals([]);
    expect(t).toEqual({
      subTotal: 0,
      totalDiscount: 0,
      totalTax: 0,
      grandTotal: 0,
      perLine: [],
    });
  });
});

describe('warnOnTotalsDivergence', () => {
  it('warns when the client grand total diverges by more than 0.05', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnOnTotalsDivergence('invoice', 'INV-1', 100, 200);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('invoice');
    expect(spy.mock.calls[0][0]).toContain('INV-1');
    spy.mockRestore();
  });

  it('does NOT warn within the 0.05 tolerance', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnOnTotalsDivergence('invoice', 'INV-1', 100.04, 100);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does NOT warn when the client value is absent / NaN', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnOnTotalsDivergence('invoice', 'INV-1', undefined, 100);
    warnOnTotalsDivergence('invoice', 'INV-1', NaN, 100);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('resolveItemTaxRates', () => {
  const db = {
    taxGroup: {
      findMany: vi.fn(async () => [
        { id: 'g1', tax_rates: [{ rate: 9, isActive: true, isDeleted: false }, { rate: 9, isActive: true, isDeleted: false }] },
      ]),
    },
  };

  it('attaches a resolved taxRate (Σ active component rates) to lines with a tax_group_id and no taxes[]', async () => {
    const out = await resolveItemTaxRates(db as never, [
      { qty: 1, rate: 100, tax_group_id: 'g1', tax: 18 },
      { qty: 1, rate: 50 }, // no group → untouched
    ] as TotalsItem[]);
    expect(out[0].taxRate).toBe(18);
    expect(out[1].taxRate).toBeUndefined();
    const t = computeDocumentTotals(out);
    expect(t.totalTax).toBe(18);
  });

  it('leaves lines that already carry taxes[] untouched (no lookup override)', async () => {
    const out = await resolveItemTaxRates(db as never, [
      { qty: 1, rate: 100, tax_group_id: 'g1', taxes: [{ percent: 5 }] },
    ] as TotalsItem[]);
    expect(out[0].taxRate).toBeUndefined();
  });

  it('is a no-op when there are no resolvable groups', async () => {
    const findMany = vi.fn();
    const out = await resolveItemTaxRates({ taxGroup: { findMany } } as never, [{ qty: 1, rate: 100 }] as TotalsItem[]);
    expect(findMany).not.toHaveBeenCalled();
    expect(out[0].taxRate).toBeUndefined();
  });
});

describe('resolveItemTaxRates — direct tax_rate_id (unified tax)', () => {
  const db = {
    taxGroup: { findMany: vi.fn(async () => []) },
    taxRate: {
      findMany: vi.fn(async () => [
        { id: 'r18', rate: 18, isActive: true, isDeleted: false },
        { id: 'rdead', rate: 99, isActive: false, isDeleted: false },
      ]),
    },
  };

  it('attaches the rate percent for lines carrying tax_rate_id', async () => {
    const out = await resolveItemTaxRates(db as never, [
      { qty: 1, rate: 100, tax_rate_id: 'r18' },
    ] as TotalsItem[]);
    expect(out[0].taxRate).toBe(18);
    expect(computeDocumentTotals(out).totalTax).toBe(18);
  });

  it('tax_rate_id wins over a legacy tax_group_id on the same line', async () => {
    const bothDb = {
      taxGroup: { findMany: vi.fn(async () => [{ id: 'g1', tax_rates: [{ rate: 5, isActive: true, isDeleted: false }] }]) },
      taxRate: { findMany: vi.fn(async () => [{ id: 'r18', rate: 18, isActive: true, isDeleted: false }]) },
    };
    const out = await resolveItemTaxRates(bothDb as never, [
      { qty: 1, rate: 100, tax_rate_id: 'r18', tax_group_id: 'g1' },
    ] as TotalsItem[]);
    expect(out[0].taxRate).toBe(18);
    // The group was never even queried for this line.
    expect(bothDb.taxGroup.findMany).not.toHaveBeenCalled();
  });

  it('ignores inactive rates and leaves taxes[] lines untouched', async () => {
    const out = await resolveItemTaxRates(db as never, [
      { qty: 1, rate: 100, tax_rate_id: 'rdead' },
      { qty: 1, rate: 100, tax_rate_id: 'r18', taxes: [{ percent: 5 }] },
    ] as TotalsItem[]);
    expect(out[0].taxRate).toBeUndefined();
    expect(out[1].taxRate).toBeUndefined();
  });

  it('a dead tax_rate_id never falls back to the group, even when a sibling line queries that group', async () => {
    const mixedDb = {
      taxGroup: { findMany: vi.fn(async () => [{ id: 'g1', tax_rates: [{ rate: 5, isActive: true, isDeleted: false }] }]) },
      taxRate: { findMany: vi.fn(async () => []) },
    };
    const out = await resolveItemTaxRates(mixedDb as never, [
      { qty: 1, rate: 100, tax_rate_id: 'deadRate', tax_group_id: 'g1' },
      { qty: 1, rate: 100, tax_group_id: 'g1' },
    ] as TotalsItem[]);
    expect(out[0].taxRate).toBeUndefined();
    expect(out[1].taxRate).toBe(5);
  });

  it('tolerates legacy db surfaces without a taxRate delegate', async () => {
    const legacyDb = { taxGroup: { findMany: vi.fn(async () => []) } };
    const out = await resolveItemTaxRates(legacyDb as never, [
      { qty: 1, rate: 100, tax_rate_id: 'r18' },
    ] as TotalsItem[]);
    expect(out[0].taxRate).toBeUndefined();
  });
});

describe('lineTaxableBase — shared discounted-base helper (used by serverAuthoritativeTax)', () => {
  it('matches computeDocumentTotals perLine[i].taxable for a structured percent discount', () => {
    const item = { qty: 2, rate: 100, discount_type: 'Percentage', discount_value: 10 };
    const totals = computeDocumentTotals([item]);
    expect(lineTaxableBase(item)).toBe(totals.perLine[0].taxable);
    expect(lineTaxableBase(item)).toBe(180);
  });

  it('matches computeDocumentTotals perLine[i].taxable for a structured fixed discount', () => {
    const item = { qty: 1, rate: 100, discount_type: 'Fixed', discount_value: 30 };
    const totals = computeDocumentTotals([item]);
    expect(lineTaxableBase(item)).toBe(totals.perLine[0].taxable);
    expect(lineTaxableBase(item)).toBe(70);
  });

  it('matches computeDocumentTotals perLine[i].taxable for the legacy absolute discount fallback', () => {
    const item = { qty: 1, rate: 100, discount: 20 };
    const totals = computeDocumentTotals([item]);
    expect(lineTaxableBase(item)).toBe(totals.perLine[0].taxable);
    expect(lineTaxableBase(item)).toBe(80);
  });
});
