import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { prisma } from '../lib/prisma';
import { setVerifiedTenantId } from '../lib/tenantContext';

interface DecodedToken {
  id: string;
  // The company-owner id (`ownerId ?? id`). Absent on tokens issued before the
  // shared-workspace feature — resolved from the DB below in that case.
  tenantId?: string;
  iat?: number;
  exp?: number;
}

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

  // Reject tokens whose user no longer exists (e.g. account recreated with a
  // new id after a reseed). Returning 401 lets the SPA cleanly force re-login
  // instead of leaking confusing 404s into forms mid-flow. Fail open on DB
  // errors so a transient hiccup doesn't log everyone out.
  //
  // We also resolve the tenant (company-owner) id here. Newer tokens carry it
  // as a `tenantId` claim; for tokens issued before the shared-workspace
  // feature we derive it from the freshly-loaded user (`ownerId ?? id`).
  let tenantId = decoded.tenantId;
  let userRoleId: string | null = null;
  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, ownerId: true, roleId: true },
    });
    if (!user) {
      res.status(401).json({ message: 'Session expired. Please sign in again.' });
      return;
    }
    if (!tenantId) {
      tenantId = user.ownerId ?? user.id;
    }
    userRoleId = user.roleId ?? null;
  } catch (err) {
    console.error('protect: user existence check failed, allowing request:', err);
  }

  req.user = decoded.id;
  // Fail safe to per-user scoping if the tenant couldn't be resolved (DB hiccup
  // on a pre-feature token) — never leak another tenant's data.
  req.tenantId = tenantId ?? decoded.id;

  // Promote the resolved tenant onto the request-scoped store, replacing the
  // optimistic JWT claim middleware/auditContext.ts put there. From here on,
  // lib/tenantGuard.ts scopes Prisma queries by a tenant we have actually
  // checked against the database rather than one the caller asserted.
  setVerifiedTenantId(req.tenantId);

  // Build req.actor: resolve role + permissions for server-side RBAC.
  // Permission-load failure is isolated — it clears perms (deny-by-default)
  // but does NOT fail the request (user existence check already guards that).
  let roleId: string | null = null;
  let roleName: string | null = null;
  const perms = new Map<string, {
    view: boolean; create: boolean; edit: boolean; delete: boolean; allowAll: boolean;
  }>();
  try {
    roleId = userRoleId;
    if (roleId) {
      const role = await prisma.role.findUnique({ where: { id: roleId }, select: { roleName: true } });
      roleName = role?.roleName ?? null;
      const rows = await prisma.permission.findMany({
        where: { roleId, deletedAt: null },
        include: { module: { select: { moduleSlug: true } } },
      });
      for (const p of rows) {
        const slug = (p.module as { moduleSlug?: string } | null)?.moduleSlug;
        if (!slug) continue;
        perms.set(slug, {
          view: !!p.view,
          create: !!p.create,
          edit: !!p.edit,
          delete: !!p.delete,
          allowAll: !!p.allowAll,
        });
      }
    }
  } catch (err) {
    console.error('protect: permission load failed, denying by default:', err);
    perms.clear();
  }
  req.actor = {
    userId: decoded.id,
    tenantId: req.tenantId,
    roleId,
    roleName,
    isOwner: roleName === 'Owner',
    perms,
  };

  next();
}

// Preserve the historical default-export shape so the existing JS controllers
// can `require('../middleware/authMiddleware')` unchanged. Once everything is
// TS we'll switch to named imports.
export default protect;
module.exports = protect;
module.exports.protect = protect;
module.exports.default = protect;
