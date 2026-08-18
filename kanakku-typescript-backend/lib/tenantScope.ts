import type { Request } from 'express';

/**
 * Throws a typed error with HTTP-style status if `req.user` (the userId
 * the auth middleware decoded from the JWT) is missing. Use this at the
 * top of any controller that needs the authenticated userId.
 */
export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = 'Not authorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Returns the **tenant** id for data scoping: the company-owner id, NOT the
 * individual logged-in user. `authMiddleware.protect` resolves this to
 * `ownerId ?? id` and stashes it on `req.tenantId`, so every staff/admin in a
 * company shares one dataset. Every converted controller should scope its
 * Prisma reads/writes by this id (via `tenantScope`) so all admins see all
 * invoices/expenses/etc.
 *
 * Name kept as `requireUserId` so the ~57 existing controllers don't need to
 * change — they already call this and now transparently get the tenant id.
 *
 * Falls back to `req.user` only when `req.tenantId` is absent (e.g. a route
 * that somehow bypassed tenant resolution), which fails safe to per-user
 * scoping rather than throwing or leaking another tenant's data.
 */
export function requireUserId(req: Request): string {
  const tenantId = req.tenantId;
  if (tenantId && typeof tenantId === 'string') {
    return tenantId;
  }
  return requireActingUserId(req);
}

/**
 * Returns the **acting** user's own id (the JWT subject), regardless of which
 * company they belong to. Use this ONLY for identity / self-account
 * operations (e.g. "my profile", login activity) — NOT for scoping shared
 * business data, which must use {@link requireUserId}/{@link tenantScope}.
 */
export function requireActingUserId(req: Request): string {
  const userId = req.user;
  if (!userId || typeof userId !== 'string') {
    throw new UnauthorizedError();
  }
  return userId;
}

/**
 * Returns the canonical per-user `where` partial that EVERY converted
 * controller should spread into its Prisma queries. We standardise on
 * `{ userId, isDeleted: false }` so soft-deleted rows are hidden by
 * default.
 *
 * If a controller legitimately needs to see soft-deleted rows (e.g. a
 * "trash" view) it can spread tenantScope(req) and then override
 * `isDeleted` explicitly.
 */
export function tenantScope(req: Request): { userId: string; isDeleted: false } {
  return { userId: requireUserId(req), isDeleted: false };
}
