/**
 * Idempotent seeder: gives every tenant its own default role set and keeps
 * those roles reconciled against the (global) Module catalog.
 *
 * Roles created per tenant (case-insensitive guard – duplicates skipped):
 *   Admin (user_type 1), Vendor (2), Staff (3), Maintainer (4), Supplier (5),
 *   plus Owner.
 *
 * WHY THIS STILL RUNS ON EVERY BOOT: the Owner/Admin reconciliation below grants
 * full permissions on modules that did not exist when a tenant signed up.
 * Without it, a release that adds a Module (e.g. 'payroll', 'my-money') would
 * leave every tenant's Owner with no Permission row for it and
 * requirePermission() would 403 them out of a feature they already have.
 *
 * Backfill: any TenantMembership with no roleId gets the role matching its
 * user's user_type (excludes user_type 999 sys-bootstrap). User.roleId is
 * mirrored for now because authMiddleware still reads it; that flips to
 * TenantMembership.roleId in P5.
 *
 * Run standalone:  npx ts-node prisma/seedRoles.ts
 * Called from:     prisma/seed.ts main()
 */

import { PrismaClient } from '@prisma/client';

import { DEFAULT_ROLE_BY_USER_TYPE, OWNER_ROLE_NAME, ensureRole } from '../lib/defaultRoles';

// Seed runs standalone via `prisma db seed` — use its own client so the
// seeder is self-contained and doesn't depend on the hot-reload-cached
// shared client from lib/prisma.
const prisma = new PrismaClient();

export { ensureRole };

export interface SeedRolesResult {
  /** How many roles were newly created (not already present), across all tenants */
  created: number;
  /** How many memberships were backfilled with a default role */
  backfilled: number;
  /** How many module permissions were granted to Admin roles */
  adminPermsGranted: number;
  /** How many owner memberships were assigned the Owner role */
  ownerAssigned: number;
  /** Map from user_type → role id, for the LAST tenant seeded (see seedRoles) */
  roleIds: Record<number, string>;
}

/**
 * Seeds and reconciles the default roles for ONE tenant. This is the unit of
 * work: signup calls it for the tenant it just created, boot calls it for every
 * existing tenant.
 */
export async function seedRolesForTenant(
  tenantId: string,
  client: PrismaClient = prisma,
): Promise<SeedRolesResult> {
  let created = 0;
  const roleIds: Record<number, string> = {};

  for (const [userTypeStr, roleName] of Object.entries(DEFAULT_ROLE_BY_USER_TYPE)) {
    const userType = Number(userTypeStr);
    const before = await client.role.findFirst({
      where: { tenantId, roleName: { equals: roleName, mode: 'insensitive' }, deletedAt: null },
    });
    const id = await ensureRole(roleName, tenantId, client);
    roleIds[userType] = id;
    if (!before) created += 1;
  }

  // Backfill: assign the default role to this tenant's members that have none.
  // Scoped through TenantMembership so a user who is Staff here and Owner in
  // another workspace keeps both roles.
  let backfilled = 0;
  for (const [userTypeStr, roleId] of Object.entries(roleIds)) {
    const userType = Number(userTypeStr);
    const result = await client.tenantMembership.updateMany({
      where: { tenantId, roleId: null, user: { user_type: userType } },
      data: { roleId },
    });
    backfilled += result.count;
  }

  // Grant the Admin role full permissions on every module — but ONLY when it
  // has none yet. This makes the default "Admin" role behave as an admin out of
  // the box (a user assigned this role gets full access) and backfills existing
  // installs where the role was created bare. Once ANY permission row exists for
  // the role we never re-grant, so an admin who later restricts it is respected.
  let adminPermsGranted = 0;
  const adminRoleId = roleIds[1];
  if (adminRoleId) {
    const existingPerms = await client.permission.count({
      where: { roleId: adminRoleId, deletedAt: null },
    });
    if (existingPerms === 0) {
      const modules = await client.module.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      if (modules.length > 0) {
        await client.permission.createMany({
          data: modules.map((m: { id: string }) => ({
            tenantId,
            roleId: adminRoleId,
            moduleId: m.id,
            create: true,
            edit: true,
            delete: true,
            view: true,
            allowAll: true,
          })),
        });
        adminPermsGranted = modules.length;
      }
    }
  }

  // Backfill the Admin role with FULL perms on any module it lacks a row for.
  // The block above only seeds Admin when it has ZERO perms, so on existing
  // installs a newly-added module (e.g. 'payroll', 'my-money') would otherwise
  // leave Admin without a permission row and requirePermission() would 403 it.
  // Additive only: we never touch existing Admin rows, so a restriction an
  // operator set on an already-present module is respected.
  if (adminRoleId) {
    const adminPerms = await client.permission.findMany({
      where: { roleId: adminRoleId, deletedAt: null },
      select: { moduleId: true },
    });
    const adminHave = new Set(adminPerms.map((p: { moduleId: string | null }) => p.moduleId));
    const allMods = await client.module.findMany({ where: { deletedAt: null }, select: { id: true } });
    const adminMissing = allMods.filter((m: { id: string }) => !adminHave.has(m.id));
    if (adminMissing.length > 0) {
      await client.permission.createMany({
        data: adminMissing.map((m: { id: string }) => ({
          tenantId,
          roleId: adminRoleId,
          moduleId: m.id,
          create: true,
          edit: true,
          delete: true,
          view: true,
          allowAll: true,
        })),
      });
      adminPermsGranted += adminMissing.length;
    }
  }

  // --- Owner role: always reconciled to FULL permissions on every module ---
  // The Owner role is separate from user_type-keyed roles. It always has
  // allowAll:true on every module so that removing the legacy user_type===1
  // bypass never locks out owners.
  const ownerRoleId = await ensureRole(OWNER_ROLE_NAME, tenantId, client);
  const allModules = await client.module.findMany({ where: { deletedAt: null }, select: { id: true } });
  const existingOwnerPerms = await client.permission.findMany({
    where: { roleId: ownerRoleId, deletedAt: null },
    select: { moduleId: true },
  });
  const haveModuleIds = new Set(existingOwnerPerms.map((p: { moduleId: string | null }) => p.moduleId));
  const missing = allModules.filter((m: { id: string }) => !haveModuleIds.has(m.id));
  if (missing.length > 0) {
    await client.permission.createMany({
      data: missing.map((m: { id: string }) => ({
        tenantId,
        roleId: ownerRoleId,
        moduleId: m.id,
        create: true,
        edit: true,
        delete: true,
        view: true,
        allowAll: true,
      })),
    });
  }
  // Force existing Owner rows to full (Owner means Owner) — flip any restricted flags.
  await client.permission.updateMany({
    where: { roleId: ownerRoleId, deletedAt: null },
    data: { create: true, edit: true, delete: true, view: true, allowAll: true },
  });

  // Assign the Owner role to this tenant's owner membership(s) that lack it, so
  // removing the legacy user_type===1 bypass never locks out an existing owner.
  const ownerAssign = await client.tenantMembership.updateMany({
    where: { tenantId, isOwner: true, NOT: { roleId: ownerRoleId } },
    data: { roleId: ownerRoleId },
  });
  const ownerAssigned = ownerAssign.count;

  // The mirror onto User.roleId that used to follow is gone with the column
  // (P9). The membership update above is the whole assignment now.

  return { created, backfilled, adminPermsGranted, ownerAssigned, roleIds };
}

/**
 * Boot entry point: reconciles roles for EVERY tenant.
 *
 * `roleIds` on the aggregate result is the LAST tenant's map — it only ever had
 * a single-tenant meaning. Callers needing a specific tenant's role ids should
 * call seedRolesForTenant directly.
 */
export async function seedRoles(client: PrismaClient = prisma): Promise<SeedRolesResult> {
  const tenants = await client.tenant.findMany({
    where: { deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  const total: SeedRolesResult = {
    created: 0, backfilled: 0, adminPermsGranted: 0, ownerAssigned: 0, roleIds: {},
  };
  for (const t of tenants) {
    const r = await seedRolesForTenant(t.id, client);
    total.created += r.created;
    total.backfilled += r.backfilled;
    total.adminPermsGranted += r.adminPermsGranted;
    total.ownerAssigned += r.ownerAssigned;
    total.roleIds = r.roleIds;
  }
  return total;
}

if (require.main === module) {
  seedRoles()
    .then((r) => {
      console.log(
        `Roles seeded (created ${r.created} new, backfilled ${r.backfilled} memberships, granted Admin ${r.adminPermsGranted} module permissions, assigned Owner to ${r.ownerAssigned} owner(s)).`,
      );
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error('seedRoles error:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
