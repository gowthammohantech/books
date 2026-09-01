import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The process's ONE request-scoped store.
 *
 * The name is historical — it started life carrying only the audit actor — but
 * it now also carries the tenant the request is acting on, because lib/
 * tenantGuard.ts needs a tenant on every Prisma query and a second
 * AsyncLocalStorage would be a second source of truth for "who is this
 * request?". One store, one middleware (middleware/auditContext.ts, mounted
 * globally in server.ts before every route).
 *
 * Prefer the helpers in lib/tenantContext.ts (getTenantId / runAsSystem /
 * runAsTenant) over touching `tenantId` and `bypass` directly.
 */
export interface AuditContext {
  userId?: string | null;
  userName: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  /**
   * The tenant this request is acting on.
   *
   * Set best-effort from the JWT `tenantId` claim by
   * middleware/auditContext.ts (which runs before `protect` and so has no
   * verified identity yet), then OVERWRITTEN IN PLACE by authMiddleware's
   * `protect` with the membership-verified value.
   *
   * The unverified claim is only ever used as a query *filter*, never as an
   * authorization decision: `protect` 401s before any route handler runs if the
   * caller has no active membership in the claimed tenant.
   */
  tenantId?: string | null;
  /**
   * Escape hatch: when true the tenant guard passes every query through
   * unscoped. Set only by `runAsSystem()` — seeds, boot backfills, data
   * migrations and platform-level admin paths. Never derived from
   * request-supplied data.
   */
  bypass?: boolean;
}

const storage = new AsyncLocalStorage<AuditContext>();

export function runWithAuditContext<T>(ctx: AuditContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getAuditContext(): AuditContext | undefined {
  return storage.getStore();
}
