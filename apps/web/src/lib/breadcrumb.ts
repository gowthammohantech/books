import type { Command } from "@lib/commandPalette";
import { resolveNavPath } from "@lib/navPaths";

export interface Crumb {
    label: string;
    /** Absent on the last crumb, and on ancestors that are menus, not routes. */
    to?: string;
}

/**
 * Where am I, in words.
 *
 * Derived rather than declared: `buildCommands` already flattens the sidebar
 * tree, the settings catalogue and the report catalogue into one list, and each
 * entry already carries the ancestor chain it was found under (`group`, e.g.
 * "Accounts Management › Finance Reports"). That is a breadcrumb with the
 * separators already in it, so the alternative — a `breadcrumb` prop on all ~120
 * pages — would be re-typing what the nav tree knows, and would go stale
 * silently the first time an entry moved between menus.
 *
 * Only the LEAF is linkable-by-omission here: ancestors are menu titles, not
 * routes ("Finance Reports" has no page of its own), so they render as plain
 * text. The one exception is the root crumb, which is a real destination.
 */
export const resolveBreadcrumb = (
    pathname: string,
    commands: Command[],
): Crumb[] => {
    const path = resolveNavPath(pathname);

    // Longest match wins. "/" is a prefix of everything and "/inventory" is a
    // prefix of "/inventory/cost-layers", so the first hit is routinely the
    // wrong one — the most specific declared route is the page you are on.
    let best: Command | undefined;
    for (const command of commands) {
        if (command.kind !== "navigate") continue;
        if (command.path !== "/" && !isUnder(path, command.path)) continue;
        if (command.path === "/" && path !== "/") continue;
        if (!best || command.path.length > best.path.length) best = command;
    }

    // A route with no menu entry at all — a create form, a detail page, an
    // unlisted report. Naming it from the URL would produce "Edit-invoice", so
    // it gets no trail rather than a wrong one; the page's own title still
    // shows in the topbar.
    if (!best) return [];

    // The root IS the first crumb — prefixing it with a link to itself would
    // render "Dashboard / Dashboard".
    if (best.path === "/") return [{ label: best.title }];

    const ancestors = best.group ? best.group.split(" › ").filter(Boolean) : [];
    return [
        { label: "Dashboard", to: "/" },
        ...ancestors.map((label) => ({ label })),
        { label: best.title },
    ];
};

/** Path containment on SEGMENT boundaries: /invoices must not match /invoices-x. */
const isUnder = (pathname: string, base: string): boolean =>
    pathname === base || pathname.startsWith(`${base}/`);
