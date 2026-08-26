// controllers/timeTracking/leaveRequestController.ts
// Time Tracking — Phase C (Task 4): leave requests + approval + balances (core).
//
// All routes `protect`, tenant-scoped via requireUserId(req) (tenant = ownerId ?? id).
// Leave is NOT project-scoped, so "manage others" = admin/owner OR the
// `time-tracking-others` permission (no project-manager scoping).
//
//   POST /leave-requests                 time-tracking,create   { leaveTypeId, startDate, endDate, perDay?, defaultPortion?, reason? }
//   GET  /leave-requests?scope=mine|pending&page=&limit=        time-tracking,view
//   GET  /leave-requests/:id             time-tracking,view     (own or manage-others)
//   POST /leave-requests/:id/approve     time-tracking-others   PENDING -> APPROVED (paid types balance-checked)
//   POST /leave-requests/:id/reject      time-tracking-others   PENDING -> REJECTED { rejectionNote? }
//   POST /leave-requests/:id/cancel      time-tracking          own or manage-others
//   GET  /leave-balances?employeeUserId=&year=                  time-tracking,view (own) / others

import type { Request, Response } from 'express';
import { LeaveStatus, Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { requireUserId, requireActingUserId, UnauthorizedError } from '../../lib/tenantScope';
import { buildLeaveDays, type LeavePortion } from '../../lib/timeTracking/leaveDays';
import { computeLeaveBalances } from '../../lib/timeTracking/balance';

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

/** Has the actor any access on `time-tracking-others` (view or full)? */
function hasOthers(req: Request, action: 'view' | 'create' | 'edit' | 'delete'): boolean {
  const p = req.actor?.perms.get('time-tracking-others');
  return !!(p && (p.allowAll || p[action]));
}

/**
 * Whether the actor may manage other employees' leave. Leave is not
 * project-scoped — so manage-others = admin/owner OR holds the given
 * `time-tracking-others` action.
 */
function canManageOthers(
  req: Request,
  actor: { isOwner: boolean; roleName: string | null },
  action: 'view' | 'edit',
): boolean {
  return isAdminOrOwner(actor) || hasOthers(req, action);
}

function resolveActor(req: Request): { userId: string; isOwner: boolean; roleName: string | null } {
  const actor = req.actor;
  if (!actor) throw new UnauthorizedError();
  return { userId: actor.userId, isOwner: actor.isOwner, roleName: actor.roleName };
}

/** Take the `yyyy-MM-dd` prefix of a date-only / ISO datetime string or Date. */
function dateKey(value: string | Date): string {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/** Parse a date-only / ISO string to UTC midnight, else undefined. */
function parseUtcDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return undefined;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/** Parse a `yyyy-MM-dd` key to UTC midnight Date (for LeaveRequestDay rows). */
function keyToUtcDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0, 0));
}

const PORTIONS: ReadonlySet<string> = new Set(['FULL', 'AM', 'PM']);

function serializeRequest(r: {
  id: string;
  employeeUserId: string;
  leaveTypeId: string;
  startDate: Date;
  endDate: Date;
  status: LeaveStatus;
  reason: string | null;
  totalDays: Prisma.Decimal;
  approvedById: string | null;
  approvedAt: Date | null;
  rejectionNote: string | null;
  createdAt?: Date;
}) {
  return {
    id: r.id,
    employeeUserId: r.employeeUserId,
    leaveTypeId: r.leaveTypeId,
    startDate: r.startDate,
    endDate: r.endDate,
    status: r.status,
    reason: r.reason,
    totalDays: Number(r.totalDays),
    approvedById: r.approvedById,
    approvedAt: r.approvedAt,
    rejectionNote: r.rejectionNote,
    ...(r.createdAt !== undefined ? { createdAt: r.createdAt } : {}),
  };
}

function employeeName(employee: { firstName: string; lastName: string | null; email: string } | null) {
  if (!employee) return { name: '', email: '' };
  return {
    name: `${employee.firstName}${employee.lastName ? ` ${employee.lastName}` : ''}`.trim(),
    email: employee.email ?? '',
  };
}

/**
 * Load the tenant's holidays overlapping [start, end] as a `yyyy-MM-dd` set.
 * Non-recurring holidays are matched by absolute date; recurringYearly holidays
 * match by month/day against every year spanned by the range.
 */
async function holidayKeysInRange(tenantId: string, start: Date, end: Date): Promise<Set<string>> {
  const holidays = await prisma.holiday.findMany({
    where: { userId: tenantId },
    select: { date: true, recurringYearly: true },
  });

  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const startKey = dateKey(start);
  const endKey = dateKey(end);

  const keys = new Set<string>();
  for (const h of holidays) {
    if (h.recurringYearly) {
      const mm = String(h.date.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(h.date.getUTCDate()).padStart(2, '0');
      for (let y = startYear; y <= endYear; y++) {
        const key = `${y}-${mm}-${dd}`;
        if (key >= startKey && key <= endKey) keys.add(key);
      }
    } else {
      const key = dateKey(h.date);
      if (key >= startKey && key <= endKey) keys.add(key);
    }
  }
  return keys;
}

// =============================================================================
// POST /leave-requests
// =============================================================================

export async function createLeaveRequest(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = resolveActor(req);
    const employeeUserId = actor.userId; // own request = the acting user

    const { leaveTypeId, startDate, endDate, perDay, defaultPortion, reason } = req.body as {
      leaveTypeId?: string;
      startDate?: string;
      endDate?: string;
      perDay?: Record<string, string>;
      defaultPortion?: string;
      reason?: string;
    };

    const start = parseUtcDate(startDate);
    const end = parseUtcDate(endDate);
    if (!leaveTypeId || !start || !end) {
      res
        .status(400)
        .json({ success: false, message: 'leaveTypeId, startDate and endDate are required' });
      return;
    }
    if (end < start) {
      res.status(400).json({ success: false, message: 'endDate must be on or after startDate' });
      return;
    }
    if (defaultPortion !== undefined && !PORTIONS.has(defaultPortion)) {
      res.status(400).json({ success: false, message: 'defaultPortion must be FULL, AM or PM' });
      return;
    }

    // Leave type must belong to this tenant (and be active).
    const leaveType = await prisma.leaveType.findFirst({
      where: { id: leaveTypeId, userId: tenantId },
      select: { id: true, isActive: true },
    });
    if (!leaveType) {
      res.status(400).json({ success: false, message: 'leaveType not found for this tenant' });
      return;
    }
    if (!leaveType.isActive) {
      res.status(400).json({ success: false, message: 'leaveType is not active' });
      return;
    }

    const holidays = await holidayKeysInRange(tenantId, start, end);
    const { days, totalDays } = buildLeaveDays(dateKey(start), dateKey(end), {
      holidays: Array.from(holidays),
      perDay: perDay as Record<string, LeavePortion> | undefined,
      defaultPortion: defaultPortion as LeavePortion | undefined,
    });

    if (totalDays === 0) {
      res.status(400).json({
        success: false,
        message: 'The selected range contains no working days (all weekends/holidays)',
      });
      return;
    }

    // Overlap check: any non-CANCELLED request for this employee whose days
    // intersect the new request's day set -> 409.
    const dayDates = days.map((d) => keyToUtcDate(d.date));
    const overlap = await prisma.leaveRequest.findFirst({
      where: {
        userId: tenantId,
        employeeUserId,
        status: { not: LeaveStatus.CANCELLED },
        days: { some: { date: { in: dayDates } } },
      },
      select: { id: true },
    });
    if (overlap) {
      res.status(409).json({
        success: false,
        message: 'This request overlaps an existing leave request',
      });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.leaveRequest.create({
        data: {
          userId: tenantId,
          employeeUserId,
          leaveTypeId,
          startDate: start,
          endDate: end,
          status: LeaveStatus.PENDING,
          reason: reason == null || reason === '' ? null : String(reason),
          totalDays: new Prisma.Decimal(totalDays),
        },
      });
      await tx.leaveRequestDay.createMany({
        data: days.map((d) => ({
          leaveRequestId: request.id,
          date: keyToUtcDate(d.date),
          portion: d.portion,
          portionDays: new Prisma.Decimal(d.portionDays),
        })),
      });
      return request;
    });

    res.status(201).json({
      success: true,
      data: { leaveRequest: serializeRequest(created), days, totalDays },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('createLeaveRequest error:', err);
    res.status(500).json({ success: false, message: 'Failed to create leave request' });
  }
}

// =============================================================================
// GET /leave-requests?scope=mine|pending
// =============================================================================

export async function listLeaveRequests(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = resolveActor(req);
    const actingUserId = requireActingUserId(req);

    const scope = String(req.query.scope ?? 'mine');
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 10) || 10));

    let where: Prisma.LeaveRequestWhereInput;
    if (scope === 'pending') {
      if (!canManageOthers(req, actor, 'view')) {
        res
          .status(403)
          .json({ success: false, message: 'Not allowed to view pending leave requests' });
        return;
      }
      where = { userId: tenantId, status: LeaveStatus.PENDING };
    } else {
      where = { userId: tenantId, employeeUserId: actingUserId };
    }

    const [total, rows] = await Promise.all([
      prisma.leaveRequest.count({ where }),
      prisma.leaveRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          employee: { select: { firstName: true, lastName: true, email: true } },
          leaveType: { select: { name: true, paid: true } },
        },
      }),
    ]);

    const leaveRequests = rows.map((r) => ({
      ...serializeRequest(r),
      employee: employeeName(r.employee),
      leaveType: { name: r.leaveType?.name ?? '', paid: r.leaveType?.paid ?? false },
    }));

    res.json({
      success: true,
      data: {
        leaveRequests,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('listLeaveRequests error:', err);
    res.status(500).json({ success: false, message: 'Failed to list leave requests' });
  }
}

// =============================================================================
// GET /leave-requests/:id
// =============================================================================

export async function getLeaveRequest(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = resolveActor(req);
    const id = String(req.params.id);

    const request = await prisma.leaveRequest.findFirst({
      where: { id, userId: tenantId },
      include: {
        days: { orderBy: { date: 'asc' } },
        leaveType: { select: { id: true, name: true, paid: true } },
        employee: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!request) {
      res.status(404).json({ success: false, message: 'Leave request not found' });
      return;
    }

    const isOwn = request.employeeUserId === actor.userId;
    if (!isOwn && !canManageOthers(req, actor, 'view')) {
      res.status(403).json({ success: false, message: 'Not allowed to view this leave request' });
      return;
    }

    res.json({
      success: true,
      data: {
        leaveRequest: {
          ...serializeRequest(request),
          employee: employeeName(request.employee),
          leaveType: request.leaveType,
          days: request.days,
        },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('getLeaveRequest error:', err);
    res.status(500).json({ success: false, message: 'Failed to load leave request' });
  }
}

// =============================================================================
// POST /leave-requests/:id/approve
// =============================================================================

export async function approveLeaveRequest(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = resolveActor(req);
    const id = String(req.params.id);

    if (!canManageOthers(req, actor, 'edit')) {
      res.status(403).json({ success: false, message: 'Not allowed to approve leave requests' });
      return;
    }

    const request = await prisma.leaveRequest.findFirst({
      where: { id, userId: tenantId },
      include: { leaveType: { select: { id: true, paid: true } } },
    });
    if (!request) {
      res.status(404).json({ success: false, message: 'Leave request not found' });
      return;
    }
    if (request.status !== LeaveStatus.PENDING) {
      res.status(409).json({
        success: false,
        message: `Only PENDING leave requests can be approved (current: ${request.status})`,
      });
      return;
    }

    // Paid leave types are balance-checked; unpaid skip the check.
    if (request.leaveType?.paid) {
      const year = request.startDate.getUTCFullYear();

      const allocations = await prisma.leaveAllocation.findMany({
        where: { userId: tenantId, employeeUserId: request.employeeUserId, leaveTypeId: request.leaveTypeId, year },
        select: { leaveTypeId: true, allocatedDays: true, carriedOverDays: true },
      });

      // Approved leave days for this employee+type in the year (the used total).
      const approvedRequests = await prisma.leaveRequest.findMany({
        where: {
          userId: tenantId,
          employeeUserId: request.employeeUserId,
          leaveTypeId: request.leaveTypeId,
          status: LeaveStatus.APPROVED,
        },
        select: { leaveTypeId: true, days: { select: { date: true, portionDays: true } } },
      });
      const approvedDays = approvedRequests.flatMap((r) =>
        r.days.map((d) => ({
          leaveTypeId: r.leaveTypeId,
          portionDays: Number(d.portionDays),
          year: d.date.getUTCFullYear(),
        })),
      );

      const allocInput = allocations.map((a) => ({
        leaveTypeId: a.leaveTypeId,
        allocatedDays: Number(a.allocatedDays),
        carriedOverDays: Number(a.carriedOverDays),
      }));
      const balances = computeLeaveBalances(allocInput, approvedDays, year);
      const balance = balances.find((b) => b.leaveTypeId === request.leaveTypeId);
      const remaining = balance ? balance.remaining : 0;

      if (remaining < Number(request.totalDays)) {
        res.status(409).json({ success: false, message: 'Insufficient leave balance' });
        return;
      }
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status: LeaveStatus.APPROVED,
        approvedById: actor.userId,
        approvedAt: new Date(),
        rejectionNote: null,
      },
    });

    res.json({ success: true, data: { leaveRequest: serializeRequest(updated) } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('approveLeaveRequest error:', err);
    res.status(500).json({ success: false, message: 'Failed to approve leave request' });
  }
}

// =============================================================================
// POST /leave-requests/:id/reject
// =============================================================================

export async function rejectLeaveRequest(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = resolveActor(req);
    const id = String(req.params.id);

    if (!canManageOthers(req, actor, 'edit')) {
      res.status(403).json({ success: false, message: 'Not allowed to reject leave requests' });
      return;
    }

    const request = await prisma.leaveRequest.findFirst({ where: { id, userId: tenantId } });
    if (!request) {
      res.status(404).json({ success: false, message: 'Leave request not found' });
      return;
    }
    if (request.status !== LeaveStatus.PENDING) {
      res.status(409).json({
        success: false,
        message: `Only PENDING leave requests can be rejected (current: ${request.status})`,
      });
      return;
    }

    const rejectionNote =
      req.body?.rejectionNote == null || req.body.rejectionNote === ''
        ? null
        : String(req.body.rejectionNote);

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveStatus.REJECTED, rejectionNote, approvedById: null, approvedAt: null },
    });

    res.json({ success: true, data: { leaveRequest: serializeRequest(updated) } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('rejectLeaveRequest error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject leave request' });
  }
}

// =============================================================================
// POST /leave-requests/:id/cancel
// =============================================================================

export async function cancelLeaveRequest(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = resolveActor(req);
    const id = String(req.params.id);

    const request = await prisma.leaveRequest.findFirst({ where: { id, userId: tenantId } });
    if (!request) {
      res.status(404).json({ success: false, message: 'Leave request not found' });
      return;
    }

    const isOwn = request.employeeUserId === actor.userId;
    if (!isOwn && !canManageOthers(req, actor, 'edit')) {
      res.status(403).json({ success: false, message: 'Not allowed to cancel this leave request' });
      return;
    }

    // PENDING is always cancellable. APPROVED only if it starts in the future.
    let cancellable = request.status === LeaveStatus.PENDING;
    if (request.status === LeaveStatus.APPROVED) {
      const todayKey = dateKey(new Date());
      const startKey = dateKey(request.startDate);
      cancellable = startKey > todayKey;
    }
    if (!cancellable) {
      res.status(409).json({
        success: false,
        message: `This leave request cannot be cancelled (current: ${request.status})`,
      });
      return;
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveStatus.CANCELLED },
    });

    res.json({ success: true, data: { leaveRequest: serializeRequest(updated) } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('cancelLeaveRequest error:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel leave request' });
  }
}

// =============================================================================
// GET /leave-balances?employeeUserId=&year=
// =============================================================================

export async function getLeaveBalances(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = resolveActor(req);

    const canSeeOthers = canManageOthers(req, actor, 'view');

    // Data-scope clamp: non-privileged actors are forced to self.
    let employeeUserId = actor.userId;
    if (req.query.employeeUserId && typeof req.query.employeeUserId === 'string') {
      employeeUserId = canSeeOthers ? req.query.employeeUserId : actor.userId;
    }

    const year =
      req.query.year !== undefined && req.query.year !== ''
        ? Number(req.query.year)
        : new Date().getUTCFullYear();
    if (!Number.isInteger(year)) {
      res.status(400).json({ success: false, message: 'year must be an integer' });
      return;
    }

    const allocations = await prisma.leaveAllocation.findMany({
      where: { userId: tenantId, employeeUserId, year },
      include: { leaveType: { select: { id: true, name: true, paid: true } } },
    });

    const approvedRequests = await prisma.leaveRequest.findMany({
      where: { userId: tenantId, employeeUserId, status: LeaveStatus.APPROVED },
      select: { leaveTypeId: true, days: { select: { date: true, portionDays: true } } },
    });
    const approvedDays = approvedRequests.flatMap((r) =>
      r.days.map((d) => ({
        leaveTypeId: r.leaveTypeId,
        portionDays: Number(d.portionDays),
        year: d.date.getUTCFullYear(),
      })),
    );

    const allocInput = allocations.map((a) => ({
      leaveTypeId: a.leaveTypeId,
      allocatedDays: Number(a.allocatedDays),
      carriedOverDays: Number(a.carriedOverDays),
    }));
    const computed = computeLeaveBalances(allocInput, approvedDays, year);

    const byType = new Map(allocations.map((a) => [a.leaveTypeId, a.leaveType]));
    const balances = computed.map((b) => {
      const lt = byType.get(b.leaveTypeId);
      return {
        leaveTypeId: b.leaveTypeId,
        leaveTypeName: lt?.name ?? '',
        paid: lt?.paid ?? false,
        allocated: b.allocated,
        carriedOver: b.carriedOver,
        used: b.used,
        remaining: b.remaining,
      };
    });

    res.json({ success: true, data: { balances, employeeUserId, year } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('getLeaveBalances error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute leave balances' });
  }
}

// CommonJS interop for legacy JS route files.
module.exports = {
  createLeaveRequest,
  listLeaveRequests,
  getLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
  getLeaveBalances,
};
module.exports.createLeaveRequest = createLeaveRequest;
module.exports.listLeaveRequests = listLeaveRequests;
module.exports.getLeaveRequest = getLeaveRequest;
module.exports.approveLeaveRequest = approveLeaveRequest;
module.exports.rejectLeaveRequest = rejectLeaveRequest;
module.exports.cancelLeaveRequest = cancelLeaveRequest;
module.exports.getLeaveBalances = getLeaveBalances;
