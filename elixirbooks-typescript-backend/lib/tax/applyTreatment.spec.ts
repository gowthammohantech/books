import { describe, it, expect } from 'vitest';
import { applyDocumentTreatment } from './applyTreatment';

interface Item { totalTax?: number; taxes?: { amount?: number }[] }

describe('applyDocumentTreatment', () => {
  const items: Item[] = [{ totalTax: 18, taxes: [{ amount: 18 }] }, { totalTax: 9, taxes: [{ amount: 9 }] }];

  it('zeroes a `tax`-named line field too (doc types using `tax`)', () => {
    const taxItems = [{ tax: 18 }, { tax: 9 }];
    const r = applyDocumentTreatment('EXEMPT', 27, taxItems);
    expect(r.tax).toBe(0);
    expect(r.items.every((i) => i.tax === 0)).toBe(true);
    expect(taxItems[0].tax).toBe(18); // input not mutated
  });

  it('STANDARD: passes tax + items through unchanged', () => {
    const r = applyDocumentTreatment('STANDARD', 27, items);
    expect(r.tax).toBe(27);
    expect(r.items[0].totalTax).toBe(18);
    expect(r.items[0].taxes![0].amount).toBe(18);
  });

  it('null treatment behaves as STANDARD', () => {
    expect(applyDocumentTreatment(null, 27, items).tax).toBe(27);
  });

  it('ZERO_RATED: tax 0 and every item tax zeroed', () => {
    const r = applyDocumentTreatment('ZERO_RATED', 27, items);
    expect(r.tax).toBe(0);
    expect(r.items.every((i) => i.totalTax === 0)).toBe(true);
    expect(r.items.every((i) => (i.taxes ?? []).every((t) => t.amount === 0))).toBe(true);
  });

  it('REVERSE_CHARGE / EXEMPT / OUT_OF_SCOPE also suppress', () => {
    for (const t of ['REVERSE_CHARGE', 'EXEMPT', 'OUT_OF_SCOPE'] as const) {
      expect(applyDocumentTreatment(t, 27, items).tax).toBe(0);
    }
  });

  it('does not mutate the input items array', () => {
    applyDocumentTreatment('ZERO_RATED', 27, items);
    expect(items[0].totalTax).toBe(18); // original untouched
  });
});
