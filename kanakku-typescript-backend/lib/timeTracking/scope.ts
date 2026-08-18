/**
 * lib/timeTracking/scope.ts
 *
 * Authorization guard for acting on *another* employee's timesheet
 * (submit-for-others / approve / reject). The route-level
 * `requirePermission('time-tracking-others', ...)` already gates the *ability*;
 * this guard narrows it to the *specific* employee+projects the actor may
 * manage:
 *
 *   - admin/owner can manage anyone (tenant-wide);
 *   - a project MANAGER can manage an employee only on projects where the actor
 *     is an active MANAGER member AND the target employee is an active member.
 *
 * Error model: follows the codebase convention (see lib/tenantScope.ts
 * `UnauthorizedError`) of a typed Error carrying an HTTP `status`. Controllers
 * catch `ForbiddenError` and map it to a 403 (mirroring how they `instanceof`
 * `UnauthorizedError` -> 401). We add 403 rather than reuse 401 because the
 * caller is authenticated but lacks rights over this resource.
 */

/** Thrown when the actor is authenticated but not allowed to manage the target. */
export class ForbiddenError extends Error {
  status = 403;
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * The subset of the resolved `Express.Actor` this guard needs. Kept structural
 * so callers can pass `req.actor` directly.
 */
export interface ScopeActor {
  userId: string;
  tenantId: string;
  isOwner: boolean;
}

/** A ProjectMember row, narrowed to the fields the guard reads. */
interface ProjectMemberLike {
  projectId: string;
  employeeUserId: string;
  role: 'MEMBER' | 'MANAGER' | string;
}

/**
 * The subset of PrismaClient this guard needs. Typed structurally so the helper
 * does not depend on the generated client types (and so tests can stub it).
 */
export interface ScopePrisma {
  projectMember: {
    findMany(args: {
      where: {
        projectId?: { in: string[] } | string;
        employeeUserId?: string;
        role?: string;
        isActive?: boolean;
      };
      select?: Record<string, boolean>;
    }): Promise<ProjectMemberLike[]>;
  };
}

/**
 * Throw {@link ForbiddenError} unless `actor` may manage `employeeUserId` on
 * every project in `projectIds`.
 *
 * Admins/owners short-circuit to allowed (no DB hit). For non-admins, the actor
 * must be an active MANAGER member of EACH listed project AND the target
 * employee must be an active member of EACH listed project. An empty/omitted
 * `projectIds` for a non-admin is rejected — there is nothing to authorize the
 * cross-employee action against.
 *
 * @param prisma         A PrismaClient (or compatible stub).
 * @param actor          The resolved caller (`req.actor`).
 * @param employeeUserId The target employee whose timesheet is being acted on.
 * @param projectIds     The project ids the action touches (defaults to []).
 */
export async function assertActorCanManageEmployee(
  prisma: ScopePrisma,
  actor: ScopeActor,
  employeeUserId: string,
  projectIds: string[] = [],
): Promise<void> {
  // Admin / owner: tenant-wide management, no per-project check needed.
  if (actor.isOwner) return;

  // A non-admin needs concrete projects to scope the authorization against.
  const ids = Array.from(new Set(projectIds));
  if (ids.length === 0) {
    throw new ForbiddenError('Not allowed to manage this employee');
  }

  // Projects on which the actor is an active MANAGER.
  const managed = await prisma.projectMember.findMany({
    where: {
      projectId: { in: ids },
      employeeUserId: actor.userId,
      role: 'MANAGER',
      isActive: true,
    },
    select: { projectId: true },
  });
  const managedSet = new Set(managed.map((m) => m.projectId));

  // The actor must manage EVERY requested project.
  for (const id of ids) {
    if (!managedSet.has(id)) {
      throw new ForbiddenError('Not allowed to manage this employee on this project');
    }
  }

  // The target employee must be an active member of EVERY requested project.
  const employeeMemberships = await prisma.projectMember.findMany({
    where: {
      projectId: { in: ids },
      employeeUserId,
      isActive: true,
    },
    select: { projectId: true },
  });
  const employeeSet = new Set(employeeMemberships.map((m) => m.projectId));

  for (const id of ids) {
    if (!employeeSet.has(id)) {
      throw new ForbiddenError('Employee is not a member of this project');
    }
  }
}
