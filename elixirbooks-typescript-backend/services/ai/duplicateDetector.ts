/**
 * services/ai/duplicateDetector.ts
 *
 * Prisma port of the former Mongoose `duplicateDetector.js`, which backs the
 * "is this a duplicate?" check on the AI document-confirmation path. It queried
 * a Mongo instance that no longer exists, so it reported `hasDuplicates: false`
 * for every document and the guard never fired.
 *
 * Like-for-like port of the original rules: look back 30 days, match on the
 * counterparty where one was extracted, and treat amounts within ±5% as the
 * same figure. Prisma returns money as `Decimal`, so every amount is converted
 * to `number` before it reaches `calculateSimilarity` — Decimal arithmetic
 * through `Math.abs`/division would otherwise silently produce NaN.
 *
 * Every query names `tenantId` explicitly rather than relying on
 * lib/tenantGuard.ts, which ships in `warn` mode and does not filter.
 */
import { prisma } from '../../lib/prisma';

const AMOUNT_TOLERANCE = 0.05; // ±5% counts as the same amount
const LOOKBACK_DAYS = 30;

export interface DuplicateMatch {
  type: string;
  id: string;
  number: string | null;
  amount: number;
  status: string;
  date: Date;
  customer?: string;
  description?: string | null;
  similarity: number;
}

export interface DuplicateCheckResult {
  hasDuplicates: boolean;
  duplicates: DuplicateMatch[];
}

type Payload = Record<string, unknown>;

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The ±5% window around an extracted amount. */
function amountWindow(amount: number): { gte: number; lte: number } {
  return { gte: amount * (1 - AMOUNT_TOLERANCE), lte: amount * (1 + AMOUNT_TOLERANCE) };
}

function calculateSimilarity(amount1: number, amount2: number): number {
  if (amount1 === 0 && amount2 === 0) return 1;
  if (amount1 === 0 || amount2 === 0) return 0;
  const diff = Math.abs(amount1 - amount2);
  const avg = (amount1 + amount2) / 2;
  return Math.round((1 - diff / avg) * 100) / 100;
}

/**
 * Check for potential duplicate documents.
 * @param documentType - invoice | purchase_order | quotation | expense
 * @param payload - the document about to be created
 * @param tenantId - the caller's tenant (workspace)
 */
async function checkDuplicates(
  documentType: string,
  payload: Payload,
  tenantId: string,
): Promise<DuplicateCheckResult> {
  const duplicates: DuplicateMatch[] = [];

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  switch (documentType) {
    case 'invoice': {
      const amount = num(payload.TotalAmount);
      const counterparty = str(payload.customerId) ?? str(payload.billTo);

      const matches = await prisma.invoice.findMany({
        where: {
          tenantId,
          isDeleted: false,
          createdAt: { gte: since },
          // The original only constrained the amount when it had a
          // counterparty to match on; without one it listed the tenant's
          // recent invoices regardless of value. Preserved deliberately.
          ...(counterparty
            ? {
                OR: [{ customerId: counterparty }, { billTo: counterparty }],
                TotalAmount: amountWindow(amount),
              }
            : {}),
        },
        select: {
          id: true,
          invoiceNumber: true,
          TotalAmount: true,
          status: true,
          invoiceDate: true,
          customer: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      for (const match of matches) {
        duplicates.push({
          type: 'Invoice',
          id: match.id,
          number: match.invoiceNumber,
          amount: num(match.TotalAmount),
          status: match.status,
          date: match.invoiceDate,
          customer: match.customer?.name ?? 'Unknown',
          similarity: calculateSimilarity(amount, num(match.TotalAmount)),
        });
      }
      break;
    }

    case 'purchase_order': {
      const amount = num(payload.TotalAmount);
      const vendor = str(payload.vendorId) ?? str(payload.billTo);

      const matches = await prisma.purchaseOrder.findMany({
        where: {
          tenantId,
          isDeleted: false,
          createdAt: { gte: since },
          TotalAmount: amountWindow(amount),
          ...(vendor ? { billTo: vendor } : {}),
        },
        select: {
          id: true,
          purchaseOrderId: true,
          TotalAmount: true,
          status: true,
          purchaseOrderDate: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      for (const match of matches) {
        duplicates.push({
          type: 'PurchaseOrder',
          id: match.id,
          number: match.purchaseOrderId,
          amount: num(match.TotalAmount),
          status: match.status,
          date: match.purchaseOrderDate,
          similarity: calculateSimilarity(amount, num(match.TotalAmount)),
        });
      }
      break;
    }

    case 'quotation': {
      const amount = num(payload.TotalAmount);
      const customer = str(payload.customerId) ?? str(payload.billTo);

      const matches = await prisma.quotation.findMany({
        where: {
          tenantId,
          isDeleted: false,
          createdAt: { gte: since },
          TotalAmount: amountWindow(amount),
          ...(customer ? { billTo: customer } : {}),
        },
        select: {
          id: true,
          quotationId: true,
          TotalAmount: true,
          status: true,
          quotationDate: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      for (const match of matches) {
        duplicates.push({
          type: 'Quotation',
          id: match.id,
          number: match.quotationId,
          amount: num(match.TotalAmount),
          status: match.status,
          date: match.quotationDate,
          similarity: calculateSimilarity(amount, num(match.TotalAmount)),
        });
      }
      break;
    }

    case 'expense': {
      const amount = num(payload.amount);
      const categoryId = str(payload.expenseCategoryId);

      const matches = await prisma.expense.findMany({
        where: {
          tenantId,
          isDeleted: false,
          createdAt: { gte: since },
          amount: amountWindow(amount),
          ...(categoryId ? { expenseCategoryId: categoryId } : {}),
        },
        select: {
          id: true,
          expenseId: true,
          amount: true,
          paymentStatus: true,
          expenseDate: true,
          description: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      for (const match of matches) {
        duplicates.push({
          type: 'Expense',
          id: match.id,
          number: match.expenseId,
          amount: num(match.amount),
          status: match.paymentStatus,
          date: match.expenseDate,
          description: match.description,
          similarity: calculateSimilarity(amount, num(match.amount)),
        });
      }
      break;
    }
  }

  return {
    hasDuplicates: duplicates.length > 0,
    duplicates,
  };
}

export { checkDuplicates };
