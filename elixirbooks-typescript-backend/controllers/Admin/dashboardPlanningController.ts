import type { Request, Response } from 'express';
import type { Prisma, InvoiceStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { requireUserId, UnauthorizedError } from '../../lib/tenantScope';
import { resolveDisplayName } from '../../lib/contacts/contactIdentity';

const num = (d: Prisma.Decimal | number | string | null | undefined): number =>
  Number(d ?? 0);

const monthKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date): string =>
  d.toLocaleString('en-US', { month: 'short', year: '2-digit' });

const OPEN_INVOICE_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE', 'SENT'] as const;

// Contact-first party-name resolution: unified-contact-linked invoices leave
// the legacy `customer` null, so `customer?.name` alone renders blank.
type InvoiceParty = {
  customer?: { name: string | null } | null;
  contact?: Parameters<typeof resolveDisplayName>[0] | null;
};
const partyName = (i: InvoiceParty): string =>
  (i.contact ? resolveDisplayName(i.contact) : '') || i.customer?.name || '';

/**
 * Accounts planning view:
 *  - monthlySeries: sales (invoices) vs expenses for the last 6 months
 *  - nextMonth: expected income (recurring invoices scheduled next month + open
 *    invoices due next month) tallied against recurring expenses due next month
 */
export async function accountsPlanning(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const now = new Date();
    const MONTHS = 6;

    const seriesStart = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1), 1);
    const seriesEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [histInvoices, histExpenses] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          userId, isDeleted: false, invoiceType: 'INVOICE',
          invoiceDate: { gte: seriesStart, lte: seriesEnd },
        },
        select: { invoiceDate: true, TotalAmount: true },
      }),
      prisma.expense.findMany({
        where: { userId, isDeleted: false, expenseDate: { gte: seriesStart, lte: seriesEnd } },
        select: { expenseDate: true, amount: true },
      }),
    ]);

    const buckets: { key: string; label: string; sales: number; expenses: number }[] = [];
    for (let i = MONTHS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: monthKey(d), label: monthLabel(d), sales: 0, expenses: 0 });
    }
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    for (const inv of histInvoices) {
      const i = idx.get(monthKey(new Date(inv.invoiceDate)));
      if (i != null) buckets[i].sales += num(inv.TotalAmount);
    }
    for (const ex of histExpenses) {
      const i = idx.get(monthKey(new Date(ex.expenseDate)));
      if (i != null) buckets[i].expenses += num(ex.amount);
    }

    // --- Next-month planning window ---
    const nextStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
    const nextLabel = nextStart.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const [recInvoices, dueInvoices, recExpenses] = await Promise.all([
      prisma.invoice.findMany({
        where: { userId, isDeleted: false, isRecurring: true, nextRecurringDate: { gte: nextStart, lte: nextEnd } },
        // Unified-contact-linked invoices leave the legacy `customer` null, so
        // the party must resolve contact-first (see mapping below) — otherwise
        // this customer-facing planning widget showed a blank/"Deleted User" label.
        select: {
          id: true, invoiceNumber: true, TotalAmount: true, nextRecurringDate: true, repeatEvery: true,
          customer: { select: { name: true } },
          contact: {
            select: {
              id: true, firstName: true, lastName: true, organisation: true,
              email: true, mobile: true, telephone: true, image: true,
            },
          },
        },
        orderBy: { nextRecurringDate: 'asc' },
      }),
      prisma.invoice.findMany({
        where: {
          userId, isDeleted: false, invoiceType: 'INVOICE',
          status: { in: OPEN_INVOICE_STATUSES as unknown as InvoiceStatus[] },
          dueDate: { gte: nextStart, lte: nextEnd },
        },
        select: {
          id: true, invoiceNumber: true, TotalAmount: true, dueDate: true,
          payments: { where: { isVoided: false }, select: { amount: true } },
          customer: { select: { name: true } },
          contact: {
            select: {
              id: true, firstName: true, lastName: true, organisation: true,
              email: true, mobile: true, telephone: true, image: true,
            },
          },
        },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.expense.findMany({
        where: { userId, isDeleted: false, isRecurring: true, nextRecurringDate: { gte: nextStart, lte: nextEnd } },
        select: { id: true, expenseId: true, description: true, amount: true, nextRecurringDate: true, repeatEvery: true, expenseCategory: { select: { title: true } } },
        orderBy: { nextRecurringDate: 'asc' },
      }),
    ]);

    const outstandingOf = (inv: { TotalAmount: Prisma.Decimal; payments: { amount: Prisma.Decimal }[] }): number => {
      const paid = inv.payments.reduce((a, p) => a + num(p.amount), 0);
      return Math.max(0, num(inv.TotalAmount) - paid);
    };

    const recurringInvoiceTotal = recInvoices.reduce((s, i) => s + num(i.TotalAmount), 0);
    const dueInvoiceTotal = dueInvoices.reduce((s, i) => s + outstandingOf(i), 0);
    const recurringExpenseTotal = recExpenses.reduce((s, e) => s + num(e.amount), 0);
    const expectedIncome = recurringInvoiceTotal + dueInvoiceTotal;
    const expectedExpenses = recurringExpenseTotal;

    res.json({
      success: true,
      data: {
        monthlySeries: buckets,
        nextMonth: {
          label: nextLabel,
          expectedIncome: { recurringInvoices: recurringInvoiceTotal, dueInvoices: dueInvoiceTotal, total: expectedIncome },
          expectedExpenses: { recurringExpenses: recurringExpenseTotal, total: expectedExpenses },
          projectedNet: expectedIncome - expectedExpenses,
        },
        upcomingRecurringInvoices: recInvoices.map((i) => ({
          id: i.id,
          label: i.invoiceNumber ?? (partyName(i) || 'Recurring invoice'),
          amount: num(i.TotalAmount),
          date: i.nextRecurringDate,
          frequency: i.repeatEvery,
        })),
        upcomingDueInvoices: dueInvoices
          .map((i) => ({ id: i.id, label: i.invoiceNumber ?? (partyName(i) || 'Invoice'), amount: outstandingOf(i), date: i.dueDate }))
          .filter((x) => x.amount > 0),
        upcomingRecurringExpenses: recExpenses.map((e) => ({
          id: e.id,
          label: e.expenseCategory?.title ?? e.description ?? e.expenseId ?? 'Recurring expense',
          amount: num(e.amount),
          date: e.nextRecurringDate,
          frequency: e.repeatEvery,
        })),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('accountsPlanning error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute accounts planning' });
  }
}

module.exports = { accountsPlanning };
module.exports.accountsPlanning = accountsPlanning;
