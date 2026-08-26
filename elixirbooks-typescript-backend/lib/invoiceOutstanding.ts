// lib/invoiceOutstanding.ts
//
// Single source of truth for an invoice's outstanding receivable and derived
// payment status. Both the AR aging report (agingController) and the invoice
// module MUST agree, or a fully credit-noted invoice can stay UNPAID and accept
// a payment that drives the GL AR control negative. This helper reuses the exact
// same netting the aging report uses (creditNoteTotalsByInvoice /
// netInvoiceOutstanding) so the two screens reconcile by construction.
//
//   outstanding = TotalAmount − Σ(non-voided payments) − Σ(non-deleted credit notes)
//
// Credit notes are counted per the aging definition: every non-deleted CN linked
// to the invoice (isDeleted:false, ALL statuses). A credit note posts Cr AR for
// its totalAmount on issue, and — in this codebase — cancelling a CN does NOT
// reverse that GL posting, so aging (GL-reconciled) nets cancelled CNs too. To
// keep the invoice due in lock-step with aging and the GL control account we net
// exactly the same set.
import { Prisma } from '@prisma/client';
import type { InvoiceStatus } from '@prisma/client';
import { creditNoteTotalsByInvoice, netInvoiceOutstanding } from './reports/aging';

/** Money tolerance: balances within half a cent are treated as fully settled. */
export const OUTSTANDING_TOLERANCE = new Prisma.Decimal('0.005');

const ZERO = new Prisma.Decimal(0);

export interface InvoiceStatusResult {
  /** TotalAmount − payments − credit notes (may be negative on over-credit). */
  outstanding: Prisma.Decimal;
  status: InvoiceStatus;
}

/**
 * Pure: derive outstanding + payment status from totals.
 *
 * Status:
 *  - PAID            outstanding ≤ tolerance (settled by cash and/or credit notes)
 *  - PARTIALLY_PAID  a balance remains but something has been settled
 *  - otherwise       the invoice's prior non-settled display status is preserved
 *                    (UNPAID / OVERDUE / SENT / DRAFT), defaulting to UNPAID.
 *                    PAID/PARTIALLY_PAID are never "preserved" — a zero-settlement
 *                    invoice can never be either, so a stale one is corrected.
 */
export function deriveInvoiceStatus(
  totalAmount: Prisma.Decimal | string | number,
  totalPaid: Prisma.Decimal | string | number,
  creditNoted: Prisma.Decimal | string | number,
  currentStatus?: InvoiceStatus | null,
): InvoiceStatusResult {
  const outstanding = netInvoiceOutstanding(totalAmount, totalPaid, creditNoted);
  const settled = new Prisma.Decimal(totalPaid.toString()).add(new Prisma.Decimal(creditNoted.toString()));

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

/** The subset of the Prisma client this helper reads/writes. */
type OutstandingDb = Pick<Prisma.TransactionClient, 'invoicePayment' | 'creditNote' | 'invoice'>;

/**
 * Fetch an invoice's settled amounts: non-voided payments and non-deleted credit
 * notes. The credit-note query mirrors agingController EXACTLY
 * (`{ userId, isDeleted:false, invoiceId }`) so both screens net the same set.
 */
export async function getInvoiceSettlement(
  db: OutstandingDb,
  invoiceId: string,
  userId: string,
): Promise<{ totalPaid: Prisma.Decimal; creditNoted: Prisma.Decimal }> {
  const [paymentAgg, creditNotes] = await Promise.all([
    db.invoicePayment.aggregate({
      where: { invoiceId, isVoided: false },
      _sum: { amount: true },
    }),
    db.creditNote.findMany({
      where: { userId, isDeleted: false, invoiceId },
      select: { invoiceId: true, totalAmount: true },
    }),
  ]);
  const totalPaid = new Prisma.Decimal((paymentAgg._sum.amount ?? 0).toString());
  const creditNoted = creditNoteTotalsByInvoice(creditNotes).get(invoiceId) ?? ZERO;
  return { totalPaid, creditNoted };
}

/**
 * Recompute an invoice's outstanding + status from its payments and credit notes
 * and persist the derived status. Call after any credit-note create/update/delete
 * so the invoice reflects the change. CANCELLED invoices are left untouched (a
 * credit note must not resurrect a voided invoice). Returns null if the invoice
 * is not found (or is CANCELLED — nothing to do).
 */
export async function recomputeInvoiceStatus(
  db: OutstandingDb,
  invoiceId: string,
  userId: string,
): Promise<InvoiceStatusResult | null> {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, userId },
    select: { id: true, TotalAmount: true, status: true },
  });
  if (!invoice) return null;
  if (invoice.status === 'CANCELLED') return null;

  const { totalPaid, creditNoted } = await getInvoiceSettlement(db, invoiceId, userId);
  const derived = deriveInvoiceStatus(invoice.TotalAmount, totalPaid, creditNoted, invoice.status);
  if (derived.status !== invoice.status) {
    await db.invoice.update({ where: { id: invoiceId }, data: { status: derived.status } });
  }
  return derived;
}
