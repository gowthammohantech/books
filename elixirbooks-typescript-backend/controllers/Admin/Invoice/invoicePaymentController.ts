import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma';
import { requireUserId, UnauthorizedError } from '../../../lib/tenantScope';
import { sendPrismaError } from '../../../middleware/prismaError';
import {
  reverseInvoicePaymentEffects,
  type PaymentEffectsTx,
} from '../../../lib/ledger/voidPaymentEffects';
import {
  recomputeInvoiceStatus,
  getInvoiceSettlement,
} from '../../../lib/invoiceOutstanding';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

// ---------------------------------------------------------------------------
// listInvoicePayments
// GET /admin/invoices/:id/payments
// ---------------------------------------------------------------------------

export async function listInvoicePayments(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    // Scope invoice to this tenant/user and confirm existence.
    const invoice = await prisma.invoice.findFirst({
      where: { id, userId, isDeleted: false },
      select: { id: true, TotalAmount: true, status: true },
    });

    if (!invoice) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }

    // Fetch all payments (including voided) newest first.
    const payments = await prisma.invoicePayment.findMany({
      where: { invoiceId: id },
      orderBy: { received_on: 'desc' },
      select: {
        id: true,
        amount: true,
        received_on: true,
        reference: true,
        notes: true,
        isVoided: true,
        voidedAt: true,
        voidReason: true,
        paymentMode: { select: { name: true } },
        bank: { select: { bankName: true } },
        receivedByUser: { select: { firstName: true, lastName: true } },
        voidedBy: { select: { firstName: true, lastName: true } },
      },
    });

    // Compute summary — voided rows excluded from paid total.
    const paid = payments
      .filter((p) => !p.isVoided)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const total = Number(invoice.TotalAmount);

    res.status(200).json({
      success: true,
      message: 'Invoice payments fetched successfully',
      data: {
        payments,
        summary: {
          total,
          paid,
          remaining: total - paid,
          status: invoice.status,
        },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    sendPrismaError(res, err);
  }
}

// ---------------------------------------------------------------------------
// invoiceActivity
// GET /admin/invoices/:id/activity
// ---------------------------------------------------------------------------

export async function invoiceActivity(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    // Scope invoice to this tenant/user.
    const invoice = await prisma.invoice.findFirst({
      where: { id, userId, isDeleted: false },
      select: { id: true },
    });

    if (!invoice) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }

    const page = toPositiveInt(req.query.page, 1);
    const limit = toPositiveInt(req.query.limit, 10);
    const skip = (page - 1) * limit;

    // Collect the invoice's payment ids for the OR clause.
    const paymentRows = await prisma.invoicePayment.findMany({
      where: { invoiceId: id },
      select: { id: true },
    });
    const paymentIds = paymentRows.map((p) => p.id);

    // Build the audit-log where clause:
    // (entityType='Invoice' AND entityId=<id>) OR (entityType='InvoicePayment' AND entityId IN paymentIds)
    const where: Prisma.AuditLogWhereInput = {
      OR: [
        { entityType: 'Invoice', entityId: id },
        ...(paymentIds.length > 0
          ? [{ entityType: 'InvoicePayment', entityId: { in: paymentIds } }]
          : []),
      ],
    };

    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          entityLabel: true,
          summary: true,
          userName: true,
          createdAt: true,
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      message: 'Invoice activity fetched successfully',
      data: {
        items,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    sendPrismaError(res, err);
  }
}

// ---------------------------------------------------------------------------
// voidInvoicePayment
// POST /admin/invoices/payments/:paymentId/void
//
// Soft-VOIDs a recorded invoice payment inside ONE transaction:
//   1. reverse the GL posting for the EXACT (InvoicePayment, paymentId, 'payment')
//      triple (mints a balanced payment.reversal JE — source nets to 0),
//   2. reverse the bank side (decrement currentBalance + a reversing BankTransaction),
//   3. mark the payment isVoided + audit fields,
//   4. recompute invoice status from the NON-voided payment sum.
// ---------------------------------------------------------------------------

export async function voidInvoicePayment(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { paymentId } = req.params as { paymentId: string };
    const reason =
      typeof (req.body as { reason?: unknown })?.reason === 'string'
        ? ((req.body as { reason: string }).reason)
        : null;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Load the payment scoped to the owning user via its invoice.
      const payment = await tx.invoicePayment.findFirst({
        where: { id: paymentId, invoice: { userId, isDeleted: false } },
        include: { invoice: true, bank: true, paymentMode: true },
      });

      if (!payment) {
        return { error: 'NOT_FOUND' as const };
      }
      if (payment.isVoided) {
        return { error: 'ALREADY_VOIDED' as const };
      }

      const invoice = payment.invoice;

      // 2+3. Reverse the GL posting AND the bank side via the shared helper —
      //      the SAME effects deleteInvoice applies when it voids an invoice's
      //      payments, so the two paths cannot drift. Cash receipts (bank null)
      //      only get the GL reversal, mirroring recordInvoicePayment.
      await reverseInvoicePaymentEffects(tx as unknown as PaymentEffectsTx, {
        userId,
        payment,
      });

      // 4. Mark the payment voided.
      const voidedAt = new Date();
      await tx.invoicePayment.update({
        where: { id: payment.id },
        data: {
          isVoided: true,
          voidedById: userId,
          voidedAt,
          voidReason: reason,
        },
      });

      // 4b. If this payment redeemed account credit, restore the customer's
      // balance by voiding the matching AccountCreditEntry in the SAME
      // transaction — same actor/timestamp as the payment void. The GL side
      // (Dr AR / Cr ACCOUNT_CREDIT) is already reversed generically above by
      // reverseInvoicePaymentEffects/reverseDocument (it replays the original
      // posted lines, so it needs no ACCOUNT_CREDIT-specific branch). No-op
      // for non-credit payments (updateMany matches zero rows).
      await tx.accountCreditEntry.updateMany({
        where: { invoicePaymentId: payment.id, type: 'REDEMPTION', isVoided: false },
        data: { isVoided: true, voidedById: userId, voidedAt },
      });

      // 5. Recompute invoice status CN-aware (post-void). Every other P1-2 site
      //    nets credit notes into invoice status/remaining; recomputing from the
      //    payment sum alone here would leave a credit-noted invoice reporting
      //    UNPAID/full-remaining while aging (GL-reconciled) shows it PARTIALLY_
      //    PAID/CN-netted — the exact screens-disagree bug. recomputeInvoiceStatus
      //    persists the derived status (and no-ops CANCELLED invoices).
      const derived = await recomputeInvoiceStatus(tx, invoice.id, userId);
      const { totalPaid } = await getInvoiceSettlement(tx, invoice.id, userId);
      const total = Number(invoice.TotalAmount);
      const paid = Number(totalPaid);
      const status = derived?.status ?? invoice.status;
      const remaining = derived ? Number(derived.outstanding) : total - paid;

      return {
        summary: { total, paid, remaining, status },
      };
    });

    if ('error' in result) {
      if (result.error === 'NOT_FOUND') {
        res.status(404).json({ success: false, message: 'Payment not found' });
        return;
      }
      res.status(400).json({ success: false, message: 'Payment is already voided' });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Payment voided successfully',
      data: result.summary,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    sendPrismaError(res, err);
  }
}

// CommonJS interop — required by routes/adminRoutes.js (.js file).
module.exports = { listInvoicePayments, invoiceActivity, voidInvoicePayment };
module.exports.listInvoicePayments = listInvoicePayments;
module.exports.invoiceActivity = invoiceActivity;
module.exports.voidInvoicePayment = voidInvoicePayment;
