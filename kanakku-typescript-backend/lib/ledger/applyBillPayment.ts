// lib/ledger/applyBillPayment.ts
//
// Shared helper: validate an open purchase/bill, create the SupplierPayment
// sub-ledger row, post the GL entry (Dr AP / Cr Bank), and update purchase status.
//
// Used by the explain path (explainPosting bill_link case) so the AP
// sub-ledger stays in sync with bank transactions linked to bills.

import { toDecimal } from './money';
import { postSupplierPayment, type PostingTx } from './ledgerPosting';
import { nextDocumentNumber, type NumberingModel } from '../documentNumbering';

// ---------------------------------------------------------------------------
// DB structural type — extends PostingTx with purchase + supplierPayment ops.
// ---------------------------------------------------------------------------

export interface ApplyBillPaymentDb extends PostingTx {
  purchase: {
    findFirst: (args: { where: { id: string; userId: string; isDeleted: boolean } }) => Promise<{
      id: string;
      totalAmount: unknown;
      paidAmount: unknown;
      balanceAmount: unknown;
      status: string;
      userId: string;
      supplierId?: string | null;
      vendorId?: string | null;
      billTo?: string | null;
      currencyCode?: string | null;
      exchangeRate?: unknown;
    } | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  supplierPayment: {
    aggregate: (args: { where: { purchaseId: string; isVoided: boolean; isDeleted: boolean }; _sum: { amount: true } }) => Promise<{ _sum: { amount: unknown } }>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    findUnique: (args: { where: { id: string } }) => Promise<{ id: string; purchaseId: string; amount: unknown; isVoided: boolean } | null>;
    findFirst: (args: {
      where:
        | { paymentId: { not: null }; purchase: { userId: string } }
        | { paymentId: string }
        | { paymentId: { not: null } };
      orderBy?: { createdAt: 'desc' } | { paymentId: 'desc' };
      select: { paymentId: true } | { id: true };
    }) => Promise<{ paymentId?: string | null; id?: string } | null>;
  };
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ApplyBillPaymentInput {
  userId: string;
  purchaseId: string;       // the bill/purchase id
  amount: string;           // string Decimal (bank txn amount)
  date: Date;
  bankAccountId: string;    // the bank account id
  /** Per-bank GL sub-account (BankDetail.accountId) for the BANK leg; null → shared BANK role. */
  bankGlAccountId?: string | null;
  paymentModeId?: string | null;
  paymentModeSlug?: string | null;
  currencyCode?: string;
}

export interface ApplyBillPaymentResult {
  supplierPaymentId: string;
}

// ---------------------------------------------------------------------------
// Payment-number generator — shared with the other 4 document-numbering call
// sites via lib/documentNumbering.ts (see that file's header for the
// algorithm and the race-hardening rationale).
//
// NOTE: this function does NOT retry on a P2002 collision, unlike its sibling
// call sites in the controllers. Those own their `prisma.$transaction` and
// can safely re-run it whole on retry; this helper is invoked from inside a
// transaction owned by lib/moneyFlow/explainPosting.ts's explainAndPost(), so
// it has no transaction to retry. A same-field P2002 here simply propagates:
// it aborts that outer transaction (nothing was committed) and the existing
// generic Prisma-error mapping (middleware/prismaError.ts, wired into both
// callers of explainAndPost) turns it into a 409 instead of a raw 500.
// ---------------------------------------------------------------------------

function generatePaymentId(db: ApplyBillPaymentDb, userId: string, prefix = 'PAY-'): Promise<string> {
  return nextDocumentNumber({
    model: db.supplierPayment as unknown as NumberingModel,
    field: 'paymentId',
    prefix,
    tenantWhere: { purchase: { userId } },
  });
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function applyBillPayment(
  db: ApplyBillPaymentDb,
  input: ApplyBillPaymentInput,
): Promise<ApplyBillPaymentResult> {
  const { userId, purchaseId, amount, date, bankAccountId, bankGlAccountId, paymentModeId, paymentModeSlug, currencyCode } = input;

  // 1. Load purchase scoped to userId (not deleted).
  const purchase = await db.purchase.findFirst({ where: { id: purchaseId, userId, isDeleted: false } });
  if (!purchase) throw new Error('BILL_NOT_FOUND');

  // 2. Already fully paid or cancelled?
  if (purchase.status === 'paid' || purchase.status === 'cancelled') throw new Error('BILL_ALREADY_PAID');

  // 3. Aggregate non-voided, non-deleted SupplierPayment sum for this purchaseId.
  const paidAgg = await db.supplierPayment.aggregate({
    where: { purchaseId: purchase.id, isVoided: false, isDeleted: false },
    _sum: { amount: true },
  });
  const alreadyPaid = Number(paidAgg._sum.amount ?? 0);

  // 4. Remaining balance on the bill.
  const totalAmount = Number(purchase.totalAmount);
  const remaining = totalAmount - alreadyPaid;

  // 5. Guard against overpayment (allow a 0.005 tolerance to absorb rounding).
  if (Number(amount) > remaining + 0.005) {
    throw new Error(`PAYMENT_EXCEEDS:${remaining}`);
  }

  // 6. Create SupplierPayment sub-ledger row.
  // supplierId MUST be a Supplier FK (or null). vendorId / billTo are User FKs —
  // using them here would cause a FK violation in production.
  const supplierId = purchase.supplierId ?? null;
  const paymentIdVal = await generatePaymentId(db, userId);
  // NOTE: movedBankBalance is intentionally left at its default (false). The
  // explain flow sets sourceType='BANK' but NEVER moves bankDetail.currentBalance
  // (the pre-existing imported statement line owns the money), so the delete/void
  // reversal must NOT touch the register for this payment.
  const spData: Record<string, unknown> = {
    paymentId: paymentIdVal,
    purchaseId: purchase.id,
    supplierId,
    paymentDate: date,
    paymentModeId: paymentModeId ?? null,
    sourceType: 'BANK',
    bankId: bankAccountId,
    amount: toDecimal(amount),
    paidAmount: toDecimal(amount),
    dueAmount: toDecimal(0),
    createdBy: userId,
  };
  if (currencyCode) spData['currencyCode'] = currencyCode;

  const supplierPayment = await db.supplierPayment.create({ data: spData });

  // 7. Post GL: Dr AP / Cr Bank, keyed to the SupplierPayment id.
  // FX: relieve AP at the rate the bill (purchase) originally booked it. The
  // explain path carries no separate payment-date rate, so paymentRate ==
  // documentRate (no FX gain/loss leg) — mirroring applyInvoiceReceipt. Without
  // this a foreign bill payment relieves AP at rate 1 and the base never clears.
  const isForeign = !!currencyCode && currencyCode !== 'BASE';
  const documentRate =
    isForeign && purchase.exchangeRate != null ? toDecimal(purchase.exchangeRate as string) : undefined;
  await postSupplierPayment(db, {
    userId,
    purchaseId: purchase.id,
    paymentId: supplierPayment.id,
    date,
    amount,
    paymentModeSlug,
    bankGlAccountId,
    ...(isForeign
      ? { currencyCode, paymentRate: documentRate, documentRate }
      : { currencyCode }),
  });

  // 8. Recompute purchase status.
  const newTotalPaid = alreadyPaid + Number(amount);
  const newBalance = totalAmount - newTotalPaid;
  let newStatus: string;
  if (newBalance <= 0) {
    newStatus = 'paid';
  } else if (newTotalPaid > 0) {
    newStatus = 'partially_paid';
  } else {
    newStatus = purchase.status;
  }

  // 9. Persist purchase status + amounts.
  await db.purchase.update({
    where: { id: purchase.id },
    data: {
      paidAmount: toDecimal(newTotalPaid),
      balanceAmount: toDecimal(newBalance),
      status: newStatus as 'pending' | 'partially_paid' | 'paid',
    },
  });

  // 10. Return the SupplierPayment id so the caller can store it.
  return { supplierPaymentId: supplierPayment.id };
}
