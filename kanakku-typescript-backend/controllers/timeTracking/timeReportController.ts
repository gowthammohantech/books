// controllers/timeTracking/timeReportController.ts
// Time Tracking — Phase 1 (Task 6): hours/amount summary reports.
//
// Endpoint:
//   GET /time-reports/summary
//     ?from=<date>&to=<date>
//     [&projectId=<id>]
//     [&employeeUserId=<id>]
//     [&status=APPROVED]          (default APPROVED)
//
//   Permission: time-tracking,view (own data only)
//               time-tracking-others,view (all employees' data)
//
// Returns:
//   { data: {
//       byProject: [{ projectId, projectName, hours, billableHours, amount }],
//       byEmployee: [{ employeeUserId, employeeName, hours, billableHours, amount }],
//       totals: { hours, billableHours, amount }
//     }
//   }
//
// Data-scope rule:
//   - Admin / owner OR time-tracking-others,view → may query any employee(s).
//   - time-tracking,view ONLY → forced to own employeeUserId; the optional
//     employeeUserId query param is silently overridden to the actor's own id
//     (no 403, just scope-clamp). This prevents cross-employee leaks.

import type { Request, Response } from 'express';
import { TimesheetStatus } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { requireUserId, UnauthorizedError } from '../../lib/tenantScope';
import { resolveEntryRate } from '../../lib/timeTracking/rate';
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

/** Has the actor a specific action on `time-tracking-others`? */
function hasOthersView(req: Request): boolean {
  const p = req.actor?.perms.get('time-tracking-others');
  return !!(p && (p.allowAll || p.view));
}

function isAdminOrOwner(actor: { isOwner: boolean; roleName: string | null }): boolean {
  return actor.isOwner || actor.roleName === 'Admin';
}

// =============================================================================
// GET /time-reports/summary
// =============================================================================

export async function getTimeSummaryReport(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError();

    // ---- Parse query params ----
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (!from || !to) {
      res.status(400).json({ success: false, message: '`from` and `to` query params are required (ISO date strings)' });
      return;
    }
    // Extend `to` to end-of-day (UTC) so the range is inclusive.
    const toEndOfDay = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59, 999),
    );

    const requestedStatus = String(req.query.status ?? 'APPROVED').toUpperCase();
    // Validate the status value is a valid TimesheetStatus.
    const validStatuses: string[] = Object.values(TimesheetStatus);
    if (!validStatuses.includes(requestedStatus)) {
      res.status(400).json({
        success: false,
        message: `status must be one of: ${validStatuses.join(', ')}`,
      });
      return;
    }
    const status = requestedStatus as TimesheetStatus;

    // ---- Determine data-scope ----
    const canSeeOthers = isAdminOrOwner(actor) || hasOthersView(req);

    // The effective employeeUserId filter.
    let employeeUserIdFilter: string | undefined;
    if (req.query.employeeUserId && typeof req.query.employeeUserId === 'string') {
      if (canSeeOthers) {
        employeeUserIdFilter = req.query.employeeUserId;
      } else {
        // Non-privileged user: clamp to own id regardless of what was passed.
        employeeUserIdFilter = actor.userId;
      }
    } else {
      // No filter provided: non-privileged user sees only their own.
      if (!canSeeOthers) {
        employeeUserIdFilter = actor.userId;
      }
      // canSeeOthers + no filter → all employees (leave undefined).
    }

    const projectIdFilter =
      req.query.projectId && typeof req.query.projectId === 'string'
        ? req.query.projectId
        : undefined;

    // ---- Query TimeEntry rows ----
    // Join through Timesheet to filter by status, tenant (Timesheet.userId), and
    // optional employee. Join to Project for name + billingRate.
    const entries = await prisma.timeEntry.findMany({
      where: {
        date: { gte: from, lte: toEndOfDay },
        ...(projectIdFilter ? { projectId: projectIdFilter } : {}),
        timesheet: {
          userId: tenantId,
          status,
          ...(employeeUserIdFilter ? { employeeUserId: employeeUserIdFilter } : {}),
        },
      },
      include: {
        timesheet: {
          select: {
            employeeUserId: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        },
        project: {
          select: { id: true, name: true, billingRate: true },
        },
      },
    });

    // ---- Fetch ProjectMember rates for all employee+project combos ----
    // Build a unique set of (employeeUserId, projectId) pairs.
    const pairs = Array.from(
      new Map(
        entries.map((e) => [
          `${e.timesheet.employeeUserId}:${e.projectId}`,
          { employeeUserId: e.timesheet.employeeUserId, projectId: e.projectId },
        ]),
      ).values(),
    );

    let memberRateMap = new Map<string, number | null>();
    if (pairs.length > 0) {
      const memberRows = await prisma.projectMember.findMany({
        where: {
          userId: tenantId,
          projectId: { in: [...new Set(pairs.map((p) => p.projectId))] },
          employeeUserId: { in: [...new Set(pairs.map((p) => p.employeeUserId))] },
        },
        select: { projectId: true, employeeUserId: true, billingRate: true },
      });
      for (const m of memberRows) {
        const key = `${m.employeeUserId}:${m.projectId}`;
        memberRateMap.set(
          key,
          m.billingRate !== null ? Number(m.billingRate) : null,
        );
      }
    }

    // ---- Aggregate ----
    const byProject = new Map<
      string,
      { projectId: string; projectName: string; hours: number; billableHours: number; amount: number }
    >();
    const byEmployee = new Map<
      string,
      { employeeUserId: string; employeeName: string; hours: number; billableHours: number; amount: number }
    >();

    let totalHours = 0;
    let totalBillableHours = 0;
    let totalAmount = 0;

    for (const entry of entries) {
      const hours = Number(entry.hours);
      const billable = entry.billable;
      const employeeUserId = entry.timesheet.employeeUserId;
      const projectId = entry.projectId;

      // Resolve rate: member-specific > project default > 0
      const rateKey = `${employeeUserId}:${projectId}`;
      const memberRate = memberRateMap.has(rateKey) ? memberRateMap.get(rateKey)! : null;
      const projectRate =
        entry.project.billingRate !== null ? Number(entry.project.billingRate) : null;
      const rate = resolveEntryRate({ memberRate, projectRate });
      const amount = hours * rate;

      // --- byProject accumulate ---
      if (!byProject.has(projectId)) {
        byProject.set(projectId, {
          projectId,
          projectName: entry.project.name,
          hours: 0,
          billableHours: 0,
          amount: 0,
        });
      }
      const pRow = byProject.get(projectId)!;
      pRow.hours += hours;
      if (billable) pRow.billableHours += hours;
      pRow.amount += amount;

      // --- byEmployee accumulate ---
      if (!byEmployee.has(employeeUserId)) {
        const emp = entry.timesheet.employee;
        const empName = emp
          ? `${emp.firstName}${emp.lastName ? ` ${emp.lastName}` : ''}`.trim()
          : employeeUserId;
        byEmployee.set(employeeUserId, {
          employeeUserId,
          employeeName: empName,
          hours: 0,
          billableHours: 0,
          amount: 0,
        });
      }
      const eRow = byEmployee.get(employeeUserId)!;
      eRow.hours += hours;
      if (billable) eRow.billableHours += hours;
      eRow.amount += amount;

      // --- totals ---
      totalHours += hours;
      if (billable) totalBillableHours += hours;
      totalAmount += amount;
    }

    // Round numbers to 2 decimal places for cleaner output.
    const round2 = (n: number) => Math.round(n * 100) / 100;

    const byProjectArr = Array.from(byProject.values()).map((r) => ({
      ...r,
      hours: round2(r.hours),
      billableHours: round2(r.billableHours),
      amount: round2(r.amount),
    }));
    const byEmployeeArr = Array.from(byEmployee.values()).map((r) => ({
      ...r,
      hours: round2(r.hours),
      billableHours: round2(r.billableHours),
      amount: round2(r.amount),
    }));

    res.json({
      success: true,
      data: {
        byProject: byProjectArr,
        byEmployee: byEmployeeArr,
        totals: {
          hours: round2(totalHours),
          billableHours: round2(totalBillableHours),
          amount: round2(totalAmount),
        },
      },
    });
  } catch (err) {
    handleError(res, err, 'Failed to generate time summary report');
  }
}

// CommonJS interop.
module.exports = { getTimeSummaryReport };
module.exports.getTimeSummaryReport = getTimeSummaryReport;
