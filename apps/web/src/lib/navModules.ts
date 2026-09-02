import type { ReactNode } from "react";

import { canView, navItems } from "./navigation";
import type {
    NavCollapsibleItem,
    NavItemType,
    NavLinkItem,
} from "@models/sidebar";
import type { PermissionSet } from "@models/permissions";

/**
 * The nav tree, reshaped for a two-column rail: modules on the left, the
 * selected module's destinations on the right.
 *
 * The tree in navigation.tsx runs two levels deep, and one module (Accounts)
 * carries fourteen children. Rendered as accordions that meant
 * opening a menu pushed everything below it off screen. The shape here is
 * flatter by construction:
 *
 *   level 1 (top-level entry)  -> a rail icon
 *   level 2 (its direct links) -> the panel's first, uncaptioned section
 *   level 3 (a nested menu)    -> a captioned section in the same panel
 *
 * A third level therefore survives as a *caption*, not as another thing to
 * open, and a whole module is on screen at once with nothing to expand. The
 * tree has no third level left today - Financial Statements and Finance Reports
 * were the last two, and the Reports Center indexes those paths now - but the
 * rule is kept so a menu that grows one does not need a new render path.
 *
 * navigation.tsx stays the single source of truth. Nothing here is authored by
 * hand: add an entry there and it appears in the rail, the panel and the
 * command palette alike.
 */

export interface NavModuleSection {
    /**
     * The nested menu this group came from. Absent for the module's own direct
     * children, which lead the panel without a caption.
     */
    caption?: string;
    items: NavLinkItem[];
}

export interface NavModule {
    /** Collapsible `id`, or the route for a module that is a plain link. */
    id: string;
    title: string;
    slug: string;
    icon: ReactNode;
    /** The band it sits under ("Finance"). Draws the dividers down the rail. */
    band: string;
    /** Set only when the rail entry is itself a destination (Dashboard, Reports). */
    to?: string;
    exact?: boolean;
    addPath?: string;
    /** Flyout heading. Unused by a plain link, which has no flyout. */
    panelTitle: string;
    sections: NavModuleSection[];
}

/** Every destination under an item, however deeply it was nested. */
const flattenLinks = (
    items: (NavLinkItem | NavCollapsibleItem)[]
): NavLinkItem[] =>
    items.flatMap((item) =>
        item.type === "link" ? [item] : flattenLinks(item.children)
    );

const sectionsFor = (item: NavCollapsibleItem): NavModuleSection[] => {
    const sections: NavModuleSection[] = [];
    const direct: NavLinkItem[] = [];

    for (const child of item.children) {
        if (child.type === "link") {
            direct.push(child);
        } else {
            // A fourth level would flatten into its grandparent's caption here.
            // The tree has none today, and the panel is better served by one
            // caption too few than by a heading hierarchy in a 224px column.
            sections.push({
                caption: child.title,
                items: flattenLinks(child.children),
            });
        }
    }

    // The module's own links lead, uncaptioned: they are what the module is,
    // and the captioned groups below them are its specialisations.
    if (direct.length > 0) sections.unshift({ items: direct });
    return sections;
};

/**
 * Drop what this role cannot see, menus that lose all their children included.
 * Bands are waved through - they carry no permission of their own - and simply
 * never surface as a divider if nothing survives beneath them.
 */
const filterTree = (
    items: NavItemType[],
    permissions: PermissionSet[]
): NavItemType[] =>
    items
        .map((item) => {
            if (item.type === "header") return item;
            if (!canView(item.slug, permissions)) return null;
            if (item.type === "collapsible") {
                const children = filterTree(
                    item.children,
                    permissions
                ) as (NavLinkItem | NavCollapsibleItem)[];
                return children.length > 0 ? { ...item, children } : null;
            }
            return item;
        })
        .filter(Boolean) as NavItemType[];

export const buildNavModules = (
    permissions: PermissionSet[],
    items: NavItemType[] = navItems
): NavModule[] => {
    const visible = filterTree(items, permissions);

    // A top-level plain link (Dashboard, Reports, Audit Trail) is a
    // destination, not a menu, so it gets no sections and therefore no flyout.
    // An earlier revision lent it its band - hovering Audit Trail revealed the
    // other Oversight rows - but a panel opening over the page when the row you
    // are pointing at is one click away is a menu you did not ask for, and the
    // band's siblings are already the rows directly above and below it in the
    // rail.
    const modules: NavModule[] = [];
    let band = "";
    for (const item of visible) {
        if (item.type === "header") {
            band = item.title;
            continue;
        }

        if (item.type === "collapsible") {
            modules.push({
                id: item.id,
                title: item.title,
                slug: item.slug,
                icon: item.icon,
                band,
                addPath: item.addPath,
                panelTitle: item.title,
                sections: sectionsFor(item),
            });
        } else {
            modules.push({
                id: item.to,
                title: item.title,
                slug: item.slug,
                icon: item.icon,
                band,
                to: item.to,
                exact: item.exact,
                addPath: item.addPath,
                panelTitle: item.title,
                sections: [],
            });
        }
    }

    return modules;
};

/**
 * Does this route belong to that nav entry?
 *
 * Boundary-aware on purpose: a bare `startsWith` makes /purchases own
 * /purchases-archive. `exact` is for entries whose route is a prefix of a
 * sibling's (/banking vs /banking/transactions).
 *
 * "/" is the Dashboard, and it is a prefix of everything, so it is matched by
 * name rather than by prefix - plus "/dashboard", which renders the same page.
 */
export const matchesNavRoute = (
    to: string,
    pathname: string,
    exact?: boolean
): boolean => {
    if (to === "/") {
        return pathname === "/" || pathname === "/dashboard";
    }
    if (exact) return pathname === to;
    return pathname === to || pathname.startsWith(`${to}/`);
};

/**
 * The destination the current route is on, and the module holding it.
 *
 * Longest match wins: /inventory and /inventory/cost-layers both claim
 * /inventory/cost-layers, and the more specific one is the row to light up.
 * Pass a path already run through resolveNavPath, so that viewer routes
 * (/view-invoice/:id) land on the list they belong to.
 *
 * A plain-link module is credited only with its own route. Its panel borrows
 * the whole band, so crediting it with the band's other links would have
 * Fixed Assets claim /reports and light up the wrong rail icon.
 */
export const findActiveNavRoute = (
    modules: NavModule[],
    pathname: string
): { moduleId: string; to: string } | null => {
    let best: { moduleId: string; to: string } | null = null;

    const consider = (moduleId: string, to: string, exact?: boolean) => {
        if (!matchesNavRoute(to, pathname, exact)) return;
        if (best === null || to.length > best.to.length) best = { moduleId, to };
    };

    for (const navModule of modules) {
        if (navModule.to) {
            consider(navModule.id, navModule.to, navModule.exact);
            continue;
        }
        for (const section of navModule.sections) {
            for (const item of section.items) {
                consider(navModule.id, item.to, item.exact);
            }
        }
    }

    return best;
};

/** Every route a module owns - what its rail badge sums over. */
export const moduleRoutes = (navModule: NavModule): string[] =>
    navModule.to
        ? [navModule.to]
        : navModule.sections.flatMap((section) =>
              section.items.map((item) => item.to)
          );
