import { describe, it, expect } from 'vitest';
import { computeLineTaxes, suggestTaxesForLine, resolveLineTaxes, splitGstRate, isUnionTerritoryStateCode } from './taxEngine';

const rate = (id: string, kind: any, percent: number, extras: Partial<any> = {}): any => ({
  id,
  name: `${kind} ${percent}%`,
  taxKind: kind,
  rate: percent,
  regime: 'GST_INDIA',
  isActive: true,
  isDeleted: false,
  countryId: null,
  stateId: null,
  ...extras,
});

describe('computeLineTaxes', () => {
  it('computes taxable + breakdown for a 2-tax IN line (CGST + SGST)', () => {
    const out = computeLineTaxes({
      qty: 2,
      rate: 1000,
      appliedTaxes: [
        { id: 'c', name: 'CGST 9%', taxKind: 'CGST', rate: 9 },
        { id: 's', name: 'SGST 9%', taxKind: 'SGST', rate: 9 },
      ],
    });
    expect(out.taxableAmount).toBe(2000);
    expect(out.taxes).toHaveLength(2);
    expect(out.taxes[0].amount).toBe(180);
    expect(out.taxes[1].amount).toBe(180);
    expect(out.totalTax).toBe(360);
    expect(out.lineTotal).toBe(2360);
  });

  it('honors discount before tax', () => {
    const out = computeLineTaxes({
      qty: 1,
      rate: 100,
      discount: 10,
      appliedTaxes: [{ id: 'v', name: 'VAT 20%', taxKind: 'VAT', rate: 20 }],
    });
    expect(out.taxableAmount).toBe(90);
    expect(out.totalTax).toBe(18);
    expect(out.lineTotal).toBe(108);
  });

  it('returns empty breakdown for tax-exempt lines', () => {
    const out = computeLineTaxes({ qty: 5, rate: 50, appliedTaxes: [] });
    expect(out.totalTax).toBe(0);
    expect(out.lineTotal).toBe(250);
  });
});

describe('suggestTaxesForLine', () => {
  const lib = [
    rate('cgst', 'CGST', 9),
    rate('sgst', 'SGST', 9),
    rate('utgst', 'UTGST', 9),
    rate('igst', 'IGST', 18),
    rate('vat', 'VAT', 20, { regime: 'VAT_GENERIC' }),
    rate('cali', 'SALES_TAX', 7.25, { regime: 'US_SALES_TAX', stateId: 'state-ca' }),
    rate('ny', 'SALES_TAX', 8.875, { regime: 'US_SALES_TAX', stateId: 'state-ny' }),
  ];

  it('IN intra-state: returns CGST + SGST', () => {
    const out = suggestTaxesForLine({
      regime: 'GST_INDIA',
      companyCountryId: 'in',
      companyStateId: 'tn',
      customerCountryId: 'in',
      customerStateId: 'tn',
      libraryRates: lib,
    });
    expect(out.map((r) => r.taxKind)).toEqual(['CGST', 'SGST']);
  });

  it('IN inter-state: returns IGST', () => {
    const out = suggestTaxesForLine({
      regime: 'GST_INDIA',
      companyCountryId: 'in',
      companyStateId: 'tn',
      customerCountryId: 'in',
      customerStateId: 'ka',
      libraryRates: lib,
    });
    expect(out.map((r) => r.taxKind)).toEqual(['IGST']);
  });

  it('IN intra-UT: prefers UTGST over SGST', () => {
    const libUT = lib.filter((r) => r.taxKind !== 'SGST');
    const out = suggestTaxesForLine({
      regime: 'GST_INDIA',
      companyCountryId: 'in',
      companyStateId: 'dl',
      customerCountryId: 'in',
      customerStateId: 'dl',
      libraryRates: libUT,
    });
    expect(out.map((r) => r.taxKind)).toEqual(['CGST', 'UTGST']);
  });

  it('VAT_GENERIC: returns the VAT rate', () => {
    const out = suggestTaxesForLine({
      regime: 'VAT_GENERIC',
      companyCountryId: 'gb',
      companyStateId: null,
      customerCountryId: 'gb',
      customerStateId: null,
      libraryRates: lib,
    });
    expect(out.map((r) => r.taxKind)).toEqual(['VAT']);
  });

  it('US_SALES_TAX: returns the destination-state rate', () => {
    const out = suggestTaxesForLine({
      regime: 'US_SALES_TAX',
      companyCountryId: 'us',
      companyStateId: 'state-ca',
      customerCountryId: 'us',
      customerStateId: 'state-ny',
      libraryRates: lib,
    });
    expect(out.map((r) => r.id)).toEqual(['ny']);
  });

  it('US_SALES_TAX: returns empty if no customer state', () => {
    const out = suggestTaxesForLine({
      regime: 'US_SALES_TAX',
      companyCountryId: 'us',
      companyStateId: 'state-ca',
      customerCountryId: 'us',
      customerStateId: null,
      libraryRates: lib,
    });
    expect(out).toEqual([]);
  });

  it('NONE regime: always empty', () => {
    const out = suggestTaxesForLine({
      regime: 'NONE',
      companyCountryId: 'in',
      companyStateId: 'tn',
      customerCountryId: 'in',
      customerStateId: 'tn',
      libraryRates: lib,
    });
    expect(out).toEqual([]);
  });
});

const RATES = [
  { id: 'cgst9', name: 'CGST 9%', taxKind: 'CGST', rate: 9, regime: 'GST_INDIA', stateId: null, isActive: true, isDeleted: false },
  { id: 'sgst9', name: 'SGST 9%', taxKind: 'SGST', rate: 9, regime: 'GST_INDIA', stateId: null, isActive: true, isDeleted: false },
  { id: 'igst18', name: 'IGST 18%', taxKind: 'IGST', rate: 18, regime: 'GST_INDIA', stateId: null, isActive: true, isDeleted: false },
] as any;

describe('resolveLineTaxes (GST)', () => {
  it('same state -> CGST + SGST', () => {
    const out = resolveLineTaxes({ taxableAmount: 100, regime: 'GST_INDIA', companyStateId: 's1', partyStateId: 's1', companyCountryId: 'in', partyCountryId: 'in', libraryRates: RATES });
    expect(out.taxes.map(t => t.kind).sort()).toEqual(['CGST', 'SGST']);
    expect(out.totalTax).toBe(18);
  });
  it('different state -> IGST', () => {
    const out = resolveLineTaxes({ taxableAmount: 100, regime: 'GST_INDIA', companyStateId: 's1', partyStateId: 's2', companyCountryId: 'in', partyCountryId: 'in', libraryRates: RATES });
    expect(out.taxes.map(t => t.kind)).toEqual(['IGST']);
    expect(out.totalTax).toBe(18);
  });
  it('missing party state -> IGST fallback', () => {
    const out = resolveLineTaxes({ taxableAmount: 100, regime: 'GST_INDIA', companyStateId: 's1', partyStateId: null, companyCountryId: 'in', partyCountryId: 'in', libraryRates: RATES });
    expect(out.taxes.map(t => t.kind)).toEqual(['IGST']);
  });
});

describe('splitGstRate — kind-less GST synthesis (spec 2026-07-12 §4B)', () => {
  it('intra-state: CGST + SGST halves (18 → 9 + 9)', () => {
    expect(splitGstRate({ totalPercent: 18, intraState: true })).toEqual([
      { kind: 'CGST', percent: 9, name: 'CGST 9%' },
      { kind: 'SGST', percent: 9, name: 'SGST 9%' },
    ]);
  });

  it('odd slabs halve exactly (5 → 2.5 + 2.5)', () => {
    expect(splitGstRate({ totalPercent: 5, intraState: true })).toEqual([
      { kind: 'CGST', percent: 2.5, name: 'CGST 2.5%' },
      { kind: 'SGST', percent: 2.5, name: 'SGST 2.5%' },
    ]);
  });

  it('inter-state: single IGST at the full rate', () => {
    expect(splitGstRate({ totalPercent: 18, intraState: false })).toEqual([
      { kind: 'IGST', percent: 18, name: 'IGST 18%' },
    ]);
  });

  it('union territory intra: CGST + UTGST', () => {
    expect(splitGstRate({ totalPercent: 12, intraState: true, unionTerritory: true })).toEqual([
      { kind: 'CGST', percent: 6, name: 'CGST 6%' },
      { kind: 'UTGST', percent: 6, name: 'UTGST 6%' },
    ]);
  });
});

describe('isUnionTerritoryStateCode', () => {
  it('true for legislature-less UTs, false for SGST states and null', () => {
    expect(isUnionTerritoryStateCode('CH')).toBe(true);
    expect(isUnionTerritoryStateCode('an')).toBe(true);
    expect(isUnionTerritoryStateCode('TN')).toBe(false);
    expect(isUnionTerritoryStateCode('DL')).toBe(false);
    expect(isUnionTerritoryStateCode(null)).toBe(false);
  });
});
