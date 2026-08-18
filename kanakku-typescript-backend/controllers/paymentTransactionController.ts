import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';


export async function list(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '10', 10)));

    const where: Prisma.PaymentTransactionWhereInput = { userId };
    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) where.status = statusFilter as Prisma.PaymentTransactionWhereInput['status'];
    const kindFilter = req.query.kind as string | undefined;
    if (kindFilter) where.kind = kindFilter as Prisma.PaymentTransactionWhereInput['kind'];
    const invoiceIdFilter = req.query.invoiceId as string | undefined;
    if (invoiceIdFilter) where.invoiceId = invoiceIdFilter;

    const [rows, total] = await Promise.all([
      prisma.paymentTransaction.findMany({
        where,
        include: { invoice: { select: { id: true, invoiceNumber: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.paymentTransaction.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        paymentTransactions: rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            status: r.status,
            amount: r.amount,
            currency: r.currency,
            invoiceId: r.invoiceId,
            invoice: r.invoice ? { id: r.invoice.id, invoiceNumber: r.invoice.invoiceNumber } : null,
            gatewayOrderId: r.gatewayOrderId,
            gatewayPaymentId: r.gatewayPaymentId,
            createdAt: r.createdAt,
          })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('paymentTransaction list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list transactions' });
  }
}

export async function getById(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const row = await prisma.paymentTransaction.findFirst({
      where: { id, userId },
      include: {
        invoice: { select: { id: true, invoiceNumber: true } },
        refunds: true,
      },
    });
    if (!row) {
      res.status(404).json({ success: false, message: 'Transaction not found' });
      return;
    }
    res.json({ success: true, data: { paymentTransaction: { ...row } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('paymentTransaction getById error:', err);
    res.status(500).json({ success: false, message: 'Failed to load transaction' });
  }
}

const handlers = { list, getById };
module.exports = handlers;
module.exports.default = handlers;
