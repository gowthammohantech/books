import { useState, useMemo, useEffect } from "react";
import { NavLink, useLocation, useNavigate, Link } from "react-router-dom";
import {
    ChevronDown,
    Plus,
    LifeBuoy,
    PanelLeftClose,
    PanelLeftOpen,
    Settings,
} from "lucide-react";
import { useSelector } from "react-redux";
import BottomBar from "./layouts/BottomBar";
import { resolveCompanyLogo } from "@utils/companyLogo";
import { formatFiscalYear } from "@utils/fiscalYear";
import { resolveNavPath as resolveSidebarPath } from "@lib/navPaths";
import { badgesByRoute } from "@lib/workQueues";
import { useWorkQueues } from "@hooks/useWorkQueues";
import { navItems, canView, canCreate } from "@lib/navigation";
import type { RootState } from "@store/index";
import type {
    NavCollapsibleItem,
    NavItemType,
    NavLinkItem,
} from "@models/sidebar";
import type { PermissionSet } from "@models/permissions";

// --- Helper Functions for Link Styling ---
const getLinkClasses = ({ isActive }: { isActive: boolean }) =>
    `flex items-center p-2 my-1 text-sm font-medium rounded-lg transition-colors duration-200 relative ${isActive
        ? "bg-sidebar-accent text-sidebar-primary border-l-4 border-sidebar-primary"
        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border-l-4 border-transparent"
    }`;

const getSubLinkClasses = ({ isActive }: { isActive: boolean }) =>
    `block py-2 px-2 text-sm font-medium rounded-md transition-colors duration-200 relative ${isActive
        ? "bg-sidebar-accent text-sidebar-primary border-l-4 border-sidebar-primary"
        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border-l-4 border-transparent"
    }`;

// Collapsed, the rail is not icon-only: every entry keeps its label, stacked
// under the icon as a small caption. Anything wider than the rail truncates
// rather than wrapping, so every row stays the same height.
const getRowLayoutClasses = (isSidebarOpen: boolean) =>
    isSidebarOpen ? "flex items-center" : "flex w-full flex-col items-center gap-1";

const getRowLabelClasses = (isSidebarOpen: boolean) =>
    isSidebarOpen
        ? "ml-2 font-medium whitespace-nowrap"
        : "text-[11px] leading-tight truncate w-full text-center font-medium";


/**
 * How many things are waiting behind this entry.
 *
 * A menu shows the sum of everything under it, so "Sales Management 7" is the
 * overdue invoices plus the expiring quotations you would find by opening it.
 * Without the roll-up a collapsed menu hides its own alerts, which is the one
 * job the badge exists to do.
 */
const badgeFor = (item: NavItemType, badges: Record<string, number>): number => {
    if (item.type === "header") return 0;
    if (item.type === "link") return badges[item.to] ?? 0;
    return item.children.reduce((total, child) => total + badgeFor(child, badges), 0);
};

const NavBadge = ({ count }: { count: number }) =>
    count > 0 ? (
        <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary-foreground">
            {count > 99 ? "99+" : count}
        </span>
    ) : null;

// --- NavItem Component (for top-level links) ---
const NavItem = ({
    item,
    isSidebarOpen,
    permissions,
    badges,
}: {
    item: NavLinkItem;
    isSidebarOpen: boolean;
    permissions: PermissionSet[];
    badges: Record<string, number>;
}) => {
    const { pathname: rawPathname } = useLocation();
    const pathname = resolveSidebarPath(rawPathname);
    const { to, icon, title, slug, addPath, exact } = item;
    // "/" is the Dashboard entry. It is also a prefix of every other route, so
    // it cannot use the plain startsWith test below — match it exactly, plus the
    // /dashboard/* views now that the per-view sidebar children are gone.
    const isActive = to === "/"
        ? pathname === to || pathname.startsWith("/dashboard")
        : exact ? pathname === to : pathname.startsWith(to);

    return (
        <div className="relative group">
            <NavLink
                to={to}
                className={getLinkClasses({ isActive })}
                title={!isSidebarOpen ? title : undefined}
            >
                <div className={getRowLayoutClasses(isSidebarOpen)}>
                    {icon}
                    <span className={getRowLabelClasses(isSidebarOpen)}>{title}</span>
                    {isSidebarOpen && <NavBadge count={badgeFor(item, badges)} />}
                </div>
            </NavLink>
            {isSidebarOpen && addPath && canCreate(slug, permissions) && (
                <Link
                    to={addPath}
                    aria-label={`Add new ${title}`}
                    className="absolute right-0 top-0 h-full w-8 flex items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground rounded-r-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
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
    badges,
}: {
    item: NavLinkItem;
    permissions: PermissionSet[];
    badges: Record<string, number>;
}) => {
    const { to, title, slug, addPath, exact } = item;

    return (
        <div className="relative group/subitem">
            <NavLink to={to} end={to === "/" || exact} className={getSubLinkClasses}>
                <span className="flex items-center gap-2">
                    <span>{title}</span>
                    {/* The leaf badge is the one the parent's roll-up is
                        summarising — open the menu and the number resolves to
                        the row it actually came from. */}
                    <NavBadge count={badgeFor(item, badges)} />
                </span>
            </NavLink>

            {addPath && canCreate(slug, permissions) && (
                <Link
                    to={addPath}
                    aria-label={`Add new ${title}`}
                    className="absolute right-0 top-0 h-full w-8 flex items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground rounded-r-lg opacity-0 group-hover/subitem:opacity-100 focus-visible:opacity-100 transition-opacity"
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
    badges: Record<string, number>;
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
    badges,
}: CollapsibleNavItemProps) => {
    const { id, icon, title, children, slug, addPath } = item;
    const isOpen = openMenus[id] || false;
    const isChildActive = activePath.includes(id);

    const paddingClass = "p-2 my-1";
    const activeClass =
        isChildActive && isSidebarOpen
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

    return (
        <div className="relative group">
            <button
                onClick={() => onToggle(id)}
                className={`flex items-center justify-between w-full text-sm font-medium rounded-lg transition-colors duration-300 text-left ${paddingClass} ${activeClass}`}
                aria-expanded={isOpen}
                title={!isSidebarOpen ? title : undefined}
            >
                <div className={getRowLayoutClasses(isSidebarOpen)}>
                    {icon}
                    <span className={getRowLabelClasses(isSidebarOpen)}>{title}</span>
                </div>
                {isSidebarOpen && <NavBadge count={badgeFor(item, badges)} />}
                {isSidebarOpen && (
                    <ChevronDown
                        size={16}
                        className={`transition-transform duration-300 ${isOpen ? "rotate-180" : ""
                            }`}
                    />
                )}
            </button>

            {isSidebarOpen && addPath && canCreate(slug, permissions) && (
                <Link
                    to={addPath}
                    aria-label={`Add new ${title}`}
                    className="absolute right-0 top-0 h-full w-8 flex items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground rounded-r-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
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
                                        badges={badges}
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
                                        badges={badges}
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
// /view-quotation/:id, /view-invoice/:id). Map them to the owning
// list path so the sidebar highlights the right menu + keeps its group open.
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
                        // "/" is the prefix of every route — match it exactly
                        // so the Dashboards group doesn't activate everywhere.
                        (child.to === "/"
                            ? pathname === "/"
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
const Sidebar = ({
    isOpen,
    onToggle,
}: {
    isOpen: boolean;
    onToggle: () => void;
}) => {
    const { pathname } = useLocation();
    const navigate = useNavigate();

    const { data: systemSettings } = useSelector(
        (state: RootState) => state.systemSettings
    );
    const permissions = systemSettings?.permissions || [];
    // Shared with the dashboard tiles through a module-level cache, so the two
    // never disagree and the dashboard does not pay for a second request.
    const { counts } = useWorkQueues();
    const badges = useMemo(() => badgesByRoute(counts ?? {}), [counts]);

    // "" is the fresh-install default, so a blank string means "never set",
    // not "set to nothing".
    const hasOwnLogo = Boolean(systemSettings?.company?.siteLogo?.trim());
    const fiscalYear = formatFiscalYear(systemSettings?.company?.fiscalYearStartMonth);
    // The FY half is dropped rather than faked when ledger setup has not run.
    const subtitle = ["GST-compliant ERP", fiscalYear].filter(Boolean).join(" · ");

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

                    if (!canView(item.slug, permissions)) {
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
        // Bands are captions, not destinations, so the filter above waves them
        // through — it has no slug to test them against. That leaves a caption
        // standing over nothing when a role cannot see any entry beneath it
        // (a Store Clerk, for instance, sees no FINANCE row at all). Drop any
        // band with no surviving item before the next band, and any band left
        // trailing at the end.
        const visible = filter(navItems);
        return visible.filter((item, i) => {
            if (item.type !== "header") return true;
            const next = visible.slice(i + 1).find((sibling) => sibling.type === "header");
            const end = next ? visible.indexOf(next) : visible.length;
            return end > i + 1;
        });
    }, [permissions]);

    return (
        <aside
            className={`bg-sidebar text-sidebar-foreground flex flex-col h-screen transition-all duration-300 ease-in-out z-0 border-r border-sidebar-border ${isOpen ? "w-60" : "w-24"
                }`}
        >
            {/* Product identity, not company identity — the company moved to
                the footer, where the workspace switcher is.

                An install that has uploaded its own siteLogo keeps it: this is
                white-labelled on-prem, and replacing a customer's mark with our
                wordmark would be a regression, not a redesign. The lettermark
                below is the fallback for everyone else, which is most installs
                (siteLogo defaults to ""). resolveCompanyLogo cannot answer
                "did they set one?" — it always returns the bundled fallback —
                so the raw value is what gets tested here.

                Only one branding element is rendered per state. Hiding the wide
                logo with opacity instead left an ~8rem phantom element inside
                the w-24 collapsed rail, pushing the icon out of sight. */}
            <div
                className={`px-4 py-3 flex items-center ${isOpen ? "gap-2.5" : "justify-center"
                    }`}
            >
                <button
                    type="button"
                    onClick={() => navigate("/dashboard")}
                    aria-label="Go to dashboard"
                    className="flex cursor-pointer items-center gap-2.5 min-w-0"
                >
                    {hasOwnLogo ? (
                        <img
                            src={resolveCompanyLogo(
                                isOpen
                                    ? systemSettings?.company?.siteLogo
                                    : systemSettings?.company?.favicon ||
                                    systemSettings?.company?.siteLogo,
                            )}
                            alt="Logo"
                            className={isOpen ? "w-32" : "h-8 w-8 object-contain"}
                        />
                    ) : (
                        <span
                            aria-hidden="true"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold tracking-tight"
                        >
                            EB
                        </span>
                    )}
                    {isOpen && !hasOwnLogo && (
                        <span className="flex min-w-0 flex-col text-left">
                            <span className="truncate text-sm font-semibold leading-tight text-sidebar-foreground">
                                Elixir Book
                            </span>
                            {subtitle && (
                                <span className="truncate text-[11px] leading-tight text-sidebar-foreground/60">
                                    {subtitle}
                                </span>
                            )}
                        </span>
                    )}
                </button>
            </div>
            <nav className="flex-1 px-3 py-2 overflow-y-auto overflow-x-hidden">
                {filterNavItems.map((item, index) => {
                    switch (item.type) {
                        case "header":
                            return (
                                <p
                                    key={index}
                                    className={`${index > 0 ? "mt-4 pt-2" : ""
                                        } mb-1 text-xs font-medium text-sidebar-foreground/60 uppercase ${index > 0 ? "border-t border-sidebar-border" : ""
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
                                    badges={badges}
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
                                    badges={badges}
                                />
                            );
                        default:
                            return null;
                    }
                })}
            </nav>
            {/* Settings is no longer a menu in the scrolling nav: it opens its
                own shell, so it is pinned here with Get Help rather than
                competing with the modules above. */}
            <div className="px-3 pb-1 overflow-x-hidden">
                <NavLink
                    to="/settings"
                    className={getLinkClasses}
                    title={!isOpen ? "Settings" : undefined}
                >
                    <div className={getRowLayoutClasses(isOpen)}>
                        <Settings size={16} />
                        <span className={getRowLabelClasses(isOpen)}>Settings</span>
                    </div>
                </NavLink>
            </div>
            {/* Pinned above the company footer so it stays reachable from any
                scroll position in the nav. */}
            <div className="px-3 pb-1 overflow-x-hidden">
                <NavLink
                    to="/help"
                    className={getLinkClasses}
                    title={!isOpen ? "Get Help" : undefined}
                >
                    <div className={getRowLayoutClasses(isOpen)}>
                        <LifeBuoy size={16} />
                        <span className={getRowLabelClasses(isOpen)}>Get Help</span>
                    </div>
                </NavLink>
            </div>
            {/* The collapse control belongs to the sidebar it drives, not the
                header: pinned here it keeps the same spot at either width. */}
            <div className="px-3 pb-1 overflow-x-hidden">
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
                    className={`flex items-center w-full p-2 my-1 text-sm font-medium rounded-md transition-colors duration-200 cursor-pointer border-l-4 border-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${isOpen ? "" : "justify-center"
                        }`}
                >
                    {isOpen ? (
                        <PanelLeftClose size={16} />
                    ) : (
                        <PanelLeftOpen size={16} />
                    )}
                    {isOpen && (
                        <span className="ml-2 font-medium whitespace-nowrap">
                            Collapse
                        </span>
                    )}
                </button>
            </div>
            <BottomBar isSidebarOpen={isOpen} />
        </aside>
    );
};

export default Sidebar;
