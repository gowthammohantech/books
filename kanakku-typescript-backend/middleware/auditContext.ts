import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { runWithAuditContext, type AuditContext } from '../lib/auditContext';

// This middleware runs globally (before the per-route `protect`), so `req.user`
// is not set yet. Derive the actor straight from the Bearer token instead, so
// audited writes are attributed to the real user rather than "system".
function userIdFromToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const decoded = jwt.verify(auth.split(' ')[1], secret) as { id?: string };
    return typeof decoded.id === 'string' ? decoded.id : null;
  } catch {
    return null;
  }
}

export async function auditContextMiddleware(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  const userId = (typeof req.user === 'string' ? req.user : null) ?? userIdFromToken(req);
  const ipAddress = req.ip ?? null;
  const userAgent = (req.headers['user-agent'] as string | undefined) ?? null;

  let userName = 'system';
  if (userId) {
    try {
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

  const ctx: AuditContext = { userId, userName, ipAddress, userAgent };
  runWithAuditContext(ctx, () => next());
}

module.exports = { auditContextMiddleware };
module.exports.auditContextMiddleware = auditContextMiddleware;
