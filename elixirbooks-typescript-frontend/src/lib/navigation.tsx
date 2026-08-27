import { MdSecurity } from "react-icons/md";
import {
    Home,
    Box,
    Settings,
    ShoppingBag,
    Users,
    CircleDollarSignIcon,
    Cpu,
    GlobeIcon,
    BarChart2,
    ChartCandlestick,
    ChartArea,
    LandmarkIcon,
    CreditCard,
    BookOpen,
    Percent,
    Receipt,
    Link2,
    MessageCircle,
    Sparkles,
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
    { type: "link", to: "/admin", icon: <Home size={16} />, title: "Dashboard", slug: "dashboard" },
    {
        type: "link",
        to: "/admin/contacts",
        icon: <Users size={16} />,
        title: "Contacts",
        slug: "contacts",
        addPath: "/admin/contacts/new",
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
                to: "/admin/invoices",
                title: "Invoices",
                slug: "invoices",
                addPath: "/admin/invoices/create-invoice",
            },
            {
                type: "link",
                to: "/admin/recurring-invoices",
                title: "Recurring Invoices",
                slug: "recurring-invoices",
            },
            {
                type: "link",
                to: "/admin/invoice-templates",
                title: "Invoice Templates",
                slug: "invoices",
            },
            {
                type: "link",
                to: "/admin/credit-notes",
                title: "Credit Notes",
                slug: "credit-notes",
                addPath: "/admin/credit-notes/new",
            },
            {
                type: "link",
                to: "/admin/quotations",
                title: "Quotations",
                slug: "quotations",
                addPath: "/admin/quotations/new",
            },
            {
                type: "link",
                to: "/admin/delivery-challans",
                title: "Delivery Challans",
                slug: "delivery-challans",
                addPath: "/admin/delivery-challans/new",
            },
            {
                type: "link",
                to: "/admin/vehicles",
                title: "Vehicles",
                slug: "vehicles",
                addPath: "/admin/vehicles/new",
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
                to: "/admin/purchases",
                title: "Purchases",
                slug: "purchase-list",
                addPath: "/admin/purchases/new",
            },
            {
                type: "link",
                to: "/admin/purchase-orders",
                title: "Purchase Orders",
                slug: "purchase-orders",
                addPath: "/admin/purchase-orders/new",
            },
            {
                type: "link",
                to: "/admin/debit-notes",
                title: "Debit Notes",
                slug: "debit-notes",
                addPath: "/admin/debit-notes/new",
            },
            {
                type: "link",
                to: "/admin/supplier-payments",
                title: "Supplier Payments",
                slug: "supplier-payments",
            },
            {
                type: "link",
                to: "/admin/supplier-balances",
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
                to: "/admin/products",
                title: "Items",
                slug: "product-services",
                addPath: "/admin/products/new",
            },
            {
                type: "link",
                to: "/admin/categories",
                title: "Categories",
                slug: "product-services",
            },
            {
                type: "link",
                to: "/admin/brands",
                title: "Brands",
                slug: "product-services",
            },
            {
                type: "link",
                to: "/admin/units",
                title: "Units",
                slug: "product-services",
            },
            {
                type: "link",
                to: "/admin/inventory",
                title: "Inventory",
                slug: "inventory",
                // exact: "/admin/inventory" is a prefix of the cost-layers route,
                // so without this both children highlight on the cost-layers page.
                exact: true,
            },
            {
                type: "link",
                to: "/admin/inventory/cost-layers",
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
                to: "/admin/banking",
                title: "Banking",
                slug: "banking",
                exact: true,
            },
            {
                type: "link",
                to: "/admin/banking/transactions",
                title: "Bank Transactions",
                slug: "bank-transactions",
            },
            {
                type: "link",
                to: "/admin/banking/reconciliation",
                title: "Reconciliation",
                slug: "bank-transactions",
            },
            {
                type: "link",
                to: "/admin/expenses",
                title: "Expenses",
                slug: "expenses",
            },
            {
                type: "link",
                to: "/admin/recurring-expenses",
                title: "Recurring Expenses",
                slug: "recurring-expenses",
            },
            {
                type: "link",
                to: "/admin/payments/transactions",
                title: "Payment Transactions",
                slug: "payment-transactions",
            },
            {
                type: "link",
                to: "/admin/petty-cash",
                title: "Petty Cash",
                slug: "petty-cash",
            },
            {
                type: "link",
                to: "/admin/my-money",
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
                to: "/admin/payroll/profiles",
                title: "Payroll Profiles",
                slug: "payroll",
            },
            {
                type: "link",
                to: "/admin/payroll/runs",
                title: "Pay Runs",
                slug: "payroll",
            },
            {
                type: "link",
                to: "/admin/time-tracking/my-timesheet",
                title: "Time Tracking",
                slug: "time-tracking",
            },
            {
                type: "link",
                to: "/admin/time-tracking/approvals",
                title: "Timesheet Approvals",
                slug: "time-tracking-others",
            },
            {
                type: "link",
                to: "/admin/time-tracking/reports",
                title: "Time Reports",
                slug: "time-tracking",
            },
            {
                type: "link",
                to: "/admin/leave/my-leave",
                title: "My Leave",
                slug: "time-tracking",
            },
            {
                type: "link",
                to: "/admin/leave/approvals",
                title: "Leave Approvals",
                slug: "time-tracking-others",
            },
            {
                type: "link",
                to: "/admin/leave/holidays",
                title: "Holidays",
                slug: "time-tracking-others",
            },
            {
                type: "link",
                to: "/admin/leave/leave-types",
                title: "Leave Types",
                slug: "time-tracking-others",
            },
            {
                type: "link",
                to: "/admin/leave/report",
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
                to: "/admin/accounting/chart-of-accounts",
                title: "Chart of Accounts",
                slug: "chart-of-accounts",
            },
            {
                type: "link",
                to: "/admin/accounting/journal-entries",
                title: "Journal Entries",
                slug: "journal-entries",
                addPath: "/admin/accounting/journal-entries/new",
            },
            {
                type: "link",
                to: "/admin/accounting/periods",
                title: "Accounting Periods",
                slug: "accounting",
            },
            {
                type: "link",
                to: "/admin/accounting/e-invoices",
                title: "E-Invoices (IRN)",
                slug: "accounting",
            },
            {
                type: "link",
                to: "/admin/accounting/budgets",
                title: "Budgets",
                slug: "accounting",
                addPath: "/admin/accounting/budgets",
            },
            {
                type: "link",
                to: "/admin/accounting/cost-centers",
                title: "Profit Centers",
                slug: "accounting",
            },
            {
                type: "link",
                to: "/admin/accounting/projects",
                title: "Projects",
                slug: "accounting",
            },
            {
                type: "link",
                to: "/admin/accounting/fixed-assets",
                title: "Fixed Assets",
                slug: "accounting",
            },
            {
                type: "link",
                to: "/admin/accounting/approvals",
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
                        to: "/admin/accounting/reports/profit-loss",
                        title: "Profit & Loss",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/admin/accounting/reports/balance-sheet",
                        title: "Balance Sheet",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/admin/accounting/reports/trial-balance",
                        title: "Trial Balance",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/admin/accounting/reports/tally-check",
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
                        to: "/admin/accounting/reports/ar-aging",
                        title: "AR Aging",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/admin/accounting/reports/ap-aging",
                        title: "AP Aging",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/admin/accounting/reports/collections",
                        title: "Collections",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/admin/accounting/reports/budget-variance",
                        title: "Budget Variance",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/admin/accounting/reports/cash-flow-forecast",
                        title: "Cash Flow Forecast",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/admin/accounting/reports/pnl-by-dimension",
                        title: "P&L by Dimension",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/admin/accounting/reports/pnl-by-department",
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
                        to: "/admin/accounting/reports/tax-summary",
                        icon: <Percent size={16} />,
                        title: "Tax Summary",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/admin/accounting/reports/gstr-1",
                        icon: <Receipt size={16} />,
                        title: "GSTR-1",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/admin/accounting/reports/gstr-3b",
                        icon: <Receipt size={16} />,
                        title: "GSTR-3B",
                        slug: "accounting",
                    },
                    {
                        type: "link",
                        to: "/admin/accounting/tax-returns",
                        icon: <Receipt size={16} />,
                        title: "Tax Returns",
                        slug: "accounting-reports",
                    },
                ],
            },
        ],
    },
    {
        type: "collapsible",
        id: "reports",
        icon: <BarChart2 size={16} />,
        title: "Reports",
        slug: "reports",
        children: [
            {
                type: "collapsible",
                id: "transaction-reports",
                icon: <BarChart2 size={16} />,
                title: "Transaction Reports",
                slug: "transaction-reports",
                children: [
                    {
                        type: "link",
                        to: "/admin/reports/sales",
                        title: "Sales",
                        slug: "transaction-reports",
                    },
                    {
                        type: "link",
                        to: "/admin/reports/sales-return",
                        title: "Sales Return",
                        slug: "transaction-reports",
                    },
                    {
                        type: "link",
                        to: "/admin/reports/purchase",
                        title: "Purchase",
                        slug: "transaction-reports",
                    },
                    {
                        type: "link",
                        to: "/admin/reports/purchase-order",
                        title: "Purchase Order",
                        slug: "transaction-reports",
                    },
                    {
                        type: "link",
                        to: "/admin/reports/purchase-return",
                        title: "Purchase Return",
                        slug: "transaction-reports",
                    },
                    {
                        type: "link",
                        to: "/admin/reports/quotation",
                        title: "Quotation",
                        slug: "transaction-reports",
                    },
                    {
                        type: "link",
                        to: "/admin/reports/staff-activity",
                        title: "Staff Activity",
                        slug: "transaction-reports",
                    },
                ],
            },
            {
                type: "collapsible",
                id: "accounting-reports",
                icon: <ChartCandlestick size={16} />,
                title: "Accounting Reports",
                slug: "accounting-reports",
                children: [
                    {
                        type: "link",
                        to: "/admin/reports/income",
                        title: "Income",
                        slug: "accounting-reports",
                    },
                    {
                        type: "link",
                        to: "/admin/reports/expense",
                        title: "Expense",
                        slug: "accounting-reports",
                    },
                ],
            },
            {
                type: "collapsible",
                id: "item-reports",
                icon: <ChartArea size={16} />,
                title: "Inventory Reports",
                slug: "item-reports",
                children: [
                    {
                        type: "link",
                        to: "/admin/reports/inventory",
                        title: "Inventory",
                        slug: "item-reports",
                    },
                    {
                        type: "link",
                        to: "/admin/reports/low-stock",
                        title: "Low Stock",
                        slug: "item-reports",
                    },
                    {
                        type: "link",
                        to: "/admin/reports/out-of-stock",
                        title: "Out of Stock",
                        slug: "item-reports",
                    },
                ],
            },
        ],
    },
    {
        type: "collapsible",
        id: "administration",
        icon: <MdSecurity size={16} />,
        title: "Administration",
        slug: "manage-users",
        children: [
            {
                type: "link",
                to: "/admin/users",
                title: "Users",
                slug: "manage-users",
            },
            {
                type: "link",
                to: "/admin/roles",
                title: "Roles & Permissions",
                slug: "manage-users",
            },
            {
                type: "link",
                to: "/admin/activity-log",
                title: "Activity Log",
                slug: "activity-log",
            },
            {
                type: "link",
                to: "/admin/ai/extractions",
                title: "AI Extractions",
                slug: "ai",
            },
        ],
    },
    {
        type: "collapsible",
        id: "settings",
        icon: <Settings size={16} />,
        title: "Settings",
        slug: "settings",
        children: [
            // "General Settings" (Profile) removed from the sidebar — Profile is
            // reached from the top-right profile menu (/admin/settings/profile).
            {
                type: "collapsible",
                id: "website-settings",
                title: "General Settings",
                slug: "website-settings",
                icon: <GlobeIcon size={16} />,
                children: [
                    {
                        type: "link",
                        to: "/admin/settings/company-settings",
                        title: "Company Settings",
                        slug: "website-settings",
                    },
                    {
                        type: "link",
                        to: "/admin/settings/localization",
                        title: "Localization Settings",
                        slug: "website-settings",
                    },
                ],
            },
            {
                type: "collapsible",
                id: "system-settings",
                title: "System Settings",
                slug: "system-settings",
                icon: <Cpu size={16} />,
                children: [
                    {
                        type: "link",
                        to: "/admin/settings/email-settings",
                        title: "Email Settings",
                        slug: "system-settings",
                    },
                    {
                        type: "link",
                        to: "/admin/settings/email-templates",
                        title: "Email Templates",
                        slug: "system-settings",
                    },
                    {
                        type: "link",
                        to: "/admin/settings/signatures",
                        title: "Signatures",
                        slug: "system-settings",
                    },
                ],
            },

            {
                type: "collapsible",
                id: "finance-settings",
                title: "Finance Settings",
                slug: "finance-settings",
                icon: <CircleDollarSignIcon size={16} />,
                children: [
                    {
                        type: "link",
                        to: "/admin/settings/bank-accounts",
                        title: "Bank Accounts",
                        slug: "finance-settings",
                    },
                    {
                        type: "link",
                        to: "/admin/settings/tax-rates",
                        title: "Taxes",
                        slug: "finance-settings",
                    },
                    {
                        type: "link",
                        to: "/admin/settings/currencies",
                        title: "Currencies",
                        slug: "finance-settings",
                    },
                    {
                        type: "link",
                        to: "/admin/settings/ledger-setup",
                        title: "Ledger Setup",
                        slug: "finance-settings",
                    },
                    {
                        type: "link",
                        to: "/admin/settings/document-defaults",
                        title: "Document Defaults",
                        slug: "finance-settings",
                    },
                    {
                        type: "link",
                        to: "/admin/settings/transaction-categories",
                        title: "Transaction Categories",
                        slug: "finance-settings",
                    },
                ],
            },

            {
                type: "collapsible",
                id: "payment-settings",
                title: "Payment Gateways",
                slug: "system-settings",
                icon: <CreditCard size={16} />,
                children: [
                    {
                        type: "link",
                        to: "/admin/settings/payment-gateways",
                        title: "Payment Gateways",
                        slug: "system-settings",
                    },
                ],
            },

            {
                type: "link",
                to: "/admin/settings/accounting-integrations",
                icon: <Link2 size={16} />,
                title: "Accounting Integrations",
                slug: "system-settings",
            },

            {
                type: "link",
                to: "/admin/settings/messaging",
                icon: <MessageCircle size={16} />,
                title: "Messaging (WhatsApp)",
                slug: "system-settings",
            },

            {
                type: "link",
                to: "/admin/settings/ai",
                icon: <Sparkles size={16} />,
                title: "AI",
                slug: "system-settings",
            },

            {
                type: "collapsible",
                id: "module-settings",
                title: "Module Settings",
                slug: "module-settings",
                icon: <Settings size={16} />,
                children: [
                    {
                        type: "link",
                        to: "/admin/settings/module-settings/invoice",
                        title: "Invoice",
                        slug: "module-settings",
                    },
                    {
                        type: "link",
                        to: "/admin/settings/module-settings/purchase",
                        title: "Purchase",
                        slug: "module-settings",
                    },
                    {
                        type: "link",
                        to: "/admin/settings/module-settings/purchase-order",
                        title: "Purchase Order",
                        slug: "module-settings",
                    },
                    // {
                    //     type: "link",
                    //     to: "/admin/settings/module-settings/customer",
                    //     title: "Customer",
                    //     slug: "module-settings",
                    // },
                    {
                        type: "link",
                        to: "/admin/settings/module-settings/expense",
                        title: "Expense",
                        slug: "module-settings",
                    },
                    // {
                    //     type: "link",
                    //     to: "/admin/settings/module-settings/quotations",
                    //     title: "Quotations",
                    //     slug: "module-settings",
                    // },
                    {
                        type: "link",
                        to: "/admin/settings/module-settings/product",
                        title: "Product",
                        slug: "module-settings",
                    },
                    {
                        type: "link",
                        to: "/admin/settings/module-settings/category",
                        title: "Category",
                        slug: "module-settings",
                    },
                    {
                        type: "link",
                        to: "/admin/settings/module-settings/brand",
                        title: "Brand",
                        slug: "module-settings",
                    },
                    {
                        type: "link",
                        to: "/admin/settings/module-settings/unit",
                        title: "Unit",
                        slug: "module-settings",
                    },
                ],
            },
        ],
    },
    // {
    //     type: "link",
    //     to: "/admin/settings/reminders",
    //     icon: <ClockFading size={16} />,
    //     title: "Reminders",
    //     slug: "system-settings",
    // },
];

// --- Permission Check Helpers ---
export const canView = (
    slug: string,
    permissions: PermissionSet[],
    user: any
): boolean => {
    if (user && user.user_type === 1) return true; // Super admin can view all
    const perm = permissions.find((p) => p.moduleSlug === slug);
    // Fail-open: server-side permissions aren't enforced (client-gating only),
    // so a slug with no matching permission row should show, not silently vanish.
    if (!perm) return true;
    return perm.allowAll || perm.view;
};

export const canCreate = (
    slug: string,
    permissions: PermissionSet[],
    user: any
): boolean => {
    if (user && user.user_type === 1) return true; // Super admin can create all
    const perm = permissions.find((p) => p.moduleSlug === slug);
    if (!perm) return false;
    return perm.allowAll || perm.create;
};
