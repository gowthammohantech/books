import { describe, it, expect } from 'vitest';
import { applyDocumentTreatment } from '../../../lib/tax/applyTreatment';

// Contract the controllers rely on: STANDARD parity + full suppression.
describe('invoice tax-treatment contract', () => {
  const items = [{ totalTax: 18, taxes: [{ amount: 18 }] }];
  it('STANDARD posts the supplied tax unchanged (parity)', () => {
    expect(applyDocumentTreatment('STANDARD', 18, items).tax).toBe(18);
  });
  it('ZERO_RATED posts zero tax + zeroes items', () => {
    const r = applyDocumentTreatment('ZERO_RATED', 18, items);
    expect(r.tax).toBe(0);
    expect(r.items[0].totalTax).toBe(0);
  });
});
