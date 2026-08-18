import cron from 'node-cron';

import { runDueRecurringExpenses } from './lib/recurringExpenseRunner';

const ENABLED = (process.env.RECURRING_EXPENSES_CRON_ENABLED ?? '1') !== '0';

export async function runRecurringExpenseCron(): Promise<void> {
  console.log(`[recurringExpensesCron] Tick at ${new Date().toISOString()}`);
  try {
    const { processed, successes, failures } = await runDueRecurringExpenses();
    if (processed === 0) {
      console.log('[recurringExpensesCron] No due expenses.');
      return;
    }
    console.log(`[recurringExpensesCron] Processed ${processed}. Successes: ${successes.length}, Failures: ${failures.length}`);
    for (const s of successes) console.log(`  ✓ ${s}`);
    for (const f of failures) console.error(`  ✗ ${f.id}: ${f.error}`);
  } catch (err) {
    console.error('[recurringExpensesCron] Top-level error:', err);
  }
}

if (ENABLED) {
  cron.schedule('0 0 * * *', runRecurringExpenseCron);
  console.log('[recurringExpensesCron] Scheduled (daily 00:00).');
} else {
  console.log('[recurringExpensesCron] Disabled via env.');
}

module.exports = { runRecurringExpenseCron };
