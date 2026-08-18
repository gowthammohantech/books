import { describe, it, expect, vi } from 'vitest';
import { applyPack } from './applyPack';
import { LedgerError } from './buildLines';
import { LEDGER_ROLES } from './roles';

function fakeTx(opts: { initialized?: boolean; noSettings?: boolean } = {}) {
  const accounts = new Map<string, { id: string; code: string }>();
  const mappings: any[] = [];
  const taxRates = new Map<string, { id: string; name: string }>();
  let n = 0;
  const existingSettings = opts.noSettings
    ? null
    : { id: 'cs1', ledgerInitialized: opts.initialized ?? false };
  return {
    accounts, mappings, taxRates,
    companySettings: {
      findFirst: vi.fn().mockResolvedValue(existingSettings),
      upsert: vi.fn().mockResolvedValue({}),
    },
    account: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => accounts.get(where.userId_code.code) ?? null),
      create: vi.fn().mockImplementation(async ({ data }: any) => { const row = { id: `acc${n++}`, code: data.code }; accounts.set(data.code, row); return row; }),
      update: vi.fn().mockResolvedValue({}),
    },
    ledgerAccountMapping: {
      upsert: vi.fn().mockImplementation(async ({ create }: any) => { mappings.push(create); return create; }),
    },
    taxGroup: {
      findFirst: vi.fn().mockResolvedValue({ id: 'grp1' }),
      create: vi.fn().mockResolvedValue({ id: 'grp1' }),
    },
    taxRate: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => taxRates.get(where.name) ?? null),
      create: vi.fn().mockImplementation(async ({ data }: any) => { const row = { id: `tr${n++}`, name: data.name }; taxRates.set(data.name, row); return row; }),
    },
  };
}

const input = { userId: 'u1', countryCode: 'IN', functionalCurrency: 'INR', fiscalYearStartMonth: 4, goLiveDate: new Date('2026-04-01') };

describe('applyPack', () => {
  it('seeds accounts, maps every role, and writes settings', async () => {
    const tx = fakeTx();
    await applyPack(tx as never, input);
    expect(tx.account.create).toHaveBeenCalled();
    expect(tx.mappings.length).toBe(LEDGER_ROLES.length); // exactly all roles mapped
    expect(tx.companySettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ countryCode: 'IN', functionalCurrency: 'INR', fiscalYearStartMonth: 4 }),
    }));
  });

  it('is idempotent: existing accounts are reused, not duplicated', async () => {
    const tx = fakeTx();
    await applyPack(tx as never, input);
    const firstCreateCount = (tx.account.create as any).mock.calls.length;
    await applyPack(tx as never, input);
    expect((tx.account.create as any).mock.calls.length).toBe(firstCreateCount); // no new creates
  });

  it('sets the tenant taxRegime from the pack (IN -> GST_INDIA)', async () => {
    const tx = fakeTx();
    await applyPack(tx as never, input);
    expect(tx.companySettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ taxRegime: 'GST_INDIA' }),
      update: expect.objectContaining({ taxRegime: 'GST_INDIA' }),
    }));
  });

  it('UK pack sets VAT_UK and seeds 20/5/0 VAT rates + a No-Tax row', async () => {
    const tx = fakeTx();
    await applyPack(tx as never, { ...input, countryCode: 'GB', functionalCurrency: 'GBP' });
    expect(tx.companySettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ taxRegime: 'VAT_UK' }),
    }));
    const names = (tx.taxRate.create as any).mock.calls.map((c: any) => c[0].data.name);
    expect(names).toEqual(expect.arrayContaining([
      'VAT Standard 20%', 'VAT Reduced 5%', 'VAT Zero 0%', 'No Tax 0%',
    ]));
  });

  it('AU seeds 10% GST; NZ seeds 15% GST', async () => {
    const au = fakeTx();
    await applyPack(au as never, { ...input, countryCode: 'AU', functionalCurrency: 'AUD' });
    const auRates = (au.taxRate.create as any).mock.calls.map((c: any) => ({ name: c[0].data.name, rate: c[0].data.rate }));
    expect(auRates).toEqual(expect.arrayContaining([{ name: 'GST 10%', rate: '10' }]));

    const nz = fakeTx();
    await applyPack(nz as never, { ...input, countryCode: 'NZ', functionalCurrency: 'NZD' });
    const nzRates = (nz.taxRate.create as any).mock.calls.map((c: any) => ({ name: c[0].data.name, rate: c[0].data.rate }));
    expect(nzRates).toEqual(expect.arrayContaining([{ name: 'GST 15%', rate: '15' }]));
  });

  it('rate seeding is idempotent: re-applying a pack creates no duplicate rates', async () => {
    const tx = fakeTx();
    await applyPack(tx as never, { ...input, countryCode: 'GB', functionalCurrency: 'GBP' });
    const firstCount = (tx.taxRate.create as any).mock.calls.length;
    expect(firstCount).toBeGreaterThan(0);
    await applyPack(tx as never, { ...input, countryCode: 'GB', functionalCurrency: 'GBP' });
    expect((tx.taxRate.create as any).mock.calls.length).toBe(firstCount); // no new rate rows
  });

  it('throws for an unknown country', async () => {
    const tx = fakeTx();
    await expect(applyPack(tx as never, { ...input, countryCode: 'ZZ' })).rejects.toThrow(LedgerError);
  });

  it('refuses to re-seed once the ledger is initialized', async () => {
    const tx = fakeTx({ initialized: true });
    await expect(applyPack(tx as never, input)).rejects.toThrow(LedgerError);
  });

  it('creates CompanySettings when the tenant has no row yet (fresh tenant)', async () => {
    const tx = fakeTx({ noSettings: true });
    await applyPack(tx as never, input);
    // Must call upsert — NOT a bare update with an empty id
    expect(tx.companySettings.upsert).toHaveBeenCalledTimes(1);
    const call = (tx.companySettings.upsert as any).mock.calls[0][0];
    // where clause targets userId, not a potentially-empty id
    expect(call.where).toEqual({ userId: input.userId });
    // create branch carries all required fields plus ledger fields
    expect(call.create).toMatchObject({
      userId: input.userId,
      countryCode: 'IN',
      functionalCurrency: 'INR',
      fiscalYearStartMonth: 4,
      goLiveDate: input.goLiveDate,
    });
  });
});
