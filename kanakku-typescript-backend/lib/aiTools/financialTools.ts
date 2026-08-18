/**
 * The eight grounded financial tools the co-pilot can call (Cluster H,
 * slice H.3).
 *
 * Each tool's `handler` calls a shared, user-scoped query function in
 * `lib/financialQueries.ts` — the SAME functions the human-facing report
 * controllers use — so the AI never sees numbers that diverge from the
 * dashboard / reports. Handlers receive `(args, { userId })` and return
 * plain JSON-serialisable data.
 *
 * `parameters` are JSON Schema objects passed verbatim to the provider so
 * Claude / OpenAI know how to call each tool.
 */
import {
  getDashboardOverview,
  getOutstandingInvoices,
  getTopDebtors,
  getRevenueSummary,
  getExpenseSummary,
  getGstSummary,
  getCustomerSummary,
  searchCustomers,
} from '../financialQueries';

import type { ToolDef } from './types';
import { buildToolRegistry } from './types';

// -----------------------------------------------------------------------------
// Arg coercion helpers (the model may send strings; be forgiving)
// -----------------------------------------------------------------------------

function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/**
 * Resolves a `from`/`to` arg pair into Date objects. Defaults to the
 * current calendar month when either is missing — matches the report
 * controllers' default behaviour.
 */
function resolveRange(args: Record<string, unknown>): { from: Date; to: Date } {
  const fromStr = asString(args.from);
  const toStr = asString(args.to);
  const to = toStr ? new Date(toStr) : new Date();
  const from = fromStr ? new Date(fromStr) : new Date(to.getFullYear(), to.getMonth(), 1);
  return { from, to };
}

// -----------------------------------------------------------------------------
// Tool definitions
// -----------------------------------------------------------------------------

export const financialTools: ToolDef[] = [
  {
    name: 'get_dashboard_overview',
    description:
      'Get the top-line financial snapshot: total outstanding receivables, total payables, ' +
      'revenue and expenses month-to-date, net month-to-date, and cash & bank balance. ' +
      'Use this for broad "how is my business doing" style questions.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    handler: async (_args, { userId }) => getDashboardOverview(userId),
  },

  {
    name: 'get_outstanding_invoices',
    description:
      'List unpaid / partially-paid invoices with their outstanding balance and how many days ' +
      'overdue they are. Optionally filter by a minimum days-overdue threshold and/or a customer ' +
      'name. Use this to answer questions about who owes money and which invoices are late.',
    parameters: {
      type: 'object',
      properties: {
        min_days_overdue: {
          type: 'number',
          description: 'Only return invoices at least this many days past their due date.',
        },
        customer_name: {
          type: 'string',
          description: 'Filter to invoices billed to customers whose name contains this text.',
        },
      },
      additionalProperties: false,
    },
    handler: async (args, { userId }) =>
      getOutstandingInvoices(userId, {
        minDaysOverdue: asNumber(args.min_days_overdue),
        customerName: asString(args.customer_name),
      }),
  },

  {
    name: 'get_top_debtors',
    description:
      'Get the top N customers ranked by total outstanding amount owed, including the age of ' +
      'their oldest open invoice. Use this for "who are my biggest/top debtors" questions.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'How many customers to return (default 5).',
        },
      },
      additionalProperties: false,
    },
    handler: async (args, { userId }) => getTopDebtors(userId, asNumber(args.limit) ?? 5),
  },

  {
    name: 'get_revenue_summary',
    description:
      'Summarise revenue for a date range: total invoiced (incl. tax), taxable revenue (excl. tax), ' +
      'output tax, total payments received, and outstanding for invoices dated in the period. ' +
      'Dates are ISO (YYYY-MM-DD). Defaults to the current month.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date (ISO, YYYY-MM-DD).' },
        to: { type: 'string', description: 'End date (ISO, YYYY-MM-DD).' },
      },
      additionalProperties: false,
    },
    handler: async (args, { userId }) => {
      const { from, to } = resolveRange(args);
      return getRevenueSummary(userId, from, to);
    },
  },

  {
    name: 'get_expense_summary',
    description:
      'Summarise expenses for a date range, broken down by category. Optionally filter to a ' +
      'single category by name. Dates are ISO (YYYY-MM-DD). Defaults to the current month.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date (ISO, YYYY-MM-DD).' },
        to: { type: 'string', description: 'End date (ISO, YYYY-MM-DD).' },
        category: {
          type: 'string',
          description: 'Filter to expense categories whose name contains this text.',
        },
      },
      additionalProperties: false,
    },
    handler: async (args, { userId }) => {
      const { from, to } = resolveRange(args);
      return getExpenseSummary(userId, from, to, asString(args.category));
    },
  },

  {
    name: 'get_gst_summary',
    description:
      'Summarise GST for a date range: outward tax (collected on sales) and inward tax (paid on ' +
      'purchases, i.e. ITC), each broken down by kind (CGST/SGST/IGST/CESS), plus the net tax ' +
      'liability. Dates are ISO (YYYY-MM-DD). Defaults to the current month. Use this for ' +
      '"how much GST do I owe / have I collected" questions.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date (ISO, YYYY-MM-DD).' },
        to: { type: 'string', description: 'End date (ISO, YYYY-MM-DD).' },
      },
      additionalProperties: false,
    },
    handler: async (args, { userId }) => {
      const { from, to } = resolveRange(args);
      return getGstSummary(userId, from, to);
    },
  },

  {
    name: 'get_customer_summary',
    description:
      'Get a single customer\'s billing snapshot: total billed, total paid, outstanding, count ' +
      'of open invoices (with details), and their most recent payment. Resolves the customer by ' +
      'a case-insensitive name match. Use this for "how much does <customer> owe me / what is ' +
      'their history" questions.',
    parameters: {
      type: 'object',
      properties: {
        customer_name: {
          type: 'string',
          description: 'The customer name (or part of it) to look up.',
        },
      },
      required: ['customer_name'],
      additionalProperties: false,
    },
    handler: async (args, { userId }) =>
      getCustomerSummary(userId, asString(args.customer_name) ?? ''),
  },

  {
    name: 'search_customers',
    description:
      'Search the customer list by name, email, or phone (case-insensitive contains match). ' +
      'Use this to disambiguate a customer before calling get_customer_summary, or to answer ' +
      '"do I have a customer called X" questions.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search customer name/email/phone for.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: async (args, { userId }) => searchCustomers(userId, asString(args.query) ?? ''),
  },
];

/** Name → def lookup used by the chat controller to dispatch tool calls. */
export const financialToolRegistry = buildToolRegistry(financialTools);
