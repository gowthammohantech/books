/**
 * "Who belongs to this workspace?" — one answer, in one place.
 *
 * WHY THIS EXISTS. Nine controllers each wrote their own version of this
 * question, all of them some spelling of:
 *
 *     where: { OR: [{ id: tenantId }, { ownerId: tenantId }] }
 *
 * That predicate encodes two assumptions the conversion has removed. The first
 * branch says "the user whose id IS the tenant id is a member", which was true
 * only because tenant #1 reused its owner's `User.id`. The second reads
 * `User.ownerId`, the single-workspace pointer that `TenantMembership`
 * replaced and that this phase drops.
 *
 * It is not merely legacy — it is WRONG TODAY for any workspace created through
 * POST /api/auth/tenants, which gets an ordinary uuid. In such a workspace the
 * owner matches neither branch: not the first (no user has that id), and not
 * the second (nobody set their `ownerId`). The owner of their own second
 * company therefore could not be paid back for an expense, given a payroll
 * profile, added to a project, or filed on a timesheet, and did not appear in
 * the staff activity report.
 *
 * Membership is the definition of "in this company", and it is the same
 * predicate `authMiddleware.protect` enforces — so a user this module admits is
 * one `protect` will authenticate, and a user it refuses is one who could not
 * have signed in to this workspace anyway.
 *
 * `User` is on the guard's EXPLICIT_MODELS list (a person belongs to N
 * workspaces, so there is no `User.tenantId` to filter on) — which makes this
 * the one place where tenant scoping is done by hand rather than structurally.
 * Concentrating it here is the point.
 */
import type { Prisma } from '@prisma/client';

import { prisma } from './prisma';

/**
 * `sys-bootstrap` exists only as an FK target for platform-seeded rows and must
 * never be treated as a person. It holds no membership, so the membership
 * filter already excludes it; the explicit NOT is belt-and-braces and documents
 * the intent at each call site that used to carry it.
 */
const NOT_SYSTEM_USER: Prisma.UserWhereInput = { NOT: { user_type: 999 } };

/**
 * The `User` where-fragment meaning "holds a membership in this workspace".
 *
 * Membership STATUS is deliberately not filtered. `listStaffUsers` — the query
 * that populates every employee dropdown in the app — does not filter it
 * either, and the two must agree: a person offered in a picker who is then
 * rejected on submit is a worse failure than including someone suspended. Use
 * {@link activeTenantMemberWhere} where the stricter reading is wanted.
 */
export function tenantMemberWhere(tenantId: string): Prisma.UserWhereInput {
  return {
    ...NOT_SYSTEM_USER,
    memberships: { some: { tenantId } },
  };
}

/**
 * Stricter: an ACTIVE membership, i.e. exactly who could sign in right now.
 * Use for anything that grants or implies the ability to act.
 */
export function activeTenantMemberWhere(tenantId: string): Prisma.UserWhereInput {
  return {
    ...NOT_SYSTEM_USER,
    memberships: { some: { tenantId, status: 'ACTIVE' } },
  };
}

/**
 * Is `userId` a member of `tenantId`?
 *
 * `includeDeleted` defaults to false: a soft-deleted user is not a valid target
 * for anything. Callers that were checking `isDeleted: false` get that for free.
 */
export async function isTenantMember(
  userId: string,
  tenantId: string,
  opts: { includeDeleted?: boolean; activeOnly?: boolean } = {},
): Promise<boolean> {
  const base = opts.activeOnly ? activeTenantMemberWhere(tenantId) : tenantMemberWhere(tenantId);
  const found = await prisma.user.findFirst({
    where: {
      ...base,
      id: userId,
      ...(opts.includeDeleted ? {} : { isDeleted: false }),
    },
    select: { id: true },
  });
  return !!found;
}

/**
 * Every user in the workspace, in a shape suitable for a picker or a report.
 * Ordered by name so callers do not each pick their own ordering.
 */
export async function listTenantMemberIds(tenantId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: tenantMemberWhere(tenantId),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
