// controllers/Admin/Purchases/validateReturnQuantities.spec.ts
// Bug 2b: a debit-note (purchase-return) line must never exceed the purchased qty.
import { describe, it, expect } from 'vitest';
import { validateReturnQuantities } from './debitNoteController';

const purchased = (entries: [string, number][]) => new Map<string, number>(entries);

describe('validateReturnQuantities (DN qty cap)', () => {
  it('accepts a return equal to the purchased quantity', () => {
    const r = validateReturnQuantities(
      [{ productId: 'p1', name: 'Widget', quantity: 5 }],
      purchased([['p1', 5]]),
    );
    expect(r.ok).toBe(true);
  });

  it('accepts a partial return', () => {
    const r = validateReturnQuantities(
      [{ productId: 'p1', name: 'Widget', quantity: 2 }],
      purchased([['p1', 5]]),
    );
    expect(r.ok).toBe(true);
  });

  it('rejects a return exceeding the purchased quantity', () => {
    const r = validateReturnQuantities(
      [{ productId: 'p1', name: 'Widget', quantity: 6 }],
      purchased([['p1', 5]]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/exceeds purchased quantity/);
  });

  it('rejects a product that is not on the source purchase', () => {
    const r = validateReturnQuantities(
      [{ productId: 'p-ghost', name: 'Ghost', quantity: 1 }],
      purchased([['p1', 5]]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/not part of the source purchase/);
  });

  it('sums purchased qty across duplicate lines for the same product', () => {
    // caller aggregates duplicates; a 8-unit return is valid against 5+5=10 purchased
    const r = validateReturnQuantities(
      [{ productId: 'p1', name: 'Widget', quantity: 8 }],
      purchased([['p1', 10]]),
    );
    expect(r.ok).toBe(true);
  });

  it('ignores lines with zero quantity or no product', () => {
    const r = validateReturnQuantities(
      [
        { productId: 'p1', name: 'Widget', quantity: 0 },
        { name: 'NoProduct', quantity: 3 },
      ],
      purchased([['p1', 1]]),
    );
    expect(r.ok).toBe(true);
  });
});
