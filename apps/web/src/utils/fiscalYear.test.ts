import { describe, expect, it } from 'vitest';

import { formatFiscalYear } from './fiscalYear';

describe('formatFiscalYear', () => {
    it('spans two years for an April start, after the boundary', () => {
        expect(formatFiscalYear(4, new Date('2026-09-01'))).toBe('FY 2026-27');
    });

    it('reports the PREVIOUS span before the boundary', () => {
        // 1 March 2026 is still inside the FY that opened in April 2025.
        expect(formatFiscalYear(4, new Date('2026-03-01'))).toBe('FY 2025-26');
    });

    it('turns over on the first day of the start month', () => {
        expect(formatFiscalYear(4, new Date('2026-03-31'))).toBe('FY 2025-26');
        expect(formatFiscalYear(4, new Date('2026-04-01'))).toBe('FY 2026-27');
    });

    it('names a single year for a January start', () => {
        // "FY 2026-27" would be wrong here: the fiscal year IS 2026.
        expect(formatFiscalYear(1, new Date('2026-09-01'))).toBe('FY 2026');
    });

    it('returns null rather than a guess when unset', () => {
        expect(formatFiscalYear(null)).toBeNull();
        expect(formatFiscalYear(undefined)).toBeNull();
    });

    it('returns null for out-of-range or non-integer months', () => {
        expect(formatFiscalYear(0)).toBeNull();
        expect(formatFiscalYear(13)).toBeNull();
        expect(formatFiscalYear(4.5)).toBeNull();
    });
});
