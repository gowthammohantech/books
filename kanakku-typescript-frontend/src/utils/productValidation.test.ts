import { describe, expect, it } from 'vitest';
import { validateProductForm } from './productValidation';

const base = { name: 'Widget', unit: '', selling_price: '', purchase_price: '', enable_inventory: false, stock: 0 };

describe('validateProductForm (Items spec 2026-07-12)', () => {
    it('name is the ONLY required field', () => {
        expect(validateProductForm(base)).toEqual({});
    });
    it('rejects empty / 1-char names', () => {
        expect(validateProductForm({ ...base, name: '' }).name).toBe('Name is required');
        expect(validateProductForm({ ...base, name: 'A' }).name).toBe('Name must be between 2 and 255 characters');
    });
    it('does NOT require unit', () => {
        expect(validateProductForm(base).unit).toBeUndefined();
    });
    it('keeps price relationship check when both entered', () => {
        expect(validateProductForm({ ...base, selling_price: 5, purchase_price: 10 }).selling_price)
            .toBe('Selling price must be greater than purchase price');
    });
    it('keeps stock>0 rule only when tracking inventory', () => {
        expect(validateProductForm({ ...base, enable_inventory: true, stock: 0 }).stock).toBe('Stock must be greater than 0');
        expect(validateProductForm({ ...base, enable_inventory: false, stock: 0 }).stock).toBeUndefined();
    });
});
