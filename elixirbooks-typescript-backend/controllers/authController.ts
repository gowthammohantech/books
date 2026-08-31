import type { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { UAParser } from 'ua-parser-js';
import geoip from 'geoip-lite';

import type { PrismaClient } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { runAsSystem } from '../lib/tenantContext';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/generateToken';
import { ensureRole, DEFAULT_ROLE_BY_USER_TYPE, OWNER_ROLE_NAME } from '../lib/defaultRoles';
import { seedRolesForTenant } from '../prisma/seedRoles';
import { seedTenantDefaults } from '../prisma/seedTenant';

function badInput(res: Response, errors: ReturnType<typeof validationResult>): void {
  res.status(400).json({
    errors: errors.array().map((err) => err.msg),
  });
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
    // Only one admin (user_type === 1) is permitted.
    // TODO (P5): this cap is what makes the install single-tenant. It is lifted
    // in P5 together with signup rate limiting and the SIGNUPS_ENABLED flag —
    // not before, so P1 stays behaviour-identical.
    const existingAdmin = await prisma.user.findFirst({ where: { user_type: 1 } });
    if (existingAdmin) {
      res.status(403).json({
        message: 'Admin account already exists. Only one admin is allowed.',
      });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ message: 'Email already exists' });
      return;
    }

    const hashed = await hashPassword(password);

    // Registering creates a WORKSPACE, not just a user: a Tenant, its owner,
    // that tenant's own role set, and the membership binding them. All in one
    // transaction — a half-provisioned tenant (an owner with no roles, or a
    // tenant with no members) is unusable and cannot be repaired by retrying.
    //
    // runAsSystem because no tenant exists yet to scope by.
    const { user, tenant } = await runAsSystem(() =>
      prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            firstName,
            lastName,
            email,
            phone,
            password: hashed,
            user_type: 1,
          },
        });

        // INVARIANT (P1–P5): a tenant created here reuses its owner's User.id.
        // `protect` still resolves req.tenantId as `ownerId ?? id`, so
        // Tenant.id must equal that value or nothing would line up. P5
        // resolves the tenant from the membership instead and lifts this
        // constraint for additional workspaces.
        const t = await tx.tenant.create({
          data: {
            id: created.id,
            name: companyName?.trim() || 'Default Workspace',
            slug: await uniqueSlug(companyName?.trim() || 'workspace', tx),
            status: 'ACTIVE',
          },
        });

        // Provision this tenant's own Owner/Admin/Staff/... roles and their
        // permission rows. Failure here is fatal, unlike the old best-effort
        // ensureRole: an owner with no Owner role has access to nothing, and
        // the next-boot backfill cannot invent a membership.
        const { roleIds } = await seedRolesForTenant(
          t.id,
          tx as unknown as PrismaClient,
        );
        const ownerRoleId = await ensureRole(
          OWNER_ROLE_NAME,
          t.id,
          tx as unknown as PrismaClient,
        );
        void roleIds;

        await tx.tenantMembership.create({
          data: {
            userId: created.id,
            tenantId: t.id,
            roleId: ownerRoleId,
            status: 'ACTIVE',
            isOwner: true,
            joinedAt: new Date(),
          },
        });

        // Stock the workspace: Units, Currencies and EmailTemplates. Before
        // P4 these were install-global and every company shared one set;
        // each workspace gets its own now, and it has to happen inside this
        // transaction so a half-provisioned company can never exist. The
        // owner is Currency.createdBy — a non-null FK, and the only real
        // user in the workspace at this point.
        await seedTenantDefaults(t.id, created.id, tx as unknown as PrismaClient);

        // User.roleId is mirrored while authMiddleware still reads it (P5
        // switches to TenantMembership.roleId).
        const withRole = await tx.user.update({
          where: { id: created.id },
          data: { roleId: ownerRoleId, lastTenantId: t.id },
        });

        return { user: withRole, tenant: t };
      }),
    );

    res.status(201).json({
      message: 'Admin account created successfully',
      token: generateToken(user.id, tenant.id),
      user,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
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
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await comparePassword(password, user.password))) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

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

      await prisma.loginActivity.create({
        data: {
          userId: user.id,
          ipAddress,
          browser,
          device,
          location,
        },
      });
    } catch (activityErr) {
      console.warn('LoginActivity recording failed (non-fatal)', activityErr);
    }

    // Never ship the password hash; expose a ready-to-use profileImageUrl so the
    // header avatar renders the photo right after login (not just after an edit).
    const { password: _pw, ...safeUser } = user;
    res.json({
      message: 'Login successful',
      // Embed the company-owner id so the session shares the workspace dataset.
      // The owner's own ownerId is null, so it falls back to its own id.
      token: generateToken(user.id, user.ownerId ?? user.id),
      user: {
        ...safeUser,
        profileImageUrl: user.profileImage
          ? `${req.protocol}://${req.get('host')}/${user.profileImage}`
          : null,
      },
    });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export function logout(_req: Request, res: Response): void {
  res.json({ message: 'Logout successful (handled client-side)' });
}

// CommonJS interop for legacy JS callers
module.exports = { register, login, logout };
module.exports.register = register;
module.exports.login = login;
module.exports.logout = logout;
