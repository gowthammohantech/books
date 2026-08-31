// lib/tenantContext.ts
//
// The tenant half of the request-scoped context stored in lib/auditContext.ts.
//
// Every Prisma query for a tenant-scoped model is filtered by the tenant id
// found here (see lib/tenantGuard.ts). Code that runs OUTSIDE a request — boot
// seeds, data backfills, cron jobs, public token-link handlers — has no tenant
// on the store and must declare its intent explicitly with one of the wrappers
// below, or the guard throws rather than guessing.
//
// Why wrappers and not a mutable setter: `runAsSystem` / `runAsTenant` open a
// NESTED AsyncLocalStorage scope, so the previous context is restored
// automatically when the callback settles. That makes them safe to nest (a cron
// iterating tenants, a request that briefly needs system access) and impossible
// to leak across an await boundary.

import {
  getAuditContext,
  runWithAuditContext,
  type AuditContext,
} from './auditContext';

/**
 * Thrown when a tenant-scoped query runs with no tenant on the context and no
 * explicit bypass. Deliberately fails loud: returning every tenant's rows would
 * be a data leak and returning none would be silent data loss.
 */
export class TenantContextMissingError extends Error {
  status = 500;
  constructor(detail = 'No tenant in context') {
    super(
      `${detail}. Wrap this call in runAsTenant(tenantId, ...) or runAsSystem(...) ` +
      'from lib/tenantContext, or use prismaUnscoped for a deliberate ' +
      'cross-tenant read.',
    );
    this.name = 'TenantContextMissingError';
  }
}

/** The tenant the current request/job is acting on, or null outside one. */
export function getTenantId(): string | null {
  return getAuditContext()?.tenantId ?? null;
}

/** True when the current scope was opened by {@link runAsSystem}. */
export function isBypassed(): boolean {
  return getAuditContext()?.bypass === true;
}

function inherit(overrides: Partial<AuditContext>): AuditContext {
  const parent = getAuditContext();
  return {
    userName: 'system',
    ...(parent ?? {}),
    ...overrides,
  };
}

/**
 * Runs `fn` with the tenant guard disabled — every model is queried unscoped.
 *
 * For platform-level work only: prisma/seed.ts and its sub-seeders, the
 * prisma/backfill*.ts and migrate*.ts scripts, importGeoDataset, and any future
 * super-admin path. Never call this from a route handler on request data.
 */
export function runAsSystem<T>(fn: () => T): T {
  return runWithAuditContext(inherit({ tenantId: null, bypass: true }), fn);
}

/**
 * Runs `fn` scoped to `tenantId`, as if a member of that tenant had made the
 * request. For work that knows its tenant but has no HTTP request behind it:
 * the four crons, public token-link handlers, and per-tenant seeding.
 *
 * This grants full access to that tenant's data — resolve `tenantId` from
 * trusted state (a row you just read, an env var), never from unvalidated
 * request input.
 */
export function runAsTenant<T>(tenantId: string, fn: () => T): T {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new TenantContextMissingError('runAsTenant called without a tenant id');
  }
  return runWithAuditContext(inherit({ tenantId, bypass: false }), fn);
}

/**
 * Promotes the tenant on the CURRENT context in place, without opening a nested
 * scope.
 *
 * Used by exactly one caller: authMiddleware's `protect`, to replace the
 * unverified JWT claim that middleware/auditContext.ts optimistically stored
 * with the membership-verified tenant. `protect` already runs *inside* the ALS
 * scope opened by that middleware, so it cannot call `storage.run` again
 * without ending the scope when it returns — mutating the stored object is the
 * correct pattern here, and the only place it is correct.
 */
export function setVerifiedTenantId(tenantId: string | null): void {
  const ctx = getAuditContext();
  if (ctx) ctx.tenantId = tenantId;
}

// CommonJS interop — quotationReminderCron.js and controllers/externalController.js
// are still CJS and require() this module. Mirrors lib/auditContext.ts.
module.exports = {
  TenantContextMissingError,
  getTenantId,
  isBypassed,
  runAsSystem,
  runAsTenant,
  setVerifiedTenantId,
};
module.exports.TenantContextMissingError = TenantContextMissingError;
module.exports.getTenantId = getTenantId;
module.exports.isBypassed = isBypassed;
module.exports.runAsSystem = runAsSystem;
module.exports.runAsTenant = runAsTenant;
module.exports.setVerifiedTenantId = setVerifiedTenantId;
