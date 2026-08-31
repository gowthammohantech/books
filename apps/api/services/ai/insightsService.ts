/**
 * services/ai/insightsService.ts
 *
 * Prisma port of the former Mongoose `insightsService.js`, which backed
 * `GET /api/ai/insights` with thirteen Mongo aggregation pipelines. Those
 * pipelines queried a Mongo instance that no longer exists (the app has run on
 * Postgres/Prisma since the schema translation), so the endpoint returned
 * zeroes for every tenant. This is a like-for-like port, not a redesign.
 *
 * Where a figure already has a shared implementation it now delegates to
 * `lib/financialQueries.ts` — the module documented there as "the single source
 * of truth for the numbers the AI co-pilot tools ground their answers in", which
 * the report controllers also delegate to. That means a human report and an AI
 * insight can no longer disagree. Two consequences of that reuse, both
 * deliberate:
 *   - revenue now counts OVERDUE invoices and excludes non-INVOICE documents
 *     (credit notes etc.), matching every other revenue figure in the product.
 *     The Mongo pipeline did neither.
 *   - outstanding/overdue is net of payments received, as the dashboard reports
 *     it; the Mongo version summed gross invoice totals.
 *
 * The response shape is preserved key-for-key (it is spread straight into the
 * endpoint's JSON and fed to the narrative prompt). The one change is inside the
 * rows: Mongo's `_id` grouping key is replaced by named fields (`customerId`,
 * `status`, `categoryId`, `year`/`month`), which read better in the prompt and
 * carry no Mongo semantics into a Postgres codebase.
 */
import Anthropic from '@anthropic-ai/sdk';

import { prisma } from '../../lib/prisma';
import {
  getRevenueSummary,
  getExpenseSummary,
  getOutstandingInvoices,
} from '../../lib/financialQueries';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/** Prisma returns money as Decimal; every figure here is JSON-serialisable number. */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pctChange(current: number, previous: number): number {
  return previous > 0 ? ((current - previous) / previous) * 100 : 0;
}

/** `YYYY-M` bucket key, matching the Mongo `{ $year, $month }` group. */
function monthKey(d: Date): { year: number; month: number } {
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

interface MonthBucket {
  year: number;
  month: number;
  total: number;
  count: number;
}

function bucketByMonth(rows: Array<{ date: Date; amount: unknown }>): MonthBucket[] {
  const buckets = new Map<string, MonthBucket>();
  for (const row of rows) {
    const { year, month } = monthKey(new Date(row.date));
    const key = `${year}-${month}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.total += num(row.amount);
      existing.count += 1;
    } else {
      buckets.set(key, { year, month, total: num(row.amount), count: 1 });
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.year - b.year || a.month - b.month);
}

/**
 * Aggregated financial data for AI analysis, scoped to one tenant.
 */
async function getFinancialData(tenantId: string): Promise<Record<string, unknown>> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

  const [
    monthRevenue,
    lastMonthRevenue,
    yearRevenue,
    monthExpenses,
    lastMonthExpenses,
    yearExpenses,
    outstanding,
    topCustomerGroups,
    revenueRows,
    expenseRows,
    quotationGroups,
    invoiceStatusGroups,
    recentInvoices,
  ] = await Promise.all([
    getRevenueSummary(tenantId, startOfMonth, now),
    getRevenueSummary(tenantId, startOfLastMonth, endOfLastMonth),
    getRevenueSummary(tenantId, startOfYear, now),

    getExpenseSummary(tenantId, startOfMonth, now),
    getExpenseSummary(tenantId, startOfLastMonth, endOfLastMonth),
    getExpenseSummary(tenantId, startOfYear, now),

    getOutstandingInvoices(tenantId, { minDaysOverdue: 1 }),

    // Top customers by revenue YTD — replaces the $group + $lookup pipeline.
    prisma.invoice.groupBy({
      by: ['customerId'],
      where: { tenantId, isDeleted: false, invoiceDate: { gte: startOfYear } },
      _sum: { TotalAmount: true },
      _count: { _all: true },
      orderBy: { _sum: { TotalAmount: 'desc' } },
      take: 5,
    }),

    // Six-month revenue/expense series: one query each, bucketed in JS — the
    // same approach dashboardController.ts uses in place of a Mongo pipeline.
    prisma.invoice.findMany({
      where: { tenantId, isDeleted: false, invoiceDate: { gte: sixMonthsAgo } },
      select: { invoiceDate: true, TotalAmount: true },
    }),
    prisma.expense.findMany({
      where: { tenantId, isDeleted: false, expenseDate: { gte: sixMonthsAgo } },
      select: { expenseDate: true, amount: true },
    }),

    prisma.quotation.groupBy({
      by: ['status'],
      where: { tenantId, isDeleted: false, createdAt: { gte: startOfYear } },
      _count: { _all: true },
    }),

    prisma.invoice.groupBy({
      by: ['status'],
      where: { tenantId, isDeleted: false, invoiceDate: { gte: startOfYear } },
      _count: { _all: true },
      _sum: { TotalAmount: true },
    }),

    prisma.invoice.findMany({
      where: { tenantId, isDeleted: false },
      select: {
        id: true,
        invoiceNumber: true,
        TotalAmount: true,
        status: true,
        invoiceDate: true,
        dueDate: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  // Resolve the grouped customer ids to names in one round trip (the $lookup).
  const customerIds = topCustomerGroups
    .map((g) => g.customerId)
    .filter((id): id is string => Boolean(id));
  const customers = customerIds.length
    ? await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, name: true },
      })
    : [];
  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));

  const topCustomers = topCustomerGroups.map((g) => ({
    customerId: g.customerId,
    customerName: g.customerId ? (customerNameById.get(g.customerId) ?? 'Unknown') : 'Unknown',
    totalRevenue: num(g._sum.TotalAmount),
    invoiceCount: g._count._all,
  }));

  const oldestDue = outstanding.invoices.reduce<Date | null>((oldest, inv) => {
    if (!inv.dueDate) return oldest;
    return !oldest || inv.dueDate < oldest ? inv.dueDate : oldest;
  }, null);

  return {
    revenue: {
      thisMonth: monthRevenue.totalInvoiced,
      thisMonthCount: monthRevenue.invoiceCount,
      lastMonth: lastMonthRevenue.totalInvoiced,
      lastMonthCount: lastMonthRevenue.invoiceCount,
      yearToDate: yearRevenue.totalInvoiced,
      yearToDateCount: yearRevenue.invoiceCount,
      monthOverMonthChange: pctChange(monthRevenue.totalInvoiced, lastMonthRevenue.totalInvoiced),
    },
    expenses: {
      thisMonth: monthExpenses.total,
      thisMonthCount: monthExpenses.count,
      lastMonth: lastMonthExpenses.total,
      lastMonthCount: lastMonthExpenses.count,
      monthOverMonthChange: pctChange(monthExpenses.total, lastMonthExpenses.total),
    },
    cashFlow: {
      thisMonth: monthRevenue.totalInvoiced - monthExpenses.total,
      lastMonth: lastMonthRevenue.totalInvoiced - lastMonthExpenses.total,
    },
    overdue: {
      total: outstanding.totalOutstanding,
      count: outstanding.invoices.length,
      oldestDue,
    },
    topCustomers,
    revenueByMonth: bucketByMonth(
      revenueRows.map((r) => ({ date: r.invoiceDate, amount: r.TotalAmount })),
    ),
    expensesByMonth: bucketByMonth(
      expenseRows.map((r) => ({ date: r.expenseDate, amount: r.amount })),
    ),
    expensesByCategory: yearExpenses.byCategory.slice(0, 10).map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.name,
      total: c.total,
    })),
    quotationConversion: quotationGroups.map((g) => ({
      status: g.status,
      count: g._count._all,
    })),
    invoiceStatusBreakdown: invoiceStatusGroups.map((g) => ({
      status: g.status,
      count: g._count._all,
      total: num(g._sum.TotalAmount),
    })),
    recentInvoices: recentInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      TotalAmount: num(inv.TotalAmount),
      status: inv.status,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
    })),
  };
}

/**
 * Generate AI narrative from financial data. No datastore access — carried
 * across from the Mongoose version unchanged.
 */
async function generateInsightNarrative(
  financialData: Record<string, unknown>,
): Promise<string | null> {
  const dataStr = JSON.stringify(financialData, null, 2);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: `You are a financial analyst for a small/medium business. Given financial data, provide a brief, actionable business insights summary. Use bullet points. Be concise and highlight:
1. Revenue trend (up/down/flat vs last month)
2. Top concern (overdue invoices, expense growth, etc.)
3. One specific actionable recommendation
4. Cash flow health status

Keep it under 200 words. Use plain language. Include specific numbers from the data. Use currency symbol ₹ for amounts.
Respond in plain text, no markdown headers.`,
    messages: [
      {
        role: 'user',
        content: `Analyze this financial data and provide insights:\n\n${dataStr}`,
      },
    ],
  });

  const block = response.content[0];
  return block && block.type === 'text' ? block.text : null;
}

export { getFinancialData, generateInsightNarrative };
