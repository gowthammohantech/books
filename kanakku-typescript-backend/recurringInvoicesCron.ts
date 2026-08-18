import cron from 'node-cron';

// NEW recurring engine: schedule-driven generation.
// The cron now drives `runDueSchedules` (lib/recurring/runner), which selects
// ACTIVE RecurringInvoiceSchedule rows whose nextRunDate has arrived, generates
// one posting Invoice each (GL + inventory), and advances the schedule lifecycle
// atomically per schedule.
//
// The LEGACY parent-Invoice engine (lib/recurringInvoiceRunner.runDueRecurringInvoices,
// keyed off Invoice.isRecurring) is intentionally NO LONGER scheduled here. Its
// due-query must not run alongside the new runner, otherwise migrated/retired
// recurring parents would double-generate. The legacy module is retained only for
// the one-shot data migration (Task 5); it is never invoked by this cron.
import { runDueSchedules } from './lib/recurring/runner';

const ENABLED = (process.env.RECURRING_INVOICES_CRON_ENABLED ?? '1') !== '0';

export async function runRecurringInvoiceCron(): Promise<void> {
  console.log(`[recurringInvoicesCron] Tick at ${new Date().toISOString()}`);
  try {
    const { processed, successes, failures } = await runDueSchedules();
    if (processed === 0) {
      console.log('[recurringInvoicesCron] No due schedules.');
      return;
    }
    console.log(
      `[recurringInvoicesCron] Processed ${processed}. Successes: ${successes.length}, Failures: ${failures.length}`,
    );
    for (const s of successes)
      console.log(`  ✓ ${s.scheduleId} → ${s.invoiceNumber} (${s.status})`);
    for (const f of failures) console.error(`  ✗ ${f.scheduleId}: ${f.error}`);
  } catch (err) {
    console.error('[recurringInvoicesCron] Top-level error:', err);
  }
}

if (ENABLED) {
  cron.schedule('0 0 * * *', runRecurringInvoiceCron);
  console.log('[recurringInvoicesCron] Scheduled (daily 00:00).');
} else {
  console.log('[recurringInvoicesCron] Disabled via env.');
}

module.exports = { runRecurringInvoiceCron };
