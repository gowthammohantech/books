import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { prisma } from '../lib/prisma';
import { setVerifiedTenantId } from '../lib/tenantContext';

interface DecodedToken {
  id: string;
  /**
   * The workspace this session is acting on. Present on every token this app
   * has ever minted (it used to hold `ownerId ?? id`, which is the id P1 gave
   * tenant #1), so the fallback below is for genuinely ancient tokens only.
   */
  tenantId?: string;
  /** TenantMembership id, v2 tokens only. Advisory — never trusted. */
  mid?: string;
  v?: number;
  iat?: number;
  exp?: number;
}

/**
 * Authenticate the caller and resolve the workspace they are acting on.
 *
 * THE MEMBERSHIP IS THE AUTHORIZATION. Before P5 this trusted the token's
 * tenant claim and looked up `User.ownerId ?? User.id` — which meant a token
 * kept working after its holder was removed from the company, and (once more
 * than one workspace exists) that a hand-edited claim would have been believed.
 * Now every request re-checks that an ACTIVE TenantMembership binds this user
 * to this tenant, and that the tenant itself is ACTIVE and not deleted. The
 * claim is only ever a SELECTOR for which of the caller's workspaces to load;
 * it can never grant access to one they are not a member of.
 *
 * 401, NOT 403, when the membership is absent. Deliberate: the frontend's axios
 * interceptor already turns 401 into a clean logout-and-bounce, so membership
 * revocation and tenant suspension get correct UX for free, with no new
 * frontend code. 403 would leave the user staring at a broken page.
 *
 * ONE QUERY. The old implementation ran three (user, role, permissions). The
 * membership include below collapses them, which pays for the extra
 * verification this phase adds rather than piling on top of it.
 */
export async function protect(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Not authorized' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ message: 'Server misconfigured: JWT_SECRET missing' });
    return;
  }

  let decoded: DecodedToken;
  try {
    decoded = jwt.verify(auth.split(' ')[1], secret) as DecodedToken;
  } catch {
    res.status(401).json({ message: 'Invalid token' });
    return;
  }

  let membership;
  try {
    membership = await prisma.tenantMembership.findFirst({
      where: {
        userId: decoded.id,
        status: 'ACTIVE',
        // The claim narrows to one workspace. Without it (a pre-tenancy token)
        // we fall back to the caller's oldest ACTIVE membership, which for
        // every existing install is their only one.
        ...(decoded.tenantId ? { tenantId: decoded.tenantId } : {}),
        tenant: { status: 'ACTIVE', deletedAt: null },
        user: { isDeleted: false },
      },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        tenantId: true,
        isOwner: true,
        roleId: true,
        role: {
          select: {
            id: true,
            roleName: true,
            permissions: {
              where: { deletedAt: null },
              select: {
                view: true,
                create: true,
                edit: true,
                delete: true,
                allowAll: true,
                module: { select: { moduleSlug: true } },
              },
            },
          },
        },
      },
    });
  } catch (err) {
    // A transient database problem must NOT look like a revoked session: 401
    // would log every signed-in user out across the whole install. 503 leaves
    // the session intact and lets the SPA retry.
    console.error('protect: membership lookup failed:', err);
    res.status(503).json({ message: 'Service temporarily unavailable' });
    return;
  }

  if (!membership) {
    // Covers all of: user deleted, membership revoked or suspended, tenant
    // suspended or soft-deleted, and a token naming a tenant the caller is not
    // a member of.
    res.status(401).json({ message: 'Session expired. Please sign in again.' });
    return;
  }

  req.user = decoded.id;
  req.tenantId = membership.tenantId;

  // Promote the VERIFIED tenant onto the request-scoped store, replacing the
  // optimistic JWT claim middleware/auditContext.ts put there. From here on,
  // lib/tenantGuard.ts scopes Prisma queries by a tenant we have actually
  // checked against the database rather than one the caller asserted.
  setVerifiedTenantId(membership.tenantId);

  const perms = new Map<string, {
    view: boolean; create: boolean; edit: boolean; delete: boolean; allowAll: boolean;
  }>();
  for (const p of membership.role?.permissions ?? []) {
    const slug = p.module?.moduleSlug;
    if (!slug) continue;
    perms.set(slug, {
      view: !!p.view,
      create: !!p.create,
      edit: !!p.edit,
      delete: !!p.delete,
      allowAll: !!p.allowAll,
    });
  }

  req.actor = {
    userId: decoded.id,
    tenantId: membership.tenantId,
    membershipId: membership.id,
    // The role comes from the MEMBERSHIP, not from User.roleId: a user may be
    // an Owner in one workspace and Staff in another, so a single column on
    // User cannot answer the question. User.roleId is still written for one
    // release and is dropped in P9.
    roleId: membership.roleId ?? null,
    roleName: membership.role?.roleName ?? null,
    // From the membership flag rather than a `roleName === 'Owner'` string
    // compare, which broke the moment a workspace renamed its Owner role.
    isOwner: membership.isOwner,
    perms,
  };

  next();
}

// Preserve the historical default-export shape so the existing JS controllers
// can `require('../middleware/authMiddleware')` unchanged. Once everything is
// TS we'll switch to named imports.
export default protect;
