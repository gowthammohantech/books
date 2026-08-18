import { describe, it, expect, vi } from 'vitest';
import { seedPackTaxRates } from './seedPackTaxRates';

function fakeTx() {
  const rates: Array<Record<string, unknown>> = [];
  return {
    rates,
    taxGroup: {
      findFirst: vi.fn(async () => ({ id: 'no-tax-group' })),
      create: vi.fn(async () => ({ id: 'no-tax-group' })),
    },
    taxRate: {
      findFirst: vi.fn(async (args: unknown) => {
        const w = (args as { where: { userId: string; name: string } }).where;
        const hit = rates.find((r) => r.userId === w.userId && r.name === w.name);
        return hit ? { id: 'existing' } : null;
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        rates.push(args.data);
        return { id: `r-${rates.length}` };
      }),
    },
  };
}

describe('seedPackTaxRates — IN pack (unified tax)', () => {
  it('seeds the four kind-less GST slabs + the No Tax row', async () => {
    const tx = fakeTx();
    await seedPackTaxRates(tx as never, 'u1', 'IN', 'GST_INDIA');
    expect(tx.rates.map((r) => r.name)).toEqual(['GST 5%', 'GST 12%', 'GST 18%', 'GST 28%', 'No Tax 0%']);
    const gst = tx.rates.filter((r) => r.name !== 'No Tax 0%');
    // Kind-less: the engine owns the CGST/SGST vs IGST split at resolve time.
    expect(gst.every((r) => r.taxKind === undefined)).toBe(true);
    expect(gst.every((r) => r.regime === 'GST_INDIA')).toBe(true);
  });

  it('is idempotent — re-applying the pack creates nothing new', async () => {
    const tx = fakeTx();
    await seedPackTaxRates(tx as never, 'u1', 'IN', 'GST_INDIA');
    await seedPackTaxRates(tx as never, 'u1', 'IN', 'GST_INDIA');
    expect(tx.rates).toHaveLength(5);
  });

  it('UK pack unchanged (regression)', async () => {
    const tx = fakeTx();
    await seedPackTaxRates(tx as never, 'u1', 'GB', 'VAT_UK');
    expect(tx.rates.map((r) => r.name)).toEqual(['VAT Standard 20%', 'VAT Reduced 5%', 'VAT Zero 0%', 'No Tax 0%']);
  });
});
