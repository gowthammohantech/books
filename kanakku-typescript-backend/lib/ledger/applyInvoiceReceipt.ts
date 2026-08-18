// lib/ledger/applyInvoiceReceipt.ts
//
// Shared helper: validate an open invoice, create the InvoicePayment sub-ledger
// row, post the GL entry (Dr Bank / Cr AR), and update invoice status.
//
// Used by the explain path (explainPosting invoice_link case) so the AR
// sub-ledger stays in sync with bank transactions linked to invoices.

import type { Prisma } from '@prisma/client';
import type { InvoiceStatus } from '@prisma/client';
import { toDecimal } from './money';
import { postInvoicePayment, type PostingTx } from './ledgerPosting';
import {
  getInvoiceSettlement,
  deriveInvoiceStatus,
  OUTSTANDING_TOLERANCE,
} from '../invoiceOutstanding';

// ---------------------------------------------------------------------------
// DB structural type — extends PostingTx with invoice + invoicePayment ops.
// ---------------------------------------------------------------------------

export interface ApplyDb extends PostingTx {
  invoice: {
    findFirst: (args: { where: { id: string; userId: string; isDeleted: boolean } }) => Promise<{ id: string; TotalAmount: unknown; status: string; userId: string; exchangeRate?: unknown } | null>;
    update: (args: { where: { id: string }; data: { status: InvoiceStatus } }) => Promise<unknown>;
  };
  invoicePayment: {
    aggregate: (args: { where: { invoiceId: string; isVoided: boolean }; _sum: { amount: true } }) => Promise<{ _sum: { amount: unknown } }>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  // Read via getInvoiceSettlement (cast below) to net non-deleted credit notes
  // against the invoice, mirroring agingController's netting exactly.
  creditNote: {
    findMany: (args: {
      where: { userId: string; isDeleted: boolean; invoiceId: string };
      select: { invoiceId: true; totalAmount: true };
    }) => Promise<Array<{ invoiceId: string; totalAmount: unknown }>>;
  };
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ApplyInvoiceReceiptInput {
  userId: string;
  invoiceId: string;
  amount: string;          // string Decimal (bank txn amount)
  date: Date;
  bankAccountId: string;   // required — the bank account id
  /** Per-bank GL sub-account (BankDetail.accountId) for the BANK leg; null → shared BANK role. */
  bankGlAccountId?: string | null;
  paymentModeId: string;   // required — payment mode id
  paymentModeSlug?: string | null;
  sourceBankTxnId?: string; // optional — link back to the bank txn
  currencyCode?: string;
  paymentRate?: Prisma.Decimal;
  documentRate?: Prisma.Decimal;
}

export interface ApplyInvoiceReceiptResult {
  invoicePaymentId: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function applyInvoiceReceipt(
  db: ApplyDb,
  input: ApplyInvoiceReceiptInput,
): Promise<ApplyInvoiceReceiptResult> {
  const { userId, invoiceId, amount, date, bankAccountId, bankGlAccountId, paymentModeId, paymentModeSlug, sourceBankTxnId, currencyCode, paymentRate, documentRate } = input;

  // 1. Load invoice scoped to userId (not deleted).
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, userId, isDeleted: false } });
  if (!invoice) throw new Error('INVOICE_NOT_FOUND');

  // 2. Already fully paid?
  if (invoice.status === 'PAID') throw new Error('INVOICE_ALREADY_PAID');

  // 3. Compute outstanding with full Decimal precision, netting BOTH non-voided
  //    payments AND applied credit notes (same source of truth as the invoice
  //    module + AR aging via getInvoiceSettlement/deriveInvoiceStatus). A blind
  //    float `TotalAmount − payments` here would (a) reject exact final receipts
  //    to floating-point drift and (b) accept a receipt on a fully credit-noted
  //    invoice, driving the GL AR control negative.
  const { totalPaid, creditNoted } = await getInvoiceSettlement(
    db as unknown as Parameters<typeof getInvoiceSettlement>[0],
    invoiceId,
    userId,
  );
  const { outstanding } = deriveInvoiceStatus(
    invoice.TotalAmount as Prisma.Decimal,
    totalPaid,
    creditNoted,
    invoice.status as InvoiceStatus,
  );

  // 4. Guard against overpayment. Exact final receipts pass within the 0.005
  //    tolerance; a fully credit-noted invoice (outstanding ≤ 0) rejects any
  //    positive receipt.
  const amountDec = toDecimal(amount);
  if (amountDec.gt(outstanding.add(OUTSTANDING_TOLERANCE))) {
    throw new Error(`PAYMENT_EXCEEDS:${outstanding.toNumber()}`);
  }

  // FX: relieve AR at the rate it was originally booked (the invoice's document rate).
  // The explain path has no separate payment-date rate, so payment rate == document rate
  // (no FX gain/loss leg). Only pass rates for foreign-currency receipts.
  const isForeign = !!currencyCode && currencyCode !== 'BASE';
  const docRate = documentRate
    ?? (invoice.exchangeRate != null ? toDecimal(invoice.exchangeRate as string) : undefined);
  const payRate = paymentRate ?? docRate;

  // 6. Create the InvoicePayment sub-ledger row.
  // NOTE: movedBankBalance is intentionally left at its default (false). The
  // explain flow does NOT move bankDetail.currentBalance — the pre-existing
  // imported statement line already owns the money — so the delete/void reversal
  // must NOT touch the register for this payment.
  const paymentData: Record<string, unknown> = {
    invoiceId,
    amount: toDecimal(amount),
    received_on: date,
    received_by: userId,
    notes: '',
    paymentModeId,
    bankId: bankAccountId,
    ...(sourceBankTxnId ? { reference: sourceBankTxnId } : {}),
    ...(currencyCode ? { currencyCode } : {}),
    ...(isForeign && payRate !== undefined ? { exchangeRate: payRate } : {}),
  };

  const payment = await db.invoicePayment.create({ data: paymentData });

  // 7. Post the GL journal entry: Dr Bank / Cr AR.
  await postInvoicePayment(db, {
    userId,
    invoiceId,
    paymentId: payment.id,
    date,
    amount,
    paymentModeSlug,
    bankGlAccountId,
    ...(isForeign ? { currencyCode, paymentRate: payRate, documentRate: docRate } : {}),
  });

  // 8. Recompute and persist invoice status — CN-aware, via the shared helper so
  //    a receipt that clears the credit-note-reduced balance flips it to PAID.
  const newTotalPaid = totalPaid.add(amountDec);
  const { status: newStatus } = deriveInvoiceStatus(
    invoice.TotalAmount as Prisma.Decimal,
    newTotalPaid,
    creditNoted,
    invoice.status as InvoiceStatus,
  );
  await db.invoice.update({ where: { id: invoiceId }, data: { status: newStatus } });

  return { invoicePaymentId: payment.id };
}
