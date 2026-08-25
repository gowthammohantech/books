// controllers/timeTracking/timesheetController.ts
// Time Tracking — Phase 1 (Task 5): the timesheet core.
//
// Endpoints (all `protect`, tenant-scoped via requireUserId(req) where tenant =
// ownerId ?? id; route-level requirePermission gates ability, the controller
// narrows for-others actions to the specific employee/projects):
//   GET  /timesheets/week?employeeUserId=&weekStart=   get-or-create the week
//   PUT  /timesheets/:id/entries                       bulk replace week entries
//   POST /timesheets/:id/submit                        DRAFT/REJECTED -> SUBMITTED
//   POST /timesheets/:id/approve                       SUBMITTED -> APPROVED
//   POST /timesheets/:id/reject                        SUBMITTED -> REJECTED
//   GET  /timesheets?scope=mine|pending&page=&limit=   list
//
// Admin/Owner bypass for "manage others": actor.isOwner (roleName === 'Owner')
// OR actor.roleName === 'Admin' (the built-in Admin role, DEFAULT_ROLE_BY_USER_TYPE[1]).
// Non-admin managers go through assertActorCanManageEmployee scoped to the
// timesheet's entry projectIds.

import type { Request, Response } from 'express';
import { Prisma, TimesheetStatus } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { requireUserId, requireActingUserId, UnauthorizedError } from '../../lib/tenantScope';
import {
  assertActorCanManageEmployee,
  ForbiddenError,
  type ScopeActor,
  type ScopePrisma,
} from '../../lib/timeTracking/scope';

// The scope guard is typed against a structural ScopePrisma (so it can be
// stubbed in tests). The generated client satisfies it at runtime; narrow the
// type here for the calls below.
const scopePrisma = prisma as unknown as ScopePrisma;

// =============================================================================
// Shared helpers
// =============================================================================

function handleError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return;
  }
  if (err instanceof ForbiddenError) {
    res.status(err.status).json({ success: false, message: err.message });
    return;
  }
  console.error(`${fallback}:`, err);
  res.status(500).json({ success: false, message: fallback });
}

/**
 * The full-bypass test for managing other employees. The Owner role grants it
 * tenant-wide (actor.isOwner === roleName 'Owner'); the built-in Admin role
 * (user_type 1 -> 'Admin') likewise manages anyone in the tenant. Project
 * MANAGERs are NOT bypassed here — they go through assertActorCanManageEmployee.
 */
function isAdminOrOwner(actor: { isOwner: boolean; roleName: string | null }): boolean {
  return actor.isOwner || actor.roleName === 'Admin';
}

/** Has the actor got the given action on `time-tracking-others`? */
function hasOthers(req: Request, action: 'view' | 'create' | 'edit' | 'delete'): boolean {
  const p = req.actor?.perms.get('time-tracking-others');
  return !!(p && (p.allowAll || p[action]));
}

/** Resolve the ScopeActor shape from req (throws 401 if unauthenticated). */
function resolveActor(req: Request): ScopeActor & { roleName: string | null } {
  const actor = req.actor;
  if (!actor) throw new UnauthorizedError();
  return {
    userId: actor.userId,
    tenantId: actor.tenantId,
    isOwner: actor.isOwner,
    roleName: actor.roleName,
  };
}

/**
 * Normalize an arbitrary date input to UTC-midnight of the Monday of its week
 * (ISO week, Monday-start). Returns undefined for invalid input.
 */
function normalizeWeekStartMonday(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return undefined;
  // Work in UTC to avoid TZ drift. getUTCDay(): 0=Sun..6=Sat. Monday-start.
  const dow = d.getUTCDay();
  const diff = (dow + 6) % 7; // days since Monday
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff, 0, 0, 0, 0),
  );
  return monday;
}

/** Normalize an entry `date` to UTC midnight (date-only semantics). */
function normalizeDateOnly(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return undefined;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/** Format a Date as 'yyyy-MM-dd' in UTC (date-only semantics). */
function fmtDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * Tenant holidays that fall within [weekStart, weekStart+6 days], INCLUDING
 * recurringYearly holidays whose month+day land in the week (matched against the
 * year(s) the week actually spans, not the year the holiday is stored under).
 * Returns `[{ date:'yyyy-MM-dd', name }]` sorted by date.
 */
async function holidaysForWeek(
  tenantId: string,
  weekStart: Date,
): Promise<{ date: string; name: string }[]> {
  // The 7 UTC-midnight dates of the week (Mon..Sun).
  const weekDates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    weekDates.push(
      new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + i)),
    );
  }
  const weekEnd = weekDates[6];

  const rows = await prisma.holiday.findMany({
    where: { userId: tenantId },
    select: { date: true, name: true, recurringYearly: true },
    orderBy: { date: 'asc' },
  });

  // Index the week's days by 'yyyy-MM-dd' (exact match) and by 'MM-dd'
  // (recurringYearly match → resolve to the actual week date).
  const exactByISO = new Map<string, Date>();
  const recurringByMonthDay = new Map<string, Date>();
  for (const d of weekDates) {
    exactByISO.set(fmtDateUTC(d), d);
    const md = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    recurringByMonthDay.set(md, d);
  }

  const result: { date: string; name: string }[] = [];
  for (const h of rows) {
    if (h.recurringYearly) {
      const md = `${String(h.date.getUTCMonth() + 1).padStart(2, '0')}-${String(h.date.getUTCDate()).padStart(2, '0')}`;
      const hit = recurringByMonthDay.get(md);
      if (hit) result.push({ date: fmtDateUTC(hit), name: h.name });
    } else {
      const iso = fmtDateUTC(h.date);
      if (iso >= fmtDateUTC(weekStart) && iso <= fmtDateUTC(weekEnd)) {
        result.push({ date: iso, name: h.name });
      }
    }
  }
  result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return result;
}

/**
 * The employee's APPROVED leave days that fall within the week. Joins through
 * the parent LeaveRequest (status=APPROVED, same employee+tenant) for the leave
 * type name. Returns `[{ date:'yyyy-MM-dd', portion, leaveTypeName }]`.
 */
async function leaveDaysForWeek(
  tenantId: string,
  employeeUserId: string,
  weekStart: Date,
): Promise<{ date: string; portion: string; leaveTypeName: string }[]> {
  const weekEnd = new Date(
    Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 6),
  );

  const rows = await prisma.leaveRequestDay.findMany({
    where: {
      date: { gte: weekStart, lte: weekEnd },
      leaveRequest: {
        userId: tenantId,
        employeeUserId,
        status: 'APPROVED',
      },
    },
    select: {
      date: true,
      portion: true,
      leaveRequest: { select: { leaveType: { select: { name: true } } } },
    },
    orderBy: { date: 'asc' },
  });

  return rows.map((r) => ({
    date: fmtDateUTC(r.date),
    portion: r.portion,
    leaveTypeName: r.leaveRequest?.leaveType?.name ?? '',
  }));
}

/** The employee's active member projects (for the week response + log validation). */
async function activeMemberProjects(tenantId: string, employeeUserId: string) {
  const members = await prisma.projectMember.findMany({
    where: { userId: tenantId, employeeUserId, isActive: true },
    include: { project: { select: { id: true, name: true, billingRate: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return members
    .filter((m) => m.project)
    .map((m) => ({
      id: m.project.id,
      name: m.project.name,
      projectBillingRate: m.project.billingRate,
      memberBillingRate: m.billingRate,
      role: m.role,
    }));
}

function serializeEntry(e: {
  id: string;
  timesheetId: string;
  projectId: string;
  date: Date;
  hours: Prisma.Decimal;
  billable: boolean;
  note: string | null;
}) {
  return {
    id: e.id,
    timesheetId: e.timesheetId,
    projectId: e.projectId,
    date: e.date,
    hours: e.hours,
    billable: e.billable,
    note: e.note,
  };
}

function serializeTimesheet(t: {
  id: string;
  userId: string;
  employeeUserId: string;
  weekStartDate: Date;
  status: TimesheetStatus;
  submittedAt: Date | null;
  approvedById: string | null;
  approvedAt: Date | null;
  rejectionNote: string | null;
}) {
  return {
    id: t.id,
    employeeUserId: t.employeeUserId,
    weekStartDate: t.weekStartDate,
    status: t.status,
    submittedAt: t.submittedAt,
    approvedById: t.approvedById,
    approvedAt: t.approvedAt,
    rejectionNote: t.rejectionNote,
  };
}

/**
 * Resolve a timesheet that belongs to the tenant. Returns null if not found /
 * other tenant. Includes entries for downstream scope + serialization.
 */
async function findTenantTimesheet(tenantId: string, id: string) {
  return prisma.timesheet.findFirst({
    where: { id, userId: tenantId },
    include: { entries: true },
  });
}

/**
 * Authorize an action on `employeeUserId`. For self (== actor) no extra check.
 * For another employee: require the `time-tracking-others` action, then either
 * admin/owner bypass OR project-manager scope over `projectIds`. Throws
 * ForbiddenError / UnauthorizedError on failure.
 */
async function authorizeForEmployee(
  req: Request,
  actor: ScopeActor & { roleName: string | null },
  employeeUserId: string,
  othersAction: 'view' | 'edit',
  projectIds: string[],
): Promise<void> {
  if (employeeUserId === actor.userId) return; // self
  if (!hasOthers(req, othersAction)) {
    throw new ForbiddenError('Not allowed to manage this employee');
  }
  if (isAdminOrOwner(actor)) return; // tenant-wide bypass
  await assertActorCanManageEmployee(scopePrisma, actor, employeeUserId, projectIds);
}

// =============================================================================
// GET /timesheets/week — get-or-create the (employee, week) timesheet
// =============================================================================

export async function getOrCreateWeek(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = resolveActor(req);

    const employeeUserId = String(req.query.employeeUserId ?? actor.userId) || actor.userId;
    const weekStart = normalizeWeekStartMonday(req.query.weekStart);
    if (!weekStart) {
      res.status(400).json({ success: false, message: 'weekStart is required and must be a valid date' });
      return;
    }

    // Self vs others: for others, gate on time-tracking-others,view + scope.
    // The employee's active projects are the scope basis for a non-admin manager.
    if (employeeUserId !== actor.userId) {
      if (!hasOthers(req, 'view')) {
        res.status(403).json({ success: false, message: 'Not allowed to view this employee' });
        return;
      }
      if (!isAdminOrOwner(actor)) {
        const empProjects = await activeMemberProjects(tenantId, employeeUserId);
        await assertActorCanManageEmployee(
          scopePrisma,
          actor,
          employeeUserId,
          empProjects.map((p) => p.id),
        );
      }
    }

    // The target employee must be staff of this tenant.
    const staff = await prisma.user.findFirst({
      where: { id: employeeUserId, NOT: { user_type: 999 }, OR: [{ id: tenantId }, { ownerId: tenantId }] },
      select: { id: true },
    });
    if (!staff) {
      res.status(400).json({ success: false, message: 'employeeUserId is not a staff user of this tenant' });
      return;
    }

    // Get-or-create on the unique (employeeUserId, weekStartDate). Idempotent.
    let timesheet = await prisma.timesheet.findUnique({
      where: { employeeUserId_weekStartDate: { employeeUserId, weekStartDate: weekStart } },
      include: { entries: true },
    });
    if (!timesheet) {
      try {
        timesheet = await prisma.timesheet.create({
          data: { userId: tenantId, employeeUserId, weekStartDate: weekStart, status: TimesheetStatus.DRAFT },
          include: { entries: true },
        });
      } catch (e) {
        // Race: another request created it first — re-read (idempotent).
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          timesheet = await prisma.timesheet.findUnique({
            where: { employeeUserId_weekStartDate: { employeeUserId, weekStartDate: weekStart } },
            include: { entries: true },
          });
        } else {
          throw e;
        }
      }
    }
    if (!timesheet) {
      res.status(500).json({ success: false, message: 'Failed to get-or-create timesheet' });
      return;
    }

    const [projects, holidays, leaveDays] = await Promise.all([
      activeMemberProjects(tenantId, employeeUserId),
      holidaysForWeek(tenantId, weekStart),
      leaveDaysForWeek(tenantId, employeeUserId, weekStart),
    ]);

    res.json({
      success: true,
      data: {
        timesheet: serializeTimesheet(timesheet),
        entries: timesheet.entries.map(serializeEntry),
        projects,
        // Phase C (additive): read-only markers for the week.
        holidays, // [{ date:'yyyy-MM-dd', name }]
        leaveDays, // [{ date:'yyyy-MM-dd', portion, leaveTypeName }]
      },
    });
  } catch (err) {
    handleError(res, err, 'Failed to get-or-create timesheet');
  }
}

// =============================================================================
// PUT /timesheets/:id/entries — bulk replace the week's entries
// =============================================================================

interface EntryInput {
  projectId?: string;
  date?: string;
  hours?: number | string;
  billable?: boolean;
  note?: string | null;
}

export async function replaceEntries(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = resolveActor(req);
    const id = String(req.params.id);

    const timesheet = await findTenantTimesheet(tenantId, id);
    if (!timesheet) {
      res.status(404).json({ success: false, message: 'Timesheet not found' });
      return;
    }

    // Status guard: only DRAFT or REJECTED accept edits (else 409).
    if (timesheet.status !== TimesheetStatus.DRAFT && timesheet.status !== TimesheetStatus.REJECTED) {
      res.status(409).json({
        success: false,
        message: `Timesheet is ${timesheet.status} and cannot be edited`,
      });
      return;
    }

    const entries = Array.isArray(req.body?.entries) ? (req.body.entries as EntryInput[]) : null;
    if (!entries) {
      res.status(400).json({ success: false, message: 'entries array is required' });
      return;
    }

    // Normalize + validate every entry up-front (all-or-nothing).
    const normalized: { projectId: string; date: Date; hours: Prisma.Decimal; billable: boolean; note: string | null }[] = [];
    for (const e of entries) {
      if (!e.projectId || typeof e.projectId !== 'string') {
        res.status(400).json({ success: false, message: 'Each entry requires a projectId' });
        return;
      }
      const date = normalizeDateOnly(e.date);
      if (!date) {
        res.status(400).json({ success: false, message: 'Each entry requires a valid date' });
        return;
      }
      // Empty/blank/zero cells (cleared or never filled) are dropped, not stored
      // — this PUT is a full-week replace, so an omitted cell means "no hours
      // that day". Only a genuinely out-of-range value is an error.
      if (e.hours === '' || e.hours === null || e.hours === undefined) {
        continue;
      }
      const hoursNum = Number(e.hours);
      if (!Number.isFinite(hoursNum) || hoursNum < 0 || hoursNum > 24) {
        res.status(400).json({ success: false, message: 'hours must be a number between 0 and 24' });
        return;
      }
      if (hoursNum === 0) {
        continue;
      }
      normalized.push({
        projectId: e.projectId,
        date,
        hours: new Prisma.Decimal(hoursNum),
        billable: e.billable === undefined ? true : !!e.billable,
        note: e.note == null || e.note === '' ? null : String(e.note),
      });
    }

    // Authorize (self / others scope) over the projects being logged AND the
    // timesheet's existing entry projects.
    const existingProjectIds = timesheet.entries.map((x) => x.projectId);
    const allProjectIds = Array.from(new Set([...normalized.map((n) => n.projectId), ...existingProjectIds]));
    await authorizeForEmployee(req, actor, timesheet.employeeUserId, 'edit', allProjectIds);

    // Only projects the employee is an ACTIVE member of are loggable (else 400).
    const memberProjects = await activeMemberProjects(tenantId, timesheet.employeeUserId);
    const memberProjectIds = new Set(memberProjects.map((p) => p.id));
    for (const n of normalized) {
      if (!memberProjectIds.has(n.projectId)) {
        res.status(400).json({
          success: false,
          message: 'Employee is not an active member of one or more of the given projects',
        });
        return;
      }
    }

    // Replace the week's entries atomically.
    await prisma.$transaction([
      prisma.timeEntry.deleteMany({ where: { timesheetId: id } }),
      ...(normalized.length
        ? [
            prisma.timeEntry.createMany({
              data: normalized.map((n) => ({
                timesheetId: id,
                projectId: n.projectId,
                date: n.date,
                hours: n.hours,
                billable: n.billable,
                note: n.note,
              })),
            }),
          ]
        : []),
    ]);

    const fresh = await prisma.timeEntry.findMany({ where: { timesheetId: id }, orderBy: { date: 'asc' } });
    res.json({
      success: true,
      data: { timesheet: serializeTimesheet(timesheet), entries: fresh.map(serializeEntry) },
    });
  } catch (err) {
    handleError(res, err, 'Failed to save timesheet entries');
  }
}

// =============================================================================
// POST /timesheets/:id/submit — DRAFT/REJECTED -> SUBMITTED
// =============================================================================

export async function submitTimesheet(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = resolveActor(req);
    const id = String(req.params.id);

    const timesheet = await findTenantTimesheet(tenantId, id);
    if (!timesheet) {
      res.status(404).json({ success: false, message: 'Timesheet not found' });
      return;
    }

    if (timesheet.status !== TimesheetStatus.DRAFT && timesheet.status !== TimesheetStatus.REJECTED) {
      res.status(409).json({
        success: false,
        message: `Timesheet is ${timesheet.status} and cannot be submitted`,
      });
      return;
    }

    // Self submits own; for-others requires others,edit + scope.
    await authorizeForEmployee(
      req,
      actor,
      timesheet.employeeUserId,
      'edit',
      timesheet.entries.map((e) => e.projectId),
    );

    const updated = await prisma.timesheet.update({
      where: { id },
      data: {
        status: TimesheetStatus.SUBMITTED,
        submittedAt: new Date(),
        // Clear any prior rejection metadata on resubmit.
        rejectionNote: null,
        approvedById: null,
        approvedAt: null,
      },
    });

    res.json({ success: true, data: { timesheet: serializeTimesheet(updated) } });
  } catch (err) {
    handleError(res, err, 'Failed to submit timesheet');
  }
}

// =============================================================================
// POST /timesheets/:id/approve — SUBMITTED -> APPROVED
// =============================================================================

export async function approveTimesheet(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = resolveActor(req);
    const id = String(req.params.id);

    const timesheet = await findTenantTimesheet(tenantId, id);
    if (!timesheet) {
      res.status(404).json({ success: false, message: 'Timesheet not found' });
      return;
    }

    if (timesheet.status !== TimesheetStatus.SUBMITTED) {
      res.status(409).json({
        success: false,
        message: `Only SUBMITTED timesheets can be approved (current: ${timesheet.status})`,
      });
      return;
    }

    // Approval is always a for-others action over the timesheet's entry projects.
    // (Even an employee approving their own would need others,edit + scope; the
    // self short-circuit in authorizeForEmployee is intentional — an approver
    // is generally not the employee.)
    if (timesheet.employeeUserId === actor.userId && !isAdminOrOwner(actor)) {
      res.status(403).json({ success: false, message: 'You cannot approve your own timesheet' });
      return;
    }
    if (!isAdminOrOwner(actor)) {
      if (!hasOthers(req, 'edit')) {
        res.status(403).json({ success: false, message: 'Not allowed to approve this timesheet' });
        return;
      }
      await assertActorCanManageEmployee(
        scopePrisma,
        actor,
        timesheet.employeeUserId,
        timesheet.entries.map((e) => e.projectId),
      );
    }

    const updated = await prisma.timesheet.update({
      where: { id },
      data: {
        status: TimesheetStatus.APPROVED,
        approvedById: actor.userId,
        approvedAt: new Date(),
        rejectionNote: null,
      },
    });

    res.json({ success: true, data: { timesheet: serializeTimesheet(updated) } });
  } catch (err) {
    handleError(res, err, 'Failed to approve timesheet');
  }
}

// =============================================================================
// POST /timesheets/:id/reject — SUBMITTED -> REJECTED
// =============================================================================

export async function rejectTimesheet(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = resolveActor(req);
    const id = String(req.params.id);

    const timesheet = await findTenantTimesheet(tenantId, id);
    if (!timesheet) {
      res.status(404).json({ success: false, message: 'Timesheet not found' });
      return;
    }

    if (timesheet.status !== TimesheetStatus.SUBMITTED) {
      res.status(409).json({
        success: false,
        message: `Only SUBMITTED timesheets can be rejected (current: ${timesheet.status})`,
      });
      return;
    }

    if (timesheet.employeeUserId === actor.userId && !isAdminOrOwner(actor)) {
      res.status(403).json({ success: false, message: 'You cannot reject your own timesheet' });
      return;
    }
    if (!isAdminOrOwner(actor)) {
      if (!hasOthers(req, 'edit')) {
        res.status(403).json({ success: false, message: 'Not allowed to reject this timesheet' });
        return;
      }
      await assertActorCanManageEmployee(
        scopePrisma,
        actor,
        timesheet.employeeUserId,
        timesheet.entries.map((e) => e.projectId),
      );
    }

    const rejectionNote =
      req.body?.rejectionNote == null || req.body.rejectionNote === ''
        ? null
        : String(req.body.rejectionNote);

    const updated = await prisma.timesheet.update({
      where: { id },
      data: {
        status: TimesheetStatus.REJECTED,
        rejectionNote,
        approvedById: null,
        approvedAt: null,
      },
    });

    res.json({ success: true, data: { timesheet: serializeTimesheet(updated) } });
  } catch (err) {
    handleError(res, err, 'Failed to reject timesheet');
  }
}

// =============================================================================
// GET /timesheets?scope=mine|pending — list
// =============================================================================

export async function listTimesheets(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = resolveActor(req);
    const actingUserId = requireActingUserId(req);

    const scope = String(req.query.scope ?? 'mine');
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 10) || 10));

    let where: Prisma.TimesheetWhereInput;

    if (scope === 'pending') {
      // For-others: SUBMITTED timesheets the actor may approve.
      if (!hasOthers(req, 'view')) {
        res.status(403).json({ success: false, message: 'Not allowed to view pending timesheets' });
        return;
      }
      if (isAdminOrOwner(actor)) {
        where = { userId: tenantId, status: TimesheetStatus.SUBMITTED };
      } else {
        // Projects the actor actively MANAGES; pending sheets that touch them.
        const managed = await prisma.projectMember.findMany({
          where: { userId: tenantId, employeeUserId: actor.userId, role: 'MANAGER', isActive: true },
          select: { projectId: true },
        });
        const managedIds = managed.map((m) => m.projectId);
        if (managedIds.length === 0) {
          res.json({
            success: true,
            data: { timesheets: [], pagination: { total: 0, page, limit, totalPages: 0 } },
          });
          return;
        }
        where = {
          userId: tenantId,
          status: TimesheetStatus.SUBMITTED,
          entries: { some: { projectId: { in: managedIds } } },
        };
      }
    } else {
      // 'mine' — the acting user's own timesheets (identity, not tenant-wide).
      where = { userId: tenantId, employeeUserId: actingUserId };
    }

    const [total, rows] = await Promise.all([
      prisma.timesheet.count({ where }),
      prisma.timesheet.findMany({
        where,
        orderBy: { weekStartDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { employee: { select: { firstName: true, lastName: true, email: true } } },
      }),
    ]);

    const timesheets = rows.map((t) => ({
      ...serializeTimesheet(t),
      employee: {
        name: t.employee
          ? `${t.employee.firstName}${t.employee.lastName ? ` ${t.employee.lastName}` : ''}`.trim()
          : '',
        email: t.employee?.email ?? '',
      },
    }));

    res.json({
      success: true,
      data: {
        timesheets,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    handleError(res, err, 'Failed to list timesheets');
  }
}

// =============================================================================
// GET /timesheets/available-projects — tenant active projects the ACTING user
// is NOT already an active member of. Self-service: the acting user is always
// the individual (no employeeUserId override). Returns [{ id, code, name }].
// =============================================================================

export async function listAvailableProjects(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actingUserId = requireActingUserId(req);

    // Projects the acting user is already an active member of (to exclude).
    const memberships = await prisma.projectMember.findMany({
      where: { userId: tenantId, employeeUserId: actingUserId, isActive: true },
      select: { projectId: true },
    });
    const memberProjectIds = memberships.map((m) => m.projectId);

    const projects = await prisma.project.findMany({
      where: {
        userId: tenantId,
        status: 'active',
        ...(memberProjectIds.length ? { id: { notIn: memberProjectIds } } : {}),
      },
      select: { id: true, code: true, name: true },
      orderBy: [{ name: 'asc' }],
    });

    res.json({ success: true, data: { projects } });
  } catch (err) {
    handleError(res, err, 'Failed to list available projects');
  }
}

// =============================================================================
// POST /timesheets/join-project — self-join: the ACTING user adds themselves as
// an active MEMBER of a tenant project. Re-activates a soft-removed membership.
// Body { projectId }. An employee can only add THEMSELVES via this path.
// =============================================================================

export async function joinProject(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actingUserId = requireActingUserId(req);

    const projectId = String(req.body?.projectId ?? '');
    if (!projectId) {
      res.status(400).json({ success: false, message: 'projectId is required' });
      return;
    }

    // Verify the project belongs to the tenant (404 else).
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: tenantId },
      select: { id: true },
    });
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // Upsert on the unique (projectId, employeeUserId). If a soft-removed
    // membership exists, re-activate it; otherwise create an active MEMBER.
    // billingRate stays null so it falls back to the project default.
    const member = await prisma.projectMember.upsert({
      where: { projectId_employeeUserId: { projectId, employeeUserId: actingUserId } },
      update: { isActive: true },
      create: {
        userId: tenantId,
        projectId,
        employeeUserId: actingUserId,
        role: 'MEMBER',
        billingRate: null,
        isActive: true,
      },
    });

    res.status(201).json({ success: true, data: { member } });
  } catch (err) {
    handleError(res, err, 'Failed to join project');
  }
}

// =============================================================================
// DELETE /timesheets/leave-project/:projectId — self-leave: the ACTING user
// removes themselves from a tenant project so the row leaves their timesheet.
// Removes the acting user's ProjectMember (hard delete, so a future join re-uses
// the existing upsert) and clears their UNSUBMITTED time entries for that project
// (entries on DRAFT/REJECTED timesheets only). Entries on SUBMITTED/APPROVED
// timesheets are preserved as history. Acting-user only — cannot remove another
// employee's membership via this path. Returns { data: { ok: true } }.
// =============================================================================

export async function leaveProject(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actingUserId = requireActingUserId(req);

    const projectId = String(req.params.projectId ?? '');
    if (!projectId) {
      res.status(400).json({ success: false, message: 'projectId is required' });
      return;
    }

    // Verify the project belongs to the tenant (404 else).
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: tenantId },
      select: { id: true },
    });
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // Resolve the acting user's UNSUBMITTED (DRAFT/REJECTED) timesheets so we
    // only clear entries that aren't part of submitted/approved history.
    const editableTimesheets = await prisma.timesheet.findMany({
      where: {
        userId: tenantId,
        employeeUserId: actingUserId,
        status: { in: [TimesheetStatus.DRAFT, TimesheetStatus.REJECTED] },
      },
      select: { id: true },
    });
    const editableTimesheetIds = editableTimesheets.map((t) => t.id);

    // Transaction: drop the acting user's membership + clear unsubmitted entries.
    await prisma.$transaction([
      prisma.timeEntry.deleteMany({
        where: {
          projectId,
          timesheetId: { in: editableTimesheetIds },
        },
      }),
      prisma.projectMember.deleteMany({
        where: { userId: tenantId, projectId, employeeUserId: actingUserId },
      }),
    ]);

    res.json({ success: true, data: { ok: true } });
  } catch (err) {
    handleError(res, err, 'Failed to leave project');
  }
}

// CommonJS interop for legacy JS route files / require().
module.exports = {
  getOrCreateWeek,
  replaceEntries,
  submitTimesheet,
  approveTimesheet,
  rejectTimesheet,
  listTimesheets,
  listAvailableProjects,
  joinProject,
  leaveProject,
};
module.exports.getOrCreateWeek = getOrCreateWeek;
module.exports.replaceEntries = replaceEntries;
module.exports.submitTimesheet = submitTimesheet;
module.exports.approveTimesheet = approveTimesheet;
module.exports.rejectTimesheet = rejectTimesheet;
module.exports.listTimesheets = listTimesheets;
module.exports.listAvailableProjects = listAvailableProjects;
module.exports.joinProject = joinProject;
module.exports.leaveProject = leaveProject;
