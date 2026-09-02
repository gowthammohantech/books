/**
 * Recompute stored totals on delivery challans and recurring invoice schedules.
 *
 * WHY: until the server-authoritative fix landed, both controllers persisted the
 * client's subTotal / totalDiscount / totalTax / grandTotal verbatim, and the
 * two form pages that feed them taxed `rate x qty` rather than the discounted
 * base and never clamped a discount to its line. So rows written before that
 * fix can carry an overstated tax, and — where a discount exceeded a line — a
 * negative document.
 *
 * Schedules matter twice over: lib/recurring/runner.ts copies a schedule's
 * TotalAmount and totalTax onto every invoice it generates rather than
 * recomputing, so a wrong schedule keeps minting wrong invoices until it is
 * repaired here.
 *
 * WHAT IT DOES: recomputes each row's totals from its own stored line items,
 * using exactly the engine the controllers now use (resolveItemTaxRates ->
 * computeDocumentTotals), and reports or writes the difference.
 *
 * SAFE BY DEFAULT: a dry run. It prints every row whose stored figures differ
 * from the recomputed ones and writes nothing. Pass --apply to persist.
 *
 * Idempotent: a second run after --apply reports zero divergences.
 *
 * NOT TOUCHED:
 *   - roundOff, on either model. It is a deliberate presentational adjustment
 *     the totals engine has no view on.
 *   - rows whose `items` is null or empty. There is nothing to derive totals
 *     from, and zeroing them would destroy the only figures those rows have.
 *   - generated invoices. Repairing a schedule stops the bleeding; invoices
 *     already issued from it are accounting records with GL postings behind
 *     them, and rewriting those is a different, reviewed piece of work.
 *
 * Run:  node dist/prisma/backfillDocumentTotals.js [--apply]
 *       (in development: npx ts-node prisma/backfillDocumentTotals.ts)
 */

import { PrismaClient, Prisma } from '@prisma/client';

import {
  computeDocumentTotals,
  resolveItemTaxRates,
  type TotalsItem,
  type TaxGroupLookupDb,
} from '../lib/documentTotals';

// A maintenance script is deliberately install-wide, so it uses a raw client
// rather than lib/prisma's tenant-scoped one — the same choice every other
// backfill in this directory makes. Every query below still names tenantId
// explicitly where the engine needs it.
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

/** Two Decimal-ish values differ enough to be worth rewriting. */
function differs(stored: unknown, recomputed: number): boolean {
  return Math.abs(Number(stored ?? 0) - recomputed) > 0.005;
}

function d(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function lineItems(raw: unknown): TotalsItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw as TotalsItem[];
}

interface Row {
  id: string;
  label: string;
  tenantId: string;
  items: unknown;
  stored: { taxable: unknown; discount: unknown; tax: unknown; total: unknown };
}

async function recompute(row: Row) {
  const items = lineItems(row.items);
  if (!items) return null;
  const withRates = await resolveItemTaxRates(
    prisma as unknown as TaxGroupLookupDb,
    items,
    row.tenantId,
  );
  return computeDocumentTotals(withRates);
}

async function pass(
  kind: string,
  rows: Row[],
  write: (id: string, t: { subTotal: number; totalDiscount: number; totalTax: number; grandTotal: number }) => Promise<unknown>,
): Promise<{ checked: number; skipped: number; diverged: number; written: number }> {
  let skipped = 0;
  let diverged = 0;
  let written = 0;

  for (const row of rows) {
    const totals = await recompute(row);
    if (!totals) {
      skipped += 1;
      continue;
    }

    const changed =
      differs(row.stored.taxable, totals.subTotal) ||
      differs(row.stored.discount, totals.totalDiscount) ||
      differs(row.stored.tax, totals.totalTax) ||
      differs(row.stored.total, totals.grandTotal);

    if (!changed) continue;
    diverged += 1;

    console.log(
      `  ${row.label} (${row.id})\n` +
        `    stored     taxable=${Number(row.stored.taxable ?? 0)} discount=${Number(row.stored.discount ?? 0)} ` +
        `tax=${Number(row.stored.tax ?? 0)} total=${Number(row.stored.total ?? 0)}\n` +
        `    recomputed taxable=${totals.subTotal} discount=${totals.totalDiscount} ` +
        `tax=${totals.totalTax} total=${totals.grandTotal}\n` +
        `    delta      tax=${(totals.totalTax - Number(row.stored.tax ?? 0)).toFixed(2)} ` +
        `total=${(totals.grandTotal - Number(row.stored.total ?? 0)).toFixed(2)}`,
    );

    if (APPLY) {
      await write(row.id, totals);
      written += 1;
    }
  }

  console.log(
    `${kind}: ${rows.length} row(s) checked, ${skipped} skipped (no line items), ` +
      `${diverged} diverged, ${written} written.`,
  );
  return { checked: rows.length, skipped, diverged, written };
}

async function backfillDocumentTotals(): Promise<void> {
  console.log(
    APPLY
      ? 'Recomputing document totals — WRITING changes.\n'
      : 'Recomputing document totals — DRY RUN. Nothing will be written. Pass --apply to persist.\n',
  );

  const challans = await prisma.deliveryChallan.findMany({
    select: {
      id: true,
      challanNumber: true,
      tenantId: true,
      items: true,
      taxableAmount: true,
      totalDiscount: true,
      vat: true,
      totalAmount: true,
    },
  });

  console.log(`Delivery challans (${challans.length}):`);
  const challanResult = await pass(
    'Delivery challans',
    challans.map((c) => ({
      id: c.id,
      label: c.challanNumber ?? '(no number)',
      tenantId: c.tenantId,
      items: c.items,
      stored: { taxable: c.taxableAmount, discount: c.totalDiscount, tax: c.vat, total: c.totalAmount },
    })),
    (id, t) =>
      prisma.deliveryChallan.update({
        where: { id },
        data: {
          taxableAmount: d(t.subTotal),
          totalDiscount: d(t.totalDiscount),
          vat: d(t.totalTax),
          totalAmount: d(t.grandTotal),
        },
      }),
  );

  const schedules = await prisma.recurringInvoiceSchedule.findMany({
    select: {
      id: true,
      name: true,
      tenantId: true,
      items: true,
      taxableAmount: true,
      totalDiscount: true,
      totalTax: true,
      TotalAmount: true,
    },
  });

  console.log(`\nRecurring invoice schedules (${schedules.length}):`);
  const scheduleResult = await pass(
    'Recurring schedules',
    schedules.map((s) => ({
      id: s.id,
      label: s.name ?? '(unnamed)',
      tenantId: s.tenantId,
      items: s.items,
      stored: { taxable: s.taxableAmount, discount: s.totalDiscount, tax: s.totalTax, total: s.TotalAmount },
    })),
    (id, t) =>
      prisma.recurringInvoiceSchedule.update({
        where: { id },
        data: {
          taxableAmount: d(t.subTotal),
          totalDiscount: d(t.totalDiscount),
          totalTax: d(t.totalTax),
          TotalAmount: d(t.grandTotal),
        },
      }),
  );

  const diverged = challanResult.diverged + scheduleResult.diverged;
  if (!APPLY && diverged > 0) {
    console.log(
      `\n${diverged} row(s) would change. Re-run with --apply to write them.\n` +
        'Any schedule listed above has been generating invoices from the stored figure; ' +
        'invoices already issued are not touched by this script.',
    );
  } else if (APPLY) {
    console.log(`\nDone. ${challanResult.written + scheduleResult.written} row(s) updated.`);
  } else {
    console.log('\nNothing to do — every row already agrees with its line items.');
  }
}

backfillDocumentTotals()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (err) => {
    console.error('Fatal error:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
