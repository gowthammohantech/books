// controllers/timeTracking/projectMemberController.ts
// Time Tracking — Phase 1 (Task 4)
// Project members CRUD + project billing settings. All handlers are tenant-scoped
// via requireTenantId(req) (tenant = ownerId ?? id) and follow the existing
// dimensionReportController patterns (response envelope `{ success, data }`,
// P2002 -> 409, UnauthorizedError -> handleUnauthorized).

import type { Request, Response } from 'express';
import { Prisma, ProjectMemberRole } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { requireTenantId, UnauthorizedError } from '../../lib/tenantScope';
import { isTenantMember } from '../../lib/tenantMembers';

// =============================================================================
// Shared helpers
// =============================================================================

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function parseDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Resolve a project that belongs to the tenant, or null. */
async function findTenantProject(tenantId: string, projectId: string) {
  return prisma.project.findFirst({ where: { id: projectId, tenantId: tenantId } });
}

/**
 * Verify the given user id belongs to this workspace. Delegates to the shared
 * membership predicate so this agrees with `listStaffUsers` — the query that
 * populates the employee picker this value comes from.
 */
async function isTenantStaff(tenantId: string, employeeUserId: string): Promise<boolean> {
  return isTenantMember(employeeUserId, tenantId);
}

/** Shape a ProjectMember (with employee) for the API response. */
function serializeMember(m: {
  id: string;
  employeeUserId: string;
  role: ProjectMemberRole;
  billingRate: Prisma.Decimal | null;
  isActive: boolean;
  employee?: { firstName: string; lastName: string | null; email: string } | null;
}) {
  const name = m.employee
    ? `${m.employee.firstName}${m.employee.lastName ? ` ${m.employee.lastName}` : ''}`.trim()
    : '';
  return {
    id: m.id,
    employeeUserId: m.employeeUserId,
    employee: {
      name,
      email: m.employee?.email ?? '',
    },
    role: m.role,
    billingRate: m.billingRate,
    isActive: m.isActive,
  };
}

const MEMBER_INCLUDE = {
  employee: { select: { firstName: true, lastName: true, email: true } },
} as const;

// =============================================================================
// Project members
// =============================================================================

/** GET /projects/:projectId/members */
export async function listProjectMembers(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const projectId = String(req.params.projectId);

    const project = await findTenantProject(tenantId, projectId);
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const members = await prisma.projectMember.findMany({
      where: { tenantId, projectId },
      orderBy: { createdAt: 'asc' },
      include: MEMBER_INCLUDE,
    });

    res.json({ success: true, data: { members: members.map(serializeMember) } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('listProjectMembers error:', err);
    res.status(500).json({ success: false, message: 'Failed to list project members' });
  }
}

/** POST /projects/:projectId/members — { employeeUserId, role, billingRate? }; upsert on (project, employee). */
export async function addProjectMember(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const projectId = String(req.params.projectId);
    const { employeeUserId, role, billingRate } = req.body as {
      employeeUserId?: string;
      role?: ProjectMemberRole;
      billingRate?: number | null;
    };

    if (!employeeUserId) {
      res.status(400).json({ success: false, message: 'employeeUserId is required' });
      return;
    }

    const project = await findTenantProject(tenantId, projectId);
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    if (!(await isTenantStaff(tenantId, employeeUserId))) {
      res.status(400).json({ success: false, message: 'employeeUserId is not a staff user of this tenant' });
      return;
    }

    const resolvedRole = role ?? ProjectMemberRole.MEMBER;
    const rate =
      billingRate === undefined ? undefined : billingRate === null ? null : new Prisma.Decimal(billingRate);

    // Upsert on the @@unique([projectId, employeeUserId]); re-activate on re-add.
    const member = await prisma.projectMember.upsert({
      where: { projectId_employeeUserId: { projectId, employeeUserId } },
      create: {
        tenantId,
        projectId,
        employeeUserId,
        role: resolvedRole,
        ...(rate !== undefined && { billingRate: rate }),
        isActive: true,
      },
      update: {
        role: resolvedRole,
        ...(rate !== undefined && { billingRate: rate }),
        isActive: true,
      },
      include: MEMBER_INCLUDE,
    });

    res.status(201).json({ success: true, data: { member: serializeMember(member) } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ success: false, message: 'This employee is already a member of the project' });
      return;
    }
    console.error('addProjectMember error:', err);
    res.status(500).json({ success: false, message: 'Failed to add project member' });
  }
}

/** PUT /projects/:projectId/members/:memberId — role/rate/isActive. */
export async function updateProjectMember(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const projectId = String(req.params.projectId);
    const memberId = String(req.params.memberId);

    const existing = await prisma.projectMember.findFirst({
      where: { id: memberId, projectId, tenantId },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Project member not found' });
      return;
    }

    const { role, billingRate, isActive } = req.body as {
      role?: ProjectMemberRole;
      billingRate?: number | null;
      isActive?: boolean;
    };

    if (role == null && billingRate === undefined && isActive == null) {
      res.status(400).json({ success: false, message: 'At least one field required' });
      return;
    }

    const rate =
      billingRate === undefined ? undefined : billingRate === null ? null : new Prisma.Decimal(billingRate);

    const member = await prisma.projectMember.update({
      where: { id: memberId },
      data: {
        ...(role != null && { role }),
        ...(rate !== undefined && { billingRate: rate }),
        ...(isActive != null && { isActive }),
      },
      include: MEMBER_INCLUDE,
    });

    res.json({ success: true, data: { member: serializeMember(member) } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('updateProjectMember error:', err);
    res.status(500).json({ success: false, message: 'Failed to update project member' });
  }
}

/** DELETE /projects/:projectId/members/:memberId */
export async function deleteProjectMember(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const projectId = String(req.params.projectId);
    const memberId = String(req.params.memberId);

    const existing = await prisma.projectMember.findFirst({
      where: { id: memberId, projectId, tenantId },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Project member not found' });
      return;
    }

    await prisma.projectMember.delete({ where: { id: memberId } });
    res.json({ success: true, message: 'Project member removed' });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('deleteProjectMember error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove project member' });
  }
}

// =============================================================================
// Project settings
// =============================================================================

/** PUT /projects/:projectId/settings — { billingRate?, startDate?, endDate?, contactId? }. */
export async function updateProjectSettings(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const projectId = String(req.params.projectId);

    const project = await findTenantProject(tenantId, projectId);
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const body = req.body as {
      billingRate?: number | null;
      startDate?: string | null;
      endDate?: string | null;
      contactId?: string | null;
    };

    // Validate startDate ≤ endDate when both are provided.
    if (body.startDate && body.endDate) {
      const start = new Date(body.startDate);
      const end = new Date(body.endDate);
      if (start > end) {
        res.status(400).json({ success: false, message: 'Start date must be on or before end date' });
        return;
      }
    }

    // Validate contactId belongs to this tenant.
    if (body.contactId != null && body.contactId !== '') {
      const contact = await prisma.contact.findFirst({
        where: { id: body.contactId, tenantId, isDeleted: false },
        select: { id: true },
      });
      if (!contact) {
        res.status(400).json({ success: false, message: 'Contact not found' });
        return;
      }
    }

    const data: Prisma.ProjectUpdateInput = {};

    if ('billingRate' in body) {
      data.billingRate =
        body.billingRate === null || body.billingRate === undefined
          ? null
          : new Prisma.Decimal(body.billingRate);
    }
    if ('startDate' in body) {
      data.startDate = body.startDate ? parseDate(body.startDate) ?? null : null;
    }
    if ('endDate' in body) {
      data.endDate = body.endDate ? parseDate(body.endDate) ?? null : null;
    }
    if ('contactId' in body) {
      data.contactId = body.contactId ?? null;
    }

    const updated = await prisma.project.update({ where: { id: projectId }, data });

    res.json({ success: true, data: { project: updated } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('updateProjectSettings error:', err);
    res.status(500).json({ success: false, message: 'Failed to update project settings' });
  }
}
