// Unified-tax data migration (spec 2026-07-12 §4B). For every Product still on
// the legacy TaxGroup link (taxGroupId set, taxRateId null):
//   - group with exactly 1 usable member → taxRateId = that member
//   - group with N>1 members            → find-or-create ONE per-tenant summed
//     rate (name = group name, rate = Σ member rates, regime from members)
//   - the global "No Tax" group         → the tenant's 0% NONE rate (this group
//     holds EVERY tenant's pack-seeded rates — see seedPackTaxRates — so it is
//     special-cased, never summed)
// taxGroupId is LEFT IN PLACE (deprecated, unread once taxRateId is set).
// Idempotent: migrated products are excluded by the query and summed/NONE
// rates are found before created — re-runs are no-ops. Optional for
// correctness (the read-fallback chain covers unmigrated data) but recommended
// on upgrade:  npm run prisma:migrate:taxes
//
// KNOWN LIMITATION (review 2026-07-12, consciously accepted): Product has no
// tenant column, so group resolution is cached per GROUP, not per (group,
// owner). On the rare multi-owner install, products pointing at the shared
// global "No Tax" group all receive the FIRST owner's 0% NONE rate id —
// functionally identical (0% = 0%) but a cosmetic cross-owner FK. Standard
// installs are single-owner (registration guard), where this cannot occur.
//
// Pattern follows prisma/migrateContacts.ts (pure planner + injectable db +
// require.main guard so the colocated spec can import without running).

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface GroupMember {
  id: string;
  userId: string;
  name: string;
  rate: unknown;
  regime: string;
  isActive: boolean | null;
  isDeleted: boolean | null;
}
export interface GroupShape { id: string; tax_name: string; tax_rates: GroupMember[] }

export type GroupResolution =
  | { kind: 'single'; taxRateId: string }
  | { kind: 'summed'; userId: string; name: string; regime: string; rate: number }
  | { kind: 'noTax'; userId: string }
  | { kind: 'skip' };

/** Pure: decide how one group collapses to a single rate. */
export function planGroupResolution(group: GroupShape): GroupResolution {
  const members = group.tax_rates.filter((r) => r.isActive !== false && r.isDeleted !== true);
  if (members.length === 0) return { kind: 'skip' };
  if (group.tax_name === 'No Tax') {
    const none = members.find((r) => r.regime === 'NONE');
    if (none) return { kind: 'single', taxRateId: none.id };
    return { kind: 'noTax', userId: members[0].userId };
  }
  if (members.length === 1) return { kind: 'single', taxRateId: members[0].id };
  // N>1 legacy compound: members of a real compound group are seeded
  // per-tenant, so scope to the first member's tenant, ignore stray rows.
  const tenantMembers = members.filter((r) => r.userId === members[0].userId);
  const rate = tenantMembers.reduce((sum, r) => sum + Number(r.rate), 0);
  const regime =
    tenantMembers.find((r) => r.regime && r.regime !== 'NONE')?.regime ?? tenantMembers[0].regime;
  return { kind: 'summed', userId: members[0].userId, name: group.tax_name, regime, rate };
}

/** Prisma-like surface so the spec can drive the runner with a fake db. */
export interface MigrateDb {
  product: {
    findMany: (args: unknown) => Promise<Array<{ id: string; taxGroupId: string | null }>>;
    update: (args: unknown) => Promise<unknown>;
  };
  taxGroup: { findMany: (args: unknown) => Promise<GroupShape[]> };
  taxRate: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: { data: unknown }) => Promise<{ id: string }>;
  };
}

async function resolveGroupToRateId(
  db: MigrateDb,
  group: GroupShape,
): Promise<{ rateId: string | null; created: boolean }> {
  const plan = planGroupResolution(group);
  if (plan.kind === 'skip') return { rateId: null, created: false };
  if (plan.kind === 'single') return { rateId: plan.taxRateId, created: false };
  if (plan.kind === 'noTax') {
    const existing = await db.taxRate.findFirst({
      where: { userId: plan.userId, regime: 'NONE', isDeleted: false },
      select: { id: true },
    });
    if (existing) return { rateId: existing.id, created: false };
    const created = await db.taxRate.create({
      data: { userId: plan.userId, regime: 'NONE', name: 'No Tax 0%', rate: '0', isActive: true },
    });
    return { rateId: created.id, created: true };
  }
  // summed — find-or-create per tenant, never duplicated on re-run.
  const existing = await db.taxRate.findFirst({
    where: { userId: plan.userId, name: plan.name, rate: plan.rate, isDeleted: false },
    select: { id: true },
  });
  if (existing) return { rateId: existing.id, created: false };
  const created = await db.taxRate.create({
    data: {
      userId: plan.userId,
      regime: plan.regime as never,
      taxKind: null,
      name: plan.name,
      rate: String(plan.rate),
      isActive: true,
    },
  });
  return { rateId: created.id, created: true };
}

export async function migrateTaxesToRates(
  db: MigrateDb = prisma as unknown as MigrateDb,
): Promise<{ updated: number; createdRates: number }> {
  const products = await db.product.findMany({
    where: { taxGroupId: { not: null }, taxRateId: null },
    select: { id: true, taxGroupId: true },
  });
  if (products.length === 0) {
    console.log('migrateTaxesToRates: nothing to migrate.');
    return { updated: 0, createdRates: 0 };
  }

  const groupIds = [...new Set(products.map((p) => p.taxGroupId as string))];
  const groups = await db.taxGroup.findMany({
    where: { id: { in: groupIds } },
    select: {
      id: true,
      tax_name: true,
      tax_rates: {
        select: { id: true, userId: true, name: true, rate: true, regime: true, isActive: true, isDeleted: true },
      },
    },
  });
  const groupById = new Map(groups.map((g) => [g.id, g]));

  let updated = 0;
  let createdRates = 0;
  const resolvedByGroup = new Map<string, string | null>();

  for (const p of products) {
    const group = groupById.get(p.taxGroupId as string);
    if (!group) continue;
    if (!resolvedByGroup.has(group.id)) {
      const { rateId, created } = await resolveGroupToRateId(db, group);
      if (created) createdRates += 1;
      resolvedByGroup.set(group.id, rateId);
    }
    const rateId = resolvedByGroup.get(group.id);
    if (!rateId) continue;
    await db.product.update({ where: { id: p.id }, data: { taxRateId: rateId } });
    updated += 1;
    console.log(`[OK] product ${p.id}: group "${group.tax_name}" -> taxRateId ${rateId}`);
  }

  console.log(`\nTax migration complete: ${updated} products linked, ${createdRates} rates created.`);
  return { updated, createdRates };
}

// Only run main when invoked directly (not when imported by the spec)
if (require.main === module) {
  migrateTaxesToRates().then(() => prisma.$disconnect()).then(() => process.exit(0))
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}
