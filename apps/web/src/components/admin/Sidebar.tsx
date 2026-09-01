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


// --- NavItem Component (for top-level links) ---
const NavItem = ({
    item,
    isSidebarOpen,
    permissions,
}: {
    item: NavLinkItem;
    isSidebarOpen: boolean;
    permissions: PermissionSet[];
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
}: {
    item: NavLinkItem;
    permissions: PermissionSet[];
}) => {
    const { to, title, slug, addPath, exact } = item;

    return (
        <div className="relative group/subitem">
            <NavLink to={to} end={to === "/" || exact} className={getSubLinkClasses}>
                <span>{title}</span>
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
}: CollapsibleNavItemProps) => {
    const { id, icon, title, children, slug, addPath } = item;
    const isOpen = openMenus[id] || false;
    const isChildActive = activePath.includes(id);

    const paddingClass = "p-2 my-1";
    const activeClass =
        isChildActive && isSidebarOpen
            ? "bg-gray-100 text-gray-800"
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
const SIDEBAR_PATH_ALIASES: ReadonlyArray<readonly [string, string]> = [
    ["/view-quotation", "/quotations"],
    ["/view-invoice", "/invoices"],
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
        return filter(navItems);
    }, [permissions]);

    return (
        <aside
            className={`bg-sidebar text-sidebar-foreground flex flex-col h-screen transition-all duration-300 ease-in-out z-0 border-r border-sidebar-border ${isOpen ? "w-60" : "w-24"
                }`}
        >
            {/* Only one branding image is rendered per state. Hiding the wide
                site logo with opacity instead left an ~8rem phantom element
                inside the w-24 collapsed rail, pushing the icon out of sight.
                resolveCompanyLogo treats "" (the fresh-install default) as
                unset, so the collapsed icon always has something to show. */}
            <div
                className={`p-4 flex items-center h-12 ${isOpen ? "" : "justify-center"
                    }`}
            >
                <button
                    type="button"
                    onClick={() => navigate("/dashboard")}
                    aria-label="Go to dashboard"
                    className="flex cursor-pointer items-center"
                >
                    {isOpen ? (
                        <img
                            src={resolveCompanyLogo(systemSettings?.company?.siteLogo)}
                            alt="Logo"
                            className="w-32"
                        />
                    ) : (
                        <img
                            src={resolveCompanyLogo(
                                systemSettings?.company?.favicon ||
                                systemSettings?.company?.siteLogo,
                            )}
                            alt="Logo"
                            className="h-6 w-6 object-contain"
                        />
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
                                        } mb-1 text-xs font-medium text-gray-400 uppercase ${index > 0 ? "border-t border-sidebar-border" : ""
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
