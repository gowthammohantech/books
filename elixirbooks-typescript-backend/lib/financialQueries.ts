/**
 * Shared, pure, user-scoped financial query functions (Cluster H, slice
 * H.3).
 *
 * These are the single source of truth for the numbers the AI co-pilot
 * tools ground their answers in. The existing report controllers
 * (`financialStatementsController`, `taxReportsController`) delegate their
 * core math here too, so a human report and an AI answer can never
 * diverge. Every function takes a `userId` and queries Prisma directly —
 * no internal HTTP, no Express coupling.
 *
 * All money is returned as plain `number` (Prisma `Decimal` → `Number`) so
 * results are JSON-serialisable for the tool layer.
 */
import { prisma } from './prisma';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function startOfMonth(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), 1);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** Open-invoice statuses that contribute to receivables / aging. */
const OPEN_INVOICE_STATUSES = ['UNPAID', 'OVERDUE', 'PARTIALLY_PAID', 'SENT'] as const;
/** Open-purchase statuses that contribute to payables. */
const OPEN_PURCHASE_STATUSES = ['new', 'pending', 'partially_paid'] as const;

interface ItemTaxLine {
  kind?: string | null;
  amount?: number;
}
interface DocItem {
  taxes?: ItemTaxLine[];
}

// -----------------------------------------------------------------------------
// Shared period-revenue math (used by P&L controller + revenue tool)
// -----------------------------------------------------------------------------

export interface RevenueSummary {
  from: Date;
  to: Date;
  invoiceCount: number;
  totalInvoiced: number; // sum of TotalAmount (incl. tax)
  taxableRevenue: number; // sum of taxableAmount (excl. tax)
  outputTax: number; // sum of vat
  totalPaid: number; // payments received in period
  outstanding: number; // unpaid balance of invoices dated in period
}

/**
 * Period revenue rollup. Used by `financialStatementsController.profitLoss`
 * (taxableRevenue / outputTax) and by the `get_revenue_summary` tool.
 */
export async function getRevenueSummary(
  userId: string,
  fromDate: Date,
  toDate: Date,
): Promise<RevenueSummary> {
  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);

  const invoices = await prisma.invoice.findMany({
    where: {
      userId,
      isDeleted: false,
      invoiceType: 'INVOICE',
      invoiceDate: { gte: from, lte: to },
      status: { in: ['UNPAID', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'SENT'] },
    },
    select: {
      TotalAmount: true,
      taxableAmount: true,
      vat: true,
      payments: { where: { isVoided: false }, select: { amount: true } },
    },
  });

  let totalInvoiced = 0;
  let taxableRevenue = 0;
  let outputTax = 0;
  let outstanding = 0;
  for (const inv of invoices) {
    const total = num(inv.TotalAmount);
    const paid = inv.payments.reduce((s, p) => s + num(p.amount), 0);
    totalInvoiced += total;
    taxableRevenue += num(inv.taxableAmount);
    outputTax += num(inv.vat);
    outstanding += Math.max(0, total - paid);
  }

  // "Received in period" is cash collected between from..to — payments whose
  // received_on falls in the window, regardless of when their invoice is dated.
  // The invoice loop above sums each invoice's FULL payment history (for its
  // outstanding balance), which is a different quantity and must not be reused
  // as totalPaid or the two figures conflate a balance with a period cash-flow.
  const paidAgg = await prisma.invoicePayment.aggregate({
    where: {
      isVoided: false,
      received_on: { gte: from, lte: to },
      invoice: { userId, isDeleted: false, invoiceType: 'INVOICE' },
    },
    _sum: { amount: true },
  });
  const totalPaid = num(paidAgg._sum.amount);

  return {
    from,
    to,
    invoiceCount: invoices.length,
    totalInvoiced,
    taxableRevenue,
    outputTax,
    totalPaid,
    outstanding,
  };
}

// -----------------------------------------------------------------------------
// Shared expense math (used by P&L controller + expense tool)
// -----------------------------------------------------------------------------

export interface ExpenseSummary {
  from: Date;
  to: Date;
  total: number;
  count: number;
  byCategory: Array<{ categoryId: string; name: string; total: number }>;
}

/**
 * Period expense rollup grouped by category. Used by the P&L controller's
 * operating-expenses section and by the `get_expense_summary` tool.
 * Optional `categoryName` does a case-insensitive contains filter.
 */
export async function getExpenseSummary(
  userId: string,
  fromDate: Date,
  toDate: Date,
  categoryName?: string,
): Promise<ExpenseSummary> {
  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);

  const expenses = await prisma.expense.findMany({
    where: {
      userId,
      isDeleted: false,
      expenseDate: { gte: from, lte: to },
      ...(categoryName
        ? { expenseCategory: { title: { contains: categoryName, mode: 'insensitive' } } }
        : {}),
    },
    select: {
      amount: true,
      expenseCategory: { select: { id: true, title: true } },
    },
  });

  const byCategoryMap = new Map<string, { name: string; total: number }>();
  let total = 0;
  for (const e of expenses) {
    const amt = num(e.amount);
    total += amt;
    const key = e.expenseCategory?.id ?? 'uncategorized';
    const name = e.expenseCategory?.title ?? 'Uncategorized';
    const existing = byCategoryMap.get(key);
    if (existing) existing.total += amt;
    else byCategoryMap.set(key, { name, total: amt });
  }

  return {
    from,
    to,
    total,
    count: expenses.length,
    byCategory: Array.from(byCategoryMap.entries())
      .map(([categoryId, v]) => ({ categoryId, name: v.name, total: v.total }))
      .sort((a, b) => b.total - a.total),
  };
}

// -----------------------------------------------------------------------------
// Shared GST math (used by taxReportsController + gst tool)
// -----------------------------------------------------------------------------

export interface GstSummary {
  from: Date;
  to: Date;
  outwardByKind: Record<string, number>;
  outwardTotal: number;
  inwardByKind: Record<string, number>;
  inwardTotal: number;
  netByKind: Record<string, number>;
  netTotal: number;
  /** Reverse-charge supplies in the period (visibility only — tax is already 0 on these docs). */
  reverseCharge: {
    count: number;
    taxableValue: number;
  };
}

/**
 * Period GST rollup. Decomposes per-item tax lines into CGST/SGST/IGST/etc
 * for both outward (invoices) and inward (purchases) supplies. Used by
 * `taxReportsController.taxSummary` and the `get_gst_summary` tool.
 */
export async function getGstSummary(
  userId: string,
  fromDate: Date,
  toDate: Date,
): Promise<GstSummary> {
  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);

  const invoices = await prisma.invoice.findMany({
    where: {
      userId,
      isDeleted: false,
      invoiceType: 'INVOICE',
      invoiceDate: { gte: from, lte: to },
      // Exclude DRAFT/CANCELLED — they never contribute output tax (mirrors
      // getRevenueSummary). A draft is not yet a supply; a cancelled invoice
      // was reversed. Including them over-states the GST liability.
      status: { in: ['UNPAID', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'SENT'] },
    },
    select: { items: true, vat: true },
  });

  // Non-cancelled sales credit notes issued in the period reduce output tax
  // (CDNR). A credit note posts a reversal of output GST, so the period's net
  // outward tax must subtract it or the filing over-states tax owed.
  const creditNotes = await prisma.creditNote.findMany({
    where: {
      userId,
      isDeleted: false,
      status: { not: 'CANCELLED' },
      creditNoteDate: { gte: from, lte: to },
    },
    select: { items: true, vat: true },
  });

  const purchases = await prisma.purchase.findMany({
    where: {
      userId,
      isDeleted: false,
      purchaseDate: { gte: from, lte: to },
    },
    select: { items: true, totalTax: true },
  });

  const accumulate = (
    docs: Array<{ items: unknown; vat?: unknown; totalTax?: unknown }>,
    fallbackField: 'vat' | 'totalTax',
  ): { byKind: Record<string, number>; total: number } => {
    const byKind: Record<string, number> = {};
    let total = 0;
    for (const doc of docs) {
      const items = (doc.items as unknown as DocItem[] | null) ?? [];
      let docHadTaxes = false;
      for (const item of items) {
        for (const t of item.taxes ?? []) {
          const k = t.kind ?? 'OTHER';
          const amt = num(t.amount);
          byKind[k] = (byKind[k] ?? 0) + amt;
          total += amt;
          docHadTaxes = true;
        }
      }
      if (!docHadTaxes) {
        const fallback = num((doc as Record<string, unknown>)[fallbackField]);
        if (fallback) {
          byKind.OTHER = (byKind.OTHER ?? 0) + fallback;
          total += fallback;
        }
      }
    }
    return { byKind, total };
  };

  const outward = accumulate(invoices, 'vat');
  const inward = accumulate(purchases, 'totalTax');

  // Net credit-note (CDNR) tax out of the outward supply totals, per kind, so
  // both the by-kind breakdown and the grand total reflect tax actually owed.
  const cdnr = accumulate(creditNotes, 'vat');
  for (const k of Object.keys(cdnr.byKind)) {
    outward.byKind[k] = (outward.byKind[k] ?? 0) - cdnr.byKind[k];
  }
  const outwardTotal = outward.total - cdnr.total;

  const netByKind: Record<string, number> = {};
  for (const k of Object.keys({ ...outward.byKind, ...inward.byKind })) {
    netByKind[k] = (outward.byKind[k] ?? 0) - (inward.byKind[k] ?? 0);
  }

  // Reverse-charge visibility: count + taxable value (tax is already 0 on these docs)
  const rcAgg = await prisma.invoice.aggregate({
    where: {
      userId,
      isDeleted: false,
      invoiceType: 'INVOICE',
      taxTreatment: 'REVERSE_CHARGE',
      invoiceDate: { gte: from, lte: to },
    },
    _count: { id: true },
    _sum: { taxableAmount: true },
  });

  return {
    from,
    to,
    outwardByKind: outward.byKind,
    outwardTotal,
    inwardByKind: inward.byKind,
    inwardTotal: inward.total,
    netByKind,
    netTotal: outwardTotal - inward.total,
    reverseCharge: {
      count: rcAgg._count.id,
      taxableValue: num(rcAgg._sum.taxableAmount),
    },
  };
}

// -----------------------------------------------------------------------------
// Receivables / aging / debtors (co-pilot only — no existing controller)
// -----------------------------------------------------------------------------

export interface OutstandingInvoiceRow {
  invoiceId: string;
  invoiceNumber: string | null;
  customerName: string | null;
  invoiceDate: Date;
  dueDate: Date | null;
  total: number;
  paid: number;
  outstanding: number;
  daysOverdue: number;
  status: string;
}

/**
 * Open invoices with their outstanding balance and days-overdue, optionally
 * filtered by minimum days overdue and/or a customer-name contains match.
 */
export async function getOutstandingInvoices(
  userId: string,
  opts: { minDaysOverdue?: number; customerName?: string } = {},
): Promise<{ invoices: OutstandingInvoiceRow[]; totalOutstanding: number }> {
  const now = startOfDay(new Date());

  const invoices = await prisma.invoice.findMany({
    where: {
      userId,
      isDeleted: false,
      invoiceType: 'INVOICE',
      status: { in: [...OPEN_INVOICE_STATUSES] },
      ...(opts.customerName
        ? { billToCustomer: { name: { contains: opts.customerName, mode: 'insensitive' } } }
        : {}),
    },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      TotalAmount: true,
      status: true,
      billToCustomer: { select: { name: true } },
      payments: { where: { isVoided: false }, select: { amount: true } },
    },
    orderBy: { dueDate: 'asc' },
  });

  const rows: OutstandingInvoiceRow[] = [];
  let totalOutstanding = 0;
  for (const inv of invoices) {
    const total = num(inv.TotalAmount);
    const paid = inv.payments.reduce((s, p) => s + num(p.amount), 0);
    const outstanding = total - paid;
    if (outstanding <= 0) continue;

    const due = inv.dueDate ?? inv.invoiceDate;
    const daysOverdue = Math.floor((now.getTime() - new Date(due).getTime()) / 86_400_000);

    if (opts.minDaysOverdue !== undefined && daysOverdue < opts.minDaysOverdue) continue;

    rows.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerName: inv.billToCustomer?.name ?? null,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      total,
      paid,
      outstanding,
      daysOverdue: Math.max(0, daysOverdue),
      status: inv.status,
    });
    totalOutstanding += outstanding;
  }

  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return { invoices: rows, totalOutstanding };
}

export interface DebtorRow {
  customerId: string;
  customerName: string;
  outstanding: number;
  oldestInvoiceDays: number;
  openInvoiceCount: number;
}

/**
 * Top N customers ranked by total outstanding receivable.
 */
export async function getTopDebtors(userId: string, limit = 5): Promise<DebtorRow[]> {
  const now = startOfDay(new Date());

  const invoices = await prisma.invoice.findMany({
    where: {
      userId,
      isDeleted: false,
      invoiceType: 'INVOICE',
      status: { in: [...OPEN_INVOICE_STATUSES] },
    },
    select: {
      invoiceDate: true,
      dueDate: true,
      TotalAmount: true,
      billToCustomer: { select: { id: true, name: true } },
      payments: { where: { isVoided: false }, select: { amount: true } },
    },
  });

  const debtorMap = new Map<string, DebtorRow>();
  for (const inv of invoices) {
    if (!inv.billToCustomer) continue;
    const total = num(inv.TotalAmount);
    const paid = inv.payments.reduce((s, p) => s + num(p.amount), 0);
    const outstanding = total - paid;
    if (outstanding <= 0) continue;

    const due = inv.dueDate ?? inv.invoiceDate;
    const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(due).getTime()) / 86_400_000));

    const key = inv.billToCustomer.id;
    const existing = debtorMap.get(key);
    if (existing) {
      existing.outstanding += outstanding;
      existing.oldestInvoiceDays = Math.max(existing.oldestInvoiceDays, ageDays);
      existing.openInvoiceCount += 1;
    } else {
      debtorMap.set(key, {
        customerId: inv.billToCustomer.id,
        customerName: inv.billToCustomer.name,
        outstanding,
        oldestInvoiceDays: ageDays,
        openInvoiceCount: 1,
      });
    }
  }

  return Array.from(debtorMap.values())
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, Math.max(1, limit));
}

// -----------------------------------------------------------------------------
// Dashboard overview (receivables / payables / revenue MTD / expense MTD)
// -----------------------------------------------------------------------------

export interface DashboardOverview {
  receivables: number;
  payables: number;
  revenueMTD: number;
  expensesMTD: number;
  netMTD: number;
  cashAndBank: number;
}

/**
 * The top-line numbers surfaced on the admin dashboard, scoped to one user.
 */
export async function getDashboardOverview(userId: string): Promise<DashboardOverview> {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfDay(now);

  // Receivables: outstanding balance on all open invoices (any age).
  const openInvoices = await prisma.invoice.findMany({
    where: {
      userId,
      isDeleted: false,
      invoiceType: 'INVOICE',
      status: { in: [...OPEN_INVOICE_STATUSES] },
    },
    select: { TotalAmount: true, payments: { where: { isVoided: false }, select: { amount: true } } },
  });
  const receivables = openInvoices.reduce((s, inv) => {
    const total = num(inv.TotalAmount);
    const paid = inv.payments.reduce((p, pay) => p + num(pay.amount), 0);
    return s + Math.max(0, total - paid);
  }, 0);

  // Payables: unpaid purchase balances.
  const openPurchases = await prisma.purchase.findMany({
    where: { userId, isDeleted: false, status: { in: [...OPEN_PURCHASE_STATUSES] } },
    select: { balanceAmount: true },
  });
  const payables = openPurchases.reduce((s, p) => s + num(p.balanceAmount), 0);

  // Revenue & expenses month-to-date — reuse the shared rollups.
  const [revenue, expenses] = await Promise.all([
    getRevenueSummary(userId, monthStart, monthEnd),
    getExpenseSummary(userId, monthStart, monthEnd),
  ]);

  const banks = await prisma.bankDetail.findMany({
    where: { userId, isDeleted: false },
    select: { currentBalance: true },
  });
  const cashAndBank = banks.reduce((s, b) => s + num(b.currentBalance), 0);

  return {
    receivables,
    payables,
    // Revenue MTD is net of output tax (taxableRevenue), matching the ledger P&L.
    // totalInvoiced is tax-INCLUSIVE and would overstate revenue by the VAT.
    revenueMTD: revenue.taxableRevenue,
    expensesMTD: expenses.total,
    netMTD: revenue.taxableRevenue - expenses.total,
    cashAndBank,
  };
}

// -----------------------------------------------------------------------------
// Customers
// -----------------------------------------------------------------------------

export interface CustomerSearchRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

/**
 * Fuzzy-ish customer lookup (DB contains match on name/email/phone).
 */
export async function searchCustomers(
  userId: string,
  query: string,
  limit = 10,
): Promise<CustomerSearchRow[]> {
  const q = (query ?? '').trim();
  const rows = await prisma.customer.findMany({
    where: {
      userId,
      isDeleted: false,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: 'asc' },
    take: Math.max(1, limit),
  });
  return rows;
}

export interface CustomerSummary {
  customer: { id: string; name: string; email: string; phone: string | null } | null;
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  openInvoiceCount: number;
  openInvoices: Array<{
    invoiceId: string;
    invoiceNumber: string | null;
    invoiceDate: Date;
    dueDate: Date | null;
    total: number;
    outstanding: number;
    status: string;
  }>;
  lastPayment: { amount: number; receivedOn: Date } | null;
}

/**
 * A single customer's billing snapshot: total billed, paid, outstanding,
 * open invoices, and most-recent payment. Resolves the customer by a
 * case-insensitive name match (first match wins).
 */
export async function getCustomerSummary(
  userId: string,
  customerName: string,
): Promise<CustomerSummary> {
  const customer = await prisma.customer.findFirst({
    where: {
      userId,
      isDeleted: false,
      name: { contains: (customerName ?? '').trim(), mode: 'insensitive' },
    },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: 'asc' },
  });

  if (!customer) {
    return {
      customer: null,
      totalBilled: 0,
      totalPaid: 0,
      outstanding: 0,
      openInvoiceCount: 0,
      openInvoices: [],
      lastPayment: null,
    };
  }

  const invoices = await prisma.invoice.findMany({
    where: { billTo: customer.id, userId, isDeleted: false, invoiceType: 'INVOICE' },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      TotalAmount: true,
      status: true,
      payments: { where: { isVoided: false }, select: { amount: true, received_on: true } },
    },
    orderBy: { invoiceDate: 'desc' },
  });

  let totalBilled = 0;
  let totalPaid = 0;
  let outstanding = 0;
  const openInvoices: CustomerSummary['openInvoices'] = [];
  let lastPayment: { amount: number; receivedOn: Date } | null = null;

  for (const inv of invoices) {
    const total = num(inv.TotalAmount);
    const paid = inv.payments.reduce((s, p) => s + num(p.amount), 0);
    totalBilled += total;
    totalPaid += paid;
    const open = Math.max(0, total - paid);
    outstanding += open;
    if (open > 0) {
      openInvoices.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        total,
        outstanding: open,
        status: inv.status,
      });
    }
    for (const p of inv.payments) {
      const receivedOn = new Date(p.received_on);
      if (!lastPayment || receivedOn > lastPayment.receivedOn) {
        lastPayment = { amount: num(p.amount), receivedOn };
      }
    }
  }

  return {
    customer,
    totalBilled,
    totalPaid,
    outstanding,
    openInvoiceCount: openInvoices.length,
    openInvoices,
    lastPayment,
  };
}
