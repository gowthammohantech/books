// controllers/timeTracking/leaveTypeController.ts
// Time Tracking — Phase C (Task 3): configurable leave types + per-employee
// annual allocations.
//
// Leave types (all tenant-scoped via requireUserId; tenant = ownerId ?? id):
//   GET    /leave-types          time-tracking,view
//   POST   /leave-types          time-tracking-others,create  { name, paid?, defaultAllocationDays?, isActive? }
//   PUT    /leave-types/:id       time-tracking-others,edit
//   DELETE /leave-types/:id       time-tracking-others,delete
//   Unique per (tenant, name) -> 409 on dup.
//
// Allocations:
//   GET  /leave-allocations?employeeUserId=&year=   time-tracking,view (own) /
//                                                    time-tracking-others,view (any employee)
//        Non-privileged actors are clamped to their own employeeUserId (mirrors
//        the Phase-1 timeReportController data-scope clamp).
//   POST /leave-allocations        time-tracking-others,create
//   PUT  /leave-allocations/:id     time-tracking-others,edit
//        body { employeeUserId, leaveTypeId, year, allocatedDays, carriedOverDays? }
//        Upsert on (employeeUserId, leaveTypeId, year). Validates the employee is
//        tenant staff and the leave type belongs to the tenant.

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { requireUserId, UnauthorizedError } from '../../lib/tenantScope';

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

function isAdminOrOwner(actor: { isOwner: boolean; roleName: string | null }): boolean {
  return actor.isOwner || actor.roleName === 'Admin';
}

/** Has the actor a specific action on `time-tracking-others`? */
function hasOthersView(req: Request): boolean {
  const p = req.actor?.perms.get('time-tracking-others');
  return !!(p && (p.allowAll || p.view));
}

/**
 * Verify the given user id is a staff member of this tenant. Reuses the
 * `listStaffUsers` tenant-scope rule from projectMemberController: the owner
 * themselves OR a user whose ownerId == tenant, excluding the super-admin.
 */
async function isTenantStaff(tenantId: string, employeeUserId: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: {
      id: employeeUserId,
      NOT: { user_type: 999 },
      OR: [{ id: tenantId }, { ownerId: tenantId }],
    },
    select: { id: true },
  });
  return !!user;
}

// =============================================================================
// Leave types
// =============================================================================

/** GET /leave-types */
export async function listLeaveTypes(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const leaveTypes = await prisma.leaveType.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: { leaveTypes } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('listLeaveTypes error:', err);
    res.status(500).json({ success: false, message: 'Failed to list leave types' });
  }
}

/** POST /leave-types — { name, paid?, defaultAllocationDays?, isActive? } */
export async function createLeaveType(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { name, paid, defaultAllocationDays, isActive } = req.body as {
      name?: string;
      paid?: boolean;
      defaultAllocationDays?: number | null;
      isActive?: boolean;
    };

    if (!name) {
      res.status(400).json({ success: false, message: 'name is required' });
      return;
    }

    const leaveType = await prisma.leaveType.create({
      data: {
        userId,
        name,
        ...(paid !== undefined && { paid }),
        defaultAllocationDays:
          defaultAllocationDays === undefined || defaultAllocationDays === null
            ? null
            : new Prisma.Decimal(defaultAllocationDays),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.status(201).json({ success: true, data: { leaveType } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ success: false, message: 'A leave type with this name already exists' });
      return;
    }
    console.error('createLeaveType error:', err);
    res.status(500).json({ success: false, message: 'Failed to create leave type' });
  }
}

/** PUT /leave-types/:id — { name?, paid?, defaultAllocationDays?, isActive? } */
export async function updateLeaveType(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = String(req.params.id);

    const existing = await prisma.leaveType.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Leave type not found' });
      return;
    }

    const { name, paid, defaultAllocationDays, isActive } = req.body as {
      name?: string;
      paid?: boolean;
      defaultAllocationDays?: number | null;
      isActive?: boolean;
    };

    if (
      name === undefined &&
      paid === undefined &&
      defaultAllocationDays === undefined &&
      isActive === undefined
    ) {
      res.status(400).json({ success: false, message: 'At least one field required' });
      return;
    }

    const leaveType = await prisma.leaveType.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(paid !== undefined && { paid }),
        ...(defaultAllocationDays !== undefined && {
          defaultAllocationDays:
            defaultAllocationDays === null ? null : new Prisma.Decimal(defaultAllocationDays),
        }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json({ success: true, data: { leaveType } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ success: false, message: 'A leave type with this name already exists' });
      return;
    }
    console.error('updateLeaveType error:', err);
    res.status(500).json({ success: false, message: 'Failed to update leave type' });
  }
}

/** DELETE /leave-types/:id */
export async function deleteLeaveType(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = String(req.params.id);

    const existing = await prisma.leaveType.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Leave type not found' });
      return;
    }

    await prisma.leaveType.delete({ where: { id } });
    res.json({ success: true, message: 'Leave type removed' });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      res.status(409).json({
        success: false,
        message: 'Cannot delete a leave type with existing allocations or requests',
      });
      return;
    }
    console.error('deleteLeaveType error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove leave type' });
  }
}

// =============================================================================
// Leave allocations
// =============================================================================

/** GET /leave-allocations?employeeUserId=&year= */
export async function listLeaveAllocations(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError();

    const canSeeOthers = isAdminOrOwner(actor) || hasOthersView(req);

    // Data-scope clamp (mirrors timeReportController): non-privileged actors are
    // forced to their own employeeUserId regardless of the query param.
    let employeeUserIdFilter: string | undefined;
    if (req.query.employeeUserId && typeof req.query.employeeUserId === 'string') {
      employeeUserIdFilter = canSeeOthers ? req.query.employeeUserId : actor.userId;
    } else if (!canSeeOthers) {
      employeeUserIdFilter = actor.userId;
    }

    let yearFilter: number | undefined;
    if (req.query.year !== undefined && req.query.year !== '') {
      const y = Number(req.query.year);
      if (!Number.isInteger(y)) {
        res.status(400).json({ success: false, message: 'year must be an integer' });
        return;
      }
      yearFilter = y;
    }

    const allocations = await prisma.leaveAllocation.findMany({
      where: {
        userId: tenantId,
        ...(employeeUserIdFilter ? { employeeUserId: employeeUserIdFilter } : {}),
        ...(yearFilter !== undefined ? { year: yearFilter } : {}),
      },
      include: {
        leaveType: { select: { id: true, name: true, paid: true } },
        employee: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
    });

    res.json({ success: true, data: { allocations } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('listLeaveAllocations error:', err);
    res.status(500).json({ success: false, message: 'Failed to list leave allocations' });
  }
}

/**
 * Shared upsert handler for POST /leave-allocations and PUT /leave-allocations/:id.
 * Upserts on (employeeUserId, leaveTypeId, year).
 */
async function upsertAllocation(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);

    const id = req.params.id ? String(req.params.id) : undefined;

    const { employeeUserId, leaveTypeId, year, allocatedDays, carriedOverDays } = req.body as {
      employeeUserId?: string;
      leaveTypeId?: string;
      year?: number;
      allocatedDays?: number;
      carriedOverDays?: number;
    };

    if (!employeeUserId || !leaveTypeId || year === undefined || allocatedDays === undefined) {
      res.status(400).json({
        success: false,
        message: 'employeeUserId, leaveTypeId, year and allocatedDays are required',
      });
      return;
    }

    // PUT: the target row must exist and belong to the tenant.
    if (id) {
      const existing = await prisma.leaveAllocation.findFirst({ where: { id, userId: tenantId } });
      if (!existing) {
        res.status(404).json({ success: false, message: 'Leave allocation not found' });
        return;
      }
    }

    // Validate the employee is staff of this tenant.
    if (!(await isTenantStaff(tenantId, employeeUserId))) {
      res
        .status(400)
        .json({ success: false, message: 'employeeUserId is not a staff user of this tenant' });
      return;
    }

    // Validate the leave type belongs to this tenant.
    const leaveType = await prisma.leaveType.findFirst({
      where: { id: leaveTypeId, userId: tenantId },
      select: { id: true },
    });
    if (!leaveType) {
      res.status(400).json({ success: false, message: 'leaveType not found for this tenant' });
      return;
    }

    const allocatedDec = new Prisma.Decimal(allocatedDays);
    const carriedDec =
      carriedOverDays === undefined ? undefined : new Prisma.Decimal(carriedOverDays);

    const allocation = await prisma.leaveAllocation.upsert({
      where: {
        employeeUserId_leaveTypeId_year: { employeeUserId, leaveTypeId, year },
      },
      create: {
        userId: tenantId,
        employeeUserId,
        leaveTypeId,
        year,
        allocatedDays: allocatedDec,
        ...(carriedDec !== undefined && { carriedOverDays: carriedDec }),
      },
      update: {
        allocatedDays: allocatedDec,
        ...(carriedDec !== undefined && { carriedOverDays: carriedDec }),
      },
      include: {
        leaveType: { select: { id: true, name: true, paid: true } },
        employee: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    res.status(id ? 200 : 201).json({ success: true, data: { allocation } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('upsertAllocation error:', err);
    res.status(500).json({ success: false, message: 'Failed to save leave allocation' });
  }
}

/** POST /leave-allocations */
export async function createLeaveAllocation(req: Request, res: Response): Promise<void> {
  await upsertAllocation(req, res);
}

/** PUT /leave-allocations/:id */
export async function updateLeaveAllocation(req: Request, res: Response): Promise<void> {
  await upsertAllocation(req, res);
}

// CommonJS interop for legacy JS route files.
module.exports = {
  listLeaveTypes,
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,
  listLeaveAllocations,
  createLeaveAllocation,
  updateLeaveAllocation,
};
module.exports.listLeaveTypes = listLeaveTypes;
module.exports.createLeaveType = createLeaveType;
module.exports.updateLeaveType = updateLeaveType;
module.exports.deleteLeaveType = deleteLeaveType;
module.exports.listLeaveAllocations = listLeaveAllocations;
module.exports.createLeaveAllocation = createLeaveAllocation;
module.exports.updateLeaveAllocation = updateLeaveAllocation;
