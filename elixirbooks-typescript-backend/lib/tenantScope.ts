import type { Request } from 'express';

/**
 * Throws a typed error with HTTP-style status if the caller is unauthenticated.
 * Use this at the top of any controller that needs the tenant or the actor.
 */
export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = 'Not authorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Returns the **tenant** id for data scoping: the workspace, NOT the individual
 * logged-in user. `authMiddleware.protect` resolves it and stashes it on
 * `req.tenantId`, so every member of a company shares one dataset.
 *
 * Every controller scopes its Prisma reads/writes by this id (via
 * {@link tenantScope}) so all members see the same invoices/expenses/etc.
 *
 * Falls back to `req.user` only when `req.tenantId` is absent (e.g. a route that
 * somehow bypassed tenant resolution), which fails safe to per-user scoping
 * rather than leaking another tenant's data.
 */
export function requireTenantId(req: Request): string {
  const tenantId = req.tenantId;
  if (tenantId && typeof tenantId === 'string') {
    return tenantId;
  }
  return requireActingUserId(req);
}

/**
 * Returns the **acting** user's own id (the JWT subject), regardless of which
 * workspace they are in. Use this ONLY for identity / self-account operations
 * (e.g. "my profile", login activity) and for stamping actor columns
 * (`createdBy`, `approvedById`, `changedBy`, ...) — NOT for scoping shared
 * business data, which must use {@link requireTenantId}/{@link tenantScope}.
 */
export function requireActingUserId(req: Request): string {
  const userId = req.user;
  if (!userId || typeof userId !== 'string') {
    throw new UnauthorizedError();
  }
  return userId;
}

/**
 * The canonical `where` partial that EVERY controller should spread into its
 * Prisma queries. We standardise on `{ tenantId, isDeleted: false }` so
 * soft-deleted rows are hidden by default.
 *
 * If a controller legitimately needs to see soft-deleted rows (e.g. a "trash"
 * view) it can spread tenantScope(req) and then override `isDeleted` explicitly.
 */
export function tenantScope(req: Request): { tenantId: string; isDeleted: false } {
  return { tenantId: requireTenantId(req), isDeleted: false };
}

// `requireUserId` used to be exported here as an alias for requireTenantId, so
// the ~500 pre-P3 call sites could migrate file-by-file rather than in one
// commit. Every one of them has, so the alias is gone. The name was actively
// misleading — it returned a TENANT id and never the acting user's — and that
// ambiguity caused real bugs (reminderController compared it against
// `createdBy`, an actor column). eslint.config.mjs still bans importing the
// name, which is what stops it coming back.
