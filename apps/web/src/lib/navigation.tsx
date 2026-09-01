import { MdSecurity } from "react-icons/md";
import {
    Home,
    Box,
    ShoppingBag,
    Users,
    BarChart2,
    ChartCandlestick,
    LandmarkIcon,
    BookOpen,
    Percent,
    Receipt,
    Briefcase,
} from "lucide-react";
import type { NavItemType } from "@models/sidebar";
import type { PermissionSet } from "@models/permissions";

/**
 * The single source of truth for admin navigation.
 *
 * Lives here rather than in Sidebar.tsx because two surfaces render it: the
 * sidebar tree, and the command palette (which flattens it into searchable
 * destinations). Anything added here shows up in both.
 */
export const navItems: NavItemType[] = [
    // Single entry point: the other dashboard views (Sales, Accounts, Expenses)
    // are switchable from the DashboardSwitcher top bar on every dashboard page.
    { type: "link", to: "/", icon: <Home size={16} />, title: "Dashboard", slug: "dashboard" },
    {
        type: "link",
        to: "/contacts",
        icon: <Users size={16} />,
        title: "Contacts",
        slug: "contacts",
        addPath: "/contacts/new",
    },
    {
        type: "collapsible",
        id: "sales",
        icon: <Receipt size={16} />,
        title: "Sales",
        slug: "sales",
        children: [
            {
                type: "link",
                to: "/invoices",
                title: "Invoices",
                slug: "invoices",
                addPath: "/invoices/create-invoice",
            },
            {
                type: "link",
                to: "/recurring-invoices",
                title: "Recurring Invoices",
                slug: "recurring-invoices",
            },
            // Invoice/PDF Templates is a Settings catalogue entry
            // (Customization > PDF Templates) and opens in the settings shell,
            // so it is not duplicated here.
            {
                type: "link",
                to: "/credit-notes",
                title: "Credit Notes",
                slug: "credit-notes",
                addPath: "/credit-notes/new",
            },
            {
                type: "link",
                to: "/quotations",
                title: "Quotations",
                slug: "quotations",
                addPath: "/quotations/new",
            },
            {
                type: "link",
                to: "/delivery-challans",
                title: "Delivery Challans",
                slug: "delivery-challans",
                addPath: "/delivery-challans/new",
            },
            {
                type: "link",
                to: "/vehicles",
                title: "Vehicles",
                slug: "vehicles",
                addPath: "/vehicles/new",
            },
        ],
    },
    {
        type: "collapsible",
        id: "purchases",
        icon: <ShoppingBag size={16} />,
        title: "Purchases",
        slug: "purchases",
        children: [
            {
                type: "link",
                to: "/purchases",
                title: "Purchases",
                slug: "purchase-list",
                addPath: "/purchases/new",
            },
            {
                type: "link",
                to: "/purchase-orders",
                title: "Purchase Orders",
                slug: "purchase-orders",
                addPath: "/purchase-orders/new",
            },
            {
                type: "link",
                to: "/debit-notes",
                title: "Debit Notes",
                slug: "debit-notes",
                addPath: "/debit-notes/new",
            },
            {
                type: "link",
                to: "/supplier-payments",
                title: "Supplier Payments",
                slug: "supplier-payments",
            },
            {
                type: "link",
                to: "/supplier-balances",
                title: "Supplier Balances",
                slug: "purchase-list",
            },
        ],
    },
    {
        type: "collapsible",
        id: "products-inventory",
        icon: <Box size={16} />,
        title: "Items & Inventory",
        slug: "product-services",
        children: [
            {
                type: "link",
                to: "/products",
                title: "Items",
                slug: "product-services",
                addPath: "/products/new",
            },
            {
                type: "link",
                to: "/categories",
                title: "Categories",
                slug: "product-services",
            },
            {
                type: "link",
                to: "/brands",
                title: "Brands",
                slug: "product-services",
            },
            {
                type: "link",
                to: "/units",
                title: "Units",
                slug: "product-services",
            },
            {
                type: "link",
                to: "/inventory",
                title: "Inventory",
                slug: "inventory",
                // exact: "/inventory" is a prefix of the cost-layers route,
                // so without this both children highlight on the cost-layers page.
                exact: true,
            },
            {
                type: "link",
                to: "/inventory/cost-layers",
                title: "Cost Layers (FIFO)",
                slug: "inventory",
            },
        ],
    },
    {
        type: "collapsible",
        id: "banking-finance",
        icon: <LandmarkIcon size={16} />,
        title: "Banking & Finance",
        slug: "banking",
        children: [
            {
                type: "link",
                to: "/banking",
                title: "Banking",
                slug: "banking",
                exact: true,
            },
            {
                type: "link",
                to: "/banking/transactions",
                title: "Bank Transactions",
                slug: "bank-transactions",
            },
            {
                type: "link",
                to: "/banking/reconciliation",
                title: "Reconciliation",
                slug: "bank-transactions",
            },
            {
                type: "link",
                to: "/expenses",
                title: "Expenses",
                slug: "expenses",
            },
            {
                type: "link",
                to: "/recurring-expenses",
                title: "Recurring Expenses",
                slug: "recurring-expenses",
            },
            {
                type: "link",
                to: "/payments/transactions",
                title: "Payment Transactions",
                slug: "payment-transactions",
            },
            {
                type: "link",
                to: "/petty-cash",
                title: "Petty Cash",
                slug: "petty-cash",
            },
            {
                type: "link",
                to: "/my-money",
                title: "My Money",
                slug: "my-money",
            },
        ],
    },
    {
        type: "collapsible",
        id: "payroll",
        icon: <Briefcase size={16} />,
        title: "Payroll",
        slug: "payroll",
        children: [
            {
                type: "link",
                to: "/payroll/profiles",
                title: "Payroll Profiles",
                slug: "payroll",
            },
            {
                type: "link",
                to: "/payroll/runs",
                title: "Pay Runs",
                slug: "payroll",
            },
            {
                type: "link",
                to: "/time-tracking/my-timesheet",
                title: "Time Tracking",
                slug: "time-tracking",
            },
            {
                type: "link",
                to: "/time-tracking/approvals",
                title: "Timesheet Approvals",
                slug: "time-tracking-others",
            },
            {
                type: "link",
                to: "/time-tracking/reports",
                title: "Time Reports",
                slug: "time-tracking",
            },
            {
                type: "link",
                to: "/leave/my-leave",
                title: "My Leave",
                slug: "time-tracking",
            },
            {
                type: "link",
                to: "/leave/approvals",
                title: "Leave Approvals",
                slug: "time-tracking-others",
            },
            {
                type: "link",
                to: "/leave/holidays",
                title: "Holidays",
                slug: "time-tracking-others",
            },
            {
                type: "link",
                to: "/leave/leave-types",
                title: "Leave Types",
                slug: "time-tracking-others",
            },
            {
                type: "link",
                to: "/leave/report",
                title: "Leave Report",
                slug: "time-tracking",
            },
        ],
    },
    {
        type: "collapsible",
        id: "accounting",
        icon: <BookOpen size={16} />,
        title: "Accounting",
        slug: "accounting",
        children: [
            {
                type: "link",
                to: "/accounting/chart-of-accounts",
                title: "Chart of Accounts",
                slug: "chart-of-accounts",
            },
            {
                type: "link",
                to: "/accounting/journal-entries",
                title: "Journal Entries",
                slug: "journal-entries",
                addPath: "/accounting/journal-entries/new",
            },
            {
                type: "link",
                to: "/accounting/periods",
                title: "Accounting Periods",
                slug: "accounting",
            },
            {
                type: "link",
                to: "/accounting/e-invoices",
                title: "E-Invoices (IRN)",
                slug: "accounting",
            },
            {
                type: "link",
                to: "/accounting/budgets",
                title: "Budgets",
                slug: "accounting",
                addPath: "/accounting/budgets",
            },
            {
                type: "link",
                to: "/accounting/cost-centers",
                title: "Profit Centers",
                slug: "accounting",
            },
            {
                type: "link",
                to: "/accounting/projects",
                title: "Projects",
                slug: "accounting",
            },
            {
                type: "link",
                to: "/accounting/fixed-assets",
                title: "Fixed Assets",
                slug: "accounting",
            },
            {
                type: "link",
                to: "/accounting/approvals",
                title: "Approvals Queue",
                slug: "accounting",
            },
            {
                type: "collapsible",
                id: "financial-statements",
                icon: <ChartCandlestick size={16} />,
                title: "Financial Statements",
                slug: "accounting",
                children: [
                    {
                        type: "link",
                        to: "/accounting/reports/profit-loss",
                        title: "Profit & Loss",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/accounting/reports/balance-sheet",
                        title: "Balance Sheet",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/accounting/reports/trial-balance",
                        title: "Trial Balance",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/accounting/reports/tally-check",
                        title: "Tally Check",
                        slug: "accounting",
                    },
                ],
            },
            {
                type: "collapsible",
                id: "finance-reports",
                icon: <BarChart2 size={16} />,
                title: "Finance Reports",
                slug: "accounting",
                children: [
                    {
                        type: "link",
                        to: "/accounting/reports/ar-aging",
                        title: "AR Aging",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/accounting/reports/ap-aging",
                        title: "AP Aging",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/accounting/reports/collections",
                        title: "Collections",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/accounting/reports/budget-variance",
                        title: "Budget Variance",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/accounting/reports/cash-flow-forecast",
                        title: "Cash Flow Forecast",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/accounting/reports/pnl-by-dimension",
                        title: "P&L by Dimension",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/accounting/reports/pnl-by-department",
                        title: "P&L by Department",
                        slug: "accounting",
                    },
                ],
            },
            {
                type: "collapsible",
                id: "tax-reports",
                icon: <Percent size={16} />,
                title: "Tax Reports",
                slug: "accounting",
                children: [
                    {
                        type: "link",
                        to: "/accounting/reports/tax-summary",
                        icon: <Percent size={16} />,
                        title: "Tax Summary",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/accounting/reports/gstr-1",
                        icon: <Receipt size={16} />,
                        title: "GSTR-1",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/accounting/reports/gstr-3b",
                        icon: <Receipt size={16} />,
                        title: "GSTR-3B",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/accounting/tax-returns",
                        icon: <Receipt size={16} />,
                        title: "Tax Returns",
                        slug: "accounting-reports",
                    },
                ],
            },
        ],
    },
    // One link, not a menu. The accordion here listed twelve of the app's 29
    // reports — the accounting, tax, time and leave reports were reachable only
    // from their own modules, so the menu was both long and incomplete. The
    // Reports Center at /reports indexes all of them, with categories, search
    // and favourites; the catalogue behind it is what the command palette
    // searches too.
    {
        type: "link",
        to: "/reports",
        icon: <BarChart2 size={16} />,
        title: "Reports",
        slug: "reports",
    },
    // Users, Roles & Permissions and Activity Log used to sit in an
    // "Administration" group here, duplicating the Settings catalogue's
    // Users & Roles card. They now live only under Settings, which leaves AI
    // Extractions as the sole entry — a top-level link rather than a
    // one-child collapsible.
    {
        type: "link",
        to: "/ai/extractions",
        icon: <MdSecurity size={16} />,
        title: "AI Extractions",
        slug: "ai",
    },
];

// --- Permission Check Helpers ---
//
// These take permissions and nothing else. They used to short-circuit to true
// for `user.user_type === 1`, which made the sidebar - and through
// buildCommands the command palette and global search - show every module to
// anyone who had signed up as an admin ANYWHERE, including inside a workspace
// they had only been invited to. The permissions passed in are the ones the
// server issued for the ACTIVE workspace, and they are now the only input.
//
// This costs an Owner nothing: provisioning grants the Owner role allowAll on
// every module, which is the same reason the backend could drop its own copy
// of this bypass (middleware/requirePermission.ts).
export const canView = (
    slug: string,
    permissions: PermissionSet[]
): boolean => {
    const perm = permissions.find((p) => p.moduleSlug === slug);
    // Fail-open: server-side permissions aren't enforced (client-gating only),
    // so a slug with no matching permission row should show, not silently vanish.
    if (!perm) return true;
    return perm.allowAll || perm.view;
};

export const canCreate = (
    slug: string,
    permissions: PermissionSet[]
): boolean => {
    const perm = permissions.find((p) => p.moduleSlug === slug);
    if (!perm) return false;
    return perm.allowAll || perm.create;
};
