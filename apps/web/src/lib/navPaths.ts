/**
 * Routes that should light up a DIFFERENT menu entry than their own path.
 *
 * These are read-only viewers reached from a list: /view-invoice/:id belongs to
 * Invoices, but shares no path prefix with /invoices, so without this mapping
 * the rail highlights nothing and the breadcrumb has no home to point at.
 *
 * Lifted out of Sidebar.tsx when the breadcrumb started needing the same
 * answer. Two copies of this list would drift, and the failure would be quiet:
 * a viewer page that highlights in the rail but breadcrumbs as a bare URL.
 */
const NAV_PATH_ALIASES: ReadonlyArray<readonly [string, string]> = [
    ["/view-quotation", "/quotations"],
    ["/view-invoice", "/invoices"],
];

export const resolveNavPath = (pathname: string): string => {
    for (const [from, to] of NAV_PATH_ALIASES) {
        if (pathname === from || pathname.startsWith(`${from}/`)) return to;
    }
    return pathname;
};
