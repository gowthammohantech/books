import { describe, it, expect } from 'vitest';
import { resolvePackCode } from '../lib/ledger/resolvePackCode';
import { applyPack, type ApplyPackTx } from '../lib/ledger/applyPack';

/**
 * EU go-live regression: an EU member country selected at onboarding must
 *   1. route to the generic VAT_EU pack (NOT fall back to the UK 'GB' pack), and
 *   2. persist the tenant's REAL member ISO-2 (e.g. 'DE') on CompanySettings
 *      (NOT the literal 'EU'), so the invoice tax engine resolves the member
 *      standard rate + reverse-charge correctly.
 */

describe('resolvePackCode — EU member routing', () => {
  it('routes EU members to the EU pack (not GB)', () => {
    expect(resolvePackCode('DE')).toBe('EU');
    expect(resolvePackCode('FR')).toBe('EU');
    expect(resolvePackCode('nl')).toBe('EU'); // case-insensitive
  });

  it('keeps non-EU packs as their own ISO-2', () => {
    expect(resolvePackCode('GB')).toBe('GB');
    expect(resolvePackCode('UK')).toBe('GB'); // UK alias guard
    expect(resolvePackCode('AU')).toBe('AU');
    expect(resolvePackCode('IN')).toBe('IN');
    expect(resolvePackCode('US')).toBe('US');
  });

  it('falls back to GB for unknown / missing codes', () => {
    expect(resolvePackCode('ZZ')).toBe('GB');
    expect(resolvePackCode(null)).toBe('GB');
    expect(resolvePackCode('')).toBe('GB');
  });

  it('the explicit EU pack code resolves to the EU pack (registry entry)', () => {
    expect(resolvePackCode('EU')).toBe('EU');
  });
});

/**
 * Minimal Prisma-tx double for applyPack: records the CompanySettings upsert
 * payload + the seeded TaxRate names/rates so we can assert what was persisted.
 */
function makeFakeTx() {
  const seededRates: Array<{ name: string; rate: string; regime: string }> = [];
  let companySettingsData: Record<string, unknown> | null = null;
  let accId = 0;

  const tx: ApplyPackTx & {
    taxGroup: NonNullable<ApplyPackTx['taxGroup']>;
    taxRate: NonNullable<ApplyPackTx['taxRate']>;
  } = {
    companySettings: {
      findFirst: async () => ({ id: 'cs1', ledgerInitialized: false }),
      upsert: async (args: any) => {
        companySettingsData = args.create;
        return {};
      },
    },
    account: {
      findUnique: async () => null,
      create: async (args: any) => {
        accId += 1;
        return { id: `acc${accId}`, code: (args.data as any).code };
      },
      update: async () => ({}),
    },
    ledgerAccountMapping: { upsert: async () => ({}) },
    taxGroup: {
      findFirst: async () => ({ id: 'grp1' }),
      create: async () => ({ id: 'grp1' }),
    },
    taxRate: {
      findFirst: async () => null,
      create: async (args: any) => {
        const d = args.data as any;
        seededRates.push({ name: d.name, rate: d.rate, regime: d.regime });
        return { id: `rate${seededRates.length}` };
      },
    },
  };

  return { tx, seededRates, getSettings: () => companySettingsData };
}

describe('applyPack — EU member persistence + member rate seeding', () => {
  it('persists the real member ISO-2 (DE) and seeds DE 19% (not generic 21%)', async () => {
    const { tx, seededRates, getSettings } = makeFakeTx();

    await applyPack(tx, {
      userId: 'u1',
      countryCode: 'EU', // routed EU pack
      memberCountryCode: 'DE', // the tenant's REAL country
      goLiveDate: new Date('2026-01-01'),
    });

    expect(getSettings()!.countryCode).toBe('DE'); // NOT 'EU'
    expect(getSettings()!.taxRegime).toBe('VAT_EU');

    const vatRow = seededRates.find((r) => r.regime === 'VAT_EU' && r.rate !== '0');
    expect(vatRow).toBeDefined();
    expect(vatRow!.rate).toBe('19'); // euStandardRate('DE')
  });

  it('FR member seeds 20%', async () => {
    const { tx, seededRates } = makeFakeTx();
    await applyPack(tx, {
      userId: 'u2',
      countryCode: 'EU',
      memberCountryCode: 'FR',
      goLiveDate: new Date('2026-01-01'),
    });
    const vatRow = seededRates.find((r) => r.regime === 'VAT_EU' && r.rate !== '0');
    expect(vatRow!.rate).toBe('20');
  });

  it('non-EU pack (GB) is unaffected — stores GB and seeds 20/5/0', async () => {
    const { tx, seededRates, getSettings } = makeFakeTx();
    await applyPack(tx, {
      userId: 'u3',
      countryCode: 'GB',
      goLiveDate: new Date('2026-01-01'),
    });
    expect(getSettings()!.countryCode).toBe('GB');
    const rates = seededRates.filter((r) => r.regime === 'VAT_UK').map((r) => r.rate).sort();
    expect(rates).toEqual(['0', '20', '5']);
  });

  it('EU pack without a member code falls back to the generic 21% (legacy safety)', async () => {
    const { tx, seededRates, getSettings } = makeFakeTx();
    await applyPack(tx, {
      userId: 'u4',
      countryCode: 'EU',
      goLiveDate: new Date('2026-01-01'),
    });
    expect(getSettings()!.countryCode).toBe('EU'); // no member supplied -> pack code
    const vatRow = seededRates.find((r) => r.regime === 'VAT_EU' && r.rate !== '0');
    expect(vatRow!.rate).toBe('21');
  });
});
