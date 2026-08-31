/**
 * quotationReminderCron.ts
 *
 * Prisma rewrite of the legacy Mongoose `quotationReminderCron.js`. That job
 * was INERT: `initializeCron()` returned immediately whenever `MONGO_URI` was
 * unset — which it always was, since quotations and reminders live in
 * Postgres/Prisma — so `automatic_quotation` reminders never fired at all,
 * even though the schema models them fully (ReminderType.automatic_quotation,
 * ReminderEvent.quotation_date / expiry_date).
 *
 * This is a like-for-like port of the old job's rules, built on the pattern
 * already established by its sibling invoiceReminderCron.ts:
 *   - Runs daily at 09:30 (the legacy slot, deliberately offset from the
 *     invoice job's 09:00 so the two don't contend for the SMTP transport).
 *   - Selects enabled + active QUOTATION reminders. The type filter is
 *     disjoint from invoiceReminderCron.ts's ('automatic' /
 *     'automatic_Purchase') — the two jobs must never claim the same reminder
 *     rule, or every matching document would be mailed twice a day.
 *   - Reference date comes from remindEvent: quotation_date -> quotationDate,
 *     expiry_date -> expiryDate; offset by remindDays per remindTiming
 *     (before / after / duedate). A quotation matches when today == that date.
 *   - Only open quotations are considered: not deleted, not yet converted
 *     (convert_type still 'quotation'), status in draft/sent/accepted/declined
 *     — the same guard `quotationMatchesCriteria` applied.
 *   - Skips a rule already fired today (lastSent on the same calendar day),
 *     and bumps lastSent ONLY after a genuinely accepted send, so a failed
 *     send stays due for the next tick instead of being silently swallowed.
 *
 * Tenancy mirrors invoiceReminderCron.ts exactly: the "what is due tonight"
 * SELECT spans every workspace and so runs through prismaUnscoped, and each
 * reminder is then processed inside runAsTenant() so its quotation lookup,
 * company-settings read and lastSent write all scope themselves.
 *
 * `module.exports` is kept so the extensionless `require('./quotationReminderCron')`
 * in server.js keeps resolving — ts-node/register (loaded first in server.js)
 * picks up the .ts file exactly as it already does for the sibling crons.
 */
import cron from 'node-cron';
import type { Reminder, ReminderEvent, ReminderTiming } from '@prisma/client';

import { prisma, prismaUnscoped } from './lib/prisma';
import { runAsTenant } from './lib/tenantContext';
import { sendQuotationReminderEmail } from './lib/reminderMailer';

const ENABLED = (process.env.QUOTATION_REMINDER_CRON_ENABLED ?? '1') !== '0';

/**
 * Automatic quotation reminder rules only. `manual_quotation` is deliberately
 * excluded: a manual reminder is a one-off aimed at a specific quotation and
 * is sent on demand from the UI, so sweeping it up here would start mailing
 * customers on a schedule nobody asked for. invoiceReminderCron.ts draws the
 * same line, and its set ('automatic' / 'automatic_Purchase') stays disjoint
 * from this one so no rule is claimed by both jobs.
 */
const QUOTATION_REMINDER_TYPES = ['automatic_quotation'] as const;

/** Quotations still worth chasing — mirrors the legacy status filter. */
const OPEN_QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'declined'] as const;

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

interface CandidateQuotation {
  id: string;
  quotationDate: Date;
  expiryDate: Date | null;
}

/**
 * The legacy job returned false for any remindEvent other than the two
 * quotation ones, so an invoice-shaped rule (due_date / invoice_date) that
 * somehow carried a quotation type simply never matched. Preserved.
 */
function referenceDateFor(
  quotation: CandidateQuotation,
  remindEvent: ReminderEvent | null,
): Date | null {
  switch (remindEvent) {
    case 'quotation_date':
      return quotation.quotationDate;
    case 'expiry_date':
      return quotation.expiryDate ?? null;
    default:
      return null;
  }
}

interface RunSummary {
  reminders: number;
  matched: number;
  sent: number;
  failed: number;
}

export async function runQuotationReminderCron(scopeTenantId?: string): Promise<RunSummary> {
  console.log(
    `[quotationReminderCron] Tick at ${new Date().toISOString()}${
      scopeTenantId ? ` (scoped to tenant ${scopeTenantId})` : ' (all tenants)'
    }`,
  );
  const summary: RunSummary = { reminders: 0, matched: 0, sent: 0, failed: 0 };
  const today = new Date();

  try {
    // CROSS-TENANT BY DESIGN: "every quotation reminder due tonight" spans the
    // whole install and belongs to no single workspace. Everything downstream
    // runs inside runAsTenant.
    const reminders = await prismaUnscoped.reminder.findMany({
      where: {
        type: { in: [...QUOTATION_REMINDER_TYPES] },
        isEnabled: true,
        status: 'active',
        ...(scopeTenantId ? { tenantId: scopeTenantId } : {}),
      },
    });

    if (reminders.length === 0) {
      console.log('[quotationReminderCron] No active quotation reminders found.');
      return summary;
    }
    summary.reminders = reminders.length;

    for (const reminder of reminders) {
      await runAsTenant(reminder.tenantId, () => processReminder(reminder, today, summary));
    }

    console.log(
      `[quotationReminderCron] Done. Reminders: ${summary.reminders}, matched quotations: ${summary.matched}, sent: ${summary.sent}, failed: ${summary.failed}`,
    );
    return summary;
  } catch (err) {
    console.error('[quotationReminderCron] Top-level error:', err);
    return summary;
  }
}

async function processReminder(reminder: Reminder, today: Date, summary: RunSummary): Promise<void> {
  try {
    // Once/day guard — mirrors the legacy job.
    if (reminder.lastSent && sameDay(new Date(reminder.lastSent), today)) {
      return;
    }
    if (reminder.remindDays === null || reminder.remindDays === undefined) {
      return;
    }

    const quotations = await prisma.quotation.findMany({
      where: {
        tenantId: reminder.tenantId,
        isDeleted: false,
        // Once a quotation has been converted to an invoice, chasing it is
        // wrong — the legacy `quotationMatchesCriteria` guard, preserved.
        convert_type: 'quotation',
        status: { in: [...OPEN_QUOTATION_STATUSES] },
      },
      select: { id: true, quotationDate: true, expiryDate: true },
    });

    const matching = quotations.filter((quotation) => {
      const referenceDate = referenceDateFor(quotation, reminder.remindEvent);
      if (!referenceDate) return false;
      const targetDate = calculateTargetDate(
        referenceDate,
        reminder.remindDays as number,
        reminder.remindTiming,
      );
      return sameDay(targetDate, today);
    });

    if (matching.length === 0) return;
    summary.matched += matching.length;

    let anySent = false;
    for (const quotation of matching) {
      const result = await sendQuotationReminderEmail({
        reminderId: reminder.id,
        quotationId: quotation.id,
      });
      if (result.sent) {
        anySent = true;
        summary.sent += 1;
        console.log(
          `[quotationReminderCron]  sent reminder "${reminder.name}" for quotation ${quotation.id}`,
        );
      } else {
        summary.failed += 1;
        console.error(
          `[quotationReminderCron]  failed reminder "${reminder.name}" for quotation ${quotation.id}: ${result.error}`,
        );
      }
    }

    // Only a real send suppresses the next tick.
    if (anySent) {
      await prisma.reminder.update({ where: { id: reminder.id }, data: { lastSent: today } });
    }
  } catch (err) {
    console.error(`[quotationReminderCron] Error processing reminder "${reminder.name}":`, err);
  }
}

if (ENABLED) {
  // Wrap, don't pass the function directly: node-cron calls its callback with a
  // truthy TaskContext, which would arrive as `scopeTenantId` and wrongly scope
  // the global nightly run. Same trap documented in invoiceReminderCron.ts.
  cron.schedule('30 9 * * *', () => runQuotationReminderCron());
  console.log('[quotationReminderCron] Scheduled (daily 09:30).');
} else {
  console.log('[quotationReminderCron] Disabled via env.');
}

module.exports = { runQuotationReminderCron };
