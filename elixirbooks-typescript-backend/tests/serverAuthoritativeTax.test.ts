import { describe, it, expect } from 'vitest';
import {
  isFlatRegime,
  recomputeServerTax,
  resolveSupplierCountry,
  resolveCustomerTaxContext,
  OSS_NOTE,
} from '../lib/tax/serverAuthoritativeTax';
import { REVERSE_CHARGE_NOTE } from '../lib/taxEngine';
import { computeDocumentTotals } from '../lib/documentTotals';

/**
 * Task 5 — server-authoritative invoice tax recompute for the flat per-country
 * regimes (VAT_UK / VAT_EU / GST_AU / GST_NZ), incl. EU B2B reverse-charge.
 *
 * The recompute IGNORES client-supplied tax totals and derives tax from the
 * tenant regime + supply context. Non-flat regimes return null so the caller
 * keeps the existing (GST_INDIA/US/VAT_GENERIC) behaviour.
 */

describe('isFlatRegime', () => {
  it('is true for the four tax-pack regimes only', () => {
    expect(isFlatRegime('VAT_UK')).toBe(true);
    expect(isFlatRegime('VAT_EU')).toBe(true);
    expect(isFlatRegime('GST_AU')).toBe(true);
    expect(isFlatRegime('GST_NZ')).toBe(true);
    expect(isFlatRegime('GST_INDIA')).toBe(false);
    expect(isFlatRegime('US_SALES_TAX')).toBe(false);
    expect(isFlatRegime('VAT_GENERIC')).toBe(false);
    expect(isFlatRegime('NONE')).toBe(false);
    expect(isFlatRegime(null)).toBe(false);
  });
});

describe('recomputeServerTax — non-flat regimes', () => {
  it('returns null for GST_INDIA / US / VAT_GENERIC / NONE (no recompute)', () => {
    const items = [{ qty: 1, rate: 100 }];
    expect(recomputeServerTax({ regime: 'GST_INDIA', items })).toBeNull();
    expect(recomputeServerTax({ regime: 'US_SALES_TAX', items })).toBeNull();
    expect(recomputeServerTax({ regime: 'VAT_GENERIC', items })).toBeNull();
    expect(recomputeServerTax({ regime: 'NONE', items })).toBeNull();
  });
});

describe('recomputeServerTax — GST_AU / GST_NZ', () => {
  it('AU charges 10% regardless of any client tax', () => {
    const out = recomputeServerTax({
      regime: 'GST_AU',
      items: [{ qty: 2, rate: 50, tax: 999 }], // client tax is ignored
    });
    expect(out).not.toBeNull();
    expect(out!.totalTax).toBe(10); // 100 net * 10%
    expect(out!.reverseCharge).toBe(false);
    expect(out!.note).toBeNull();
  });

  it('NZ charges 15%', () => {
    const out = recomputeServerTax({ regime: 'GST_NZ', items: [{ qty: 1, rate: 100 }] });
    expect(out!.totalTax).toBe(15);
  });

  it('applies per-line discount to the taxable base', () => {
    const out = recomputeServerTax({ regime: 'GST_AU', items: [{ qty: 1, rate: 100, discount: 20 }] });
    expect(out!.totalTax).toBe(8); // (100 - 20) * 10%
  });
});

describe('recomputeServerTax — VAT_UK per-line rates', () => {
  it('uses the line tax rate when supplied, default 20% otherwise', () => {
    const out = recomputeServerTax({
      regime: 'VAT_UK',
      items: [
        { qty: 1, rate: 100 }, // default standard 20 -> 20
        { qty: 1, rate: 100, tax: 5 }, // reduced 5 -> 5
        { qty: 1, rate: 100, tax: 0 }, // zero -> 0
      ],
    });
    expect(out!.totalTax).toBe(25); // 20 + 5 + 0
    expect(out!.reverseCharge).toBe(false);
  });

  it('clamps a client-supplied UK line rate outside {0,5,20} to the 20% standard', () => {
    const out = recomputeServerTax({
      regime: 'VAT_UK',
      // Spoofed 1% and 17.5% must be rejected and snapped to 20.
      items: [
        { qty: 1, rate: 100, tax: 1 }, // -> 20
        { qty: 1, rate: 100, tax: 17.5 }, // -> 20
        { qty: 1, rate: 100, tax: 5 }, // allowed -> 5
      ],
    });
    expect(out!.totalTax).toBe(45); // 20 + 20 + 5
  });
});

describe('recomputeServerTax — VAT_EU', () => {
  it('domestic supply charges the supplier member rate (DE 19%)', () => {
    const out = recomputeServerTax({
      regime: 'VAT_EU',
      items: [{ qty: 1, rate: 100 }],
      supplierCountry: 'DE',
      customerCountry: 'DE',
      customerVatNumber: 'DE123456789',
    });
    expect(out!.totalTax).toBe(19);
    expect(out!.reverseCharge).toBe(false);
    expect(out!.note).toBeNull();
  });

  it('cross-border B2B with a valid customer VAT -> 0 + reverse-charge note', () => {
    const out = recomputeServerTax({
      regime: 'VAT_EU',
      items: [{ qty: 1, rate: 100 }],
      supplierCountry: 'DE',
      customerCountry: 'FR',
      customerVatNumber: 'FR12345678901', // valid FR format
    });
    expect(out!.totalTax).toBe(0);
    expect(out!.reverseCharge).toBe(true);
    expect(out!.note).toBe(REVERSE_CHARGE_NOTE);
  });

  it('cross-border WITHOUT a valid VAT -> normal supplier rate (no reverse charge)', () => {
    const out = recomputeServerTax({
      regime: 'VAT_EU',
      items: [{ qty: 1, rate: 100 }],
      supplierCountry: 'DE',
      customerCountry: 'FR',
      customerVatNumber: null,
    });
    expect(out!.totalTax).toBe(19); // DE standard
    expect(out!.reverseCharge).toBe(false);
  });

  it('non-EU customer -> supplier rate, no reverse charge', () => {
    const out = recomputeServerTax({
      regime: 'VAT_EU',
      items: [{ qty: 1, rate: 100 }],
      supplierCountry: 'DE',
      customerCountry: 'US',
      customerVatNumber: 'US999',
    });
    expect(out!.totalTax).toBe(19);
    expect(out!.reverseCharge).toBe(false);
  });
});

describe('recomputeServerTax — VAT_EU OSS (destination rate)', () => {
  it('B2C cross-border, OSS registered -> destination (FR 20%) + oss flag + OSS note', () => {
    const out = recomputeServerTax({
      regime: 'VAT_EU',
      items: [{ qty: 1, rate: 100 }],
      supplierCountry: 'DE',
      customerCountry: 'FR',
      customerVatNumber: null, // B2C: no valid VAT
      ossRegistered: true,
    });
    expect(out!.totalTax).toBe(20);
    expect(out!.reverseCharge).toBe(false);
    expect(out!.oss).toBe(true);
    expect(out!.note).toBe(OSS_NOTE);
  });

  it('B2C cross-border, OSS NOT registered -> origin (DE 19%), no oss flag', () => {
    const out = recomputeServerTax({
      regime: 'VAT_EU',
      items: [{ qty: 1, rate: 100 }],
      supplierCountry: 'DE',
      customerCountry: 'FR',
      customerVatNumber: null,
      ossRegistered: false,
    });
    expect(out!.totalTax).toBe(19);
    expect(out!.oss).toBe(false);
    expect(out!.note).toBeNull();
  });

  it('B2B cross-border (valid VAT) -> reverse-charge 0 even with OSS registered', () => {
    const out = recomputeServerTax({
      regime: 'VAT_EU',
      items: [{ qty: 1, rate: 100 }],
      supplierCountry: 'DE',
      customerCountry: 'FR',
      customerVatNumber: 'FR12345678901',
      ossRegistered: true,
    });
    expect(out!.totalTax).toBe(0);
    expect(out!.reverseCharge).toBe(true);
    expect(out!.oss).toBe(false);
    expect(out!.note).toBe(REVERSE_CHARGE_NOTE);
  });

  it('domestic DE->DE with OSS registered -> supplier rate 19, no oss flag', () => {
    const out = recomputeServerTax({
      regime: 'VAT_EU',
      items: [{ qty: 1, rate: 100 }],
      supplierCountry: 'DE',
      customerCountry: 'DE',
      customerVatNumber: null,
      ossRegistered: true,
    });
    expect(out!.totalTax).toBe(19);
    expect(out!.oss).toBe(false);
  });
});

describe('resolveSupplierCountry', () => {
  const fakeTx = {
    country: {
      findUnique: async () => ({ iso2: 'GB' }),
    },
  };

  it('prefers countryCode', async () => {
    const c = await resolveSupplierCountry(fakeTx, { countryCode: 'de', countryId: 'x', country: 'Germany' });
    expect(c).toBe('DE');
  });

  it('falls back to countryId -> iso2', async () => {
    const c = await resolveSupplierCountry(fakeTx, { countryCode: null, countryId: 'x', country: 'United Kingdom' });
    expect(c).toBe('GB');
  });

  it('falls back to a 2-letter country string', async () => {
    const noFk = { country: { findUnique: async () => null } };
    const c = await resolveSupplierCountry(noFk, { countryCode: null, countryId: null, country: 'fr' });
    expect(c).toBe('FR');
  });

  it('returns null for an unmappable country', async () => {
    const noFk = { country: { findUnique: async () => null } };
    const c = await resolveSupplierCountry(noFk, { countryCode: null, countryId: null, country: 'Germany' });
    expect(c).toBeNull();
  });

  it('treats a legacy literal countryCode:"EU" as non-resolvable and falls through to countryId -> iso2 (the real member)', async () => {
    // This is THE bug fix: countryCode:'EU' passes ^[A-Z]{2}$ but is NOT a member.
    const deTx = { country: { findUnique: async () => ({ iso2: 'DE' }) } };
    const c = await resolveSupplierCountry(deTx, { countryCode: 'EU', countryId: 'de-id', country: 'Germany' });
    expect(c).toBe('DE'); // resolves the REAL member, not 'EU'
  });

  it('never returns the literal "EU" even when it is the only value', async () => {
    const noFk = { country: { findUnique: async () => null } };
    const c = await resolveSupplierCountry(noFk, { countryCode: 'EU', countryId: null, country: 'EU' });
    expect(c).toBeNull();
  });
});

describe('VAT_EU end-to-end — real member state drives the rate (regression for the EU go-live bug)', () => {
  it('DE supplier domestic supply computes 19% (not 0)', () => {
    const out = recomputeServerTax({
      regime: 'VAT_EU',
      items: [{ qty: 1, rate: 100 }],
      supplierCountry: 'DE',
      customerCountry: 'DE',
    });
    expect(out!.totalTax).toBe(19);
    expect(out!.reverseCharge).toBe(false);
  });

  it('FR supplier domestic supply computes 20%', () => {
    const out = recomputeServerTax({
      regime: 'VAT_EU',
      items: [{ qty: 1, rate: 100 }],
      supplierCountry: 'FR',
      customerCountry: 'FR',
    });
    expect(out!.totalTax).toBe(20);
  });

  it('a literal "EU" supplier (the old bug) yields 0% — proving why resolveSupplierCountry must not return it', () => {
    const out = recomputeServerTax({
      regime: 'VAT_EU',
      items: [{ qty: 1, rate: 100 }],
      supplierCountry: 'EU',
      customerCountry: 'EU',
    });
    expect(out!.totalTax).toBe(0); // euStandardRate('EU') is null -> 0 (the bug)
  });
});

describe('resolveCustomerTaxContext — field-choice (new fields preferred)', () => {
  const fakeTx = { country: { findUnique: async () => ({ iso2: 'NL' }) } };

  it('prefers new country + vatNumber over legacy', async () => {
    const ctx = await resolveCustomerTaxContext(fakeTx, {
      country: 'FR',
      countryId: 'x',
      vatNumber: 'FR12345678901',
      vatRegNumber: 'GB999',
    });
    expect(ctx.customerCountry).toBe('FR');
    expect(ctx.customerVatNumber).toBe('FR12345678901');
  });

  it('falls back to countryId -> iso2 and legacy vatRegNumber', async () => {
    const ctx = await resolveCustomerTaxContext(fakeTx, {
      country: null,
      countryId: 'x',
      vatNumber: null,
      vatRegNumber: 'NL123456789B01',
    });
    expect(ctx.customerCountry).toBe('NL');
    expect(ctx.customerVatNumber).toBe('NL123456789B01');
  });
});

describe('recomputeServerTax — taxable base matches documentTotals (bug fix)', () => {
  // Bug: the flat-regime recompute derived its taxable base from the legacy
  // absolute `discount` field only. A line using the NEW structured
  // discount_value/discount_type (percent/fixed) was taxed on the UNdiscounted
  // gross while computeDocumentTotals' persisted total subtracted the real
  // discount -> VAT overstated and the document internally inconsistent.
  it('VAT_UK: a structured PERCENT discount is honoured — tax is computed on the discounted base, matching computeDocumentTotals', () => {
    const items = [{ qty: 2, rate: 100, discount_type: 'Percentage', discount_value: 10, tax: 20 }];

    // documentTotals' own per-line taxable base (the ground truth this recompute must match).
    const totals = computeDocumentTotals(items);
    expect(totals.perLine[0].taxable).toBe(180); // (2*100) - 10% = 180

    const out = recomputeServerTax({ regime: 'VAT_UK', items });
    // Before the fix this was 40 (20% of the undiscounted 200 gross).
    expect(out!.totalTax).toBe(36); // 20% of the discounted 180 base
    expect(out!.totalTax).toBe(round2Pct(totals.perLine[0].taxable, 20));
  });

  it('GST_AU: a structured FIXED discount is honoured — tax is computed on the discounted base', () => {
    const items = [{ qty: 1, rate: 100, discount_type: 'Fixed', discount_value: 30 }];
    const totals = computeDocumentTotals(items);
    expect(totals.perLine[0].taxable).toBe(70);

    const out = recomputeServerTax({ regime: 'GST_AU', items });
    expect(out!.totalTax).toBe(7); // 10% of the discounted 70 base
  });

  it('legacy absolute `discount` (no discount_value/discount_type): unchanged result vs before the fix (pinned)', () => {
    // Same case as the pre-existing "applies per-line discount to the taxable
    // base" test above — pinned again here explicitly as the fix's regression
    // guard: legacy payloads carrying ONLY the absolute `discount` field must
    // produce byte-identical output to the pre-fix behaviour.
    const items = [{ qty: 1, rate: 100, discount: 20 }];
    const totals = computeDocumentTotals(items);
    expect(totals.perLine[0].taxable).toBe(80); // matches the helper's legacy fallback

    const out = recomputeServerTax({ regime: 'GST_AU', items });
    expect(out!.totalTax).toBe(8); // (100 - 20) * 10% — same figure as pre-fix
  });
});

function round2Pct(base: number, pct: number): number {
  return Math.round((base * pct) / 100 * 100) / 100;
}
