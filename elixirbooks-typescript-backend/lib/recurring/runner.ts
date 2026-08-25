// lib/recurring/runner.ts
//
// Shared generation runner for RecurringInvoiceSchedule.
//
// `generateInvoiceFromSchedule` is the SINGLE place that turns a (non-posting)
// schedule template into a real, GL-posting + inventory-adjusting Invoice. The
// controller's `POST /recurring-schedules/:id/run-now` and the cron runner
// (`runDueSchedules`) both delegate here so the posting path is never duplicated.
//
// CRITICAL INVARIANT: the schedule itself NEVER posts to the GL or adjusts
// inventory. ONLY the Invoice produced by this function posts — via the same
// helpers the manual invoice-create endpoint uses (postInvoiceIssued +
// postSaleCogs for the GL, applyStockAdjustment for stock_out). Each generated
// invoice balances on its own, so the GL tie-out invariant holds.
//
// IDEMPOTENCY: generation + the schedule advance (advanceAfterRun) happen inside
// ONE transaction. The schedule's nextRunDate is moved forward atomically with
// the invoice it produced, so a re-run for the same due date cannot double-
// generate (the schedule is no longer due once advanced). gatedPost is itself
// idempotent per (Invoice, id, event), a second safety net against double-post.

import type { PrismaClient, Prisma } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';

import { prisma } from '../prisma';
import {
  postInvoiceIssued,
  postSaleCogs,
  type PostingTx,
} from '../ledger/ledgerPosting';
import { applyStockAdjustment } from '../inventory/stockAdjust';
import { advanceAfterRun, type Cadence } from './schedule';

/** Marker error retained for callers that still distinguish it; never thrown now. */
export class RunnerNotImplementedError extends Error {
  readonly notImplemented = true as const;
  constructor(message = 'Recurring invoice generation is not yet wired.') {
    super(message);
    this.name = 'RunnerNotImplementedError';
  }
}

export interface GenerateResult {
  /** The id of the freshly generated (posting) Invoice. */
  invoiceId: string;
  invoiceNumber: string;
}

/**
 * Minimal transaction-client shape this runner needs. The real
 * `Prisma.TransactionClient` and the full `PrismaClient` both satisfy it; tests
 * pass a small stub. Kept narrow so unit tests don't have to mock all of Prisma.
 */
export type RunnerTx = Pick<PrismaClient, 'invoice' | 'generalSetting' | 'product' | 'inventory'>;

const MAX_NUMBER_RETRIES = 8;

/**
 * Compute the next sequential invoice number for the tenant-wide INVOICE series.
 *
 * Mirrors the legacy prefix scheme (`generalSetting.invoicePrefix` || 'INV-' +
 * zero-padded counter) but is consumed inside a retry loop (see
 * `createInvoiceWithNumber`) so a unique-constraint collision is recovered from
 * rather than crashing — avoiding the legacy read-then-write race.
 */
async function nextInvoiceNumber(tx: RunnerTx, offset: number): Promise<string> {
  const prefixSetting = await tx.generalSetting.findUnique({ where: { key: 'invoicePrefix' } });
  const prefix =
    prefixSetting && typeof prefixSetting.value === 'string' ? prefixSetting.value : 'INV-';
  const lastInvoice = await tx.invoice.findFirst({
    where: { invoiceNumber: { not: null }, invoiceType: 'INVOICE' },
    orderBy: { createdAt: 'desc' },
    select: { invoiceNumber: true },
  });
  let lastNumber = 0;
  if (lastInvoice?.invoiceNumber) {
    const m = lastInvoice.invoiceNumber.match(/\d+$/);
    if (m) lastNumber = parseInt(m[0], 10);
  }
  return `${prefix}${String(lastNumber + 1 + offset).padStart(6, '0')}`;
}

/**
 * Schedule template rows carry Decimal/enum fields. We accept a structural shape
 * so both a real `RecurringInvoiceSchedule` row and a test fixture work.
 */
export interface ScheduleTemplate {
  id: string;
  userId: string;
  contactId: string | null;
  currencyCode: string | null;
  taxTreatment: string | null;
  items: Prisma.JsonValue;
  taxableAmount: PrismaNS.Decimal;
  totalDiscount: PrismaNS.Decimal | null;
  totalTax: PrismaNS.Decimal | null;
  TotalAmount: PrismaNS.Decimal;
  notes: string | null;
  termsAndCondition: string | null;
  signatureId: string | null;
  billFrom: string | null;
}

/**
 * Create the Invoice row, retrying on the invoiceNumber unique constraint (P2002)
 * with the next candidate number. This is the collision-safe alternative to the
 * legacy "read last + 1, hope nobody else did" race: concurrent generations that
 * pick the same number have exactly one winner per attempt; losers bump and retry.
 */
async function createInvoiceWithNumber(
  tx: RunnerTx,
  schedule: ScheduleTemplate,
  runDate: Date,
): Promise<{ id: string; invoiceNumber: string }> {
  const billFrom = schedule.billFrom ?? schedule.userId;

  for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
    const invoiceNumber = await nextInvoiceNumber(tx, attempt);
    try {
      const created = await tx.invoice.create({
        data: {
          invoiceNumber,
          invoiceType: 'INVOICE',
          status: 'UNPAID',
          invoiceDate: runDate,
          userId: schedule.userId,
          billFrom,
          ...(schedule.contactId ? { contactId: schedule.contactId } : {}),
          items: (schedule.items ?? null) as Prisma.InputJsonValue,
          taxableAmount: schedule.taxableAmount,
          TotalAmount: schedule.TotalAmount,
          vat: schedule.totalTax ?? new PrismaNS.Decimal(0),
          totalDiscount: schedule.totalDiscount ?? new PrismaNS.Decimal(0),
          ...(schedule.taxTreatment
            ? { taxTreatment: schedule.taxTreatment as Prisma.InvoiceCreateInput['taxTreatment'] }
            : {}),
          ...(schedule.currencyCode ? { currencyCode: schedule.currencyCode } : {}),
          ...(schedule.notes != null ? { notes: schedule.notes } : {}),
          ...(schedule.termsAndCondition != null
            ? { termsAndCondition: schedule.termsAndCondition }
            : {}),
          ...(schedule.signatureId ? { signatureId: schedule.signatureId } : {}),
          recurringScheduleId: schedule.id,
          isRecurring: false,
        },
        select: { id: true, invoiceNumber: true },
      });
      return { id: created.id, invoiceNumber: created.invoiceNumber ?? invoiceNumber };
    } catch (err) {
      const isUniqueViolation =
        err instanceof PrismaNS.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        // Only retry collisions on invoiceNumber; re-throw any other unique error.
        (Array.isArray((err.meta as { target?: string[] } | undefined)?.target)
          ? ((err.meta as { target?: string[] }).target as string[]).some((t) =>
              t.toLowerCase().includes('invoicenumber'),
            )
          : true);
      if (isUniqueViolation && attempt < MAX_NUMBER_RETRIES - 1) continue;
      throw err;
    }
  }
  // Unreachable: the loop either returns or throws on the final attempt.
  throw new Error('Could not allocate a unique invoice number after retries.');
}

/**
 * Post the GL + adjust inventory for a freshly-created generated invoice, exactly
 * mirroring the manual invoice-issue path:
 *   - postInvoiceIssued: Dr AR / Cr SALES_REVENUE (+ Cr OUTPUT_TAX when tax > 0)
 *   - applyStockAdjustment(stock_out) per non-Service item (deducts inventory)
 *   - postSaleCogs: Dr COGS / Cr INVENTORY at WAC for stocked items
 * Skipped entirely for PROFORMA — but generated invoices are always INVOICE.
 */
async function postGeneratedInvoice(
  tx: RunnerTx,
  invoice: { id: string; invoiceNumber: string },
  schedule: ScheduleTemplate,
  runDate: Date,
): Promise<void> {
  const postingTx = tx as unknown as PostingTx;

  await postInvoiceIssued(postingTx, {
    userId: schedule.userId,
    invoiceId: invoice.id,
    date: runDate,
    total: String(schedule.TotalAmount),
    tax: String(schedule.totalTax ?? 0),
    ...(schedule.currencyCode ? { currencyCode: schedule.currencyCode } : {}),
  });

  let totalCogs = new PrismaNS.Decimal(0);
  const items = Array.isArray(schedule.items)
    ? (schedule.items as Array<{ productId?: string; id?: string; qty?: number | string; unit?: string }>)
    : [];

  for (const item of items) {
    const productId = item.productId ?? item.id;
    const qty = item.qty != null ? Number(item.qty) : 0;
    if (!productId || !qty) continue;

    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { item_type: true },
    });
    // Never deduct stock or accrue COGS for Service products.
    if (product?.item_type === 'Service') continue;

    const inv = await tx.inventory.findFirst({
      where: { productId, userId: schedule.userId, isDeleted: false },
    });
    if (inv) {
      totalCogs = totalCogs.plus(inv.avgCost.times(new PrismaNS.Decimal(qty)));
    }

    // Deduct inventory exactly like a normal invoice issue (stock_out).
    await applyStockAdjustment(tx as unknown as Parameters<typeof applyStockAdjustment>[0], {
      productId,
      userId: schedule.userId,
      qtyDelta: -qty,
      type: 'stock_out',
      referenceType: 'invoice',
      referenceId: invoice.id,
      extra: {
        unitId: item.unit ?? null,
        notes: `Stock reduced due to recurring Invoice #${invoice.invoiceNumber}`,
        createdBy: schedule.userId,
      },
    });
  }

  await postSaleCogs(postingTx, {
    userId: schedule.userId,
    invoiceId: invoice.id,
    date: runDate,
    cost: totalCogs.toString(),
  });
}

/**
 * Generate ONE Invoice from the given schedule template, posting GL + inventory.
 *
 * Caller passes a transaction client (`tx`) when it owns the surrounding tx (the
 * cron runner does, so generation + advance commit atomically), or the top-level
 * `prisma` client — in which case we open our own transaction so the create +
 * posting stay atomic. The returned invoice is linked via `recurringScheduleId`.
 *
 * This function does NOT advance the schedule lifecycle; the caller is responsible
 * (cron via advanceAfterRun, run-now via the controller) so the advance and
 * generation share one transaction.
 *
 * @param client a Prisma transaction client OR the PrismaClient
 * @param schedule the schedule template (already tenant-checked by caller)
 * @param runDate the effective date for the generated invoice
 * @param _userId tenant scope (kept for signature stability; schedule.userId is authoritative)
 */
export async function generateInvoiceFromSchedule(
  client: RunnerTx | PrismaClient,
  schedule: ScheduleTemplate,
  runDate: Date,
  _userId?: string,
): Promise<GenerateResult> {
  const run = async (tx: RunnerTx): Promise<GenerateResult> => {
    const created = await createInvoiceWithNumber(tx, schedule, runDate);
    await postGeneratedInvoice(tx, created, schedule, runDate);
    return { invoiceId: created.id, invoiceNumber: created.invoiceNumber };
  };

  // If we were handed the full PrismaClient (has $transaction), open our own tx
  // so create + posting are atomic. If we were handed a tx client, run inline so
  // the caller's transaction wraps generation + advance together (idempotency).
  const maybeClient = client as Partial<PrismaClient>;
  if (typeof maybeClient.$transaction === 'function') {
    return (maybeClient.$transaction as PrismaClient['$transaction'])((tx) =>
      run(tx as unknown as RunnerTx),
    ) as Promise<GenerateResult>;
  }
  return run(client as RunnerTx);
}

export interface RunDueSummary {
  processed: number;
  successes: Array<{ scheduleId: string; invoiceNumber: string; status: string }>;
  failures: Array<{ scheduleId: string; error: string }>;
}

/**
 * System cron entrypoint. Tenant-agnostic SELECT of every ACTIVE schedule whose
 * nextRunDate has arrived; each is processed using its OWN userId for posting +
 * tenant scope.
 *
 * Per schedule, in a SINGLE transaction:
 *   1. generate the posting invoice (GL + inventory) from the template, then
 *   2. advanceAfterRun → update {nextRunDate, occurrencesCount, status, lastRunDate}.
 * The advance is atomic with generation, so the same due date cannot fire twice.
 *
 * Failure isolation: one schedule's failure rolls back ONLY its own transaction
 * and is recorded; the loop continues with the rest.
 */
export async function runDueSchedules(
  today: Date = startOfToday(),
  db: Pick<PrismaClient, 'recurringInvoiceSchedule' | '$transaction'> = prisma,
): Promise<RunDueSummary> {
  const due = await db.recurringInvoiceSchedule.findMany({
    where: { status: 'ACTIVE', nextRunDate: { lte: today } },
  });

  const successes: RunDueSummary['successes'] = [];
  const failures: RunDueSummary['failures'] = [];

  for (const schedule of due) {
    try {
      const status = await db.$transaction(async (tx) => {
        const result = await generateInvoiceFromSchedule(
          tx as unknown as RunnerTx,
          schedule as unknown as ScheduleTemplate,
          today,
        );

        const advance = advanceAfterRun(
          {
            startOn: schedule.startOn,
            endsOn: schedule.endsOn,
            neverExpire: schedule.neverExpire,
            maxOccurrences: schedule.maxOccurrences,
            occurrencesCount: schedule.occurrencesCount,
            cadence: cadenceOf(schedule),
          },
          today,
        );

        await tx.recurringInvoiceSchedule.update({
          where: { id: schedule.id },
          data: {
            nextRunDate: advance.nextRunDate,
            occurrencesCount: advance.occurrencesCount,
            lastRunDate: today,
            status: advance.status as Prisma.RecurringInvoiceScheduleUpdateInput['status'],
          },
        });

        return { invoiceNumber: result.invoiceNumber, status: advance.status };
      });

      successes.push({
        scheduleId: schedule.id,
        invoiceNumber: status.invoiceNumber,
        status: status.status,
      });
    } catch (err) {
      failures.push({
        scheduleId: schedule.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processed: due.length, successes, failures };
}

/** Build the pure-lib Cadence shape from a schedule row. */
function cadenceOf(s: {
  repeatEvery: string;
  customIntervalNumber: number | null;
  customIntervalType: string | null;
}): Cadence {
  return {
    repeatEvery: (s.repeatEvery as Cadence['repeatEvery']) ?? 'month',
    customIntervalNumber: s.customIntervalNumber ?? undefined,
    customIntervalType: (s.customIntervalType as Cadence['customIntervalType']) ?? undefined,
  };
}

/** Midnight (local) today — the cron's notion of "due as of now". */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
