// lib/ledger/voidPaymentEffects.ts
//
// Shared money-effect reversal for VOIDING/ DELETING a recorded payment.
//
// Both the standalone void endpoints (voidInvoicePayment / voidSupplierPayment)
// AND the document-delete paths (deleteInvoice / deletePurchase /
// deleteSupplierPayment) must reverse the EXACT same effects when a payment is
// undone:
//
//   1. reverse the payment's GL posting (the (SourceType, paymentId, 'payment')
//      triple) so the source nets to zero,
//   2. restore the cash source's balance (bankDetail.currentBalance for BANK,
//      pettyCash.currentBalance for PETTY_CASH) and write a reversing
//      bank/petty transaction that inverts the original outflow/inflow.
//
// This module owns ONLY those money effects — the row-state change
// (isVoided vs hard-delete) and any parent-document status recompute stay with
// each caller, because they legitimately differ (a void keeps the row and
// recomputes status; a document delete soft-deletes the whole document and the
// per-payment status recompute is moot).
//
// Keeping this in one place stops the delete paths from drifting away from the
// audited voidInvoicePayment / voidSupplierPayment reference behaviour.

import { Prisma } from '@prisma/client';
import { reverseDocument, type PostingTx } from './ledgerPosting';
import { toBaseAmount } from './money';

function toDecimal(value: unknown, fallback = 0): Prisma.Decimal {
  return new Prisma.Decimal(
    typeof value === 'number' || typeof value === 'string' ? value : fallback,
  );
}

/** Base-currency register value for a payment being reversed. The create path
 *  moved the base-currency register by amount × the payment's own rate, so the
 *  reversal must undo the SAME base amount. `exchangeRate` null → base path. */
function baseFor(amount: unknown, exchangeRate: unknown): number {
  return toBaseAmount(
    // Prisma returns money columns (amount/paidAmount) as Prisma.Decimal
    // INSTANCES (typeof === 'object'). Without the instanceof arm this guard
    // fell through to 0, so the register reversal moved 0 and the cash balance
    // was never restored on void/delete of a record-path payment. toBaseAmount
    // accepts Decimal|number|string, so pass the Decimal straight through.
    typeof amount === 'number' || typeof amount === 'string' || amount instanceof Prisma.Decimal
      ? (amount as Prisma.Decimal | number | string)
      : 0,
    typeof exchangeRate === 'number' || typeof exchangeRate === 'string' || exchangeRate instanceof Prisma.Decimal
      ? (exchangeRate as Prisma.Decimal | number | string)
      : null,
  );
}

// The narrow slice of a Prisma transaction client these helpers touch. Callers
// pass their real `tx`; it is cast to PostingTx for the GL reversal (which needs
// the journalEntry surface) and used directly for the balance writes.
export interface PaymentEffectsTx {
  bankDetail: { update: (args: unknown) => Promise<unknown> };
  bankTransaction: {
    create: (args: unknown) => Promise<unknown>;
  };
  pettyCash: {
    findFirst: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  pettyCashTransaction: {
    create: (args: unknown) => Promise<unknown>;
  };
}

/**
 * DISCRIMINATOR (P1 final review, finding 1 — REFIX): did THIS payment's CREATE
 * path move a cash register? Two payment origins share the same
 * InvoicePayment/SupplierPayment shape but move money differently:
 *
 *   - recordInvoicePayment / createSupplierPayment (the classic record path):
 *     these DECREMENT/INCREMENT bankDetail.currentBalance (or pettyCash) AND
 *     write their own bank/petty transaction. They persist movedBankBalance=true.
 *     Reversing them MUST undo that register move.
 *
 *   - the bank-reconciliation EXPLAIN flow (applyInvoiceReceipt /
 *     applyBillPayment): the money already sits in a PRE-EXISTING imported bank
 *     line (a DIFFERENT row that owns currentBalance); the created payment never
 *     touched currentBalance. They leave movedBankBalance=false. Reversing them
 *     must NOT move the register a second time (else it drifts by the payment
 *     amount) — only the GL is reversed.
 *
 * The FIRST fix gated on "a bank line keyed (relatedType, relatedId=paymentId)
 * exists". That FAILED: the explain flow RELABELS the imported statement line,
 * stamping the SAME relatedType/relatedId (and postedSourceType) onto it
 * (lib/moneyFlow/explainPosting.ts ~L775) — identical to what the record path
 * writes on its own fresh line. So the lookup matched BOTH origins and the
 * double-adjust persisted. The persisted movedBankBalance flag is the only
 * signal that reliably separates them. The GL reversal ALWAYS runs regardless.
 */

// ---------------------------------------------------------------------------
// Invoice payment (a RECEIPT — created path INCREMENTED bank balance)
// ---------------------------------------------------------------------------

export interface InvoicePaymentForVoid {
  id: string;
  amount: Prisma.Decimal | number | string;
  /** Payment-currency → base rate the receipt was recorded at (null/undefined = base). */
  exchangeRate?: Prisma.Decimal | number | string | null;
  paymentModeId: string | null;
  bank: { id: string; currentBalance: Prisma.Decimal | number | null } | null;
  paymentMode: { slug: string | null } | null;
  /** TRUE iff the CREATE path moved bankDetail.currentBalance (record path). The
   *  explain flow leaves it false — see the module DISCRIMINATOR note. */
  movedBankBalance?: boolean | null;
}

/**
 * Reverse the money effects of one recorded INVOICE payment (mirrors the bank
 * block inside voidInvoicePayment):
 *   - reverse the GL posting (InvoicePayment / paymentId / 'payment'),
 *   - for a bank-backed receipt: DECREMENT bank.currentBalance and write a
 *     reversing WITHDRAWAL (cash mode) / TRANSFER_OUT bankTransaction.
 * Cash receipts carry no bank (bank === null) so only the GL reversal runs,
 * exactly as recordInvoicePayment skipped the bank side on record.
 */
export async function reverseInvoicePaymentEffects(
  tx: PaymentEffectsTx,
  params: { userId: string; payment: InvoicePaymentForVoid; remarks?: string },
): Promise<void> {
  const { userId, payment } = params;
  // Base-currency register value — the receipt INCREMENTED the base register by
  // this on create, so the void DECREMENTS the same base amount.
  const amount = baseFor(payment.amount, payment.exchangeRate);

  await reverseDocument(tx as unknown as PostingTx, {
    userId,
    sourceType: 'InvoicePayment',
    sourceId: payment.id,
    event: 'payment',
  });

  // Only reverse the cash register if THIS payment moved it on record. An
  // explain-flow receipt (applyInvoiceReceipt) carries a bank but the money
  // lives in a pre-existing imported bank line (movedBankBalance=false), so
  // moving currentBalance here would double-adjust the register. GL reversal
  // above already ran.
  if (payment.bank && payment.movedBankBalance === true) {
    const isCashMode = payment.paymentMode?.slug?.toLowerCase() === 'cash';
    const reversalType = isCashMode ? 'WITHDRAWAL' : 'TRANSFER_OUT';

    const balanceBefore = Number(payment.bank.currentBalance ?? 0);
    const newBalance = balanceBefore - amount;

    await tx.bankDetail.update({
      where: { id: payment.bank.id },
      data: { currentBalance: toDecimal(newBalance), asOnDate: new Date() },
    });

    await tx.bankTransaction.create({
      data: {
        bankAccountId: payment.bank.id,
        transactionDate: new Date(),
        type: reversalType,
        amount: toDecimal(amount),
        balanceBefore: toDecimal(balanceBefore),
        balanceAfter: toDecimal(newBalance),
        paymentModeId: payment.paymentModeId,
        remarks: params.remarks ?? `Void of invoice payment ${payment.id}`,
        relatedType: 'INVOICE_PAYMENT',
        relatedId: payment.id,
        // System-generated void reversal — mark EXPLAINED so it does NOT land in
        // the Unexplained queue as an un-actionable row (it has no source to
        // explain; it IS the explanation of the void). Payment-born: the void JE
        // already books this cash movement, so banking must never let it be
        // explained/reposted (that would double-count the reversal).
        explainStatus: 'EXPLAINED',
        isPaymentBorn: true,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Supplier payment (an OUTFLOW — created path DECREMENTED bank/petty balance)
// ---------------------------------------------------------------------------

export interface SupplierPaymentForVoid {
  id: string;
  paidAmount: Prisma.Decimal | number | string;
  /** Payment-currency → base rate the payment was recorded at (null/undefined = base). */
  exchangeRate?: Prisma.Decimal | number | string | null;
  paymentModeId: string | null;
  sourceType: string;
  bank: { id: string; currentBalance: Prisma.Decimal | number | null } | null;
  /** TRUE iff the CREATE path moved a cash register (record path). The explain
   *  flow (applyBillPayment) leaves it false — see the module DISCRIMINATOR note. */
  movedBankBalance?: boolean | null;
}

/**
 * Reverse the money effects of one recorded SUPPLIER payment (mirrors the cash
 * block inside voidSupplierPayment):
 *   - reverse the GL posting (SupplierPayment / paymentId / 'payment'),
 *   - BANK: INCREMENT bank.currentBalance + reversing TRANSFER_IN bankTransaction,
 *   - PETTY_CASH: INCREMENT pettyCash.currentBalance + reversing RETURN
 *     pettyCashTransaction (tenant-scoped strictly by userId).
 */
export async function reverseSupplierPaymentEffects(
  tx: PaymentEffectsTx,
  params: { userId: string; payment: SupplierPaymentForVoid; remarks?: string },
): Promise<void> {
  const { userId, payment } = params;
  // Base-currency register value — the payment DECREMENTED the base register by
  // this on create, so the void INCREMENTS the same base amount.
  const amount = baseFor(payment.paidAmount, payment.exchangeRate);

  await reverseDocument(tx as unknown as PostingTx, {
    userId,
    sourceType: 'SupplierPayment',
    sourceId: payment.id,
    event: 'payment',
  });

  // Same discriminator as the invoice side: an explain-flow bill payment
  // (applyBillPayment) sets sourceType='BANK' + bankId but NEVER moved
  // currentBalance (the pre-existing imported bank line owns the money, so
  // movedBankBalance=false), so reversing the register here would double-adjust
  // it. Gate on the persisted flag; GL reversal above always runs.
  if (
    payment.sourceType === 'BANK' &&
    payment.bank &&
    payment.movedBankBalance === true
  ) {
    const balanceBefore = Number(payment.bank.currentBalance ?? 0);
    const newBalance = balanceBefore + amount;

    await tx.bankDetail.update({
      where: { id: payment.bank.id },
      data: { currentBalance: toDecimal(newBalance), asOnDate: new Date() },
    });

    await tx.bankTransaction.create({
      data: {
        bankAccountId: payment.bank.id,
        transactionDate: new Date(),
        type: 'TRANSFER_IN',
        amount: toDecimal(amount),
        balanceBefore: toDecimal(balanceBefore),
        balanceAfter: toDecimal(newBalance),
        paymentModeId: payment.paymentModeId!,
        remarks: params.remarks ?? `Void of supplier payment ${payment.id}`,
        relatedType: 'SUPPLIER_PAYMENT',
        relatedId: payment.id,
        // System-generated void reversal — EXPLAINED so it stays out of the
        // Unexplained queue, payment-born so banking can never repost it
        // (see the invoice-side note above).
        explainStatus: 'EXPLAINED',
        isPaymentBorn: true,
      },
    });
  } else if (
    payment.sourceType === 'PETTY_CASH' &&
    payment.movedBankBalance === true
  ) {
    const pettyCash = (await tx.pettyCash.findFirst({
      where: { userId, isDeleted: false },
    })) as { id: string; currentBalance: Prisma.Decimal | number | null } | null;
    if (pettyCash) {
      const balanceBefore = Number(pettyCash.currentBalance ?? 0);
      const balanceAfter = Number((balanceBefore + amount).toFixed(2));

      await tx.pettyCash.update({
        where: { id: pettyCash.id },
        data: { currentBalance: toDecimal(balanceAfter) },
      });

      await tx.pettyCashTransaction.create({
        data: {
          pettyCashId: pettyCash.id,
          transactionDate: new Date(),
          transactionType: 'RETURN',
          amount: toDecimal(amount),
          balanceBefore: toDecimal(balanceBefore),
          balanceAfter: toDecimal(balanceAfter),
          remarks: params.remarks ?? `Void of supplier payment ${payment.id}`,
          relatedType: 'SUPPLIER_PAYMENT',
          relatedId: payment.id,
        },
      });
    }
  }
}
