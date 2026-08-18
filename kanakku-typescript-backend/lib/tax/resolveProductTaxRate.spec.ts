import { describe, it, expect } from 'vitest';
import { resolveProductTaxRate } from './resolveProductTaxRate';

const rate = (id: string, name: string, pct: number | string, extras: Record<string, unknown> = {}) =>
  ({ id, name, rate: pct, isActive: true, isDeleted: false, ...extras });

describe('resolveProductTaxRate — fallback chain (spec 2026-07-12 §4B)', () => {
  it('direct taxRateId wins over any group', () => {
    const out = resolveProductTaxRate({
      taxRate: rate('r1', 'GST 18%', 18),
      taxGroup: { id: 'g1', tax_name: 'Old Group', tax_rates: [rate('r2', 'VAT 20%', 20)] },
    });
    expect(out).toEqual({ taxRateId: 'r1', name: 'GST 18%', rate: 18 });
  });

  it('1-member group resolves to that member', () => {
    const out = resolveProductTaxRate({
      taxGroup: { id: 'g1', tax_name: 'VAT', tax_rates: [rate('r2', 'VAT 20%', 20)] },
    });
    expect(out).toEqual({ taxRateId: 'r2', name: 'VAT 20%', rate: 20 });
  });

  it('N-member group resolves to the summed legacy compound (taxRateId null)', () => {
    const out = resolveProductTaxRate({
      taxGroup: {
        id: 'g1', tax_name: 'GST 18%',
        tax_rates: [rate('c', 'CGST 9%', 9), rate('s', 'SGST 9%', 9)],
      },
    });
    expect(out).toEqual({ taxRateId: null, name: 'GST 18%', rate: 18 });
  });

  it('inactive/deleted members are excluded (may collapse N→1)', () => {
    const out = resolveProductTaxRate({
      taxGroup: {
        id: 'g1', tax_name: 'GST 18%',
        tax_rates: [rate('c', 'CGST 9%', 9), rate('s', 'SGST 9%', 9, { isDeleted: true })],
      },
    });
    expect(out).toEqual({ taxRateId: 'c', name: 'CGST 9%', rate: 9 });
  });

  it('empty group and no linkage both resolve to null', () => {
    expect(resolveProductTaxRate({ taxGroup: { id: 'g', tax_name: 'Empty', tax_rates: [] } })).toBeNull();
    expect(resolveProductTaxRate({})).toBeNull();
  });

  it('decimal-string rates (Prisma Decimal) are converted to numbers', () => {
    const out = resolveProductTaxRate({ taxRate: { id: 'r1', name: 'VAT 5%', rate: '5.0000' } });
    expect(out).toEqual({ taxRateId: 'r1', name: 'VAT 5%', rate: 5 });
  });

  // Cross-task finding (final review 2026-07-12 §4B): the global "No Tax"
  // TaxGroup (no userId) holds EVERY tenant's pack-seeded rates
  // (ensureDefaultTaxGroup.ts + seedPackTaxRates.ts), so a naive N>1 sum
  // returns nonsense like {name:'No Tax', rate:63}. Mirror the migration
  // script's guard (prisma/migrateTaxesToRates.ts planGroupResolution).
  it('global "No Tax" group (name match) resolves to the NONE member, never summed', () => {
    const out = resolveProductTaxRate({
      taxGroup: {
        id: 'g1',
        tax_name: 'No Tax',
        tax_rates: [
          rate('none', 'No Tax 0%', 0, { regime: 'NONE' }),
          rate('gst5', 'GST 5%', 5, { regime: 'GST' }),
          rate('gst12', 'GST 12%', 12, { regime: 'GST' }),
          rate('gst18', 'GST 18%', 18, { regime: 'GST' }),
          rate('gst28', 'GST 28%', 28, { regime: 'GST' }),
        ],
      },
    });
    expect(out).toEqual({ taxRateId: 'none', name: 'No Tax 0%', rate: 0 });
  });

  it('a group with a NONE-regime member (regime signal, not just name) also resolves to it, never summed', () => {
    const out = resolveProductTaxRate({
      taxGroup: {
        id: 'g2',
        tax_name: 'Compound Group',
        tax_rates: [
          rate('none', 'No Tax 0%', 0, { regime: 'NONE' }),
          rate('vat', 'VAT 20%', 20, { regime: 'VAT' }),
        ],
      },
    });
    expect(out).toEqual({ taxRateId: 'none', name: 'No Tax 0%', rate: 0 });
  });
});
