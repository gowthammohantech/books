/**
 * An invoice's outstanding receivable and the payment status derived from it.
 *
 * Both the AR aging report and the invoice module MUST agree, or a fully
 * credit-noted invoice can stay UNPAID and accept a payment that drives the GL
 * AR control negative.
 *
 *   outstanding = TotalAmount - Sum(non-voided payments) - Sum(non-deleted credit notes)
 *
 * Credit notes are counted per the aging definition: every non-deleted CN linked
 * to the invoice (isDeleted:false, ALL statuses). A credit note posts Cr AR for
 * its totalAmount on issue, and — in this codebase — cancelling a CN does NOT
 * reverse that GL posting, so aging (GL-reconciled) nets cancelled CNs too.
 *
 * The frontend previously had its own copy of this derivation
 * (apps/web/src/utils/invoiceStatus.ts) that took only totalAmount and totalPaid
 * — it had no credit-note term at all — so a credit-noted, past-due invoice
 * rendered "Delayed Payment" while the aging report considered it settled.
 * Sharing this is what lets both sides answer the same question.
 */
import type { InvoiceStatus } from '@elixirbooks/enums';

import { Decimal, toDecimal } from './decimal.js';

/** Money tolerance: balances within half a cent are treated as fully settled. */
export const OUTSTANDING_TOLERANCE = new Decimal('0.005');

export interface InvoiceStatusResult {
  /** TotalAmount - payments - credit notes (may be negative on over-credit). */
  outstanding: Decimal;
  status: InvoiceStatus;
}

/**
 * Pure: outstanding receivable for one invoice.
 * Reconciles the AR sub-ledger to the GL AR control account.
 */
export function netInvoiceOutstanding(
  totalAmount: Decimal | string | number,
  totalPaid: Decimal | string | number,
  creditNoted: Decimal | string | number,
): Decimal {
  return toDecimal(totalAmount).sub(toDecimal(totalPaid)).sub(toDecimal(creditNoted));
}

/**
 * Pure: derive outstanding + payment status from totals.
 *
 * Status:
 *  - PAID            outstanding <= tolerance (settled by cash and/or credit notes)
 *  - PARTIALLY_PAID  a balance remains but something has been settled
 *  - otherwise       the invoice's prior non-settled display status is preserved
 *                    (UNPAID / OVERDUE / SENT / DRAFT), defaulting to UNPAID.
 *                    PAID/PARTIALLY_PAID are never "preserved" — a zero-settlement
 *                    invoice can never be either, so a stale one is corrected.
 */
export function deriveInvoiceStatus(
  totalAmount: Decimal | string | number,
  totalPaid: Decimal | string | number,
  creditNoted: Decimal | string | number,
  currentStatus?: InvoiceStatus | null,
): InvoiceStatusResult {
  const outstanding = netInvoiceOutstanding(totalAmount, totalPaid, creditNoted);
  const settled = toDecimal(totalPaid).add(toDecimal(creditNoted));

  let status: InvoiceStatus;
  if (outstanding.lte(OUTSTANDING_TOLERANCE)) {
    status = 'PAID';
  } else if (settled.gt(OUTSTANDING_TOLERANCE)) {
    status = 'PARTIALLY_PAID';
  } else if (currentStatus && currentStatus !== 'PAID' && currentStatus !== 'PARTIALLY_PAID') {
    status = currentStatus;
  } else {
    status = 'UNPAID';
  }
  return { outstanding, status };
}

// ---------------------------------------------------------------------------
// Display status (what the invoice list/detail badge shows)
// ---------------------------------------------------------------------------

/**
 * The stored lifecycle is DRAFT -> SENT -> PARTIALLY_PAID -> PAID (+ CANCELLED).
 * "DELAYED" is NOT stored — it is derived when an open invoice's due date has
 * passed and a balance remains. Legacy UNPAID rows are treated as SENT.
 */
export type DisplayStatus =
  | 'DRAFT'
  | 'SENT'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'DELAYED'
  | 'CANCELLED';

export interface InvoiceDisplayInput {
  status?: string | null;
  dueDate?: string | Date | null;
  totalAmount?: Decimal | number | string | null;
  totalPaid?: Decimal | number | string | null;
  /**
   * Non-deleted credit notes against this invoice.
   *
   * Optional because not every caller has it, but omitting it means the balance
   * below ignores credit notes — which is precisely the bug this field exists to
   * close. Callers that can supply it should.
   */
  creditNoted?: Decimal | number | string | null;
  /** Injectable for tests; defaults to the real clock. */
  now?: Date;
}

const startOfDay = (d: Date): number => {
  const copy = new Date(d.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
};

/**
 * Derive the user-facing status. "DELAYED" overlays SENT/PARTIALLY_PAID when the
 * due date has passed and a balance remains.
 *
 * The balance nets credit notes, matching `deriveInvoiceStatus` — without that,
 * a credit-noted past-due invoice showed "Delayed Payment" while the aging
 * report treated it as settled.
 */
export function deriveInvoiceDisplayStatus(input: InvoiceDisplayInput): DisplayStatus {
  const stored = (input.status || '').toUpperCase();

  if (stored === 'CANCELLED') return 'CANCELLED';
  if (stored === 'DRAFT') return 'DRAFT';

  const total = toDecimal(input.totalAmount ?? 0);
  const balance = netInvoiceOutstanding(total, input.totalPaid ?? 0, input.creditNoted ?? 0);
  const settled = toDecimal(input.totalPaid ?? 0).add(toDecimal(input.creditNoted ?? 0));

  // Fully settled regardless of stored value.
  if (stored === 'PAID' || (total.gt(0) && balance.lte(OUTSTANDING_TOLERANCE))) return 'PAID';

  // Open invoice (SENT / PARTIALLY_PAID / legacy UNPAID / OVERDUE).
  const due = input.dueDate ? new Date(input.dueDate) : null;
  const isPastDue =
    !!due &&
    !Number.isNaN(due.getTime()) &&
    due.getTime() < startOfDay(input.now ?? new Date()) &&
    balance.gt(OUTSTANDING_TOLERANCE);
  if (isPastDue) return 'DELAYED';

  if (settled.gt(0) || stored === 'PARTIALLY_PAID') return 'PARTIALLY_PAID';

  // SENT, UNPAID (legacy), OVERDUE-but-not-actually-past-due -> Sent.
  return 'SENT';
}

/** Only draft invoices can be edited. */
export const isInvoiceEditable = (status?: string | null): boolean =>
  (status || '').toUpperCase() === 'DRAFT';
