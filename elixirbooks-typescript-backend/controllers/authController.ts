/* @cross-tenant: authentication necessarily precedes knowing the tenant. The
 * identity reads (find a user by email, list every workspace they belong to)
 * use prismaUnscoped because there is no workspace to scope by yet; the
 * provisioning writes use runAsSystem for the same reason. Which workspace a
 * session may act on is decided by TenantMembership, not by these queries. */
import type { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { UAParser } from 'ua-parser-js';
import geoip from 'geoip-lite';

import type { PrismaClient } from '@prisma/client';

import { prisma, prismaUnscoped } from '../lib/prisma';
import { runAsSystem } from '../lib/tenantContext';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/generateToken';
import { ensureRole, OWNER_ROLE_NAME } from '../lib/defaultRoles';
import { seedRolesForTenant } from '../prisma/seedRoles';
import { seedTenantDefaults } from '../prisma/seedTenant';

/**
 * The system bootstrap account (prisma/seed.ts). It exists only as an FK target
 * for platform reference rows and must never be able to authenticate.
 */
const BOOTSTRAP_USER_TYPE = 999;

function badInput(res: Response, errors: ReturnType<typeof validationResult>): void {
  res.status(400).json({
    errors: errors.array().map((err) => err.msg),
  });
}

/** Self-serve signup can be switched off entirely on a self-hosted install. */
export function signupsEnabled(): boolean {
  return process.env.SIGNUPS_ENABLED !== 'false';
}

/**
 * Optional hard ceiling on workspaces, so a single-company install can be
 * locked down after the first signup without disabling the endpoint (which
 * would also block the very first registration).
 */
function maxTenants(): number | null {
  const raw = process.env.MAX_TENANTS;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Turns a workspace name into a URL-safe slug that no tenant already holds.
 *
 * Tenant.slug is globally unique, so two companies both called "Acme" cannot
 * both be `acme`; the loser gets `acme-2`. The slug is cosmetic today (routing
 * is by JWT claim, not subdomain) but is unique from the start so that adding
 * subdomain routing later does not require a backfill.
 */
async function uniqueSlug(
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

export interface MembershipSummary {
  membershipId: string;
  tenantId: string;
  name: string;
  slug: string;
  roleName: string | null;
  isOwner: boolean;
}

/**
 * The workspaces a user can actually act in: ACTIVE membership on an ACTIVE,
 * non-deleted tenant. This is the same predicate authMiddleware.protect
 * enforces, so anything listed here is guaranteed to be switchable to.
 *
 * Cross-tenant by nature — it spans every workspace the caller belongs to.
 */
export async function loadMemberships(userId: string): Promise<MembershipSummary[]> {
  const rows = await prismaUnscoped.tenantMembership.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      tenant: { status: 'ACTIVE', deletedAt: null },
    },
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      tenantId: true,
      isOwner: true,
      tenant: { select: { name: true, slug: true } },
      role: { select: { roleName: true } },
    },
  });
  return rows.map((m) => ({
    membershipId: m.id,
    tenantId: m.tenantId,
    name: m.tenant.name,
    slug: m.tenant.slug,
    roleName: m.role?.roleName ?? null,
    isOwner: m.isOwner,
  }));
}

/**
 * Provision a complete, usable workspace: the Tenant, its own role set with
 * permissions, the owner membership, and the per-tenant defaults (Units,
 * Currencies, EmailTemplates).
 *
 * NOT CompanySettings — /setup still creates that, which is what keeps the
 * per-tenant setup gate meaningful.
 *
 * Runs inside the caller's transaction on purpose. A half-provisioned workspace
 * (an owner with no roles, or a tenant with no members) is unusable and cannot
 * be repaired by retrying the signup, because the User row would already exist.
 */
async function provisionTenant(
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

export async function register(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    badInput(res, errors);
    return;
  }

  const { firstName, lastName, email, phone, password, companyName } = req.body as {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    password: string;
    companyName?: string;
  };

  try {
    // The single-admin cap that made this install single-tenant is GONE. What
    // replaces it is a pair of deliberate, operator-controlled switches plus
    // the rate limiter on the route, so a self-hosted customer who wants the
    // old "one company, one owner" behaviour can still have it.
    if (!signupsEnabled()) {
      res.status(403).json({ message: 'Sign-ups are disabled on this instance.' });
      return;
    }
    const cap = maxTenants();
    if (cap !== null) {
      const existing = await prismaUnscoped.tenant.count({ where: { deletedAt: null } });
      if (existing >= cap) {
        res.status(403).json({ message: 'This instance is not accepting new workspaces.' });
        return;
      }
    }

    // A user is one identity across the whole platform (User.email stays
    // globally unique), which is what makes multi-membership and switching
    // coherent. Unscoped because we do not know — and must not assume — a
    // tenant here.
    const existingUser = await prismaUnscoped.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ message: 'Email already exists' });
      return;
    }

    const hashed = await hashPassword(password);

    // Registering creates a WORKSPACE, not just a user. runAsSystem because no
    // tenant exists yet to scope by.
    const { user, tenant } = await runAsSystem(() =>
      prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            firstName,
            lastName,
            email,
            phone,
            password: hashed,
            // `user_type` is signup intent, not authorization: nothing on the
            // server reads it for access decisions any more (requirePermission
            // consults req.actor.perms, and the Owner role carries allowAll).
            user_type: 1,
          },
        });

        // The tenant reuses its owner's User.id. This was LOAD-BEARING from P1
        // to P4, because protect() resolved the tenant as `ownerId ?? id` and
        // every migration's backfill depended on the two matching. It is
        // incidental now that protect() reads the membership — but it is kept
        // because it is what lets every already-issued token keep resolving,
        // and changing it would buy nothing. Additional workspaces created
        // through POST /api/tenants get ordinary uuids.
        const t = await provisionTenant(tx as unknown as PrismaClient, {
          ownerUserId: created.id,
          companyName,
          tenantId: created.id,
        });

        const ownerMembership = await tx.tenantMembership.findUnique({
          where: { userId_tenantId: { userId: created.id, tenantId: t.id } },
          select: { id: true, roleId: true },
        });

        // User.roleId is mirrored for one release while other code still reads
        // it; TenantMembership.roleId is authoritative (P9 drops the column).
        const withRole = await tx.user.update({
          where: { id: created.id },
          data: { roleId: ownerMembership?.roleId ?? null, lastTenantId: t.id },
        });

        return { user: withRole, tenant: t, membershipId: ownerMembership?.id };
      }),
    );

    const memberships = await loadMemberships(user.id);
    const { password: _pw, ...safeUser } = user;

    res.status(201).json({
      message: 'Workspace created successfully',
      token: generateToken(user.id, tenant.id, memberships[0]?.membershipId),
      user: safeUser,
      tenant,
      memberships,
    });
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    badInput(res, errors);
    return;
  }

  const { email, password } = req.body as { email: string; password: string };

  try {
    // Unscoped: at this point we do not know which workspace the caller
    // belongs to — resolving that is the whole job below.
    const user = await prismaUnscoped.user.findUnique({ where: { email } });
    if (!user || user.isDeleted || !(await comparePassword(password, user.password))) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    // prisma/seed.ts's `sys-bootstrap` row exists purely as an FK target for
    // platform reference data. It has a real (random) password hash and would
    // otherwise be a valid login with no membership and no owner.
    if (user.user_type === BOOTSTRAP_USER_TYPE) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    const memberships = await loadMemberships(user.id);
    if (memberships.length === 0) {
      // Credentials were correct, so this is not an authentication failure —
      // the account is real but belongs to no usable workspace (every
      // membership revoked, or every tenant suspended).
      res.status(403).json({
        message: 'Your account is not a member of any active workspace.',
      });
      return;
    }

    // With several workspaces, resume the one they were last in; otherwise the
    // oldest. No pre-auth workspace picker: it would double the login flow for
    // everyone to serve the rare multi-membership case, and the in-app switcher
    // covers it in one click.
    const active =
      memberships.find((m) => m.tenantId === user.lastTenantId) ?? memberships[0];

    // Capture login activity (best-effort; failure here must not break login).
    try {
      const forwardedFor = req.headers['x-forwarded-for'];
      const ipAddress =
        (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0]) ||
        req.socket.remoteAddress ||
        'Unknown';

      const ua = new UAParser(req.headers['user-agent']).getResult();
      const browser = ua.browser.name || 'Unknown';
      const device = ua.device.model
        ? `${ua.device.vendor || 'Unknown'} ${ua.device.model}`
        : 'Desktop';

      const geo = geoip.lookup(ipAddress);
      const location = geo
        ? `${geo.city || 'Unknown'}, ${geo.country || 'Unknown'}`
        : 'Unknown';

      // LoginActivity.userId is an ACTOR column — it records the person, not
      // the workspace — so this row is unchanged by tenancy.
      await prisma.loginActivity.create({
        data: { userId: user.id, ipAddress, browser, device, location },
      });
    } catch (activityErr) {
      console.warn('LoginActivity recording failed (non-fatal)', activityErr);
    }

    if (user.lastTenantId !== active.tenantId) {
      await prismaUnscoped.user
        .update({ where: { id: user.id }, data: { lastTenantId: active.tenantId } })
        .catch((e) => console.warn('lastTenantId update failed (non-fatal)', e));
    }

    // Never ship the password hash; expose a ready-to-use profileImageUrl so the
    // header avatar renders the photo right after login (not just after an edit).
    const { password: _pw, ...safeUser } = user;
    res.json({
      message: 'Login successful',
      token: generateToken(user.id, active.tenantId, active.membershipId),
      user: {
        ...safeUser,
        profileImageUrl: user.profileImage
          ? `${req.protocol}://${req.get('host')}/${user.profileImage}`
          : null,
      },
      tenant: {
        id: active.tenantId,
        name: active.name,
        slug: active.slug,
        roleName: active.roleName,
        isOwner: active.isOwner,
      },
      memberships,
    });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ message: 'Server error' });
  }
}

/**
 * POST /api/auth/switch-tenant — mint a token for another of the caller's
 * workspaces.
 *
 * The membership is re-verified here rather than trusted from the request: this
 * is the one endpoint whose entire purpose is to change which tenant a session
 * acts on, so it is exactly where a forged tenant id would be aimed.
 */
export async function switchTenant(req: Request, res: Response): Promise<void> {
  const userId = req.user;
  if (!userId) {
    res.status(401).json({ message: 'Not authorized' });
    return;
  }

  const { tenantId } = req.body as { tenantId?: string };
  if (!tenantId || typeof tenantId !== 'string') {
    res.status(400).json({ message: 'tenantId is required' });
    return;
  }

  try {
    const memberships = await loadMemberships(userId);
    const target = memberships.find((m) => m.tenantId === tenantId);
    if (!target) {
      // 403, not 404: the caller is authenticated, they simply may not act as
      // this workspace. A 404 would also leak whether the tenant exists.
      res.status(403).json({ message: 'You are not a member of that workspace.' });
      return;
    }

    await prismaUnscoped.user.update({
      where: { id: userId },
      data: { lastTenantId: target.tenantId },
    });

    res.json({
      message: 'Workspace switched',
      token: generateToken(userId, target.tenantId, target.membershipId),
      tenant: {
        id: target.tenantId,
        name: target.name,
        slug: target.slug,
        roleName: target.roleName,
        isOwner: target.isOwner,
      },
      memberships,
    });
  } catch (err) {
    console.error('switchTenant error', err);
    res.status(500).json({ message: 'Server error' });
  }
}

/**
 * GET /api/auth/session — everything the SPA needs to render itself for the
 * current user in the current workspace, in one call.
 *
 * This replaces the unauthenticated, INSTALL-WIDE question the frontend used to
 * ask on boot (`/api/admin/app-version` counted every user_type:1 user and every
 * CompanySettings row to decide which route tree to mount). That question has
 * no answer once more than one company exists; this one is per session.
 */
export async function session(req: Request, res: Response): Promise<void> {
  const userId = req.user;
  const tenantId = req.tenantId;
  const actor = req.actor;
  if (!userId || !tenantId || !actor) {
    res.status(401).json({ message: 'Not authorized' });
    return;
  }

  try {
    const [user, tenant, companySettings, memberships] = await Promise.all([
      prismaUnscoped.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          profileImage: true,
          user_type: true,
        },
      }),
      prismaUnscoped.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true, plan: true, status: true },
      }),
      prisma.companySettings.findFirst({
        where: { tenantId },
        select: { id: true, companyName: true, countryId: true },
      }),
      loadMemberships(userId),
    ]);

    if (!user || !tenant) {
      res.status(401).json({ message: 'Session expired. Please sign in again.' });
      return;
    }

    // A Map is not JSON-serialisable; the frontend permission helper reads a
    // plain object keyed by module slug.
    const permissions: Record<string, Express.ActorPerm> = {};
    for (const [slug, perm] of actor.perms) permissions[slug] = perm;

    res.json({
      success: true,
      data: {
        user: {
          ...user,
          profileImageUrl: user.profileImage
            ? `${req.protocol}://${req.get('host')}/${user.profileImage}`
            : null,
        },
        tenant: {
          ...tenant,
          roleName: actor.roleName,
          isOwner: actor.isOwner,
        },
        memberships,
        setup: {
          // The per-tenant replacement for the old install-wide
          // `company_settings` flag: has THIS workspace been through /setup?
          companySettingsComplete: !!companySettings,
        },
        permissions,
      },
    });
  } catch (err) {
    console.error('session error', err);
    res.status(500).json({ message: 'Server error' });
  }
}

/**
 * POST /api/tenants — create an ADDITIONAL workspace for the signed-in user.
 *
 * Same provisioning as signup, but the caller already exists, so there is no
 * new User row and the tenant gets an ordinary uuid rather than reusing a user
 * id (that reuse only ever made sense for a person's first workspace).
 */
export async function createTenant(req: Request, res: Response): Promise<void> {
  const userId = req.user;
  if (!userId) {
    res.status(401).json({ message: 'Not authorized' });
    return;
  }

  const { companyName } = req.body as { companyName?: string };
  if (!companyName || !companyName.trim()) {
    res.status(400).json({ message: 'companyName is required' });
    return;
  }

  try {
    if (!signupsEnabled()) {
      res.status(403).json({ message: 'Creating workspaces is disabled on this instance.' });
      return;
    }
    const cap = maxTenants();
    if (cap !== null) {
      const existing = await prismaUnscoped.tenant.count({ where: { deletedAt: null } });
      if (existing >= cap) {
        res.status(403).json({ message: 'This instance is not accepting new workspaces.' });
        return;
      }
    }

    const tenant = await runAsSystem(() =>
      prisma.$transaction((tx) =>
        provisionTenant(tx as unknown as PrismaClient, {
          ownerUserId: userId,
          companyName,
        }),
      ),
    );

    const memberships = await loadMemberships(userId);
    const created = memberships.find((m) => m.tenantId === tenant.id);

    res.status(201).json({
      message: 'Workspace created',
      // Hand back a token for the NEW workspace so the client can switch
      // straight into it without a second round-trip.
      token: generateToken(userId, tenant.id, created?.membershipId),
      tenant,
      memberships,
    });
  } catch (err) {
    console.error('createTenant error', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export function logout(_req: Request, res: Response): void {
  res.json({ message: 'Logout successful (handled client-side)' });
}

// CommonJS interop for legacy JS callers
module.exports = { register, login, logout, switchTenant, session, createTenant, loadMemberships, signupsEnabled };
module.exports.register = register;
module.exports.login = login;
module.exports.logout = logout;
module.exports.switchTenant = switchTenant;
module.exports.session = session;
module.exports.createTenant = createTenant;
module.exports.loadMemberships = loadMemberships;
module.exports.signupsEnabled = signupsEnabled;
