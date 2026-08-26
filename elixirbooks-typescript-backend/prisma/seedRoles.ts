/**
 * Idempotent seeder: creates the 5 default roles and backfills existing users
 * that have no roleId.
 *
 * Roles created (by roleName, case-insensitive guard – duplicates skipped):
 *   Admin (user_type 1), Vendor (2), Staff (3), Maintainer (4), Supplier (5)
 *
 * Backfill: any User with user_type in the map above and roleId = null gets
 *           assigned the matching role (excludes user_type 999 sys-bootstrap).
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
  /** How many roles were newly created (not already present) */
  created: number;
  /** How many users were backfilled with a default role */
  backfilled: number;
  /** How many module permissions were granted to the Admin role */
  adminPermsGranted: number;
  /** How many user_type 1 users were assigned the Owner role */
  ownerAssigned: number;
  /** Map from user_type → role id */
  roleIds: Record<number, string>;
}

export async function seedRoles(): Promise<SeedRolesResult> {
  let created = 0;
  const roleIds: Record<number, string> = {};

  for (const [userTypeStr, roleName] of Object.entries(DEFAULT_ROLE_BY_USER_TYPE)) {
    const userType = Number(userTypeStr);
    const before = await prisma.role.findFirst({
      where: { roleName: { equals: roleName, mode: 'insensitive' }, deletedAt: null },
    });
    const id = await ensureRole(roleName, prisma);
    roleIds[userType] = id;
    if (!before) created += 1;
  }

  // Backfill: assign default role to existing users that have none
  let backfilled = 0;
  for (const [userTypeStr, roleId] of Object.entries(roleIds)) {
    const userType = Number(userTypeStr);
    const result = await prisma.user.updateMany({
      where: {
        user_type: userType,
        roleId: null,
      },
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
    const existingPerms = await prisma.permission.count({
      where: { roleId: adminRoleId, deletedAt: null },
    });
    if (existingPerms === 0) {
      const modules = await prisma.module.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      if (modules.length > 0) {
        await prisma.permission.createMany({
          data: modules.map((m) => ({
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
    const adminPerms = await prisma.permission.findMany({
      where: { roleId: adminRoleId, deletedAt: null },
      select: { moduleId: true },
    });
    const adminHave = new Set(adminPerms.map((p: { moduleId: string | null }) => p.moduleId));
    const allMods = await prisma.module.findMany({ where: { deletedAt: null }, select: { id: true } });
    const adminMissing = allMods.filter((m: { id: string }) => !adminHave.has(m.id));
    if (adminMissing.length > 0) {
      await prisma.permission.createMany({
        data: adminMissing.map((m: { id: string }) => ({
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
  // The Owner role is separate from user_type-keyed roles. It always has allowAll:true
  // on every module so that removing the legacy user_type===1 bypass never locks out owners.
  const ownerRoleId = await ensureRole(OWNER_ROLE_NAME, prisma);
  const allModules = await prisma.module.findMany({ where: { deletedAt: null }, select: { id: true } });
  const existingOwnerPerms = await prisma.permission.findMany({
    where: { roleId: ownerRoleId, deletedAt: null },
    select: { moduleId: true },
  });
  const haveModuleIds = new Set(existingOwnerPerms.map((p: { moduleId: string }) => p.moduleId));
  const missing = allModules.filter((m: { id: string }) => !haveModuleIds.has(m.id));
  if (missing.length > 0) {
    await prisma.permission.createMany({
      data: missing.map((m: { id: string }) => ({
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
  await prisma.permission.updateMany({
    where: { roleId: ownerRoleId, deletedAt: null },
    data: { create: true, edit: true, delete: true, view: true, allowAll: true },
  });

  // Assign the Owner role to every user_type 1 user that lacks it, so removing the
  // legacy bypass never locks out an existing owner.
  const ownerAssign = await prisma.user.updateMany({
    where: { user_type: 1, NOT: { roleId: ownerRoleId } },
    data: { roleId: ownerRoleId },
  });
  const ownerAssigned = ownerAssign.count;

  return { created, backfilled, adminPermsGranted, ownerAssigned, roleIds };
}

if (require.main === module) {
  seedRoles()
    .then((r) => {
      console.log(
        `Roles seeded (created ${r.created} new, backfilled ${r.backfilled} users, granted Admin role ${r.adminPermsGranted} module permissions, assigned Owner to ${r.ownerAssigned} owner(s)).`,
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
