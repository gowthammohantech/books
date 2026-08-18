// controllers/timeTracking/leaveReportController.ts
// Time Tracking — Phase C (Task 5): leave summary report.
//
// Endpoint:
//   GET /leave-reports/summary
//     ?from=<date>&to=<date>
//     [&employeeUserId=<id>]
//     [&leaveTypeId=<id>]
//
//   Permission: time-tracking,view (own data only)
//               time-tracking-others,view OR admin/owner (all employees)
//
// Returns:
//   { data: {
//       byType:     [{ leaveTypeId, leaveTypeName, days }],
//       byEmployee: [{ employeeUserId, employeeName, days }],
//       totals:     { days }
//     }
//   }
//
// Aggregates APPROVED LeaveRequestDay.portionDays whose `date` falls within
// [from, to] (inclusive), tenant-scoped via the parent LeaveRequest.userId.
//
// Data-scope rule (mirrors timeReportController):
//   - Admin / owner OR time-tracking-others,view → may query any employee(s).
//   - time-tracking,view ONLY → clamped to own employeeUserId (the optional
//     employeeUserId query param is silently overridden to the actor's own id).

import type { Request, Response } from 'express';

import { prisma } from '../../lib/prisma';
import { requireUserId, UnauthorizedError } from '../../lib/tenantScope';
import { ForbiddenError } from '../../lib/timeTracking/scope';

// =============================================================================
// Helpers
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

function parseDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Has the actor `view` on `time-tracking-others`? */
function hasOthersView(req: Request): boolean {
  const p = req.actor?.perms.get('time-tracking-others');
  return !!(p && (p.allowAll || p.view));
}

function isAdminOrOwner(actor: { isOwner: boolean; roleName: string | null }): boolean {
  return actor.isOwner || actor.roleName === 'Admin';
}

// =============================================================================
// GET /leave-reports/summary
// =============================================================================

export async function getLeaveSummaryReport(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError();

    // ---- Parse query params ----
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (!from || !to) {
      res.status(400).json({
        success: false,
        message: '`from` and `to` query params are required (ISO date strings)',
      });
      return;
    }
    // Extend `to` to end-of-day (UTC) so the range is inclusive.
    const toEndOfDay = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59, 999),
    );

    // ---- Determine data-scope (mirror timeReportController) ----
    const canSeeOthers = isAdminOrOwner(actor) || hasOthersView(req);

    let employeeUserIdFilter: string | undefined;
    if (req.query.employeeUserId && typeof req.query.employeeUserId === 'string') {
      // Non-privileged user: clamp to own id regardless of what was passed.
      employeeUserIdFilter = canSeeOthers ? req.query.employeeUserId : actor.userId;
    } else if (!canSeeOthers) {
      // No filter provided: non-privileged user sees only their own.
      employeeUserIdFilter = actor.userId;
    }
    // canSeeOthers + no filter → all employees (leave undefined).

    const leaveTypeIdFilter =
      req.query.leaveTypeId && typeof req.query.leaveTypeId === 'string'
        ? req.query.leaveTypeId
        : undefined;

    // ---- Query APPROVED LeaveRequestDay rows in range ----
    const rows = await prisma.leaveRequestDay.findMany({
      where: {
        date: { gte: from, lte: toEndOfDay },
        leaveRequest: {
          userId: tenantId,
          status: 'APPROVED',
          ...(employeeUserIdFilter ? { employeeUserId: employeeUserIdFilter } : {}),
          ...(leaveTypeIdFilter ? { leaveTypeId: leaveTypeIdFilter } : {}),
        },
      },
      select: {
        portionDays: true,
        leaveRequest: {
          select: {
            employeeUserId: true,
            leaveTypeId: true,
            leaveType: { select: { name: true } },
            employee: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    // ---- Aggregate ----
    const byType = new Map<string, { leaveTypeId: string; leaveTypeName: string; days: number }>();
    const byEmployee = new Map<
      string,
      { employeeUserId: string; employeeName: string; days: number }
    >();
    let totalDays = 0;

    for (const r of rows) {
      const days = Number(r.portionDays);
      const lr = r.leaveRequest;
      const leaveTypeId = lr.leaveTypeId;
      const employeeUserId = lr.employeeUserId;

      // --- byType ---
      if (!byType.has(leaveTypeId)) {
        byType.set(leaveTypeId, {
          leaveTypeId,
          leaveTypeName: lr.leaveType?.name ?? leaveTypeId,
          days: 0,
        });
      }
      byType.get(leaveTypeId)!.days += days;

      // --- byEmployee ---
      if (!byEmployee.has(employeeUserId)) {
        const emp = lr.employee;
        const empName = emp
          ? `${emp.firstName}${emp.lastName ? ` ${emp.lastName}` : ''}`.trim()
          : employeeUserId;
        byEmployee.set(employeeUserId, { employeeUserId, employeeName: empName, days: 0 });
      }
      byEmployee.get(employeeUserId)!.days += days;

      // --- totals ---
      totalDays += days;
    }

    const round1 = (n: number) => Math.round(n * 10) / 10;

    res.json({
      success: true,
      data: {
        byType: Array.from(byType.values()).map((r) => ({ ...r, days: round1(r.days) })),
        byEmployee: Array.from(byEmployee.values()).map((r) => ({ ...r, days: round1(r.days) })),
        totals: { days: round1(totalDays) },
      },
    });
  } catch (err) {
    handleError(res, err, 'Failed to generate leave summary report');
  }
}

// CommonJS interop.
module.exports = { getLeaveSummaryReport };
module.exports.getLeaveSummaryReport = getLeaveSummaryReport;
