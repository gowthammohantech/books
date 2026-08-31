import { describe, it, expect } from 'vitest';
import { resolveDocumentTax, suppressesTax, parseTaxTreatment } from './taxTreatment';

describe('resolveDocumentTax', () => {
  it('STANDARD passes the supplied tax through', () => {
    expect(resolveDocumentTax('STANDARD', 18)).toBe(18);
  });
  it('null/undefined treated as STANDARD (legacy rows)', () => {
    expect(resolveDocumentTax(null, 18)).toBe(18);
    expect(resolveDocumentTax(undefined, 18)).toBe(18);
  });
  it('ZERO_RATED / EXEMPT / REVERSE_CHARGE / OUT_OF_SCOPE force 0', () => {
    for (const t of ['ZERO_RATED', 'EXEMPT', 'REVERSE_CHARGE', 'OUT_OF_SCOPE'] as const) {
      expect(resolveDocumentTax(t, 18)).toBe(0);
    }
  });
});

describe('suppressesTax', () => {
  it('false for STANDARD/null', () => {
    expect(suppressesTax('STANDARD')).toBe(false);
    expect(suppressesTax(null)).toBe(false);
    expect(suppressesTax(undefined)).toBe(false);
  });
  it('true for every non-standard treatment', () => {
    for (const t of ['ZERO_RATED', 'EXEMPT', 'REVERSE_CHARGE', 'OUT_OF_SCOPE'] as const) {
      expect(suppressesTax(t)).toBe(true);
    }
  });
});

describe('parseTaxTreatment', () => {
  it('returns the value for each valid enum string', () => {
    for (const t of ['STANDARD', 'ZERO_RATED', 'EXEMPT', 'REVERSE_CHARGE', 'OUT_OF_SCOPE'] as const) {
      expect(parseTaxTreatment(t)).toBe(t);
    }
  });
  it('returns undefined for unknown/invalid values', () => {
    expect(parseTaxTreatment('INVALID')).toBeUndefined();
    expect(parseTaxTreatment('')).toBeUndefined();
    expect(parseTaxTreatment(null)).toBeUndefined();
    expect(parseTaxTreatment(undefined)).toBeUndefined();
    expect(parseTaxTreatment(42)).toBeUndefined();
    expect(parseTaxTreatment('standard')).toBeUndefined(); // case-sensitive
  });
});
