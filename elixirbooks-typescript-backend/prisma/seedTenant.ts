/**
 * Per-tenant seed: everything a brand-new workspace needs to be usable.
 *
 * Before P4 these rows were seeded ONCE per install by prisma/seed.ts and
 * shared by everybody, because Unit, Currency and EmailTemplate were global
 * tables. They are tenant-owned now, so the same content has to be stocked per
 * workspace instead — at signup (inside the registration transaction) and, for
 * workspaces that already exist, by the boot reconciliation.
 *
 * WHAT IS AND IS NOT HERE. This seeds exactly what the install used to hand
 * every company for free — Units, Currencies, EmailTemplates — and nothing
 * more. GeneralSetting rows are still created lazily on first write by
 * CompanySettingsController/documentDefaultsController, TaxGroups by
 * lib/tax/ensureDefaultTaxGroup and the country pack, and ExpenseCategories by
 * the user; none of those were ever seeded, and inventing them here would
 * change what a fresh company sees rather than preserve it.
 *
 * FIXED IDS ARE GONE. seed.ts used hard-coded ids ('u-pcs', 'cur-inr', ...) as
 * its idempotency key. That cannot survive per-tenant rows — nine tenants
 * cannot all own a row with id 'u-pcs' — so ids are generated and idempotency
 * moves to (tenantId, short_name) for Units and (tenantId, code) for
 * Currencies. Nothing outside seed.ts referenced those ids (verified by grep).
 *
 * IDEMPOTENT. Safe to call on every boot for every tenant: an existing row is
 * left exactly as the user left it. In particular a currency the user disabled,
 * soft-deleted, or promoted to default is never reset — the same reasoning the
 * old seed.ts spelled out on its Currency upsert, and the reason this seeder
 * checks for existence rather than upserting display fields over the top.
 */

import { PrismaClient } from '@prisma/client';

import { seedEmailTemplatesForTenant, type EmailTemplateSeedDb } from './seedEmailTemplates';

const prisma = new PrismaClient();

/** Base units every company gets so products can be created out of the box. */
export const DEFAULT_UNITS: { unit_name: string; short_name: string }[] = [
  { unit_name: 'Pieces', short_name: 'pcs' },
  { unit_name: 'Hours', short_name: 'hr' },
  { unit_name: 'Kilograms', short_name: 'kg' },
  { unit_name: 'Box', short_name: 'box' },
  { unit_name: 'Litres', short_name: 'ltr' },
  { unit_name: 'Days', short_name: 'day' },
  { unit_name: 'Weeks', short_name: 'wk' },
  { unit_name: 'Months', short_name: 'mo' },
  { unit_name: 'Package', short_name: 'pkg' },
];

/**
 * Starter currency list. `isDefault` on the first entry is a starting point,
 * not a decision — /setup overwrites it with the currency chosen there, and
 * the Currencies screen can change it afterwards.
 */
export const DEFAULT_CURRENCIES: {
  name: string;
  code: string;
  symbol: string;
  isDefault: boolean;
}[] = [
  { name: 'Indian Rupee', code: 'INR', symbol: '₹', isDefault: true },
  { name: 'US Dollar', code: 'USD', symbol: '$', isDefault: false },
  { name: 'Euro', code: 'EUR', symbol: '€', isDefault: false },
  { name: 'British Pound', code: 'GBP', symbol: '£', isDefault: false },
  { name: 'Australian Dollar', code: 'AUD', symbol: 'A$', isDefault: false },
  { name: 'Canadian Dollar', code: 'CAD', symbol: 'C$', isDefault: false },
  { name: 'Singapore Dollar', code: 'SGD', symbol: 'S$', isDefault: false },
  { name: 'Japanese Yen', code: 'JPY', symbol: '¥', isDefault: false },
  { name: 'UAE Dirham', code: 'AED', symbol: 'د.إ', isDefault: false },
];

export interface SeedTenantResult {
  units: number;
  currencies: number;
  emailTemplates: number;
}

/** The client slice this seeder needs, so it can run inside a transaction. */
export type TenantSeedDb = Pick<PrismaClient, 'unit' | 'currency'> & EmailTemplateSeedDb;

/**
 * Stock one workspace.
 *
 * @param tenantId  the workspace to seed
 * @param createdBy a real User id for Currency.createdBy (a non-null FK). At
 *                  signup this is the owner; for the boot reconciliation it is
 *                  the tenant's owner, resolved from the membership.
 */
export async function seedTenantDefaults(
  tenantId: string,
  createdBy: string,
  db: TenantSeedDb = prisma,
): Promise<SeedTenantResult> {
  let units = 0;
  for (const u of DEFAULT_UNITS) {
    const existing = await db.unit.findFirst({
      where: { tenantId, short_name: u.short_name },
      select: { id: true },
    });
    if (existing) continue;
    await db.unit.create({ data: { tenantId, ...u, status: true } });
    units += 1;
  }

  let currencies = 0;
  for (const c of DEFAULT_CURRENCIES) {
    // Deliberately NOT filtered by isDeleted: a currency the user removed must
    // stay removed, and re-creating it here would resurrect it on every boot.
    const existing = await db.currency.findFirst({
      where: { tenantId, code: c.code },
      select: { id: true },
    });
    if (existing) continue;
    await db.currency.create({
      data: {
        tenantId,
        name: c.name,
        code: c.code,
        symbol: c.symbol,
        isDefault: c.isDefault,
        status: true,
        isDeleted: false,
        createdBy,
      },
    });
    currencies += 1;
  }

  const templates = await seedEmailTemplatesForTenant(tenantId, db);

  return { units, currencies, emailTemplates: templates.created };
}

/**
 * Replay the defaults across every tenant. This is the boot-time counterpart:
 * a release that adds a Unit, Currency or EmailTemplate reaches workspaces that
 * already exist, the same way seedRoles.ts reconciles newly-added Modules.
 *
 * A tenant with no owner membership is skipped rather than guessed at, because
 * Currency.createdBy is a non-null FK to User and there is no honest value.
 */
export async function seedAllTenantDefaults(): Promise<SeedTenantResult & { tenants: number }> {
  const totals: SeedTenantResult & { tenants: number } = {
    tenants: 0,
    units: 0,
    currencies: 0,
    emailTemplates: 0,
  };

  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      memberships: {
        where: { isOwner: true },
        take: 1,
        select: { userId: true },
      },
    },
  });

  for (const t of tenants) {
    const ownerId = t.memberships[0]?.userId;
    if (!ownerId) {
      console.warn(`[seedTenant] tenant ${t.id} has no owner membership — skipped`);
      continue;
    }
    const r = await seedTenantDefaults(t.id, ownerId);
    totals.tenants += 1;
    totals.units += r.units;
    totals.currencies += r.currencies;
    totals.emailTemplates += r.emailTemplates;
  }

  return totals;
}

if (require.main === module) {
  seedAllTenantDefaults()
    .then((r) => {
      console.log(
        `Tenant defaults seeded across ${r.tenants} tenant(s): ` +
          `${r.units} unit(s), ${r.currencies} currency(ies), ${r.emailTemplates} template(s).`,
      );
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error('seedTenant error:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
