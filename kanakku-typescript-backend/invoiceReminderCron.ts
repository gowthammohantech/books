/**
 * invoiceReminderCron.ts
 *
 * Wave-1 Task 3: rewritten on Prisma. The previous implementation
 * (invoiceReminderCron.js) was legacy Mongoose — it queried
 * Reminder/Invoice/Customer/User Mongo models and no-op'd entirely whenever
 * MONGO_URI was unset, which it always is now that reminders live in
 * Postgres/Prisma. It never actually fired.
 *
 * Behavior mirrors the old Mongoose job (kept intentionally close so this is
 * a like-for-like port, not a redesign):
 *   - Runs daily. Selects `automatic` / `automatic_Purchase` reminders that
 *     are enabled + active. These have no fixed target invoice (unlike
 *     `manual` reminders) — they're a standing rule ("N days before/after
 *     due date") applied across the rule owner's outstanding invoices.
 *   - For each reminder, finds the owner's (createdBy) UNPAID/SENT/OVERDUE/
 *     PARTIALLY_PAID, non-deleted invoices and computes a target date from
 *     remindEvent (due_date | invoice_date) + remindDays + remindTiming
 *     (before/after/duedate). An invoice matches when today == target date.
 *   - Skips a reminder rule already fired today (lastSent same calendar day)
 *     — same "once/day" guard the Mongoose job had.
 *   - Sends via lib/reminderMailer.ts (the same helper the manual "send
 *     reminder" endpoint uses) so transport, public-link generation, and
 *     placeholder substitution are identical on both paths. Only on a real
 *     accepted send does the reminder's `lastSent` get bumped; failures are
 *     logged and left due for the next tick — never silently marked sent.
 *
 * Registration mirrors recurringInvoicesCron.ts / recurringExpensesCron.ts:
 * a `*_CRON_ENABLED` env escape hatch, `cron.schedule` at module load, and a
 * `module.exports` so `require('./invoiceReminderCron')` (extensionless, in
 * server.js and controllers/reminderController.ts) keeps working unchanged —
 * ts-node/register (loaded first in server.js) resolves the `.ts` file the
 * same way it already does for those sibling crons.
 */
import cron from 'node-cron';
import type { Reminder, ReminderEvent, ReminderTiming } from '@prisma/client';

import { prisma } from './lib/prisma';
import { sendReminderEmail } from './lib/reminderMailer';

const ENABLED = (process.env.INVOICE_REMINDER_CRON_ENABLED ?? '1') !== '0';

const DUE_INVOICE_STATUSES = ['UNPAID', 'SENT', 'OVERDUE', 'PARTIALLY_PAID'] as const;

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function calculateTargetDate(referenceDate: Date, days: number, timing: ReminderTiming | null): Date {
  const target = new Date(referenceDate);
  if (timing === 'before') {
    target.setDate(target.getDate() - days);
  } else if (timing === 'duedate') {
    // No offset — fires exactly on the reference date itself.
  } else {
    target.setDate(target.getDate() + days);
  }
  return target;
}

interface CandidateInvoice {
  id: string;
  dueDate: Date | null;
  invoiceDate: Date;
}

function referenceDateFor(invoice: CandidateInvoice, remindEvent: ReminderEvent | null): Date | null {
  switch (remindEvent) {
    case 'invoice_date':
      return invoice.invoiceDate;
    case 'due_date':
    default:
      return invoice.dueDate ?? null;
  }
}

interface RunSummary {
  reminders: number;
  matched: number;
  sent: number;
  failed: number;
}

export async function runReminderCron(scopeUserId?: string): Promise<RunSummary> {
  console.log(
    `[invoiceReminderCron] Tick at ${new Date().toISOString()}${
      scopeUserId ? ` (scoped to user ${scopeUserId})` : ' (global)'
    }`,
  );
  const summary: RunSummary = { reminders: 0, matched: 0, sent: 0, failed: 0 };
  const today = new Date();

  try {
    const reminders = await prisma.reminder.findMany({
      where: {
        type: { in: ['automatic', 'automatic_Purchase'] },
        isEnabled: true,
        status: 'active',
        // HTTP-triggered runs (Wave-1 final review, Important finding) must
        // scope to the caller — same ownership boundary as sendManualReminder
        // (reminder.createdBy === requireUserId(req)). Only the scheduled
        // 9am tick below calls this with no argument, keeping that run
        // global exactly as before.
        ...(scopeUserId ? { createdBy: scopeUserId } : {}),
      },
    });

    if (reminders.length === 0) {
      console.log('[invoiceReminderCron] No active automatic reminders found.');
      return summary;
    }
    summary.reminders = reminders.length;

    for (const reminder of reminders) {
      await processReminder(reminder, today, summary);
    }

    console.log(
      `[invoiceReminderCron] Done. Reminders: ${summary.reminders}, matched invoices: ${summary.matched}, sent: ${summary.sent}, failed: ${summary.failed}`,
    );
    return summary;
  } catch (err) {
    console.error('[invoiceReminderCron] Top-level error:', err);
    return summary;
  }
}

async function processReminder(reminder: Reminder, today: Date, summary: RunSummary): Promise<void> {
  try {
    // Once/day guard — mirrors the legacy Mongoose job.
    if (reminder.lastSent && sameDay(new Date(reminder.lastSent), today)) {
      return;
    }
    if (reminder.remindDays === null || reminder.remindDays === undefined) {
      return;
    }

    const invoices = await prisma.invoice.findMany({
      where: {
        userId: reminder.createdBy,
        status: { in: [...DUE_INVOICE_STATUSES] },
        isDeleted: false,
      },
      select: { id: true, dueDate: true, invoiceDate: true },
    });

    const matching = invoices.filter((invoice) => {
      const referenceDate = referenceDateFor(invoice, reminder.remindEvent);
      if (!referenceDate) return false;
      const targetDate = calculateTargetDate(referenceDate, reminder.remindDays as number, reminder.remindTiming);
      return sameDay(targetDate, today);
    });

    if (matching.length === 0) return;
    summary.matched += matching.length;

    let anySent = false;
    for (const invoice of matching) {
      const result = await sendReminderEmail({ reminderId: reminder.id, invoiceId: invoice.id });
      if (result.sent) {
        anySent = true;
        summary.sent += 1;
        console.log(`[invoiceReminderCron]  sent reminder "${reminder.name}" for invoice ${invoice.id}`);
      } else {
        summary.failed += 1;
        console.error(
          `[invoiceReminderCron]  failed reminder "${reminder.name}" for invoice ${invoice.id}: ${result.error}`,
        );
      }
    }

    if (anySent) {
      await prisma.reminder.update({ where: { id: reminder.id }, data: { lastSent: today } });
    }
  } catch (err) {
    console.error(`[invoiceReminderCron] Error processing reminder "${reminder.name}":`, err);
  }
}

if (ENABLED) {
  // IMPORTANT: wrap, don't pass `runReminderCron` directly. node-cron invokes
  // its callback with a truthy TaskContext object (`{ date, ... }`) — if that
  // were forwarded as `scopeUserId` it would wrongly scope the daily global
  // run to a bogus "user". The wrapper guarantees the scheduled tick always
  // calls runReminderCron() with no arguments.
  cron.schedule('0 9 * * *', () => runReminderCron());
  console.log('[invoiceReminderCron] Scheduled (daily 09:00).');
} else {
  console.log('[invoiceReminderCron] Disabled via env.');
}

module.exports = { runReminderCron };
