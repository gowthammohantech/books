/**
 * "What is waiting for me" — the queues the dashboard tiles and the sidebar
 * count badges both render.
 *
 * One catalogue, because the two surfaces have to agree. A tile saying 7
 * invoices are overdue beside a rail badge saying 5 is worse than either
 * number alone: it tells the reader neither can be trusted.
 *
 * The counts arrive on the dashboard payload (`workQueues`), computed in
 * controllers/Admin/dashboardController.ts. Each is derived from the data
 * rather than read from a status column something has to keep fresh.
 *
 * --- Absent on purpose ---
 *
 * The reference design also tiles GRN awaiting receipt, bills awaiting
 * three-way match, delivery challans to raise and IRNs to generate. Those
 * modules do not exist yet (Phase 1 of documentation/product/erp-roadmap.md),
 * and a tile reading "0" would claim an empty queue rather than a missing
 * feature. They are left out until there is something to count.
 */

export type WorkQueueKey =
    | "invoicesOverdue"
    | "billsUnpaid"
    | "bankUnexplained"
    | "quotationsExpiring"
    | "awaitingApproval";

export type WorkQueueCounts = Partial<Record<WorkQueueKey, number>>;

export interface WorkQueue {
    key: WorkQueueKey;
    /** Tile heading. */
    label: string;
    /** The module caption beneath it, matching the sidebar band it lives in. */
    module: string;
    /** Where the tile goes. Lands on the list, filtered where the list supports it. */
    to: string;
    /**
     * Which sidebar entry carries this count as a badge, keyed by the nav
     * entry's route.
     *
     * Route, not `slug`: slugs are PERMISSION keys and are deliberately shared
     * — `accounting` alone covers Taxation Management, Fixed Assets and half a
     * dozen report menus — so badging by slug would light up four unrelated
     * rows with the approvals count. Routes are unique per destination.
     *
     * The sidebar rolls these up: a parent menu shows the sum of its children,
     * which is what makes "Sales Management 7" mean invoices plus quotations.
     */
    navTo: string;
}

export const WORK_QUEUES: readonly WorkQueue[] = [
    {
        key: "invoicesOverdue",
        label: "Invoices Overdue",
        module: "Sales",
        to: "/invoices?status=OVERDUE",
        navTo: "/invoices",
    },
    {
        key: "billsUnpaid",
        label: "Bills Unpaid",
        module: "Purchase",
        to: "/purchases",
        navTo: "/purchases",
    },
    {
        key: "bankUnexplained",
        label: "Bank Lines To Explain",
        module: "Accounts",
        to: "/banking/reconciliation",
        navTo: "/banking/reconciliation",
    },
    {
        key: "awaitingApproval",
        label: "Awaiting Approval",
        module: "Accounts",
        to: "/accounting/approvals",
        navTo: "/accounting/approvals",
    },
    {
        key: "quotationsExpiring",
        label: "Quotations Expiring",
        module: "Sales",
        to: "/quotations",
        navTo: "/quotations",
    },
] as const;

/**
 * Nav route -> badge number.
 *
 * Zero is omitted rather than rendered: a badge is a call to action, and "0"
 * is a call to do nothing that still costs the reader a glance on every page.
 */
export const badgesByRoute = (counts: WorkQueueCounts): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const queue of WORK_QUEUES) {
        const count = counts[queue.key];
        if (!count) continue;
        out[queue.navTo] = (out[queue.navTo] ?? 0) + count;
    }
    return out;
};
