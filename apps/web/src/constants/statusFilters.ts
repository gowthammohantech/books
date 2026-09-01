/**
 * The "still owed" status sets, derived from the Prisma enums rather than
 * written out as string literals.
 *
 * These are passed to the invoice/purchase list endpoints as a CSV `status`
 * query param by the aging, collections and balance-sheet drill-down links. As
 * literals they were a silent drift risk: rename a status in schema.prisma and
 * the reports keep filtering on a value the API no longer knows, returning an
 * empty list rather than an error.
 */
import type { InvoiceStatus, PurchaseStatus } from '@elixirbooks/enums';

/** Receivables that still owe money: everything except paid, draft and cancelled. */
export const AR_UNPAID_STATUSES: InvoiceStatus[] = [
  'UNPAID',
  'PARTIALLY_PAID',
  'OVERDUE',
  'SENT',
];

/** Payables that still owe money. Note these are lower-case in the schema. */
export const AP_UNPAID_STATUSES: PurchaseStatus[] = ['new', 'pending', 'partially_paid'];

export const AR_UNPAID_STATUSES_CSV = AR_UNPAID_STATUSES.join(',');
export const AP_UNPAID_STATUSES_CSV = AP_UNPAID_STATUSES.join(',');
