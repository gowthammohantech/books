// controllers/Admin/Purchases/supplierPaymentReadController.ts
//
// Purchase-parity read endpoints (Task 2):
//   GET  /purchases/:id/payments    → listSupplierPaymentsForPurchase
//   GET  /purchases/:id/activity    → purchaseActivity
//   POST /purchases/payments/:paymentId/void → voidSupplierPayment
//
// Mirrors invoicePaymentController.ts exactly, adapted for SupplierPayment /
// Purchase / PurchaseStatus.

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { PurchaseStatus } from '@prisma/client';

import { prisma } from '../../../lib/prisma';
import { requireUserId, UnauthorizedError } from '../../../lib/tenantScope';
import { sendPrismaError } from '../../../middleware/prismaError';
import {
  reverseSupplierPaymentEffects,
  type PaymentEffectsTx,
} from '../../../lib/ledger/voidPaymentEffects';

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
// listSupplierPaymentsForPurchase
// GET /admin/purchases/:id/payments
// ---------------------------------------------------------------------------

export async function listSupplierPaymentsForPurchase(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    // Scope purchase to this tenant/user and confirm existence.
    const purchase = await prisma.purchase.findFirst({
      where: { id, userId, isDeleted: false },
      select: { id: true, totalAmount: true, status: true },
    });

    if (!purchase) {
      res.status(404).json({ success: false, message: 'Purchase not found' });
      return;
    }

    // Fetch all payments (including voided) newest first.
    const payments = await prisma.supplierPayment.findMany({
      where: { purchaseId: id },
      orderBy: { paymentDate: 'desc' },
      select: {
        id: true,
        paidAmount: true,
        paymentDate: true,
        referenceNumber: true,
        notes: true,
        isVoided: true,
        voidedAt: true,
        voidReason: true,
        currencyCode: true,
        paymentMode: { select: { name: true } },
        bank: { select: { bankName: true } },
        createdByUser: { select: { firstName: true, lastName: true } },
        voidedBy: { select: { firstName: true, lastName: true } },
      },
    });

    // Compute summary — voided rows excluded from paid total.
    const paid = payments
      .filter((p) => !p.isVoided)
      .reduce((sum, p) => sum + Number(p.paidAmount), 0);
    const total = Number(purchase.totalAmount);

    res.status(200).json({
      success: true,
      message: 'Purchase payments fetched successfully',
      data: {
        payments,
        summary: {
          total,
          paid,
          remaining: total - paid,
          status: purchase.status,
        },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    sendPrismaError(res, err);
  }
}

// ---------------------------------------------------------------------------
// purchaseActivity
// GET /admin/purchases/:id/activity
// ---------------------------------------------------------------------------

export async function purchaseActivity(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    // Scope purchase to this tenant/user.
    const purchase = await prisma.purchase.findFirst({
      where: { id, userId, isDeleted: false },
      select: { id: true },
    });

    if (!purchase) {
      res.status(404).json({ success: false, message: 'Purchase not found' });
      return;
    }

    const page = toPositiveInt(req.query.page, 1);
    const limit = toPositiveInt(req.query.limit, 10);
    const skip = (page - 1) * limit;

    // Collect the purchase's payment ids for the OR clause.
    const paymentRows = await prisma.supplierPayment.findMany({
      where: { purchaseId: id },
      select: { id: true },
    });
    const paymentIds = paymentRows.map((p) => p.id);

    // Build the audit-log where clause:
    // (entityType='Purchase' AND entityId=<id>) OR (entityType='SupplierPayment' AND entityId IN paymentIds)
    const where: Prisma.AuditLogWhereInput = {
      OR: [
        { entityType: 'Purchase', entityId: id },
        ...(paymentIds.length > 0
          ? [{ entityType: 'SupplierPayment', entityId: { in: paymentIds } }]
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
      message: 'Purchase activity fetched successfully',
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
// voidSupplierPayment
// POST /admin/purchases/payments/:paymentId/void
//
// Soft-VOIDs a recorded supplier payment inside ONE transaction:
//   1. reverse the GL posting for the EXACT (SupplierPayment, paymentId, 'payment')
//      triple (mints a balanced payment.reversal JE — source nets to 0),
//   2. reverse the bank side (increment currentBalance + a reversing BankTransaction —
//      opposite of createSupplierPayment which DECREMENTED balance + wrote TRANSFER_OUT),
//   3. mark the payment isVoided + audit fields,
//   4. recompute purchase status from the NON-voided payment sum.
// ---------------------------------------------------------------------------

export async function voidSupplierPayment(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { paymentId } = req.params as { paymentId: string };
    const reason =
      typeof (req.body as { reason?: unknown })?.reason === 'string'
        ? ((req.body as { reason: string }).reason)
        : null;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Load the payment scoped to the owning user via its purchase.
      const payment = await tx.supplierPayment.findFirst({
        where: { id: paymentId, purchase: { userId, isDeleted: false } },
        include: { purchase: true, bank: true, paymentMode: true },
      });

      if (!payment) {
        return { error: 'NOT_FOUND' as const };
      }
      if (payment.isVoided) {
        return { error: 'ALREADY_VOIDED' as const };
      }

      const purchase = payment.purchase;

      // 2+3. Reverse the GL posting AND the cash source (bank OR petty cash)
      //      via the shared helper — the SAME effects deletePurchase and
      //      deleteSupplierPayment apply, so the paths cannot drift.
      await reverseSupplierPaymentEffects(tx as unknown as PaymentEffectsTx, {
        userId,
        payment,
      });

      // 4. Mark the payment voided.
      await tx.supplierPayment.update({
        where: { id: payment.id },
        data: {
          isVoided: true,
          voidedById: userId,
          voidedAt: new Date(),
          voidReason: reason,
        },
      });

      // 5. Recompute purchase status from the NON-voided payment sum (post-void).
      const paidAgg = await tx.supplierPayment.aggregate({
        where: { purchaseId: purchase.id, isVoided: false },
        _sum: { paidAmount: true },
      });
      const paid = Number(paidAgg._sum.paidAmount ?? 0);
      const total = Number(purchase.totalAmount);

      let status: PurchaseStatus = 'pending';
      if (paid >= total) status = 'paid';
      else if (paid > 0) status = 'partially_paid';

      await tx.purchase.update({
        where: { id: purchase.id },
        data: { status },
      });

      return {
        summary: { total, paid, remaining: total - paid, status },
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
module.exports = {
  listSupplierPaymentsForPurchase,
  purchaseActivity,
  voidSupplierPayment,
};
module.exports.listSupplierPaymentsForPurchase = listSupplierPaymentsForPurchase;
module.exports.purchaseActivity = purchaseActivity;
module.exports.voidSupplierPayment = voidSupplierPayment;
