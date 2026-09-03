import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { prisma } from '../lib/prisma';
import { runWithAuditContext, type AuditContext } from '../lib/auditContext';

// This middleware runs globally (before the per-route `protect`), so `req.user`
// is not set yet. Derive the actor straight from the Bearer token instead, so
// audited writes are attributed to the real user rather than "system".
//
// The `tenantId` claim is read here too, but only as an OPTIMISTIC value: it
// gives unauthenticated/pre-`protect` code a tenant to scope by, and `protect`
// overwrites it with the membership-verified tenant before any route handler
// runs. A forged claim can therefore only narrow what a request sees, never
// widen it — see lib/auditContext.ts's AuditContext.tenantId.
function claimsFromToken(req: Request): { userId: string | null; tenantId: string | null } {
  const empty = { userId: null, tenantId: null };
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return empty;
  const secret = process.env.JWT_SECRET;
  if (!secret) return empty;
  try {
    const decoded = jwt.verify(auth.split(' ')[1], secret) as {
      id?: string;
      tenantId?: string;
    };
    return {
      userId: typeof decoded.id === 'string' ? decoded.id : null,
      tenantId: typeof decoded.tenantId === 'string' ? decoded.tenantId : null,
    };
  } catch {
    return empty;
  }
}

export async function auditContextMiddleware(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  const claims = claimsFromToken(req);
  const userId = (typeof req.user === 'string' ? req.user : null) ?? claims.userId;
  const tenantId = (typeof req.tenantId === 'string' ? req.tenantId : null) ?? claims.tenantId;
  const ipAddress = req.ip ?? null;
  const userAgent = (req.headers['user-agent'] as string | undefined) ?? null;

  let userName = 'system';
  if (userId) {
    try {
      // @user-scope: self — `userId` is the JWT subject being labelled for the
      // audit trail, resolved before any tenant is known.
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true, email: true },
      });
      if (u) {
        const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
        userName = full || u.email || 'system';
      }
    } catch {
      userName = 'system';
    }
  }

  const ctx: AuditContext = { userId, userName, ipAddress, userAgent, tenantId };
  runWithAuditContext(ctx, () => next());
}
