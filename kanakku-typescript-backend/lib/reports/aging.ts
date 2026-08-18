// lib/reports/aging.ts
import { Prisma } from '@prisma/client';

export interface AgingItem {
  id: string;
  label: string;
  /** Decimal string (e.g. "1234.56") */
  amount: string;
  dueDate: Date;
}

export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus';

export interface AgingRow extends AgingItem {
  daysOverdue: number;
  bucket: AgingBucket;
}

export interface AgingResult {
  buckets: {
    current: Prisma.Decimal;
    d1_30: Prisma.Decimal;
    d31_60: Prisma.Decimal;
    d61_90: Prisma.Decimal;
    d90plus: Prisma.Decimal;
  };
  total: Prisma.Decimal;
  rows: AgingRow[];
}

const ZERO = new Prisma.Decimal(0);
const MS_PER_DAY = 86_400_000;

function classifyDays(days: number): AgingBucket {
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90plus';
}

/**
 * Pure: group credit-note amounts by the invoice they relate to.
 *
 * FIX 2 (audit-ledger): a credit note posts Cr Accounts Receivable for its
 * totalAmount, so the GL AR control is reduced by every posted CN. AR aging must
 * net these out per invoice or it over-states receivables by exactly the CN total
 * (the demo was off by 64,663.06). Each CN is counted once, keyed by invoiceId.
 */
export function creditNoteTotalsByInvoice(
  creditNotes: { invoiceId: string; totalAmount: Prisma.Decimal | string | number }[],
): Map<string, Prisma.Decimal> {
  const byInvoice = new Map<string, Prisma.Decimal>();
  for (const cn of creditNotes) {
    const prev = byInvoice.get(cn.invoiceId) ?? ZERO;
    byInvoice.set(cn.invoiceId, prev.add(new Prisma.Decimal(cn.totalAmount.toString())));
  }
  return byInvoice;
}

/**
 * Pure: outstanding receivable for one invoice = TotalAmount − Σ payments − Σ CNs.
 * Reconciles the AR sub-ledger to the GL AR control account.
 */
export function netInvoiceOutstanding(
  totalAmount: Prisma.Decimal | string | number,
  totalPaid: Prisma.Decimal | string | number,
  creditNoted: Prisma.Decimal | string | number,
): Prisma.Decimal {
  return new Prisma.Decimal(totalAmount.toString())
    .sub(new Prisma.Decimal(totalPaid.toString()))
    .sub(new Prisma.Decimal(creditNoted.toString()));
}

// =============================================================================
// GL-derived aging (reconciles to the control account BY CONSTRUCTION)
// =============================================================================

/**
 * One journal line posted to the AR (or AP) control account, already attributed
 * to the document whose age governs its bucket.
 *
 * - `bucketKey` groups lines onto a single aging row. For AR it is the invoice
 *   id; for AP the purchase id. Lines that cannot be tied to a document (opening
 *   balances, manual journal entries) carry `bucketKey = null` and collapse into
 *   a single "Unapplied / opening" row so the grand total still equals the GL
 *   control balance.
 * - `baseDebit`/`baseCredit` are the functional-currency leg amounts as posted.
 */
export interface SubLedgerLine {
  bucketKey: string | null;
  baseDebit: Prisma.Decimal | string | number;
  baseCredit: Prisma.Decimal | string | number;
}

/** Per-document metadata used to label and age a sub-ledger aging row. */
export interface SubLedgerDoc {
  label: string;
  dueDate: Date;
}

export interface SubLedgerAgingOptions {
  /** AR is a debit-natured control (outstanding = debit−credit); AP is credit-
   *  natured (outstanding = credit−debit). */
  nature: 'debit' | 'credit';
  /** Metadata for each bucketKey. Missing keys (incl. the null key) fall back to
   *  a generic label dated `asOf` (→ current bucket). */
  docs: Map<string, SubLedgerDoc>;
  /** Label for lines with no document link (opening balances, manual JEs). */
  unappliedLabel?: string;
}

/**
 * Pure: reconstruct an aging report from the GL control-account sub-ledger.
 *
 * Each line's signed outstanding is `baseDebit − baseCredit` for a debit-natured
 * control (AR) or `baseCredit − baseDebit` for a credit-natured control (AP).
 * Lines are summed per `bucketKey` to a net per-document balance, then bucketed
 * by that document's due date.
 *
 * Because the rows are exactly the control account's own journal lines, the
 * grand total is `Σ (debit−credit)` over every AR/AP line — i.e. the GL control
 * balance — for ANY data: credit/debit notes on paid invoices, partial payments,
 * over-credits (a row may go negative = a customer credit / supplier debit), and
 * opening balances all reconcile by construction.
 *
 * Net-zero documents (fully settled) are dropped; non-zero rows — positive AND
 * negative — are kept so the total ties out.
 */
export function buildSubLedgerAging(
  lines: SubLedgerLine[],
  asOf: Date,
  opts: SubLedgerAgingOptions,
): AgingResult {
  // 1. Net each line's signed outstanding onto its document row.
  const netByKey = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const debit = new Prisma.Decimal(line.baseDebit.toString());
    const credit = new Prisma.Decimal(line.baseCredit.toString());
    const signed = opts.nature === 'debit' ? debit.sub(credit) : credit.sub(debit);
    // null bucketKey (opening/manual) collapses onto one reserved row key.
    const key = line.bucketKey ?? '__unapplied__';
    netByKey.set(key, (netByKey.get(key) ?? ZERO).add(signed));
  }

  // 2. Turn each non-zero document net into an aging item.
  const items: AgingItem[] = [];
  for (const [key, amount] of netByKey) {
    if (amount.isZero()) continue;
    const doc = key !== '__unapplied__' ? opts.docs.get(key) : undefined;
    items.push({
      id: key,
      label: doc?.label ?? opts.unappliedLabel ?? 'Unapplied / opening balance',
      amount: amount.toString(),
      // Unattributed lines have no due date → treat as current (asOf).
      dueDate: doc?.dueDate ?? asOf,
    });
  }

  return bucketAging(items, asOf);
}

/**
 * Pure function — buckets a list of open items by days overdue.
 * `asOf` is the reference date (typically today or the user-supplied date).
 *
 * Item amounts may be negative (a customer credit / supplier debit balance from
 * over-credit-noting); they are bucketed and summed signed so the grand total
 * still reconciles to the GL control account.
 */
export function bucketAging(items: AgingItem[], asOf: Date): AgingResult {
  const buckets: AgingResult['buckets'] = {
    current: ZERO,
    d1_30: ZERO,
    d31_60: ZERO,
    d61_90: ZERO,
    d90plus: ZERO,
  };
  let total = ZERO;
  const rows: AgingRow[] = [];

  for (const item of items) {
    const daysOverdue = Math.floor((asOf.getTime() - item.dueDate.getTime()) / MS_PER_DAY);
    const bucket = classifyDays(daysOverdue);
    const amt = new Prisma.Decimal(item.amount);

    buckets[bucket] = buckets[bucket].add(amt);
    total = total.add(amt);

    rows.push({ ...item, daysOverdue, bucket });
  }

  return { buckets, total, rows };
}
