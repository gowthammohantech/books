import { describe, expect, it } from 'vitest';
import { applyFlatRateToLine, appendLineTaxFormData } from './lineTax';
import type { TaxRate } from '@models/taxRate';

const rate = (over: Partial<TaxRate> = {}): TaxRate => ({
    id: 'tr-1', name: 'GST 18%', rate: 18, regime: 'GST_INDIA', taxKind: null,
    countryId: null, stateId: null, isActive: true, createdAt: '', updatedAt: '', ...over,
});

describe('applyFlatRateToLine', () => {
    it('null rate → no taxes, amount = discounted base', () => {
        const r = applyFlatRateToLine({ qty: 2, rate: 50, discount: 10 }, null);
        expect(r.taxes).toEqual([]);
        expect(r.totalTax).toBe(0);
        expect(r.amount).toBe(90);
        expect(r.appliedTaxRateIds).toEqual([]);
    });
    it('single rate → one component, flat percent on unrounded base', () => {
        const r = applyFlatRateToLine({ qty: 3, rate: 9.99, discount: 3 }, rate());
        // base 26.97 → 26.97 * 18% = 4.8546 → 4.85
        expect(r.taxes).toEqual([{ taxRateId: 'tr-1', name: 'GST 18%', kind: null, percent: 18, amount: 4.85 }]);
        expect(r.totalTax).toBe(4.85);
        expect(r.amount).toBe(31.82);
        expect(r.appliedTaxRateIds).toEqual(['tr-1']);
    });
});

describe('appendLineTaxFormData customFields', () => {
    it('serializes the per-line customFields bag under bracket keys', () => {
        const fd = new FormData();
        appendLineTaxFormData(fd, [
            { name: 'Pen', qty: 1, customFields: { hsn_code: '8471', tags: ['a', 'b'], skip: null, blank: '  ' } },
        ]);
        expect(fd.get('items[0][customFields][hsn_code]')).toBe('8471');
        expect(fd.get('items[0][customFields][tags][0]')).toBe('a');
        expect(fd.get('items[0][customFields][tags][1]')).toBe('b');
        expect(fd.get('items[0][customFields][skip]')).toBeNull();
        expect(fd.get('items[0][customFields][blank]')).toBeNull();
        expect(fd.get('items[0][customFields]')).toBeNull(); // no [object Object] leak
        expect(fd.get('items[0][name]')).toBe('Pen');
    });
});
