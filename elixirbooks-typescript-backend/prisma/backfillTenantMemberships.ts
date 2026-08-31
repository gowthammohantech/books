/**
 * Idempotent backfill: give every real user a TenantMembership.
 *
 * This REPLACES prisma/seedUserOwner.ts, which pointed users at "the single
 * company owner" via User.ownerId. That column is no longer how membership is
 * decided — authMiddleware.protect resolves the workspace from
 * TenantMembership and 401s without one — so a user with an ownerId and no
 * membership can no longer sign in at all. This is the repair for exactly that
 * state.
 *
 * Two ways it can occur:
 *   * migration 20260901000000_tenant_core generated memberships from
 *     User.ownerId as it stood then; any user created AFTER that migration but
 *     BEFORE P5 taught createStaffUser to write a membership has none.
 *   * a User row restored from an old backup.
 *
 * WHAT IT WILL NOT DO. It never invents a workspace, and it never guesses when
 * the answer is ambiguous: a user whose ownerId names no tenant, on an install
 * with more than one tenant, is REPORTED and skipped. Silently attaching a
 * person to the wrong company is worse than leaving them locked out, because
 * the lockout is visible and reversible while the mis-attachment is neither.
 *
 * Run standalone:  npx ts-node prisma/backfillTenantMemberships.ts
 * Called from:     prisma/seed.ts main()
 */

import { PrismaClient } from '@prisma/client';

import { OWNER_ROLE_NAME, DEFAULT_ROLE_BY_USER_TYPE, ensureRole } from '../lib/defaultRoles';

// Self-contained client so the seeder doesn't depend on the hot-reload-cached
// shared client from lib/prisma (matches the other prisma/seed*.ts modules).
const prisma = new PrismaClient();

/** The system bootstrap account is an FK target, not a person. */
const BOOTSTRAP_USER_TYPE = 999;

export interface BackfillMembershipsResult {
  created: number;
  /** Users with no resolvable workspace — reported, never guessed at. */
  skipped: number;
}

export async function backfillTenantMemberships(): Promise<BackfillMembershipsResult> {
  const orphans = await prisma.user.findMany({
    where: {
      isDeleted: false,
      user_type: { not: BOOTSTRAP_USER_TYPE },
      memberships: { none: {} },
    },
    select: { id: true, email: true, ownerId: true, roleId: true, user_type: true },
  });
  if (orphans.length === 0) return { created: 0, skipped: 0 };

  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const tenantIds = new Set(tenants.map((t) => t.id));

  let created = 0;
  let skipped = 0;

  for (const u of orphans) {
    // Candidate workspaces, best first:
    //  * the tenant named by ownerId (staff created under the old model);
    //  * the tenant whose id IS this user's id (an owner from P1's tenant #1,
    //    where Tenant.id was deliberately set to the owner's User.id).
    let tenantId: string | null = null;
    if (u.ownerId && tenantIds.has(u.ownerId)) tenantId = u.ownerId;
    else if (tenantIds.has(u.id)) tenantId = u.id;
    else if (tenants.length === 1) tenantId = tenants[0].id;

    if (!tenantId) {
      console.warn(
        `[backfillTenantMemberships] ${u.email}: no workspace could be resolved — skipped. ` +
          'Add the membership by hand; guessing here could put them in the wrong company.',
      );
      skipped += 1;
      continue;
    }

    // An owner is someone whose own id is the tenant's id (the P1 shape) or who
    // has no ownerId at all. Everyone else joins as a member.
    const isOwner = tenantId === u.id || (!u.ownerId && u.user_type === 1);

    // The role must belong to THIS workspace: User.roleId may point at another
    // tenant's row on a database that predates per-tenant roles.
    let roleId: string | null = null;
    if (u.roleId) {
      const role = await prisma.role.findFirst({
        where: { id: u.roleId, tenantId, deletedAt: null },
        select: { id: true },
      });
      roleId = role?.id ?? null;
    }
    if (!roleId) {
      const roleName = isOwner
        ? OWNER_ROLE_NAME
        : DEFAULT_ROLE_BY_USER_TYPE[u.user_type as keyof typeof DEFAULT_ROLE_BY_USER_TYPE];
      if (roleName) {
        roleId = await ensureRole(roleName, tenantId, prisma).catch(() => null);
      }
    }

    await prisma.tenantMembership.create({
      data: {
        userId: u.id,
        tenantId,
        roleId,
        status: 'ACTIVE',
        isOwner,
        joinedAt: new Date(),
      },
    });
    created += 1;
  }

  return { created, skipped };
}

if (require.main === module) {
  backfillTenantMemberships()
    .then((r) => {
      console.log(
        `Tenant membership backfill: created ${r.created}, skipped ${r.skipped}.`,
      );
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error('backfillTenantMemberships error:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
