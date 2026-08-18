// prisma/migrateRecurringToSchedules.ts
//
// One-off, idempotent data migration: convert legacy "recurring invoices" into
// the new RecurringInvoiceSchedule entity.
//
// Legacy model (retired by the recurring rebuild, Task 4): a recurring "template"
// was a real, GL-posted Invoice with `isRecurring=true, parentInvoice=null` plus
// cadence columns. Each generated occurrence was an Invoice with
// `isRecurring=false, parentInvoice=<template.id>`.
//
// New model: a non-posting RecurringInvoiceSchedule holds the template + cadence
// + lifecycle, and generated occurrences link via `Invoice.recurringScheduleId`.
//
// For each legacy template we:
//   1. Create a RecurringInvoiceSchedule mirroring its fields + cadence + lifecycle.
//   2. Relink the template's children to the new schedule (recurringScheduleId).
//   3. Flip the template's `isRecurring=false` so it (a) leaves the recurring engine
//      and (b) survives as a plain, already-posted historical invoice.
//
// We DO NOT reverse the template's GL or inventory: it was posted as a real invoice
// and reversing it would unbalance the books. It simply stops being a recurring root.
//
// Idempotency: the source query only matches `isRecurring=true AND parentInvoice=null
// AND isDeleted=false`. Step 3 flips `isRecurring=false` inside the same transaction,
// so a migrated template no longer matches on re-run. Per-template work is wrapped in
// a transaction, so a failure leaves that template fully un-migrated (it will be
// retried on the next run) rather than half-converted. Re-running is therefore safe.

import { PrismaClient, Prisma } from '@prisma/client';
import { computeNextRun, type Cadence, type RecurrenceUnit } from '../lib/recurring/schedule';

const prisma = new PrismaClient();

export interface MigrationCounts {
  templatesMigrated: number;
  childrenRelinked: number;
  skipped: number;
}

/** Build the pure-lib Cadence shape from a legacy template's recurrence columns. */
function cadenceFromTemplate(t: {
  repeatEvery: string | null;
  customIntervalNumber: number | null;
  customIntervalType: string | null;
}): Cadence {
  const repeatEvery = (t.repeatEvery ?? 'month') as Cadence['repeatEvery'];
  return {
    repeatEvery,
    customIntervalNumber: t.customIntervalNumber ?? null,
    customIntervalType: (t.customIntervalType ?? null) as RecurrenceUnit | null,
  };
}

/**
 * Derive the schedule's nextRunDate from the legacy template.
 * Prefer the stored nextRecurringDate; otherwise compute the next run from the
 * last generated date (or the start anchor) so a migrated schedule resumes cleanly.
 */
function deriveNextRunDate(
  t: {
    nextRecurringDate: Date | null;
    lastRecurringDate: Date | null;
    startOn: Date | null;
    invoiceDate: Date;
  },
  cadence: Cadence,
): Date {
  if (t.nextRecurringDate) return t.nextRecurringDate;
  const anchor = t.lastRecurringDate ?? t.startOn ?? t.invoiceDate;
  return computeNextRun(anchor, cadence);
}

async function main(): Promise<MigrationCounts> {
  // Legacy recurring templates: roots only (parentInvoice null), not soft-deleted.
  const templates = await prisma.invoice.findMany({
    where: { isRecurring: true, parentInvoice: null, isDeleted: false },
  });

  const counts: MigrationCounts = { templatesMigrated: 0, childrenRelinked: 0, skipped: 0 };

  for (const t of templates) {
    try {
      const cadence = cadenceFromTemplate(t);
      const startOn = t.startOn ?? t.invoiceDate;
      const nextRunDate = deriveNextRunDate(t, cadence);

      const result = await prisma.$transaction(async (tx) => {
        // Count this template's generated children (occurrences) for occurrencesCount.
        const childCount = await tx.invoice.count({ where: { parentInvoice: t.id } });

        // 1) Create the mirroring schedule. NEVER posts to GL / touches inventory.
        const schedule = await tx.recurringInvoiceSchedule.create({
          data: {
            userId: t.userId,
            name: t.invoiceNumber ?? null,
            contactId: t.contactId ?? null,
            currencyCode: t.currencyCode ?? null,
            taxTreatment: t.taxTreatment ?? null,
            // Template snapshot
            items: (t.items ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            taxableAmount: t.taxableAmount,
            totalDiscount: t.totalDiscount ?? null,
            totalTax: t.vat ?? null,
            roundOff: null,
            TotalAmount: t.TotalAmount,
            notes: t.notes ?? null,
            termsAndCondition: t.termsAndCondition ?? null,
            signatureId: t.signatureId ?? null,
            billFrom: t.billFrom ?? null,
            // Cadence
            repeatEvery: t.repeatEvery ?? 'month',
            customIntervalNumber: t.customIntervalNumber ?? null,
            customIntervalType: t.customIntervalType ?? null,
            // End conditions
            startOn,
            endsOn: t.endsOn ?? null,
            neverExpire: t.neverExpire ?? false,
            maxOccurrences: null,
            // Lifecycle
            status: t.stopped ? 'PAUSED' : 'ACTIVE',
            nextRunDate,
            lastRunDate: t.lastRecurringDate ?? null,
            occurrencesCount: childCount,
          },
        });

        // 2) Relink the template's generated children to the new schedule.
        const relink = await tx.invoice.updateMany({
          where: { parentInvoice: t.id },
          data: { recurringScheduleId: schedule.id },
        });

        // 3) Flip the template out of the recurring engine. Leave parentInvoice null,
        //    do NOT reverse its GL / inventory — it stays a normal posted invoice.
        await tx.invoice.update({
          where: { id: t.id },
          data: { isRecurring: false },
        });

        return { childrenRelinked: relink.count };
      });

      counts.templatesMigrated += 1;
      counts.childrenRelinked += result.childrenRelinked;
      console.log(
        `[OK] template=${t.id} user=${t.userId} -> schedule created, ${result.childrenRelinked} child(ren) relinked, status=${t.stopped ? 'PAUSED' : 'ACTIVE'}`,
      );
    } catch (e) {
      counts.skipped += 1;
      console.error(`[SKIP] template=${t.id} user=${t.userId} — migration failed, left un-migrated:`, e);
    }
  }

  console.log(
    `\nRecurring migration complete: ${counts.templatesMigrated} template(s) migrated, ` +
      `${counts.childrenRelinked} child(ren) relinked, ${counts.skipped} skipped. ` +
      `(re-run safe: migrated templates no longer match isRecurring=true.)`,
  );
  return counts;
}

// Only run main when invoked directly (controller / CLI), not when imported by tests.
if (require.main === module) {
  main()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}

export { main as migrateRecurringToSchedules };
