/**
 * The report catalogue: one description of every report the app can render.
 *
 * The 29 report pages were built in four separate slices and they landed in
 * four unrelated corners of the router — `/reports/*`, `/accounting/reports/*`,
 * `/accounting/tax-returns`, `/time-tracking/reports`, `/leave/report`. Until
 * now the only index of them was the sidebar's Reports accordion, which listed
 * twelve and silently omitted the other seventeen: the accounting reports were
 * reachable only from the Accounting menu, and the time/leave reports only from
 * their own modules. Nobody could see the set.
 *
 * This array is that set. The Reports Center renders it as a browsable, starrable
 * index, and the command palette flattens it into searchable destinations, so a
 * report added here is reachable from both without touching either.
 *
 * `slug` is the module permission the destination's route guard in AdminRoute
 * actually uses, so consumers can filter with the same answer the router will
 * give. `slug: null` would mean an unguarded route reachable by any signed-in
 * user; no report is currently in that position, but the shape allows it.
 *
 * `id` is a STABLE key, not a label: it is what favourites and last-visited are
 * persisted under in browser storage. Renaming one silently orphans every user's
 * stars for that report, so change one only deliberately.
 *
 * `reportCatalogue.test.ts` reads AdminRoute.tsx and asserts every `path` here is
 * a route the router actually declares — a hand-maintained list of paths drifts
 * otherwise, and a drifted entry is a row that navigates to the 404 page.
 */

export type ReportCategory =
    | "Business Overview"
    | "Sales"
    | "Purchases and Expenses"
    | "Inventory"
    | "Receivables"
    | "Payables"
    | "Taxes"
    | "Projects and Timesheet"
    | "Accountant";

export type ReportEntry = {
    /** Stable storage key. Kebab-case, never reused, never casually renamed. */
    id: string;
    name: string;
    category: ReportCategory;
    path: string;
    /** The module slug this report's route guard gates on; null = ungated. */
    slug: string | null;
};

/** Display order of the left rail's category list. */
export const reportCategories: ReportCategory[] = [
    "Business Overview",
    "Sales",
    "Purchases and Expenses",
    "Inventory",
    "Receivables",
    "Payables",
    "Taxes",
    "Projects and Timesheet",
    "Accountant",
];

export const reports: ReportEntry[] = [
    // --- Business Overview ---------------------------------------------------
    {
        id: "profit-loss",
        name: "Profit & Loss",
        category: "Business Overview",
        path: "/accounting/reports/profit-loss",
        slug: "accounting",
    },
    {
        id: "balance-sheet",
        name: "Balance Sheet",
        category: "Business Overview",
        path: "/accounting/reports/balance-sheet",
        slug: "accounting",
    },
    {
        id: "trial-balance",
        name: "Trial Balance",
        category: "Business Overview",
        path: "/accounting/reports/trial-balance",
        slug: "accounting",
    },
    {
        id: "cash-flow-forecast",
        name: "Cash Flow Forecast",
        category: "Business Overview",
        path: "/accounting/reports/cash-flow-forecast",
        slug: "accounting",
    },
    {
        id: "tally-check",
        name: "Tally Check",
        category: "Business Overview",
        path: "/accounting/reports/tally-check",
        slug: "accounting",
    },

    // --- Sales ---------------------------------------------------------------
    {
        id: "sales",
        name: "Sales",
        category: "Sales",
        path: "/reports/sales",
        slug: "transaction-reports",
    },
    {
        id: "sales-return",
        name: "Sales Return",
        category: "Sales",
        path: "/reports/sales-return",
        slug: "transaction-reports",
    },
    {
        id: "quotation",
        name: "Quotation",
        category: "Sales",
        path: "/reports/quotation",
        slug: "transaction-reports",
    },
    {
        id: "income",
        name: "Income",
        category: "Sales",
        path: "/reports/income",
        slug: "accounting-reports",
    },

    // --- Purchases and Expenses ---------------------------------------------
    {
        id: "purchase",
        name: "Purchase",
        category: "Purchases and Expenses",
        path: "/reports/purchase",
        slug: "transaction-reports",
    },
    {
        id: "purchase-order",
        name: "Purchase Order",
        category: "Purchases and Expenses",
        path: "/reports/purchase-order",
        slug: "transaction-reports",
    },
    {
        id: "purchase-return",
        name: "Purchase Return",
        category: "Purchases and Expenses",
        path: "/reports/purchase-return",
        slug: "transaction-reports",
    },
    {
        id: "expense",
        name: "Expense",
        category: "Purchases and Expenses",
        path: "/reports/expense",
        slug: "accounting-reports",
    },

    // --- Inventory -----------------------------------------------------------
    {
        id: "inventory",
        name: "Inventory",
        category: "Inventory",
        path: "/reports/inventory",
        slug: "item-reports",
    },
    {
        id: "low-stock",
        name: "Low Stock",
        category: "Inventory",
        path: "/reports/low-stock",
        slug: "item-reports",
    },
    {
        id: "out-of-stock",
        name: "Out of Stock",
        category: "Inventory",
        path: "/reports/out-of-stock",
        slug: "item-reports",
    },

    // --- Receivables ---------------------------------------------------------
    {
        id: "ar-aging",
        name: "AR Aging",
        category: "Receivables",
        path: "/accounting/reports/ar-aging",
        slug: "accounting",
    },
    {
        id: "collections",
        name: "Collections",
        category: "Receivables",
        path: "/accounting/reports/collections",
        slug: "accounting",
    },

    // --- Payables ------------------------------------------------------------
    {
        id: "ap-aging",
        name: "AP Aging",
        category: "Payables",
        path: "/accounting/reports/ap-aging",
        slug: "accounting",
    },

    // --- Taxes ---------------------------------------------------------------
    {
        id: "tax-summary",
        name: "Tax Summary",
        category: "Taxes",
        path: "/accounting/reports/tax-summary",
        slug: "accounting",
    },
    {
        id: "gstr-1",
        name: "GSTR-1",
        category: "Taxes",
        path: "/accounting/reports/gstr-1",
        slug: "accounting",
    },
    {
        id: "gstr-3b",
        name: "GSTR-3B",
        category: "Taxes",
        path: "/accounting/reports/gstr-3b",
        slug: "accounting",
    },
    {
        id: "tax-returns",
        name: "Tax Returns",
        category: "Taxes",
        path: "/accounting/tax-returns",
        slug: "accounting-reports",
    },

    // --- Projects and Timesheet ---------------------------------------------
    {
        id: "time-reports",
        name: "Time Reports",
        category: "Projects and Timesheet",
        path: "/time-tracking/reports",
        slug: "time-tracking",
    },
    {
        id: "leave-report",
        name: "Leave Report",
        category: "Projects and Timesheet",
        path: "/leave/report",
        slug: "time-tracking",
    },

    // --- Accountant ----------------------------------------------------------
    {
        id: "budget-variance",
        name: "Budget Variance",
        category: "Accountant",
        path: "/accounting/reports/budget-variance",
        slug: "accounting",
    },
    {
        id: "pnl-by-dimension",
        name: "P&L by Dimension",
        category: "Accountant",
        path: "/accounting/reports/pnl-by-dimension",
        slug: "accounting",
    },
    {
        id: "pnl-by-department",
        name: "P&L by Department",
        category: "Accountant",
        path: "/accounting/reports/pnl-by-department",
        slug: "accounting",
    },
    {
        id: "staff-activity",
        name: "Staff Activity",
        category: "Accountant",
        path: "/reports/staff-activity",
        slug: "transaction-reports",
    },
];
