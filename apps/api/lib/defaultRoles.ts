/**
 * Default role mapping for user_type values.
 *
 * Used by:
 *  - prisma/seedRoles.ts   – seeds each tenant's default roles on boot
 *  - controllers/authController.ts – assigns Admin role on registration
 *  - controllers/externalController.js – assigns Vendor role on SSO upsert
 *
 * The map is intentionally exported as a plain object (not an enum) so it can
 * be imported in both ESM (TS controllers) and CJS (legacy JS routes) contexts.
 */

import { PrismaClient } from '@prisma/client';

import { prisma as sharedPrisma } from './prisma';

/** The canonical Owner role name — separate from user_type map (Owner is role-only, not user_type-keyed). */
export const OWNER_ROLE_NAME = 'Owner';

/** Maps user_type integer → default role name */
export const DEFAULT_ROLE_BY_USER_TYPE: Readonly<Record<number, string>> = {
  1: 'Admin',
  2: 'Vendor',
  3: 'Staff',
  4: 'Maintainer',
  5: 'Supplier',
} as const;

/**
 * Ensure a role exists WITHIN A TENANT (case-insensitive name match). Returns
 * the role id.
 *
 * Roles are per-tenant, so `tenantId` is required: two workspaces each having
 * their own "Owner" is the normal case, and a lookup that forgot to scope would
 * hand one tenant's role to another.
 *
 * The case-insensitive findFirst (rather than an upsert on a unique index) is
 * deliberate and load-bearing — see the note on Role in prisma/schema.prisma:
 * roles are SOFT-deleted, so the DB cannot carry a plain unique constraint on
 * (tenantId, roleName).
 *
 * Uses the shared Prisma client by default. Seeders that need to pass their
 * own client (e.g. when running standalone via `prisma db seed`) can supply
 * it via the optional `client` parameter.
 */
export async function ensureRole(
  roleName: string,
  tenantId: string,
  client: PrismaClient = sharedPrisma,
): Promise<string> {
  if (!tenantId) {
    throw new Error(`ensureRole('${roleName}') called without a tenantId`);
  }
  // Case-insensitive guard: look for an active (non-deleted) role with the same
  // name regardless of capitalisation, matching the convention in roleController.
  const existing = await client.role.findFirst({
    where: {
      tenantId,
      roleName: { equals: roleName, mode: 'insensitive' },
      deletedAt: null,
    },
  });
  if (existing) return existing.id;

  const created = await client.role.create({
    data: {
      tenantId,
      roleName,
      status: true,
      createdBy: 'sys-bootstrap',
    },
  });
  return created.id;
}
