// controllers/recurringScheduleController.ts
//
// CRUD + lifecycle for RecurringInvoiceSchedule (Task 3 of the recurring-invoice
// rebuild). A schedule is a NON-POSTING invoice template + cadence + lifecycle.
//
// CRITICAL INVARIANT: none of these endpoints post to the GL or adjust
// inventory. Creating / editing / pausing / resuming / ending a schedule only
// mutates the RecurringInvoiceSchedule row. ONLY the Invoices generated FROM a
// schedule post — and that happens exclusively inside
// lib/recurring/runner.ts::generateInvoiceFromSchedule (delegated to from
// run-now). This controller never imports postInvoice*/applyStockAdjustment.

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';
import { sanitizeLineCustomFields } from '../lib/lineCustomFields';
import {
  reanchorOnResume,
  advanceAfterRun,
  type Cadence,
} from '../lib/recurring/schedule';
import {
  generateInvoiceFromSchedule,
  type ScheduleTemplate,
} from '../lib/recurring/runner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RepeatEvery = 'day' | 'week' | 'month' | 'year' | 'custom';
type IntervalType = 'day' | 'week' | 'month' | 'year';
type ScheduleStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'COMPLETED';

const VALID_REPEAT = new Set<RepeatEvery>(['day', 'week', 'month', 'year', 'custom']);
const VALID_INTERVAL = new Set<IntervalType>(['day', 'week', 'month', 'year']);

function parseRepeatEvery(raw: unknown): RepeatEvery | undefined {
  return typeof raw === 'string' && VALID_REPEAT.has(raw as RepeatEvery)
    ? (raw as RepeatEvery)
    : undefined;
}

function parseIntervalType(raw: unknown): IntervalType | null {
  return typeof raw === 'string' && VALID_INTERVAL.has(raw as IntervalType)
    ? (raw as IntervalType)
    : null;
}

/** Build the pure-lib Cadence shape from a schedule row / body. */
function cadenceOf(s: {
  repeatEvery: string;
  customIntervalNumber: number | null;
  customIntervalType: string | null;
}): Cadence {
  return {
    repeatEvery: (s.repeatEvery as Cadence['repeatEvery']) ?? 'month',
    customIntervalNumber: s.customIntervalNumber ?? undefined,
    customIntervalType: (s.customIntervalType as IntervalType | null) ?? undefined,
  };
}

function toDate(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  const d = new Date(raw as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDecimalOrNull(raw: unknown): Prisma.Decimal | null {
  if (raw == null || raw === '') return null;
  try {
    return new Prisma.Decimal(raw as Prisma.Decimal.Value);
  } catch {
    return null;
  }
}

function toDecimal(raw: unknown, fallback = 0): Prisma.Decimal {
  return toDecimalOrNull(raw) ?? new Prisma.Decimal(fallback);
}

function toIntOrNull(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Recurring items are otherwise a raw JSON passthrough; the one field that
 *  must obey the server-wide line-bag contract is customFields. */
export function sanitizeScheduleItems(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    const { customFields, ...rest } = item as Record<string, unknown>;
    const cleaned = sanitizeLineCustomFields(customFields);
    return cleaned !== undefined ? { ...rest, customFields: cleaned } : rest;
  });
}

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, message });
}

function handleErr(res: Response, err: unknown, fallbackMsg: string): void {
  if (err instanceof UnauthorizedError) {
    res.status(401).json({ success: false, message: err.message });
    return;
  }
  console.error(`${fallbackMsg}:`, err);
  res.status(500).json({ success: false, message: fallbackMsg });
}

// ---------------------------------------------------------------------------
// POST /recurring-schedules  (create) — status ACTIVE (or DRAFT), nextRunDate = startOn
// ---------------------------------------------------------------------------

export async function createSchedule(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as Record<string, unknown>;

    const startOn = toDate(body.startOn);
    if (!startOn) {
      fail(res, 400, 'startOn is required and must be a valid date.');
      return;
    }

    const repeatEvery = parseRepeatEvery(body.repeatEvery) ?? 'month';
    if (repeatEvery === 'custom') {
      const n = toIntOrNull(body.customIntervalNumber);
      const t = parseIntervalType(body.customIntervalType);
      if (!n || n < 1 || !t) {
        fail(res, 400, 'custom cadence requires customIntervalNumber (>=1) and customIntervalType.');
        return;
      }
    }

    if (body.items == null) {
      fail(res, 400, 'items (line-item template) is required.');
      return;
    }

    // Lifecycle: DRAFT only if explicitly requested; otherwise ACTIVE.
    const requestedStatus = typeof body.status === 'string' ? body.status.toUpperCase() : '';
    const status: ScheduleStatus = requestedStatus === 'DRAFT' ? 'DRAFT' : 'ACTIVE';

    const created = await prisma.recurringInvoiceSchedule.create({
      data: {
        userId,
        name: typeof body.name === 'string' ? body.name : null,
        contactId: typeof body.contactId === 'string' ? body.contactId : null,
        currencyCode: typeof body.currencyCode === 'string' ? body.currencyCode : null,
        taxTreatment:
          typeof body.taxTreatment === 'string'
            ? (body.taxTreatment as Prisma.RecurringInvoiceScheduleCreateInput['taxTreatment'])
            : undefined,
        items: sanitizeScheduleItems(body.items) as Prisma.InputJsonValue,
        taxableAmount: toDecimal(body.taxableAmount),
        totalDiscount: toDecimalOrNull(body.totalDiscount),
        totalTax: toDecimalOrNull(body.totalTax),
        roundOff: toDecimalOrNull(body.roundOff),
        TotalAmount: toDecimal(body.TotalAmount),
        notes: typeof body.notes === 'string' ? body.notes : null,
        termsAndCondition: typeof body.termsAndCondition === 'string' ? body.termsAndCondition : null,
        signatureId: typeof body.signatureId === 'string' ? body.signatureId : null,
        billFrom: typeof body.billFrom === 'string' ? body.billFrom : null,
        repeatEvery: repeatEvery as Prisma.RecurringInvoiceScheduleCreateInput['repeatEvery'],
        customIntervalNumber: toIntOrNull(body.customIntervalNumber),
        customIntervalType: parseIntervalType(
          body.customIntervalType,
        ) as Prisma.RecurringInvoiceScheduleCreateInput['customIntervalType'],
        startOn,
        endsOn: toDate(body.endsOn),
        neverExpire: body.neverExpire === true || body.neverExpire === 'true',
        maxOccurrences: toIntOrNull(body.maxOccurrences),
        status: status as Prisma.RecurringInvoiceScheduleCreateInput['status'],
        // Set the first run to startOn; occurrencesCount starts at 0.
        nextRunDate: startOn,
        occurrencesCount: 0,
      },
    });

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    handleErr(res, err, 'Failed to create recurring schedule');
  }
}

// ---------------------------------------------------------------------------
// GET /recurring-schedules  (list)
// ---------------------------------------------------------------------------

export async function listSchedules(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '10', 10)));
    const search = ((req.query.search as string) ?? '').trim();

    const where: Prisma.RecurringInvoiceScheduleWhereInput = { userId };
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      prisma.recurringInvoiceSchedule.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          contact: {
            select: { id: true, firstName: true, lastName: true, organisation: true },
          },
        },
      }),
      prisma.recurringInvoiceSchedule.count({ where }),
    ]);

    const data = rows.map((s) => ({
      id: s.id,
      name: s.name,
      customer: s.contact
        ? { id: s.contact.id, name: resolveDisplayName(s.contact) }
        : null,
      repeatEvery: s.repeatEvery,
      customIntervalNumber: s.customIntervalNumber,
      customIntervalType: s.customIntervalType,
      nextRunDate: s.nextRunDate,
      lastRunDate: s.lastRunDate,
      status: s.status,
      occurrencesCount: s.occurrencesCount,
      TotalAmount: s.TotalAmount,
    }));

    res.json({
      success: true,
      data: {
        schedules: data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    handleErr(res, err, 'Failed to list recurring schedules');
  }
}

// ---------------------------------------------------------------------------
// GET /recurring-schedules/:id  (full schedule)
// ---------------------------------------------------------------------------

export async function getSchedule(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const schedule = await prisma.recurringInvoiceSchedule.findFirst({
      where: { id, userId },
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, organisation: true },
        },
      },
    });
    if (!schedule) {
      fail(res, 404, 'Recurring schedule not found');
      return;
    }

    res.json({
      success: true,
      data: {
        ...schedule,
        customer: schedule.contact
          ? { id: schedule.contact.id, name: resolveDisplayName(schedule.contact) }
          : null,
      },
    });
  } catch (err) {
    handleErr(res, err, 'Failed to get recurring schedule');
  }
}

// ---------------------------------------------------------------------------
// PUT /recurring-schedules/:id  (edit template + cadence)
// ---------------------------------------------------------------------------

export async function updateSchedule(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;

    const existing = await prisma.recurringInvoiceSchedule.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      fail(res, 404, 'Recurring schedule not found');
      return;
    }

    const data: Prisma.RecurringInvoiceScheduleUpdateInput = {};

    if (body.name !== undefined) data.name = typeof body.name === 'string' ? body.name : null;
    if (body.contactId !== undefined)
      data.contact =
        typeof body.contactId === 'string'
          ? { connect: { id: body.contactId } }
          : { disconnect: true };
    if (body.currencyCode !== undefined)
      data.currencyCode = typeof body.currencyCode === 'string' ? body.currencyCode : null;
    if (body.taxTreatment !== undefined && typeof body.taxTreatment === 'string')
      data.taxTreatment = body.taxTreatment as Prisma.RecurringInvoiceScheduleUpdateInput['taxTreatment'];
    if (body.items !== undefined) data.items = sanitizeScheduleItems(body.items) as Prisma.InputJsonValue;
    if (body.taxableAmount !== undefined) data.taxableAmount = toDecimal(body.taxableAmount);
    if (body.totalDiscount !== undefined) data.totalDiscount = toDecimalOrNull(body.totalDiscount);
    if (body.totalTax !== undefined) data.totalTax = toDecimalOrNull(body.totalTax);
    if (body.roundOff !== undefined) data.roundOff = toDecimalOrNull(body.roundOff);
    if (body.TotalAmount !== undefined) data.TotalAmount = toDecimal(body.TotalAmount);
    if (body.notes !== undefined) data.notes = typeof body.notes === 'string' ? body.notes : null;
    if (body.termsAndCondition !== undefined)
      data.termsAndCondition = typeof body.termsAndCondition === 'string' ? body.termsAndCondition : null;
    if (body.signatureId !== undefined)
      data.signatureId = typeof body.signatureId === 'string' ? body.signatureId : null;
    if (body.billFrom !== undefined)
      data.billFrom = typeof body.billFrom === 'string' ? body.billFrom : null;
    if (body.endsOn !== undefined) data.endsOn = toDate(body.endsOn);
    if (body.neverExpire !== undefined)
      data.neverExpire = body.neverExpire === true || body.neverExpire === 'true';
    if (body.maxOccurrences !== undefined) data.maxOccurrences = toIntOrNull(body.maxOccurrences);

    // Cadence + startOn changes
    let cadenceChanged = false;
    if (body.repeatEvery !== undefined) {
      const re = parseRepeatEvery(body.repeatEvery);
      if (re) {
        data.repeatEvery = re as Prisma.RecurringInvoiceScheduleUpdateInput['repeatEvery'];
        cadenceChanged = true;
      }
    }
    if (body.customIntervalNumber !== undefined) {
      data.customIntervalNumber = toIntOrNull(body.customIntervalNumber);
      cadenceChanged = true;
    }
    if (body.customIntervalType !== undefined) {
      data.customIntervalType = parseIntervalType(
        body.customIntervalType,
      ) as Prisma.RecurringInvoiceScheduleUpdateInput['customIntervalType'];
      cadenceChanged = true;
    }
    let startChanged = false;
    let newStartOn = existing.startOn;
    if (body.startOn !== undefined) {
      const d = toDate(body.startOn);
      if (!d) {
        fail(res, 400, 'startOn must be a valid date.');
        return;
      }
      data.startOn = d;
      newStartOn = d;
      startChanged = true;
    }

    // Recompute nextRunDate from startOn only if cadence/startOn changed AND the
    // schedule has not yet run (occurrencesCount === 0). A schedule that has
    // already produced occurrences keeps its computed cadence (the runner owns
    // nextRunDate from then on).
    if ((cadenceChanged || startChanged) && existing.occurrencesCount === 0) {
      data.nextRunDate = newStartOn;
    }

    const updated = await prisma.recurringInvoiceSchedule.update({
      where: { id },
      data,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    handleErr(res, err, 'Failed to update recurring schedule');
  }
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

async function loadOwned(
  req: Request,
  id: string,
): Promise<Awaited<ReturnType<typeof prisma.recurringInvoiceSchedule.findFirst>>> {
  const userId = requireUserId(req);
  return prisma.recurringInvoiceSchedule.findFirst({ where: { id, userId } });
}

/** POST /recurring-schedules/:id/pause  (ACTIVE -> PAUSED) */
export async function pauseSchedule(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const s = await loadOwned(req, id);
    if (!s) {
      fail(res, 404, 'Recurring schedule not found');
      return;
    }
    if (s.status !== 'ACTIVE') {
      fail(res, 409, `Only an ACTIVE schedule can be paused (current status: ${s.status}).`);
      return;
    }
    const updated = await prisma.recurringInvoiceSchedule.update({
      where: { id },
      data: { status: 'PAUSED' as Prisma.RecurringInvoiceScheduleUpdateInput['status'] },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    handleErr(res, err, 'Failed to pause recurring schedule');
  }
}

/** POST /recurring-schedules/:id/resume  (PAUSED -> ACTIVE + re-anchor nextRunDate) */
export async function resumeSchedule(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const s = await loadOwned(req, id);
    if (!s) {
      fail(res, 404, 'Recurring schedule not found');
      return;
    }
    if (s.status !== 'PAUSED') {
      fail(res, 409, `Only a PAUSED schedule can be resumed (current status: ${s.status}).`);
      return;
    }
    // Re-anchor so a schedule that went stale while paused doesn't backfire
    // (fire once per missed period). nextRunDate becomes max(stored, next-from-today).
    const nextRunDate = reanchorOnResume(
      { nextRunDate: s.nextRunDate, cadence: cadenceOf(s) },
      new Date(),
    );
    const updated = await prisma.recurringInvoiceSchedule.update({
      where: { id },
      data: {
        status: 'ACTIVE' as Prisma.RecurringInvoiceScheduleUpdateInput['status'],
        nextRunDate,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    handleErr(res, err, 'Failed to resume recurring schedule');
  }
}

/** POST /recurring-schedules/:id/end  (ACTIVE|PAUSED -> ENDED, terminal) */
export async function endSchedule(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const s = await loadOwned(req, id);
    if (!s) {
      fail(res, 404, 'Recurring schedule not found');
      return;
    }
    if (s.status !== 'ACTIVE' && s.status !== 'PAUSED') {
      fail(
        res,
        409,
        `Only an ACTIVE or PAUSED schedule can be ended (current status: ${s.status}).`,
      );
      return;
    }
    const updated = await prisma.recurringInvoiceSchedule.update({
      where: { id },
      data: {
        status: 'ENDED' as Prisma.RecurringInvoiceScheduleUpdateInput['status'],
        nextRunDate: null,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    handleErr(res, err, 'Failed to end recurring schedule');
  }
}

// ---------------------------------------------------------------------------
// POST /recurring-schedules/:id/run-now  (generate ONE occurrence immediately)
// ---------------------------------------------------------------------------

export async function runScheduleNow(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const s = await prisma.recurringInvoiceSchedule.findFirst({ where: { id, userId } });
    if (!s) {
      fail(res, 404, 'Recurring schedule not found');
      return;
    }
    if (s.status !== 'ACTIVE') {
      fail(res, 409, `Only an ACTIVE schedule can be run (current status: ${s.status}).`);
      return;
    }

    const runDate = new Date();

    // Generate + advance inside ONE transaction so they commit atomically: the
    // schedule's nextRunDate moves forward together with the invoice it produced,
    // so a duplicate run-now (or a cron tick) for the same due date cannot
    // double-generate. The runner is the ONLY place that creates a posting
    // Invoice (GL + inventory) from a non-posting schedule.
    const { invoice, updated } = await prisma.$transaction(async (tx) => {
      const result = await generateInvoiceFromSchedule(
        tx as unknown as Parameters<typeof generateInvoiceFromSchedule>[0],
        s as unknown as ScheduleTemplate,
        runDate,
      );

      // Advance via the shared lifecycle lib: occurrencesCount++, next run, and
      // status flip to COMPLETED on maxOccurrences / endsOn.
      const advance = advanceAfterRun(
        {
          startOn: s.startOn,
          endsOn: s.endsOn,
          neverExpire: s.neverExpire,
          maxOccurrences: s.maxOccurrences,
          occurrencesCount: s.occurrencesCount,
          cadence: cadenceOf(s),
        },
        runDate,
      );

      const sched = await tx.recurringInvoiceSchedule.update({
        where: { id },
        data: {
          occurrencesCount: advance.occurrencesCount,
          lastRunDate: runDate,
          nextRunDate: advance.nextRunDate,
          status: advance.status as Prisma.RecurringInvoiceScheduleUpdateInput['status'],
        },
      });

      return { invoice: result, updated: sched };
    });

    res.status(201).json({
      success: true,
      data: { schedule: updated, invoice },
    });
  } catch (err) {
    handleErr(res, err, 'Failed to run recurring schedule');
  }
}

// ---------------------------------------------------------------------------
// GET /recurring-schedules/:id/occurrences  (generated invoices)
// ---------------------------------------------------------------------------

export async function listOccurrences(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const s = await prisma.recurringInvoiceSchedule.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!s) {
      fail(res, 404, 'Recurring schedule not found');
      return;
    }

    const rows = await prisma.invoice.findMany({
      where: { recurringScheduleId: id, userId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        status: true,
        TotalAmount: true,
      },
    });

    res.json({
      success: true,
      data: {
        occurrences: rows.map((r) => ({
          id: r.id,
          invoiceNumber: r.invoiceNumber,
          date: r.invoiceDate,
          status: r.status,
          total: r.TotalAmount,
        })),
      },
    });
  } catch (err) {
    handleErr(res, err, 'Failed to list schedule occurrences');
  }
}
