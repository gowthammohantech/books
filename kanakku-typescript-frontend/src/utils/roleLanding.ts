import type { PermissionSet } from "@models/permissions";

/**
 * moduleSlug -> landing page metadata, extracted verbatim from the sidebar's
 * navigation tree (src/components/admin/Sidebar.tsx). Every moduleSlug that
 * appears anywhere in that tree (top-level links, collapsible groups, and
 * nested children) has an entry here so a role's `defaultRoute` — or a
 * permitted-module fallback — always resolves to a page the sidebar itself
 * would let the user reach.
 *
 * Where a slug is used by both a collapsible group AND its own child link
 * (e.g. "banking" labels both the "Banking & Finance" group and its first
 * child link), the path points at that first reachable page and the label
 * favors whichever title reads better as a page name.
 */
export const MODULE_LANDING_PATHS: Record<string, { path: string; label: string }> = {
    // Dashboards
    dashboard: { path: "/admin/dashboard", label: "Dashboard" },

    // Contacts
    contacts: { path: "/admin/contacts", label: "Contacts" },

    // Sales
    sales: { path: "/admin/invoices", label: "Sales" },
    invoices: { path: "/admin/invoices", label: "Invoices" },
    "recurring-invoices": { path: "/admin/recurring-invoices", label: "Recurring Invoices" },
    "credit-notes": { path: "/admin/credit-notes", label: "Credit Notes" },
    quotations: { path: "/admin/quotations", label: "Quotations" },
    "delivery-challans": { path: "/admin/delivery-challans", label: "Delivery Challans" },
    vehicles: { path: "/admin/vehicles", label: "Vehicles" },

    // Purchases
    purchases: { path: "/admin/purchases", label: "Purchases" },
    "purchase-list": { path: "/admin/purchases", label: "Purchases" },
    "purchase-orders": { path: "/admin/purchase-orders", label: "Purchase Orders" },
    "debit-notes": { path: "/admin/debit-notes", label: "Debit Notes" },
    "supplier-payments": { path: "/admin/supplier-payments", label: "Supplier Payments" },

    // Products & Inventory
    "product-services": { path: "/admin/products", label: "Products" },
    inventory: { path: "/admin/inventory", label: "Inventory" },

    // Banking & Finance
    banking: { path: "/admin/banking", label: "Banking" },
    "bank-transactions": { path: "/admin/banking/transactions", label: "Bank Transactions" },
    expenses: { path: "/admin/expenses", label: "Expenses" },
    "recurring-expenses": { path: "/admin/recurring-expenses", label: "Recurring Expenses" },
    "payment-transactions": { path: "/admin/payments/transactions", label: "Payment Transactions" },
    "petty-cash": { path: "/admin/petty-cash", label: "Petty Cash" },
    "my-money": { path: "/admin/my-money", label: "My Money" },

    // Payroll
    payroll: { path: "/admin/payroll/profiles", label: "Payroll" },
    "time-tracking": { path: "/admin/time-tracking/my-timesheet", label: "Time Tracking" },
    "time-tracking-others": { path: "/admin/time-tracking/approvals", label: "Timesheet Approvals" },

    // Accounting
    accounting: { path: "/admin/accounting/chart-of-accounts", label: "Accounting" },
    "chart-of-accounts": { path: "/admin/accounting/chart-of-accounts", label: "Chart of Accounts" },
    "journal-entries": { path: "/admin/accounting/journal-entries", label: "Journal Entries" },

    // Reports
    reports: { path: "/admin/reports/sales", label: "Reports" },
    "transaction-reports": { path: "/admin/reports/sales", label: "Transaction Reports" },
    "accounting-reports": { path: "/admin/reports/income", label: "Accounting Reports" },
    "item-reports": { path: "/admin/reports/inventory", label: "Inventory Reports" },

    // Administration
    "manage-users": { path: "/admin/users", label: "Administration" },
    "activity-log": { path: "/admin/activity-log", label: "Activity Log" },
    ai: { path: "/admin/ai/extractions", label: "AI Extractions" },

    // Settings
    settings: { path: "/admin/settings/company-settings", label: "Settings" },
    "website-settings": { path: "/admin/settings/company-settings", label: "General Settings" },
    "system-settings": { path: "/admin/settings/email-settings", label: "System Settings" },
    "finance-settings": { path: "/admin/settings/bank-accounts", label: "Finance Settings" },
    "module-settings": { path: "/admin/settings/module-settings/invoice", label: "Module Settings" },
};

export const UNAUTHORIZED_PATH = "/admin/unauthorized";

const isPermitted = (permission: PermissionSet | undefined): boolean =>
    Boolean(permission && (permission.allowAll || permission.view));

/**
 * Pure resolver for "where should this user land after login / when they hit
 * an unauthorized page". No redux/router imports — takes plain data in,
 * returns a path string.
 *
 * (a) `defaultRoute` wins if it's set AND the user still has view/allowAll on
 *     that module.
 * (b) Otherwise prefer "dashboard" if permitted, else the first module (in
 *     the given permissions order) the user has view/allowAll on that maps to
 *     a known page.
 * (c) Otherwise (nothing permitted / mappable) -> /admin/unauthorized.
 */
export const resolveLandingPath = (
    defaultRoute: string | undefined,
    permissions: PermissionSet[] | undefined | null,
): string => {
    const perms = permissions ?? [];

    if (defaultRoute) {
        const entry = MODULE_LANDING_PATHS[defaultRoute];
        if (entry && isPermitted(perms.find((p) => p.moduleSlug === defaultRoute))) {
            return entry.path;
        }
    }

    if (isPermitted(perms.find((p) => p.moduleSlug === "dashboard"))) {
        return MODULE_LANDING_PATHS.dashboard.path;
    }

    for (const permission of perms) {
        if (permission.moduleSlug === "dashboard") continue; // already checked above
        if (!isPermitted(permission)) continue;
        const entry = MODULE_LANDING_PATHS[permission.moduleSlug];
        if (entry) return entry.path;
    }

    return UNAUTHORIZED_PATH;
};
