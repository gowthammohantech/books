/**
 * controllers/staffActivityController.ts
 *
 * Staff invoice-activity report ("how many invoices has each staff member
 * processed?"). Read-only: aggregates the AuditLog rows the global Prisma
 * audit extension (lib/auditExtension.ts) already writes for every Invoice
 * create/update/delete — no schema change, no new writes.
 *
 * Tenant scoping mirrors controllers/userController.ts `listStaffUsers`
 * EXACTLY (owner + every staff member whose ownerId == tenant). This must
 * never widen to a plain global User/AuditLog query — that class of mistake
 * was a prior P0 cross-tenant leak.
 */
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

class BadRequestError extends Error {}

function handleError(res: Response, err: unknown, what: string): void {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return;
  }
  if (err instanceof BadRequestError) {
    res.status(400).json({ success: false, message: err.message });
    return;
  }
  console.error(`Error ${what}:`, err);
  res.status(500).json({
    success: false,
    message: `Server error while ${what}`,
    error: err instanceof Error ? err.message : String(err),
  });
}

/**
 * Parses an optional `from`/`to` query param as a YYYY-MM-DD date, anchored to
 * the UTC day boundary (`from` -> 00:00:00.000Z, `to` -> 23:59:59.999Z). Mirrors
 * controllers/mtdController.ts `parseDateParam`, but unlike that helper the
 * param is OPTIONAL here — an absent value returns `undefined` so the caller
 * can omit the date filter entirely (all-time report), per this report's spec.
 */
function parseOptionalDate(value: unknown, kind: 'from' | 'to'): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestError(`Query param "${kind}" must be a valid YYYY-MM-DD date`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const ms =
    kind === 'from'
      ? Date.UTC(y, m - 1, d, 0, 0, 0, 0)
      : Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  const date = new Date(ms);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new BadRequestError(`Query param "${kind}" is not a valid YYYY-MM-DD date`);
  }
  return date;
}

interface StaffUserRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

function displayName(u: StaffUserRow): string {
  const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  return name || u.email || 'Unknown';
}

interface Bucket {
  created: number;
  updated: number;
  deleted: number;
  createdEntityIds: string[];
}

/** GET /admin/reports/staff-activity?from=<YYYY-MM-DD>&to=<YYYY-MM-DD> */
export async function getStaffActivity(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireUserId(req);

    const from = parseOptionalDate(req.query.from, 'from');
    const to = parseOptionalDate(req.query.to, 'to');
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestError('Query param "from" must not be after "to"');
    }

    // Tenant staff scope — copied verbatim from userController.listStaffUsers:
    // the owner themselves OR any staff whose ownerId == tenant. Excludes the
    // sys-bootstrap user_type (999) the same way.
    const staffUsers: StaffUserRow[] = await prisma.user.findMany({
      where: {
        NOT: { user_type: 999 },
        AND: [{ OR: [{ id: tenantId }, { ownerId: tenantId }] }],
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: { firstName: 'asc' },
    });
    const staffIds = staffUsers.map((u) => u.id);

    const createdAtFilter: Prisma.DateTimeFilter | undefined =
      from || to
        ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
        : undefined;

    const logs =
      staffIds.length === 0
        ? []
        : await prisma.auditLog.findMany({
            where: {
              entityType: 'Invoice',
              userId: { in: staffIds },
              ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
            },
            select: { userId: true, action: true, entityId: true },
          });

    const buckets = new Map<string, Bucket>();
    for (const id of staffIds) {
      buckets.set(id, { created: 0, updated: 0, deleted: 0, createdEntityIds: [] });
    }

    for (const log of logs) {
      if (!log.userId) continue;
      const bucket = buckets.get(log.userId);
      if (!bucket) continue; // defensive; the userId IN staffIds filter already guarantees this
      if (log.action === 'CREATE') {
        bucket.created += 1;
        if (log.entityId) bucket.createdEntityIds.push(log.entityId);
      } else if (log.action === 'UPDATE') {
        bucket.updated += 1;
      } else if (log.action === 'DELETE') {
        bucket.deleted += 1;
      }
    }

    // Value sum excludes since-deleted invoices (avoids overstating currently-real
    // business value); the CREATE count above still includes them, since it
    // reflects what the staff member actually did.
    const allCreatedIds = Array.from(
      new Set(
        logs
          .filter((l) => l.action === 'CREATE' && l.entityId)
          .map((l) => l.entityId as string),
      ),
    );
    const invoiceValues =
      allCreatedIds.length === 0
        ? []
        : await prisma.invoice.findMany({
            where: { id: { in: allCreatedIds }, isDeleted: false },
            select: { id: true, TotalAmount: true },
          });
    const valueById = new Map(invoiceValues.map((i) => [i.id, Number(i.TotalAmount ?? 0)]));

    const rows = staffUsers.map((u) => {
      const bucket = buckets.get(u.id)!;
      const totalValueCreated = bucket.createdEntityIds.reduce(
        (sum, id) => sum + (valueById.get(id) ?? 0),
        0,
      );
      return {
        userId: u.id,
        userName: displayName(u),
        invoicesCreated: bucket.created,
        invoicesUpdated: bucket.updated,
        invoicesDeleted: bucket.deleted,
        totalValueCreated: Number(totalValueCreated.toFixed(2)),
      };
    });

    rows.sort((a, b) => b.invoicesCreated - a.invoicesCreated);

    const totals = rows.reduce(
      (acc, r) => {
        acc.invoicesCreated += r.invoicesCreated;
        acc.invoicesUpdated += r.invoicesUpdated;
        acc.invoicesDeleted += r.invoicesDeleted;
        acc.totalValueCreated += r.totalValueCreated;
        return acc;
      },
      { invoicesCreated: 0, invoicesUpdated: 0, invoicesDeleted: 0, totalValueCreated: 0 },
    );
    totals.totalValueCreated = Number(totals.totalValueCreated.toFixed(2));

    res.status(200).json({
      success: true,
      data: {
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        rows,
        totals,
      },
    });
  } catch (err) {
    handleError(res, err, 'fetching staff activity report');
  }
}

// CommonJS interop for legacy JS routes.
module.exports = { getStaffActivity };
module.exports.getStaffActivity = getStaffActivity;
