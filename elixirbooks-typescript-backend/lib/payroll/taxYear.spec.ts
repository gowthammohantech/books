import { describe, it, expect } from 'vitest';
import {
  taxYearFor,
  currentTaxYear,
  taxYearByLabel,
  taxMonthOf,
  listTaxYears,
  type TaxYear,
} from './taxYear';

/** Helper: parse an ISO date string as a UTC Date */
function utc(iso: string): Date {
  return new Date(iso);
}

// ---------------------------------------------------------------------------
// taxYearFor — boundary cases
// ---------------------------------------------------------------------------
describe('taxYearFor', () => {
  it('2026-04-05 → 2025/26 (one day before the flip)', () => {
    const ty = taxYearFor(utc('2026-04-05T00:00:00Z'));
    expect(ty.label).toBe('2025/26');
    expect(ty.start).toEqual(utc('2025-04-06T00:00:00.000Z'));
    expect(ty.end).toEqual(utc('2026-04-05T23:59:59.999Z'));
  });

  it('2026-04-06T00:00:00Z → 2026/27 (exact flip point)', () => {
    const ty = taxYearFor(utc('2026-04-06T00:00:00Z'));
    expect(ty.label).toBe('2026/27');
    expect(ty.start).toEqual(utc('2026-04-06T00:00:00.000Z'));
    expect(ty.end).toEqual(utc('2027-04-05T23:59:59.999Z'));
  });

  it('2026-12-31 → 2026/27 (mid-year)', () => {
    const ty = taxYearFor(utc('2026-12-31T12:00:00Z'));
    expect(ty.label).toBe('2026/27');
  });

  it('2027-04-05T23:59:59.999Z → 2026/27 (last millisecond)', () => {
    const ty = taxYearFor(utc('2027-04-05T23:59:59.999Z'));
    expect(ty.label).toBe('2026/27');
  });

  it('2027-04-06T00:00:00Z → 2027/28 (next year flip)', () => {
    const ty = taxYearFor(utc('2027-04-06T00:00:00Z'));
    expect(ty.label).toBe('2027/28');
  });
});

// ---------------------------------------------------------------------------
// currentTaxYear — delegates to taxYearFor
// ---------------------------------------------------------------------------
describe('currentTaxYear', () => {
  it('returns the same result as taxYearFor for the same date', () => {
    const now = utc('2026-06-22T10:00:00Z');
    expect(currentTaxYear(now)).toEqual(taxYearFor(now));
  });
});

// ---------------------------------------------------------------------------
// taxYearByLabel — parsing + validation
// ---------------------------------------------------------------------------
describe('taxYearByLabel', () => {
  it('2026/27 → start=2026-04-06, end=2027-04-05', () => {
    const ty = taxYearByLabel('2026/27');
    expect(ty.label).toBe('2026/27');
    expect(ty.start).toEqual(utc('2026-04-06T00:00:00.000Z'));
    expect(ty.end).toEqual(utc('2027-04-05T23:59:59.999Z'));
  });

  it('2009/10 — century wrap short-year', () => {
    const ty = taxYearByLabel('2009/10');
    expect(ty.label).toBe('2009/10');
    expect(ty.start.getUTCFullYear()).toBe(2009);
    expect(ty.end.getUTCFullYear()).toBe(2010);
  });

  it('1999/00 — millennium wrap short-year', () => {
    const ty = taxYearByLabel('1999/00');
    expect(ty.label).toBe('1999/00');
    expect(ty.start.getUTCFullYear()).toBe(1999);
    expect(ty.end.getUTCFullYear()).toBe(2000);
  });

  it('throws on bad format "2026-27"', () => {
    expect(() => taxYearByLabel('2026-27')).toThrow('Invalid tax year label');
  });

  it('throws on empty string', () => {
    expect(() => taxYearByLabel('')).toThrow('Invalid tax year label');
  });

  it('throws on inconsistent short year "2026/28"', () => {
    expect(() => taxYearByLabel('2026/28')).toThrow('Invalid tax year label');
  });

  it('throws on wrong digit count "26/27"', () => {
    expect(() => taxYearByLabel('26/27')).toThrow('Invalid tax year label');
  });
});

// ---------------------------------------------------------------------------
// taxMonthOf — boundary cases
// ---------------------------------------------------------------------------
describe('taxMonthOf', () => {
  it('2026-04-06 → month 1 (first day of tax year)', () => {
    expect(taxMonthOf(utc('2026-04-06T00:00:00Z'))).toBe(1);
  });

  it('2026-05-05T23:59:59.999Z → month 1 (last ms of month 1)', () => {
    expect(taxMonthOf(utc('2026-05-05T23:59:59.999Z'))).toBe(1);
  });

  it('2026-05-06T00:00:00Z → month 2 (first ms of month 2)', () => {
    expect(taxMonthOf(utc('2026-05-06T00:00:00Z'))).toBe(2);
  });

  it('2026-06-06 → month 3', () => {
    expect(taxMonthOf(utc('2026-06-06T00:00:00Z'))).toBe(3);
  });

  it('2027-03-06 → month 12 (first day of last tax month)', () => {
    expect(taxMonthOf(utc('2027-03-06T00:00:00Z'))).toBe(12);
  });

  it('2027-04-05T23:59:59.999Z → month 12 (last ms of tax year)', () => {
    expect(taxMonthOf(utc('2027-04-05T23:59:59.999Z'))).toBe(12);
  });

  it('2027-03-05T23:59:59Z → month 11 (last ms before month 12)', () => {
    expect(taxMonthOf(utc('2027-03-05T23:59:59.999Z'))).toBe(11);
  });

  it('2026-12-31 → month 9 (Dec = 6Dec-5Jan = month 9)', () => {
    // Apr=1, May=2, Jun=3, Jul=4, Aug=5, Sep=6, Oct=7, Nov=8, Dec=9
    expect(taxMonthOf(utc('2026-12-31T00:00:00Z'))).toBe(9);
  });

  it('2027-01-05T23:59:59Z → month 9 (still in Dec window, before 6 Jan)', () => {
    expect(taxMonthOf(utc('2027-01-05T23:59:59Z'))).toBe(9);
  });

  it('2027-01-06 → month 10', () => {
    expect(taxMonthOf(utc('2027-01-06T00:00:00Z'))).toBe(10);
  });

  it('accepts optional pre-computed TaxYear', () => {
    const ty = taxYearByLabel('2026/27');
    expect(taxMonthOf(utc('2026-04-06T00:00:00Z'), ty)).toBe(1);
    expect(taxMonthOf(utc('2027-04-05T23:59:59.999Z'), ty)).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// listTaxYears
// ---------------------------------------------------------------------------
describe('listTaxYears', () => {
  it('returns 3 years most-recent-first', () => {
    const ty = taxYearByLabel('2026/27');
    const result = listTaxYears(ty, 3);
    expect(result).toHaveLength(3);
    expect(result.map((r: TaxYear) => r.label)).toEqual(['2026/27', '2025/26', '2024/25']);
  });

  it('returns 1 year correctly', () => {
    const ty = taxYearByLabel('2025/26');
    const result = listTaxYears(ty, 1);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('2025/26');
  });

  it('returns 5 years ending at 2026/27', () => {
    const ty = taxYearByLabel('2026/27');
    const result = listTaxYears(ty, 5);
    expect(result.map((r: TaxYear) => r.label)).toEqual([
      '2026/27', '2025/26', '2024/25', '2023/24', '2022/23',
    ]);
  });

  it('each returned TaxYear has correct start/end dates', () => {
    const ty = taxYearByLabel('2026/27');
    const result = listTaxYears(ty, 2);
    expect(result[0].start).toEqual(utc('2026-04-06T00:00:00.000Z'));
    expect(result[0].end).toEqual(utc('2027-04-05T23:59:59.999Z'));
    expect(result[1].start).toEqual(utc('2025-04-06T00:00:00.000Z'));
    expect(result[1].end).toEqual(utc('2026-04-05T23:59:59.999Z'));
  });
});
