const mongoose = require("mongoose");
const Invoice = require("@models/Invoice");
const Purchase = require("@models/Purchase");
const Expense = require("@models/Expense");
const Quotation = require("@models/Quotation");
const InvoicePayment = require("@models/InvoicePayment");
const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Get aggregated financial data for AI analysis
 */
async function getFinancialData(userId) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

  const userObjId = new mongoose.Types.ObjectId(userId);

  const [
    monthlyRevenue,
    lastMonthRevenue,
    yearlyRevenue,
    topCustomers,
    overdueInvoices,
    monthlyExpenses,
    lastMonthExpenses,
    revenueByMonth,
    expensesByMonth,
    expensesByCategory,
    quotationConversion,
    invoiceStatusBreakdown,
    recentInvoices,
  ] = await Promise.all([
    // This month revenue
    Invoice.aggregate([
      {
        $match: {
          userId: userObjId,
          isDeleted: false,
          invoiceDate: { $gte: startOfMonth },
          status: { $in: ["PAID", "PARTIALLY_PAID", "SENT", "UNPAID"] },
        },
      },
      { $group: { _id: null, total: { $sum: "$TotalAmount" }, count: { $sum: 1 } } },
    ]),

    // Last month revenue
    Invoice.aggregate([
      {
        $match: {
          userId: userObjId,
          isDeleted: false,
          invoiceDate: { $gte: startOfLastMonth, $lte: endOfLastMonth },
          status: { $in: ["PAID", "PARTIALLY_PAID", "SENT", "UNPAID"] },
        },
      },
      { $group: { _id: null, total: { $sum: "$TotalAmount" }, count: { $sum: 1 } } },
    ]),

    // YTD revenue
    Invoice.aggregate([
      {
        $match: {
          userId: userObjId,
          isDeleted: false,
          invoiceDate: { $gte: startOfYear },
          status: { $in: ["PAID", "PARTIALLY_PAID", "SENT", "UNPAID"] },
        },
      },
      { $group: { _id: null, total: { $sum: "$TotalAmount" }, count: { $sum: 1 } } },
    ]),

    // Top 5 customers by revenue
    Invoice.aggregate([
      {
        $match: {
          userId: userObjId,
          isDeleted: false,
          invoiceDate: { $gte: startOfYear },
        },
      },
      {
        $group: {
          _id: "$customerId",
          totalRevenue: { $sum: "$TotalAmount" },
          invoiceCount: { $sum: 1 },
        },
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "customers",
          localField: "_id",
          foreignField: "_id",
          as: "customer",
        },
      },
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          customerName: { $ifNull: ["$customer.name", "Unknown"] },
          totalRevenue: 1,
          invoiceCount: 1,
        },
      },
    ]),

    // Overdue invoices
    Invoice.aggregate([
      {
        $match: {
          userId: userObjId,
          isDeleted: false,
          status: { $in: ["SENT", "UNPAID", "OVERDUE", "PARTIALLY_PAID"] },
          dueDate: { $lt: now },
        },
      },
      {
        $group: {
          _id: null,
          totalOverdue: { $sum: "$TotalAmount" },
          count: { $sum: 1 },
          oldestDue: { $min: "$dueDate" },
        },
      },
    ]),

    // This month expenses
    Expense.aggregate([
      {
        $match: {
          userId: userObjId,
          isDeleted: false,
          expenseDate: { $gte: startOfMonth },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),

    // Last month expenses
    Expense.aggregate([
      {
        $match: {
          userId: userObjId,
          isDeleted: false,
          expenseDate: { $gte: startOfLastMonth, $lte: endOfLastMonth },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),

    // Revenue by month (last 6 months)
    Invoice.aggregate([
      {
        $match: {
          userId: userObjId,
          isDeleted: false,
          invoiceDate: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$invoiceDate" },
            month: { $month: "$invoiceDate" },
          },
          total: { $sum: "$TotalAmount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),

    // Expenses by month (last 6 months)
    Expense.aggregate([
      {
        $match: {
          userId: userObjId,
          isDeleted: false,
          expenseDate: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$expenseDate" },
            month: { $month: "$expenseDate" },
          },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),

    // Expenses by category
    Expense.aggregate([
      {
        $match: {
          userId: userObjId,
          isDeleted: false,
          expenseDate: { $gte: startOfYear },
        },
      },
      {
        $group: {
          _id: "$expenseCategoryId",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "expensecategories",
          localField: "_id",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          categoryName: { $ifNull: ["$category.title", "Uncategorized"] },
          total: 1,
          count: 1,
        },
      },
    ]),

    // Quotation conversion rate
    Quotation.aggregate([
      {
        $match: {
          userId: userObjId,
          isDeleted: false,
          createdAt: { $gte: startOfYear },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]),

    // Invoice status breakdown
    Invoice.aggregate([
      {
        $match: {
          userId: userObjId,
          isDeleted: false,
          invoiceDate: { $gte: startOfYear },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          total: { $sum: "$TotalAmount" },
        },
      },
    ]),

    // Recent 5 invoices
    Invoice.find({ userId, isDeleted: false })
      .select("invoiceNumber TotalAmount status invoiceDate dueDate")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);

  return {
    revenue: {
      thisMonth: monthlyRevenue[0]?.total || 0,
      thisMonthCount: monthlyRevenue[0]?.count || 0,
      lastMonth: lastMonthRevenue[0]?.total || 0,
      lastMonthCount: lastMonthRevenue[0]?.count || 0,
      yearToDate: yearlyRevenue[0]?.total || 0,
      yearToDateCount: yearlyRevenue[0]?.count || 0,
      monthOverMonthChange:
        lastMonthRevenue[0]?.total > 0
          ? ((monthlyRevenue[0]?.total || 0) - lastMonthRevenue[0].total) /
              lastMonthRevenue[0].total *
            100
          : 0,
    },
    expenses: {
      thisMonth: monthlyExpenses[0]?.total || 0,
      thisMonthCount: monthlyExpenses[0]?.count || 0,
      lastMonth: lastMonthExpenses[0]?.total || 0,
      lastMonthCount: lastMonthExpenses[0]?.count || 0,
      monthOverMonthChange:
        lastMonthExpenses[0]?.total > 0
          ? ((monthlyExpenses[0]?.total || 0) - lastMonthExpenses[0].total) /
              lastMonthExpenses[0].total *
            100
          : 0,
    },
    cashFlow: {
      thisMonth: (monthlyRevenue[0]?.total || 0) - (monthlyExpenses[0]?.total || 0),
      lastMonth: (lastMonthRevenue[0]?.total || 0) - (lastMonthExpenses[0]?.total || 0),
    },
    overdue: {
      total: overdueInvoices[0]?.totalOverdue || 0,
      count: overdueInvoices[0]?.count || 0,
      oldestDue: overdueInvoices[0]?.oldestDue || null,
    },
    topCustomers,
    revenueByMonth,
    expensesByMonth,
    expensesByCategory,
    quotationConversion,
    invoiceStatusBreakdown,
    recentInvoices,
  };
}

/**
 * Generate AI narrative from financial data
 */
async function generateInsightNarrative(financialData) {
  const dataStr = JSON.stringify(financialData, null, 2);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
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
        role: "user",
        content: `Analyze this financial data and provide insights:\n\n${dataStr}`,
      },
    ],
  });

  return response.content[0].text;
}

module.exports = { getFinancialData, generateInsightNarrative };
