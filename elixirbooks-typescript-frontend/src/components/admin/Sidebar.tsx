import { useState, useMemo, useEffect } from "react";
import { NavLink, useLocation, useNavigate, Link } from "react-router-dom";
import { MdSecurity } from "react-icons/md";
import {
    Home,
    ChevronDown,
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
    Plus,
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
import { useSelector } from "react-redux";
import { assetUrl } from "@utils/assetUrl";
import BottomBar from "./layouts/BottomBar";
import { resolveCompanyLogo } from "@utils/companyLogo";
import type { RootState } from "@store/index";
import type {
    NavCollapsibleItem,
    NavItemType,
    NavLinkItem,
} from "@models/sidebar";
import type { PermissionSet } from "@models/permissions";

// --- Navigation Data Structure ---
const navItems: NavItemType[] = [
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

// --- Helper Functions for Link Styling ---
const getLinkClasses = ({ isActive }: { isActive: boolean }) =>
    `flex items-center p-2 my-1 text-sm font-medium rounded-lg transition-colors duration-200 relative ${isActive
        ? "bg-purple-100 text-purple-600 border-l-4 border-purple-600"
        : "text-gray-600 hover:bg-gray-100 border-l-4 border-transparent"
    }`;

const getSubLinkClasses = ({ isActive }: { isActive: boolean }) =>
    `block py-2 px-2 text-sm font-medium rounded-md transition-colors duration-200 relative ${isActive
        ? "bg-purple-100 text-purple-600 border-l-4 border-purple-600"
        : "text-gray-600 hover:bg-gray-100 border-l-4 border-transparent"
    }`;

// --- Permission Check Helpers ---
const canView = (
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

const canCreate = (
    slug: string,
    permissions: PermissionSet[],
    user: any
): boolean => {
    if (user && user.user_type === 1) return true; // Super admin can create all
    const perm = permissions.find((p) => p.moduleSlug === slug);
    if (!perm) return false;
    return perm.allowAll || perm.create;
};

// --- NavItem Component (for top-level links) ---
const NavItem = ({
    item,
    isSidebarOpen,
    permissions,
    user,
}: {
    item: NavLinkItem;
    isSidebarOpen: boolean;
    permissions: PermissionSet[];
    user: any;
}) => {
    const { pathname: rawPathname } = useLocation();
    const pathname = resolveSidebarPath(rawPathname);
    const { to, icon, title, slug, addPath, exact } = item;
    // "/admin" is the collapsed Dashboard entry: keep it lit on every dashboard
    // view (/admin/dashboard/*) now that the per-view sidebar children are gone.
    const isActive = to === "/admin"
        ? pathname === to || pathname.startsWith("/admin/dashboard")
        : exact ? pathname === to : pathname.startsWith(to);

    return (
        <div className="relative group">
            <NavLink to={to} className={getLinkClasses({ isActive })}>
                <div className="flex items-center">
                    {icon}
                    <span
                        className={`ml-2 transition-opacity font-medium duration-300 whitespace-nowrap ${isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                            }`}
                    >
                        {title}
                    </span>
                </div>
            </NavLink>
            {isSidebarOpen && addPath && canCreate(slug, permissions, user) && (
                <Link
                    to={addPath}
                    aria-label={`Add new ${title}`}
                    className="absolute right-0 top-0 h-full w-8 flex items-center justify-center bg-purple-600 text-white rounded-r-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                >
                    <Plus size={18} />
                </Link>
            )}
        </div>
    );
};

const SubNavLinkItem = ({
    item,
    permissions,
    user,
}: {
    item: NavLinkItem;
    permissions: PermissionSet[];
    user: any;
}) => {
    const { to, title, slug, addPath, exact } = item;

    return (
        <div className="relative group/subitem">
            <NavLink to={to} end={to === "/admin" || exact} className={getSubLinkClasses}>
                <span>{title}</span>
            </NavLink>

            {addPath && canCreate(slug, permissions, user) && (
                <Link
                    to={addPath}
                    aria-label={`Add new ${title}`}
                    className="absolute right-0 top-0 h-full w-8 flex items-center justify-center bg-purple-600 text-white rounded-r-lg opacity-0 group-hover/subitem:opacity-100 focus-visible:opacity-100 transition-opacity"
                >
                    <Plus size={18} />
                </Link>
            )}
        </div>
    );
};

// --- CollapsibleNavItem Component ---
interface CollapsibleNavItemProps {
    item: NavCollapsibleItem;
    isSidebarOpen: boolean;
    openMenus: Record<string, boolean>;
    activePath: string[];
    onToggle: (id: string) => void;
    level: number;
    permissions: PermissionSet[];
    user: any;
}

// This is the updated CollapsibleNavItem component
const CollapsibleNavItem = ({
    item,
    isSidebarOpen,
    openMenus,
    activePath,
    onToggle,
    level,
    permissions,
    user,
}: CollapsibleNavItemProps) => {
    const { id, icon, title, children, slug, addPath } = item;
    const isOpen = openMenus[id] || false;
    const isChildActive = activePath.includes(id);

    const paddingClass = "p-2 my-1";
    const activeClass =
        isChildActive && isSidebarOpen
            ? "bg-gray-100 text-gray-800"
            : "text-gray-600 hover:bg-gray-100";

    return (
        <div className="relative group">
            <button
                onClick={() => onToggle(id)}
                className={`flex items-center justify-between w-full text-sm font-medium rounded-lg transition-colors duration-300 text-left ${paddingClass} ${activeClass}`}
                aria-expanded={isOpen}
            >
                <div className="flex items-center">
                    {icon}
                    <span
                        className={`ml-2 transition-opacity duration-300 whitespace-nowrap font-medium ${isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                            }`}
                    >
                        {title}
                    </span>
                </div>
                {isSidebarOpen && (
                    <ChevronDown
                        size={16}
                        className={`transition-transform duration-300 ${isOpen ? "rotate-180" : ""
                            }`}
                    />
                )}
            </button>

            {isSidebarOpen && addPath && canCreate(slug, permissions, user) && (
                <Link
                    to={addPath}
                    aria-label={`Add new ${title}`}
                    className="absolute right-0 top-0 h-full w-8 flex items-center justify-center bg-purple-600 text-white rounded-r-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                >
                    <Plus size={18} />
                </Link>
            )}

            <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen && isSidebarOpen ? "max-h-screen" : "max-h-0"
                    }`}
            >
                <div
                    className="space-y-1"
                    style={{
                        paddingLeft: level <= 1 ? level * 1.5 + "rem" : level - 0.5 + "rem",
                    }}
                >
                    {children.map((subItem) => {
                        switch (subItem.type) {
                            case "link":
                                return (
                                    <SubNavLinkItem
                                        key={subItem.to}
                                        item={subItem}
                                        permissions={permissions}
                                        user={user}
                                    />
                                );
                            case "collapsible":
                                return (
                                    <CollapsibleNavItem
                                        key={subItem.id}
                                        item={subItem}
                                        isSidebarOpen={isSidebarOpen}
                                        openMenus={openMenus}
                                        activePath={activePath}
                                        onToggle={onToggle}
                                        level={level + 1}
                                        permissions={permissions}
                                        user={user}
                                    />
                                );
                            default:
                                return null;
                        }
                    })}
                </div>
            </div>
        </div>
    );
};

// --- Helper to find the full path of the active menu ---
// Some document VIEW routes live outside their list path (e.g.
// /admin/view-quotation/:id, /admin/view-invoice/:id). Map them to the owning
// list path so the sidebar highlights the right menu + keeps its group open.
const SIDEBAR_PATH_ALIASES: ReadonlyArray<readonly [string, string]> = [
    ["/admin/view-quotation", "/admin/quotations"],
    ["/admin/view-invoice", "/admin/invoices"],
];
const resolveSidebarPath = (pathname: string): string => {
    for (const [from, to] of SIDEBAR_PATH_ALIASES) {
        if (pathname === from || pathname.startsWith(`${from}/`)) return to;
    }
    return pathname;
};

const findActiveMenuPath = (
    items: NavItemType[],
    pathname: string
): string[] => {
    for (const item of items) {
        if (item.type === "collapsible") {
            if (
                item.children.some(
                    (child) =>
                        child.type === "link" &&
                        // "/admin" is the prefix of every admin route — match it
                        // exactly so the Dashboards group doesn't activate everywhere.
                        (child.to === "/admin"
                            ? pathname === "/admin"
                            : pathname.startsWith(child.to))
                )
            ) {
                return [item.id];
            }
            const pathInChild = findActiveMenuPath(item.children, pathname);
            if (pathInChild.length > 0) {
                return [item.id, ...pathInChild];
            }
        }
    }
    return [];
};

const findPathToId = (items: NavItemType[], targetId: string): string[] => {
    for (const item of items) {
        if (item.type === "collapsible") {
            // Check if the current item is the one we're looking for
            if (item.id === targetId) {
                return [item.id];
            }
            // If not, search in its children
            const pathInChild = findPathToId(item.children, targetId);
            // If found in a child, prepend the current item's ID to the path
            if (pathInChild.length > 0) {
                return [item.id, ...pathInChild];
            }
        }
    }
    // Return an empty array if not found
    return [];
};

// --- Main Sidebar Component ---
const Sidebar = ({ isOpen }: { isOpen: boolean }) => {
    const { pathname } = useLocation();
    const navigate = useNavigate();

    const { user } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector(
        (state: RootState) => state.systemSettings
    );
    const permissions = systemSettings?.permissions || [];

    const activePath = useMemo(
        () => findActiveMenuPath(navItems, resolveSidebarPath(pathname)),
        [pathname]
    );
    const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});

    useEffect(() => {
        const newOpenState: Record<string, boolean> = {};
        activePath.forEach((id) => {
            newOpenState[id] = true;
        });
        setOpenMenus(newOpenState);
    }, [activePath]);

    const handleToggle = (id: string) => {
        setOpenMenus((prev) => {
            const isCurrentlyOpen = !!prev[id];

            // If the user is trying to CLOSE an already open menu...
            if (isCurrentlyOpen) {
                // Find the path to the item being closed.
                const path = findPathToId(navItems, id);
                // The new state will be its parent's path.
                const parentPath = path.slice(0, -1);
                const newOpenState: Record<string, boolean> = {};
                parentPath.forEach((pathId) => {
                    newOpenState[pathId] = true;
                });
                return newOpenState;
            }
            // If the user is trying to OPEN a menu...
            else {
                // Find the full path to the item.
                const pathToOpen = findPathToId(navItems, id);
                // The new state will be this exact path, closing all other menus.
                const newOpenState: Record<string, boolean> = {};
                pathToOpen.forEach((pathId) => {
                    newOpenState[pathId] = true;
                });
                return newOpenState;
            }
        });
    };

    const filterNavItems = useMemo(() => {
        function filter(items: NavItemType[]): NavItemType[] {
            return items
                .map((item) => {
                    if (item.type === "header") {
                        return item;
                    }

                    if (!canView(item.slug, permissions, user)) {
                        return null;
                    }

                    if (item.type === "collapsible") {
                        const visibleChildren = filter(item.children);
                        if (visibleChildren.length > 0) {
                            return { ...item, children: visibleChildren };
                        }
                        return null;
                    }
                    return item;
                })
                .filter(Boolean) as NavItemType[];
        }
        return filter(navItems);
    }, [permissions, user]);

    return (
        <aside
            className={`bg-gray-50 text-gray-950 flex flex-col h-screen transition-all duration-300 ease-in-out z-0 border-r border-gray-200 ${isOpen ? "w-60" : "w-20"
                }`}
        >
            <div className="p-4 flex items-center h-12">
                {systemSettings?.company?.favicon && (
                    <img
                        src={assetUrl(systemSettings?.company?.favicon)}
                        alt="Logo"
                        className={`h-6 w-6 ${isOpen ? "hidden" : ""}`}
                    />
                )}
                <span
                    onClick={() => navigate("/admin/dashboard")}
                    className={`text-xl font-medium ml-2 text-gray-950 transition-opacity duration-200 whitespace-nowrap cursor-pointer ${isOpen ? "opacity-100" : "opacity-0"
                        }`}
                >
                    <img
                        src={resolveCompanyLogo(systemSettings?.company?.siteLogo)}
                        alt="Logo"
                        className="w-32"
                    />
                </span>
            </div>
            <nav className="flex-1 px-3 py-2 overflow-y-auto overflow-x-hidden">
                {filterNavItems.map((item, index) => {
                    switch (item.type) {
                        case "header":
                            return (
                                <p
                                    key={index}
                                    className={`${index > 0 ? "mt-4 pt-2" : ""
                                        } mb-1 text-xs font-medium text-gray-400 uppercase ${index > 0 ? "border-t border-gray-200" : ""
                                        } tracking-wider transition-opacity duration-300 ease-in-out ${isOpen ? "opacity-100" : "hidden"
                                        }`}
                                >
                                    {item.title}
                                </p>
                            );
                        case "link":
                            return (
                                <NavItem
                                    key={item.to}
                                    item={item}
                                    isSidebarOpen={isOpen}
                                    permissions={permissions}
                                    user={user}
                                />
                            );
                        case "collapsible":
                            return (
                                <CollapsibleNavItem
                                    key={item.id}
                                    item={item}
                                    isSidebarOpen={isOpen}
                                    openMenus={openMenus}
                                    activePath={activePath}
                                    onToggle={handleToggle}
                                    level={1}
                                    permissions={permissions}
                                    user={user}
                                />
                            );
                        default:
                            return null;
                    }
                })}
            </nav>
            <BottomBar isSidebarOpen={isOpen} />
        </aside>
    );
};

export default Sidebar;
