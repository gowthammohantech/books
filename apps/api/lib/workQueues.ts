import { prisma } from './prisma';

/**
 * "What is waiting for me", as counts.
 *
 * Two callers, one implementation: the dashboard folds these into its payload
 * (it is already making twenty queries, so one more block costs nothing), and
 * GET /admin/work-queues serves the sidebar badges on every other page without
 * dragging the whole dashboard along.
 *
 * Every count is DERIVED rather than read from a status column that something
 * has to keep fresh. `InvoiceStatus.OVERDUE` exists, for instance, but nothing
 * sweeps it — an invoice that fell overdue last night still reads UNPAID until
 * someone touches it, so counting the status would silently under-report.
 *
 * Queues in the reference design with nothing behind them — GRN awaiting
 * receipt, bills awaiting three-way match, IRNs to generate — are absent rather
 * than zeroed. A tile reading "0" claims the queue is empty, which is a
 * different statement from "this module does not exist yet".
 */
export interface WorkQueueCounts {
  invoicesOverdue: number;
  billsUnpaid: number;
  bankUnexplained: number;
  quotationsExpiring: number;
  awaitingApproval: number;
}

/** Open enough to still be chased. PAID and CANCELLED are neither. */
const OPEN_INVOICE_STATUSES = ['UNPAID', 'SENT', 'PARTIALLY_PAID', 'OVERDUE'] as const;

/** A purchase with money still owed on it. */
const OPEN_PURCHASE_STATUSES = ['new', 'pending', 'partially_paid'] as const;

/**
 * `today` must be the START of the day, not the current instant: an invoice due
 * today is not yet overdue, and a quotation expiring today is still expiring.
 */
export async function computeWorkQueues(
  tenantId: string,
  today: Date,
): Promise<WorkQueueCounts> {
  const inSevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    invoicesOverdue,
    billsUnpaid,
    bankUnexplained,
    quotationsExpiring,
    invoicesAwaitingApproval,
    expensesAwaitingApproval,
    purchasesAwaitingApproval,
  ] = await Promise.all([
    prisma.invoice.count({
      where: {
        tenantId,
        isDeleted: false,
        status: { in: [...OPEN_INVOICE_STATUSES] },
        dueDate: { not: null, lt: today },
      },
    }),
    prisma.purchase.count({
      where: { tenantId, isDeleted: false, status: { in: [...OPEN_PURCHASE_STATUSES] } },
    }),
    prisma.bankTransaction.count({
      where: { tenantId, isDeleted: false, explainStatus: 'UNEXPLAINED' },
    }),
    prisma.quotation.count({
      where: {
        tenantId,
        isDeleted: false,
        status: { in: ['draft', 'sent'] },
        // Expiring, not expired: one that lapsed months ago is history, not a
        // queue, and burying today's two behind four hundred of those makes
        // the number useless.
        expiryDate: { gte: today, lte: inSevenDays },
      },
    }),
    prisma.invoice.count({ where: { tenantId, isDeleted: false, approvalStatus: 'PENDING' } }),
    prisma.expense.count({ where: { tenantId, isDeleted: false, approvalStatus: 'PENDING' } }),
    prisma.purchase.count({ where: { tenantId, isDeleted: false, approvalStatus: 'PENDING' } }),
  ]);

  return {
    invoicesOverdue,
    billsUnpaid,
    bankUnexplained,
    quotationsExpiring,
    // One queue to the user — the Approvals Queue page lists all three document
    // types together — so one number.
    awaitingApproval:
      invoicesAwaitingApproval + expensesAwaitingApproval + purchasesAwaitingApproval,
  };
}
