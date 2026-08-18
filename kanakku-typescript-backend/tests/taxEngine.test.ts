import { describe, it, expect } from 'vitest';
import { computeRegimeTax, computeLineTaxes } from '../lib/taxEngine';

/**
 * Task 3 — per-country tax computation in the engine.
 *
 * `computeRegimeTax` is the new, library-row-free compute path for the flat
 * per-country regimes (AU/NZ/UK/EU). It is backward-compatible: existing
 * GST_INDIA / US_SALES_TAX / VAT_GENERIC flows still go through the
 * suggest/resolve/computeLineTaxes path (library TaxRate rows) untouched.
 */

describe('computeRegimeTax — GST_AU', () => {
  it('charges 10% GST', () => {
    const out = computeRegimeTax({ regime: 'GST_AU', taxableAmount: 100 });
    expect(out.totalTax).toBe(10);
    expect(out.rate).toBe(10);
    expect(out.reverseCharge).toBe(false);
    expect(out.note).toBeUndefined();
  });
});

describe('computeRegimeTax — GST_NZ', () => {
  it('charges 15% GST', () => {
    const out = computeRegimeTax({ regime: 'GST_NZ', taxableAmount: 100 });
    expect(out.totalTax).toBe(15);
    expect(out.rate).toBe(15);
    expect(out.reverseCharge).toBe(false);
  });
});

describe('computeRegimeTax — VAT_UK', () => {
  it('defaults to the 20% standard rate when no per-line rate is given', () => {
    const out = computeRegimeTax({ regime: 'VAT_UK', taxableAmount: 100 });
    expect(out.totalTax).toBe(20);
    expect(out.rate).toBe(20);
  });

  it('honours an explicit standard rate of 20', () => {
    const out = computeRegimeTax({ regime: 'VAT_UK', taxableAmount: 100, lineRate: 20 });
    expect(out.totalTax).toBe(20);
    expect(out.rate).toBe(20);
  });

  it('honours a reduced rate of 5', () => {
    const out = computeRegimeTax({ regime: 'VAT_UK', taxableAmount: 100, lineRate: 5 });
    expect(out.totalTax).toBe(5);
    expect(out.rate).toBe(5);
  });

  it('honours a zero-rated line (rate 0 → tax 0)', () => {
    const out = computeRegimeTax({ regime: 'VAT_UK', taxableAmount: 100, lineRate: 0 });
    expect(out.totalTax).toBe(0);
    expect(out.rate).toBe(0);
  });
});

describe('computeRegimeTax — VAT_EU', () => {
  it('domestic DE supply → 19% standard rate', () => {
    const out = computeRegimeTax({
      regime: 'VAT_EU',
      taxableAmount: 100,
      supplierCountry: 'DE',
      customerCountry: 'DE',
      customerVatValid: true,
    });
    expect(out.totalTax).toBe(19);
    expect(out.rate).toBe(19);
    expect(out.reverseCharge).toBe(false);
    expect(out.note).toBeUndefined();
  });

  it('cross-border B2B (supplier DE, customer FR, valid VAT) → 0 + reverseCharge', () => {
    const out = computeRegimeTax({
      regime: 'VAT_EU',
      taxableAmount: 100,
      supplierCountry: 'DE',
      customerCountry: 'FR',
      customerVatValid: true,
    });
    expect(out.totalTax).toBe(0);
    expect(out.rate).toBe(0);
    expect(out.reverseCharge).toBe(true);
    expect(out.note).toBe('Reverse charge — VAT to be accounted for by the recipient');
  });

  it('cross-border with no/invalid customer VAT → normal supplier rate (19)', () => {
    const out = computeRegimeTax({
      regime: 'VAT_EU',
      taxableAmount: 100,
      supplierCountry: 'DE',
      customerCountry: 'FR',
      customerVatValid: false,
    });
    expect(out.totalTax).toBe(19);
    expect(out.rate).toBe(19);
    expect(out.reverseCharge).toBe(false);
  });

  it('falls back to 0 when the supplier country is not an EU member', () => {
    const out = computeRegimeTax({
      regime: 'VAT_EU',
      taxableAmount: 100,
      supplierCountry: 'US',
      customerCountry: 'US',
      customerVatValid: false,
    });
    expect(out.totalTax).toBe(0);
    expect(out.rate).toBe(0);
  });
});

describe('computeRegimeTax — VAT_EU OSS (destination rate)', () => {
  it('cross-border B2C, OSS registered → destination (FR) rate 20 + oss marker', () => {
    const out = computeRegimeTax({
      regime: 'VAT_EU',
      taxableAmount: 100,
      supplierCountry: 'DE',
      customerCountry: 'FR',
      customerVatValid: false,
      ossRegistered: true,
    });
    expect(out.rate).toBe(20);
    expect(out.totalTax).toBe(20);
    expect(out.reverseCharge).toBe(false);
    expect(out.oss).toBe(true);
  });

  it('cross-border B2C, OSS NOT registered → origin (DE) rate 19, no oss marker', () => {
    const out = computeRegimeTax({
      regime: 'VAT_EU',
      taxableAmount: 100,
      supplierCountry: 'DE',
      customerCountry: 'FR',
      customerVatValid: false,
      ossRegistered: false,
    });
    expect(out.rate).toBe(19);
    expect(out.totalTax).toBe(19);
    expect(out.reverseCharge).toBe(false);
    expect(out.oss).toBeFalsy();
  });

  it('cross-border B2B (valid VAT) → reverse-charge 0 even when OSS registered', () => {
    const out = computeRegimeTax({
      regime: 'VAT_EU',
      taxableAmount: 100,
      supplierCountry: 'DE',
      customerCountry: 'FR',
      customerVatValid: true,
      ossRegistered: true,
    });
    expect(out.rate).toBe(0);
    expect(out.totalTax).toBe(0);
    expect(out.reverseCharge).toBe(true);
    expect(out.oss).toBeFalsy();
  });

  it('domestic DE→DE → supplier rate 19 even when OSS registered', () => {
    const out = computeRegimeTax({
      regime: 'VAT_EU',
      taxableAmount: 100,
      supplierCountry: 'DE',
      customerCountry: 'DE',
      customerVatValid: false,
      ossRegistered: true,
    });
    expect(out.rate).toBe(19);
    expect(out.totalTax).toBe(19);
    expect(out.oss).toBeFalsy();
  });

  it('non-EU customer with OSS registered → unchanged supplier (DE) rate 19', () => {
    const out = computeRegimeTax({
      regime: 'VAT_EU',
      taxableAmount: 100,
      supplierCountry: 'DE',
      customerCountry: 'US',
      customerVatValid: false,
      ossRegistered: true,
    });
    expect(out.rate).toBe(19);
    expect(out.totalTax).toBe(19);
    expect(out.oss).toBeFalsy();
  });
});

describe('computeRegimeTax — backward-compatible defaults', () => {
  it('NONE → no tax', () => {
    const out = computeRegimeTax({ regime: 'NONE', taxableAmount: 100 });
    expect(out.totalTax).toBe(0);
    expect(out.rate).toBe(0);
  });

  it('is decimal-safe (10% of 99.99 = 10.00 rounded)', () => {
    const out = computeRegimeTax({ regime: 'GST_AU', taxableAmount: 99.99 });
    expect(out.totalTax).toBe(10);
  });
});

describe('existing computeLineTaxes is unchanged', () => {
  it('still computes a library-rate VAT line at 19%', () => {
    const out = computeLineTaxes({
      qty: 1,
      rate: 100,
      appliedTaxes: [{ id: 'r1', name: 'VAT 19%', taxKind: 'VAT', rate: 19 }],
    });
    expect(out.taxableAmount).toBe(100);
    expect(out.totalTax).toBe(19);
    expect(out.lineTotal).toBe(119);
  });
});
