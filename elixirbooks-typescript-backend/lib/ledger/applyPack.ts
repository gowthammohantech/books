import { LedgerError } from './buildLines';
import { getPack } from './packs';
import { packRegimeToPrisma, seedPackTaxRates, type SeedTaxRatesTx } from './packs/seedPackTaxRates';
import type { LedgerRole } from './roles';
import { isEuMember } from '../euVat';

export interface ApplyPackTx {
  companySettings: {
    findFirst: (args: unknown) => Promise<{ id: string; ledgerInitialized: boolean } | null>;
    upsert: (args: unknown) => Promise<unknown>;
  };
  account: {
    findUnique: (args: unknown) => Promise<{ id: string; code: string } | null>;
    create: (args: { data: unknown }) => Promise<{ id: string; code: string }>;
    update: (args: unknown) => Promise<unknown>;
  };
  ledgerAccountMapping: { upsert: (args: unknown) => Promise<unknown> };
  // Optional tax-rate seeding surface. Present on a real Prisma `$transaction`
  // tx; may be absent in narrow test doubles, in which case rate seeding is
  // skipped (the regime is still written to CompanySettings).
  taxGroup?: SeedTaxRatesTx['taxGroup'];
  taxRate?: SeedTaxRatesTx['taxRate'];
}

export interface ApplyPackInput {
  userId: string;
  /**
   * Pack-registry code to apply (e.g. 'GB', 'EU', 'AU'). EU member states share
   * the single generic 'EU' pack — pass 'EU' here for any member.
   */
  countryCode: string;
  /**
   * The tenant's REAL country ISO-2 to persist on CompanySettings + use for rate
   * resolution. For EU members this is the member code (e.g. 'DE') — NOT the
   * generic 'EU' pack code — so VAT rate (euStandardRate) + reverse-charge work.
   * Defaults to `countryCode` when omitted (non-EU packs already are the ISO-2).
   */
  memberCountryCode?: string | null;
  functionalCurrency?: string;
  fiscalYearStartMonth?: number;
  goLiveDate: Date;
}

export async function applyPack(tx: ApplyPackTx, input: ApplyPackInput): Promise<void> {
  const pack = getPack(input.countryCode);
  if (!pack) throw new LedgerError(`unknown country pack: ${input.countryCode}`);

  // The country to PERSIST + use for rate seeding. For the generic EU pack we
  // store the tenant's real member ISO-2 (e.g. 'DE'), never the literal 'EU'.
  const memberIso2 = (input.memberCountryCode ?? '').trim().toUpperCase();
  const storedCountryCode =
    pack.countryCode === 'EU' && isEuMember(memberIso2) ? memberIso2 : pack.countryCode;

  const settings = await tx.companySettings.findFirst({ where: { userId: input.userId } });
  if (settings?.ledgerInitialized) {
    throw new LedgerError('ledger already initialized; country/setup is immutable');
  }

  // 1. Seed CoA — parents first (sorted so a parent precedes its children by code length then code)
  const ordered = [...pack.accounts].sort((a, b) => (a.parentCode ? 1 : 0) - (b.parentCode ? 1 : 0));
  const codeToId = new Map<string, string>();
  const roleByCode = new Map(pack.accounts.filter((a) => a.role).map((a) => [a.code, a.role!]));

  for (const acc of ordered) {
    const existing = await tx.account.findUnique({ where: { userId_code: { userId: input.userId, code: acc.code } } });
    if (existing) {
      codeToId.set(acc.code, existing.id);
      if (roleByCode.has(acc.code)) {
        await tx.account.update({ where: { id: existing.id }, data: { roleProtected: true } });
      }
      continue;
    }
    const parentId = acc.parentCode ? codeToId.get(acc.parentCode) ?? null : null;
    const row = await tx.account.create({
      data: {
        userId: input.userId, code: acc.code, name: acc.name, accountType: acc.accountType,
        parentId, currencyCode: input.functionalCurrency ?? pack.defaultFunctionalCurrency,
        roleProtected: roleByCode.has(acc.code),
      },
    });
    codeToId.set(acc.code, row.id);
  }

  // 2. Map every role -> account id
  for (const role of Object.keys(pack.roleMap) as LedgerRole[]) {
    const code = pack.roleMap[role];
    const accountId = codeToId.get(code);
    if (!accountId) throw new LedgerError(`pack ${pack.countryCode} role ${role} -> missing account ${code}`);
    await tx.ledgerAccountMapping.upsert({
      where: { userId_roleKey: { userId: input.userId, roleKey: role } },
      create: { userId: input.userId, roleKey: role, accountId },
      update: { accountId },
    });
  }

  // 3. Write tenant ledger settings (NOT ledgerInitialized — that flips at cutover, B.6)
  // Use upsert so a fresh tenant with no CompanySettings row doesn't crash with P2025.
  // taxRegime is set from the pack so the tenant's tax engine matches the country.
  const taxRegime = packRegimeToPrisma(pack.taxRegime);
  await tx.companySettings.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      // Required String fields — populated with empty strings as placeholder defaults.
      // The tenant will complete these via the company-settings onboarding step.
      companyName: '',
      email: '',
      phone: '',
      address: '',
      city: '',
      state: '',
      country: '',
      pincode: '',
      // Ledger fields — persist the REAL member ISO-2 (e.g. 'DE'), not 'EU'.
      countryCode: storedCountryCode,
      functionalCurrency: input.functionalCurrency ?? pack.defaultFunctionalCurrency,
      fiscalYearStartMonth: input.fiscalYearStartMonth ?? pack.fiscalYearStartMonth,
      goLiveDate: input.goLiveDate,
      taxRegime,
    },
    update: {
      countryCode: storedCountryCode,
      functionalCurrency: input.functionalCurrency ?? pack.defaultFunctionalCurrency,
      fiscalYearStartMonth: input.fiscalYearStartMonth ?? pack.fiscalYearStartMonth,
      goLiveDate: input.goLiveDate,
      taxRegime,
    },
  });

  // 4. Seed this country's default tax rate(s) into the tenant tax-rate table
  // (UK 20/5/0, AU 10, NZ 15, EU member standard rate + 0%; IN/US keep their own
  // seeding — only a No-Tax row is ensured). Idempotent + tenant-scoped.
  if (tx.taxGroup && tx.taxRate) {
    await seedPackTaxRates(
      { taxGroup: tx.taxGroup, taxRate: tx.taxRate },
      input.userId,
      // Seed the REAL member rate (euStandardRate('DE')=19), not generic EU.
      storedCountryCode,
      pack.taxRegime,
    );
  }
}
