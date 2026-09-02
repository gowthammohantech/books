/**
 * Workspace provisioning — the single definition of "what a usable tenant is".
 *
 * This lived in controllers/authController.ts, where signup was its only
 * caller. It moved here when the per-company seeder (prisma/seedCompany.ts)
 * needed to create a workspace too: importing a controller from a CLI would
 * pull express, express-validator and the whole route surface in at module
 * load, and re-implementing provisioning in the seeder would let a seeded
 * workspace drift from a signed-up one. Both callers now run the same code, so
 * a seeded company and a registered company are the same shape by construction.
 *
 * Nothing here is signup policy. Who the owner is, and whether they already
 * exist, is the caller's decision — this module only takes an owner id.
 */

import type { PrismaClient } from '@prisma/client';

import { seedRolesForTenant } from '../prisma/seedRoles';
import { seedTenantDefaults } from '../prisma/seedTenant';

import { ensureRole, OWNER_ROLE_NAME } from './defaultRoles';

/**
 * Turns a workspace name into a URL-safe slug that no tenant already holds.
 *
 * Tenant.slug is globally unique, so two companies both called "Acme" cannot
 * both be `acme`; the loser gets `acme-2`. The slug is cosmetic today (routing
 * is by JWT claim, not subdomain) but is unique from the start so that adding
 * subdomain routing later does not require a backfill.
 */
export async function uniqueSlug(
  raw: string,
  tx: { tenant: { findUnique(args: { where: { slug: string } }): Promise<unknown> } },
): Promise<string> {
  const base =
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace';

  for (let n = 1; n < 50; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await tx.tenant.findUnique({ where: { slug: candidate } }))) return candidate;
  }
  // Practically unreachable; keeps signup working rather than 500ing on a
  // pathological run of collisions.
  return `${base}-${Date.now()}`;
}

/**
 * Provisioning is a lot of writes for one transaction: the tenant, six roles,
 * a Permission row per module, the owner membership, and the Units, Currencies
 * and EmailTemplates a fresh workspace starts with. Prisma's default 5s
 * interactive-transaction budget was not enough for that on a remote database,
 * and overrunning it aborts the whole signup with P2028 ("Transaction already
 * closed" / "Transaction not found") — a registration the user sees as a 500.
 *
 * The seeders now batch their reads and writes, which brings the work well
 * inside the default; this ceiling is what keeps a slow or contended database
 * from failing a signup that is merely slow.
 */
export const PROVISION_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

/**
 * Provision a complete, usable workspace: the Tenant, its own role set with
 * permissions, the owner membership, and the per-tenant defaults (Units,
 * Currencies, EmailTemplates).
 *
 * NOT CompanySettings — /setup still creates that, which is what keeps the
 * per-tenant setup gate meaningful. (The seeder's ledger step reaches it via
 * applyPack instead, which upserts CompanySettings itself.)
 *
 * Runs inside the caller's transaction on purpose. A half-provisioned workspace
 * (an owner with no roles, or a tenant with no members) is unusable and cannot
 * be repaired by retrying the signup, because the User row would already exist.
 */
export async function provisionTenant(
  tx: PrismaClient,
  opts: { ownerUserId: string; companyName?: string; tenantId?: string },
): Promise<{ id: string; name: string; slug: string }> {
  const name = opts.companyName?.trim() || 'Default Workspace';
  const tenant = await tx.tenant.create({
    data: {
      ...(opts.tenantId ? { id: opts.tenantId } : {}),
      name,
      slug: await uniqueSlug(opts.companyName?.trim() || 'workspace', tx),
      status: 'ACTIVE',
    },
  });

  await seedRolesForTenant(tenant.id, tx);
  const ownerRoleId = await ensureRole(OWNER_ROLE_NAME, tenant.id, tx);

  await tx.tenantMembership.create({
    data: {
      userId: opts.ownerUserId,
      tenantId: tenant.id,
      roleId: ownerRoleId,
      status: 'ACTIVE',
      isOwner: true,
      joinedAt: new Date(),
    },
  });

  await seedTenantDefaults(tenant.id, opts.ownerUserId, tx);

  return { id: tenant.id, name: tenant.name, slug: tenant.slug };
}
