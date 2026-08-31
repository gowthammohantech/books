/**
 * Who did this, as opposed to which company it belongs to.
 *
 * THE BUG THIS EXISTS TO CLOSE. Roughly sixty writes across the app put a
 * TENANT id into a column that is a FOREIGN KEY TO User — `createdBy`,
 * `changedBy`, `voidedById`, `reconciledBy`, `received_by`, `billFrom`. That
 * compiled and ran for years because the two were the same value: a tenant id
 * WAS the owner's `User.id`, so `createdBy: tenantId` stored a real user row.
 *
 * It stops being true the moment a workspace is created through
 * POST /api/auth/tenants, which gets an ordinary uuid. No `User` row carries
 * that id, so the insert dies on the foreign key: creating an expense in such a
 * workspace returns 500, not a subtly wrong audit trail. `lib/ledger/
 * applyBillPayment.ts` even carries a comment warning that "billTo is a User FK
 * — using it here would cause a FK violation in production", three lines above
 * a `createdBy: tenantId`.
 *
 * TWO DIFFERENT QUESTIONS, TWO DIFFERENT ANSWERS:
 *
 *   actor columns   (createdBy, changedBy, updatedBy, voidedById, reconciledBy,
 *                    received_by, approvedBy, salesPerson)
 *                   -> the person who performed the action. Use
 *                      requireActingUserId(req) where a request is in scope,
 *                      or resolveActorId() where it is not.
 *
 *   party columns   (billFrom, billTo)
 *                   -> "this company", as a User FK. A modelling wart from the
 *                      single-tenant era; the honest value is the workspace's
 *                      OWNER, which is exactly what these columns held before,
 *                      so tenantOwnerUserId() preserves their meaning rather
 *                      than quietly changing it to whoever clicked the button.
 */
import { getAuditContext } from './auditContext';
import { prisma } from './prisma';

/**
 * The acting user from the request-scoped context, or null outside a request.
 *
 * The context is populated by middleware/auditContext.ts from the JWT subject
 * and re-checked by `protect`, so inside a handled request this is the
 * authenticated person.
 */
export function currentActorId(): string | null {
  return getAuditContext()?.userId ?? null;
}

/**
 * The workspace's owner, as a User id.
 *
 * Every workspace has exactly one owner membership — `provisionTenant` creates
 * it in the same transaction as the tenant, so a tenant without one cannot
 * exist. Falls back to the oldest membership if an install somehow lost the
 * flag, and only then to null.
 */
export async function tenantOwnerUserId(tenantId: string): Promise<string | null> {
  const owner = await prisma.tenantMembership.findFirst({
    where: { tenantId, isOwner: true },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });
  if (owner) return owner.userId;

  const anyMember = await prisma.tenantMembership.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });
  return anyMember?.userId ?? null;
}

/**
 * The best available actor for a write happening outside a request — a cron, a
 * runner, a library called from one.
 *
 * Prefers the real actor when there is one (a runner invoked from an HTTP
 * request still has the context), and falls back to the workspace owner, who is
 * a real user and the person accountable for automation in their own company.
 * Never returns a tenant id.
 */
export async function resolveActorId(tenantId: string): Promise<string | null> {
  return currentActorId() ?? (await tenantOwnerUserId(tenantId));
}

// CommonJS interop, matching the other lib/* modules that legacy JS requires.
module.exports = { currentActorId, tenantOwnerUserId, resolveActorId };
module.exports.currentActorId = currentActorId;
module.exports.tenantOwnerUserId = tenantOwnerUserId;
module.exports.resolveActorId = resolveActorId;
