import { describe, it, expect } from 'vitest';
import {
  EU_MEMBER_RATES,
  isEuMember,
  euStandardRate,
  parseVatNumber,
  isReverseCharge,
} from '../lib/euVat';

describe('EU_MEMBER_RATES', () => {
  it('contains all 27 member states', () => {
    expect(Object.keys(EU_MEMBER_RATES)).toHaveLength(27);
  });

  it('does not include GB (not EU)', () => {
    expect(EU_MEMBER_RATES).not.toHaveProperty('GB');
  });

  it('has expected standard rates', () => {
    expect(EU_MEMBER_RATES.DE).toBe(19);
    expect(EU_MEMBER_RATES.FR).toBe(20);
    expect(EU_MEMBER_RATES.IE).toBe(23);
    expect(EU_MEMBER_RATES.NL).toBe(21);
    expect(EU_MEMBER_RATES.HU).toBe(27);
    expect(EU_MEMBER_RATES.LU).toBe(17);
    expect(EU_MEMBER_RATES.FI).toBe(25.5);
  });
});

describe('isEuMember', () => {
  it('returns true for EU members (case-insensitive)', () => {
    expect(isEuMember('DE')).toBe(true);
    expect(isEuMember('de')).toBe(true);
    expect(isEuMember(' fr ')).toBe(true);
  });

  it('returns false for GB (not EU)', () => {
    expect(isEuMember('GB')).toBe(false);
  });

  it('returns false for non-EU', () => {
    expect(isEuMember('US')).toBe(false);
    expect(isEuMember('')).toBe(false);
    expect(isEuMember('ZZ')).toBe(false);
  });
});

describe('euStandardRate', () => {
  it('returns the member standard rate', () => {
    expect(euStandardRate('DE')).toBe(19);
    expect(euStandardRate('FR')).toBe(20);
    expect(euStandardRate('IE')).toBe(23);
    expect(euStandardRate('de')).toBe(19);
  });

  it('returns null for unknown / non-EU', () => {
    expect(euStandardRate('GB')).toBeNull();
    expect(euStandardRate('US')).toBeNull();
    expect(euStandardRate('ZZ')).toBeNull();
  });
});

describe('parseVatNumber', () => {
  it('parses a valid German VAT number', () => {
    const r = parseVatNumber('DE123456789');
    expect(r.country).toBe('DE');
    expect(r.number).toBe('123456789');
    expect(r.valid).toBe(true);
  });

  it('strips spaces and uppercases', () => {
    const r = parseVatNumber('de 123 456 789');
    expect(r.country).toBe('DE');
    expect(r.number).toBe('123456789');
    expect(r.valid).toBe(true);
  });

  it('parses a valid French VAT number (11 alnum)', () => {
    const r = parseVatNumber('FR12345678901');
    expect(r.country).toBe('FR');
    expect(r.valid).toBe(true);
  });

  it('parses a valid Irish VAT number (8-9 alnum)', () => {
    expect(parseVatNumber('IE1234567X').valid).toBe(true);
    expect(parseVatNumber('IE1234567XY').valid).toBe(true);
  });

  it('parses a valid Dutch VAT number (9 digits + B + 2 digits)', () => {
    const r = parseVatNumber('NL123456789B01');
    expect(r.country).toBe('NL');
    expect(r.valid).toBe(true);
  });

  it('parses a valid GB VAT number (9 or 12 digits)', () => {
    expect(parseVatNumber('GB123456789').valid).toBe(true);
    expect(parseVatNumber('GB123456789012').valid).toBe(true);
  });

  it('rejects a bad country prefix', () => {
    const r = parseVatNumber('ZZ123456789');
    expect(r.country).toBe('ZZ');
    expect(r.valid).toBe(false);
  });

  it('rejects too-short numbers', () => {
    expect(parseVatNumber('DE12').valid).toBe(false);
    expect(parseVatNumber('NL123').valid).toBe(false);
  });

  it('rejects empty / undersized input', () => {
    expect(parseVatNumber('').valid).toBe(false);
    expect(parseVatNumber('D').valid).toBe(false);
  });
});

describe('isReverseCharge', () => {
  it('is true for cross-border EU B2B with valid customer VAT', () => {
    expect(
      isReverseCharge({ supplierCountry: 'DE', customerCountry: 'FR', customerVatValid: true })
    ).toBe(true);
  });

  it('is false for domestic (same country)', () => {
    expect(
      isReverseCharge({ supplierCountry: 'DE', customerCountry: 'DE', customerVatValid: true })
    ).toBe(false);
  });

  it('is false when customer is non-EU', () => {
    expect(
      isReverseCharge({ supplierCountry: 'DE', customerCountry: 'US', customerVatValid: true })
    ).toBe(false);
  });

  it('is false when customer has no valid VAT number', () => {
    expect(
      isReverseCharge({ supplierCountry: 'DE', customerCountry: 'FR', customerVatValid: false })
    ).toBe(false);
  });

  it('is false when supplier is non-EU', () => {
    expect(
      isReverseCharge({ supplierCountry: 'US', customerCountry: 'FR', customerVatValid: true })
    ).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(
      isReverseCharge({ supplierCountry: 'de', customerCountry: 'fr', customerVatValid: true })
    ).toBe(true);
  });
});
