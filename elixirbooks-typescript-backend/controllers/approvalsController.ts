// controllers/approvalsController.ts
// Spec D — approvals queue: list PENDING documents for the approvals dashboard.
import type { Request, Response } from 'express';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

// GET /admin/approvals/pending
// Returns tenant-scoped PENDING invoices, expenses, and purchases (id, number, amount, date).
export async function listPending(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);

    const [invoices, expenses, purchases] = await Promise.all([
      prisma.invoice.findMany({
        where: { userId, approvalStatus: 'PENDING', isDeleted: false },
        select: {
          id: true,
          invoiceNumber: true,
          TotalAmount: true,
          invoiceDate: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.expense.findMany({
        where: { userId, approvalStatus: 'PENDING', isDeleted: false },
        select: {
          id: true,
          expenseId: true,
          amount: true,
          expenseDate: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.purchase.findMany({
        where: { userId, approvalStatus: 'PENDING', isDeleted: false },
        select: {
          id: true,
          purchaseId: true,
          totalAmount: true,
          purchaseDate: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.status(200).json({
      success: true,
      message: 'Pending approvals retrieved',
      data: {
        invoices: invoices.map((i) => ({
          id: i.id,
          number: i.invoiceNumber,
          amount: i.TotalAmount,
          date: i.invoiceDate,
        })),
        expenses: expenses.map((e) => ({
          id: e.id,
          number: e.expenseId,
          amount: e.amount,
          date: e.expenseDate,
        })),
        purchases: purchases.map((p) => ({
          id: p.id,
          number: p.purchaseId,
          amount: p.totalAmount,
          date: p.purchaseDate,
        })),
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('listPending approvals error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching pending approvals',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes
module.exports = { listPending };
module.exports.listPending = listPending;
