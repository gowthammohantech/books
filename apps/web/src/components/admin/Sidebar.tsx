import { useMemo, useEffect, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, LifeBuoy } from "lucide-react";
import { useSelector } from "react-redux";

import { AnimatedIcon } from "@components/icons";
import BottomBar from "./layouts/BottomBar";
import { cn } from "@lib/cn";
import { resolveCompanyLogo } from "@utils/companyLogo";
import { resolveNavPath as resolveSidebarPath } from "@lib/navPaths";
import { badgesByRoute } from "@lib/workQueues";
import { useWorkQueues } from "@hooks/useWorkQueues";
import { useNavFlyout } from "@hooks/useNavFlyout";
import { canCreate, navItems } from "@lib/navigation";
import { applyModulePreferences } from "@lib/setupModules";
import { useEnabledModules } from "@hooks/useEnabledModules";
import {
    buildNavModules,
    findActiveNavRoute,
    moduleRoutes,
    type NavModule,
} from "@lib/navModules";
import type { RootState } from "@store/index";
import type { NavLinkItem } from "@models/sidebar";
import type { PermissionSet } from "@models/permissions";

/**
 * A module rail whose children open in a flyout OVER the page.
 *
 * This replaced a tree of nested accordions. The problem is specific to the
 * size of this nav: Accounts Management alone holds fourteen entries, so
 * expanding it pushed every module below it off screen, and
 * the thing you were aiming at moved while you aimed at it. A flyout fixes that
 * for free — nothing in the rail moves when a module opens, because the
 * children are not in the rail. navModules.ts does the flattening.
 *
 * The two widths differ only in whether the rail shows labels:
 *
 *   expanded   240px, icon + label + count, bands captioned
 *   collapsed  64px, icon alone, bands reduced to a hairline
 *
 * Both open the SAME flyout on hover, focus or click. An earlier revision
 * docked the children as a second 224px column when expanded, which made the
 * expanded state a different interaction from the collapsed one — two
 * behaviours to learn, and the wide state was the worse of the two. One
 * mechanism at both widths is the point.
 *
 * The flyout is a DOM child of the row container even though it renders
 * outside it: `mouseleave` follows the DOM, not the pixels, so moving the
 * pointer from a rail row into the flyout is not a leave.
 */

const PANEL_ROW = "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors";

/**
 * How many things are waiting behind this entry.
 *
 * A module shows the sum of everything under it, so a "7" on Sales is the
 * overdue invoices plus the expiring quotations you would find inside it.
 * Without the roll-up an unselected module hides its own alerts, which is the
 * one job the badge exists to do.
 */
const countFor = (routes: string[], badges: Record<string, number>): number =>
    routes.reduce((total, route) => total + (badges[route] ?? 0), 0);

const NavBadge = ({ count }: { count: number }) =>
    count > 0 ? (
        <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[0.6875rem] font-semibold leading-none text-primary-foreground">
            {count > 99 ? "99+" : count}
        </span>
    ) : null;

/** The quick-create affordance, unchanged in behaviour from the accordion rail. */
const AddButton = ({ to, title }: { to: string; title: string }) => (
    <Link
        to={to}
        aria-label={`Add new ${title}`}
        className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
    >
        <AnimatedIcon name="plus" size={14} />
    </Link>
);

const ModuleRow = ({
    navModule,
    isActive,
    isExpanded,
    count,
    onPeek,
}: {
    navModule: NavModule;
    isActive: boolean;
    isExpanded: boolean;
    count: number;
    onPeek: (element: HTMLElement) => void;
}) => {
    const label = count > 0 ? `${navModule.title} (${count} waiting)` : navModule.title;
    const hasChildren = navModule.sections.length > 0;

    const classes = cn(
        "relative flex items-center rounded-xl transition-colors",
        isExpanded ? "h-10 w-full gap-2.5 px-2.5" : "h-10 w-10 justify-center",
        isActive
            ? "bg-sidebar-accent text-sidebar-primary"
            : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    );

    const body = (
        <>
            <span className="relative flex shrink-0 items-center justify-center">
                {navModule.icon}
                {/* Collapsed, the count is a dot: at 40px a two-digit pill
                    crowds the icon out, and the figure itself is one row away
                    in the flyout. Expanded, there is room for the number. */}
                {!isExpanded && count > 0 && (
                    <span
                        aria-hidden="true"
                        className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar"
                    />
                )}
            </span>
            {isExpanded && (
                <>
                    <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
                        {navModule.title}
                    </span>
                    <NavBadge count={count} />
                    {/* Points at where the children will appear — to the side,
                        not below. A chevron-down here would promise an
                        accordion that is not coming. */}
                    {hasChildren && (
                        <ChevronRight
                            size={14}
                            aria-hidden="true"
                            className="shrink-0 text-sidebar-foreground/40"
                        />
                    )}
                </>
            )}
        </>
    );

    return (
        <div className={cn("relative flex py-0.5", isExpanded ? "px-2" : "justify-center")}>
            {/* Inset marker rather than the old border-l-4: it reads as the rail
                pointing at the module instead of the row growing a border. */}
            {isActive && (
                <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-sidebar-primary"
                />
            )}
            {navModule.to ? (
                <Link
                    to={navModule.to}
                    title={isExpanded ? undefined : label}
                    aria-label={label}
                    aria-current={isActive ? "page" : undefined}
                    className={classes}
                    onMouseEnter={(event) => onPeek(event.currentTarget)}
                    onFocus={(event) => onPeek(event.currentTarget)}
                >
                    {body}
                </Link>
            ) : (
                <button
                    type="button"
                    title={isExpanded ? undefined : label}
                    aria-label={label}
                    aria-current={isActive ? "true" : undefined}
                    aria-haspopup={hasChildren ? "menu" : undefined}
                    className={cn(classes, "cursor-pointer")}
                    onClick={(event) => onPeek(event.currentTarget)}
                    onMouseEnter={(event) => onPeek(event.currentTarget)}
                    onFocus={(event) => onPeek(event.currentTarget)}
                >
                    {body}
                </button>
            )}
        </div>
    );
};

const PanelRow = ({
    item,
    isActive,
    permissions,
    badges,
}: {
    item: NavLinkItem;
    isActive: boolean;
    permissions: PermissionSet[];
    badges: Record<string, number>;
}) => (
    <div className="group/row relative">
        {/* The padding belongs to the link, not to a wrapper: a row whose
            hit area stops short of its own background is a target that looks
            bigger than it is. */}
        <Link
            to={item.to}
            aria-current={isActive ? "page" : undefined}
            className={cn(
                PANEL_ROW,
                isActive
                    ? "bg-sidebar-accent font-medium text-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
        >
            <span className="truncate">{item.title}</span>
            <NavBadge count={countFor([item.to], badges)} />
        </Link>
        {item.addPath && canCreate(item.slug, permissions) && (
            <AddButton to={item.addPath} title={item.title} />
        )}
    </div>
);

/** A module's destinations, flat. The body of the flyout at either width. */
const ModulePanel = ({
    navModule,
    activeRoute,
    permissions,
    badges,
}: {
    navModule: NavModule;
    activeRoute: string | null;
    permissions: PermissionSet[];
    badges: Record<string, number>;
}) => (
    <>
        <div className="flex h-10 shrink-0 items-center gap-2 px-3">
            <h2 className="truncate text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                {navModule.panelTitle}
            </h2>
            {navModule.addPath && canCreate(navModule.slug, permissions) && (
                <Link
                    to={navModule.addPath}
                    aria-label={`Add new ${navModule.title}`}
                    title={`Add new ${navModule.title}`}
                    className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-primary"
                >
                    <AnimatedIcon name="plus" size={15} />
                </Link>
            )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
            {navModule.sections.map((section, index) => (
                <div key={section.caption ?? `direct-${index}`} className={index > 0 ? "mt-3" : ""}>
                    {/* The old third accordion level, demoted to a caption. */}
                    {section.caption && (
                        <p className="px-2.5 pb-1 pt-1 text-[0.6875rem] font-medium uppercase tracking-wider text-sidebar-foreground/40">
                            {section.caption}
                        </p>
                    )}
                    {section.items.map((item) => (
                        <PanelRow
                            key={item.to}
                            item={item}
                            isActive={item.to === activeRoute}
                            permissions={permissions}
                            badges={badges}
                        />
                    ))}
                </div>
            ))}
        </div>
    </>
);

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
    const { activeTenant } = useSelector((state: RootState) => state.auth);
    const permissions = useMemo(
        () => systemSettings?.permissions || [],
        [systemSettings?.permissions]
    );
    // Shared with the dashboard tiles through a module-level cache, so the two
    // never disagree and the dashboard does not pay for a second request.
    const { counts } = useWorkQueues();
    const badges = useMemo(() => badgesByRoute(counts ?? {}), [counts]);

    // "" is the fresh-install default, so a blank string means "never set",
    // not "set to nothing".
    const hasOwnLogo = Boolean(systemSettings?.company?.siteLogo?.trim());
    // Which company am I in. It sat in the top bar, which put it as far from
    // the product name as the layout allows; under the wordmark it reads as
    // one statement — this product, this company — and frees the top bar for
    // the breadcrumb.
    //
    // activeTenant is the workspace the current token is scoped to, which is
    // the same thing the footer and the picker name. CompanySettings.companyName
    // is the fallback for a session that has not re-read /auth/session yet.
    const subtitle =
        activeTenant?.name?.trim() || systemSettings?.company?.companyName?.trim() || "";

    // The workspace's own module choice from setup, on top of the role's
    // permissions. A preference, not a permission: the routes still resolve, so
    // a bookmark into a hidden module keeps working.
    const enabledModules = useEnabledModules();
    const modules = useMemo(
        () => buildNavModules(permissions, applyModulePreferences(navItems, enabledModules)),
        [permissions, enabledModules]
    );
    const active = useMemo(
        () => findActiveNavRoute(modules, resolveSidebarPath(pathname)),
        [modules, pathname]
    );

    // The children live in a flyout anchored to the row that opened it, shared
    // with the settings rail so both open the same way in the same place.
    const { flyout: peek, openFlyout, closeFlyout: closePeek } = useNavFlyout();
    const peekModule = peek ? modules.find((navModule) => navModule.id === peek.id) : undefined;

    const openPeek = useCallback(
        (navModule: NavModule, element: HTMLElement) => {
            // A module that is only a link (Dashboard, Fixed Assets, Reports)
            // has no rows, so this opens nothing.
            const rows = navModule.sections.reduce(
                (total, section) => total + section.items.length + (section.caption ? 1 : 0),
                0
            );
            openFlyout(navModule.id, element, rows);
        },
        [openFlyout]
    );

    // The one close the hook cannot know about: the rail changing width leaves
    // the anchor coordinates pointing at where the row used to be.
    useEffect(() => {
        closePeek();
    }, [isOpen, closePeek]);

    return (
        <aside
            className={cn(
                // h-full, not h-screen: as a flex child of an h-dvh row,
                // h-screen double-specifies the height and breaks print:block.
                "z-0 flex h-full min-h-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
                // Narrower below 2xl, where content width is scarcest: 194px
                // open at the compact density, widening to 216px on a large
                // monitor (w-54 / w-60 against --spacing: 0.225rem).
                isOpen ? "w-54 2xl:w-60" : "w-16"
            )}
        >
            {/* Product identity, not company identity - the company moved to
                the footer, where the workspace switcher is.

                An install that has uploaded its own siteLogo keeps it: this is
                white-labelled on-prem, and replacing a customer's mark with our
                wordmark would be a regression, not a redesign. The lettermark
                below is the fallback for everyone else, which is most installs
                (siteLogo defaults to ""). resolveCompanyLogo cannot answer
                "did they set one?" - it always returns the bundled fallback -
                so the raw value is what gets tested here.

                Spans both columns, with the mark centred over the rail so it
                sits in the same place at either width. */}
            <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border pr-3">
                <button
                    type="button"
                    onClick={() => navigate("/dashboard")}
                    aria-label="Go to dashboard"
                    className="flex min-w-0 flex-1 cursor-pointer items-center"
                >
                    {hasOwnLogo && isOpen ? (
                        // Only one branding element is rendered per state: a wide
                        // logo left inside the 64px rail slot would either clip or
                        // push the mark out of the collapsed rail entirely.
                        <img
                            src={resolveCompanyLogo(systemSettings?.company?.siteLogo)}
                            alt="Logo"
                            className="ml-4 w-32 object-contain"
                        />
                    ) : (
                        <>
                            <span className="flex w-16 shrink-0 justify-center">
                                {hasOwnLogo ? (
                                    <img
                                        src={resolveCompanyLogo(
                                            systemSettings?.company?.favicon ||
                                            systemSettings?.company?.siteLogo
                                        )}
                                        alt="Logo"
                                        className="h-8 w-8 object-contain"
                                    />
                                ) : (
                                    <span
                                        aria-hidden="true"
                                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-xs font-bold tracking-tight text-primary-foreground"
                                    >
                                        EB
                                    </span>
                                )}
                            </span>
                            {isOpen && (
                                <span className="flex min-w-0 flex-col text-left">
                                    <span className="truncate text-sm font-semibold leading-tight text-sidebar-foreground">
                                        Elixir Book
                                    </span>
                                    {subtitle && (
                                        <span className="truncate text-[0.6875rem] leading-tight text-sidebar-foreground/60">
                                            {subtitle}
                                        </span>
                                    )}
                                </span>
                            )}
                        </>
                    )}
                </button>
            </div>

            {/* The flyout is rendered inside this container on purpose: it is
                positioned outside the sidebar, but mouseleave follows the DOM,
                so crossing from a row into the flyout does not close it. */}
            <div
                className="relative flex min-h-0 flex-1 flex-col"
                onMouseLeave={closePeek}
            >
                <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {modules.map((navModule, index) => {
                        const startsBand =
                            index === 0 || navModule.band !== modules[index - 1].band;
                        return (
                            <div key={navModule.id}>
                                {/* Expanded, the band is a caption. Collapsed, a
                                    hairline: at 64px a caption truncates to
                                    nothing useful, and the grouping is all the
                                    caption was carrying anyway. */}
                                {startsBand &&
                                    (isOpen ? (
                                        <p
                                            className={cn(
                                                "px-4 pb-1 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/60",
                                                index > 0 && "pt-3"
                                            )}
                                        >
                                            {navModule.band}
                                        </p>
                                    ) : (
                                        index > 0 && (
                                            <div
                                                aria-hidden="true"
                                                className="mx-3 my-1.5 h-px bg-sidebar-border"
                                            />
                                        )
                                    ))}
                                <ModuleRow
                                    navModule={navModule}
                                    isActive={navModule.id === active?.moduleId}
                                    isExpanded={isOpen}
                                    count={countFor(moduleRoutes(navModule), badges)}
                                    onPeek={(element) => openPeek(navModule, element)}
                                />
                            </div>
                        );
                    })}
                </nav>

                {/* Settings and Get Help are pinned rather than filed under a
                    module: they have to be reachable from every one of them,
                    and at both widths. */}
                <div className="shrink-0 border-t border-sidebar-border py-1">
                    {[
                        {
                            to: "/settings",
                            icon: <AnimatedIcon name="settings" size={16} />,
                            label: "Settings",
                        },
                        // LifeBuoy stays static: a spinning life ring reads as
                        // loading, which is the one thing Help must not say.
                        { to: "/help", icon: <LifeBuoy size={16} />, label: "Get Help" },
                    ].map((entry) => (
                        <div
                            key={entry.to}
                            className={cn("flex py-0.5", isOpen ? "px-2" : "justify-center")}
                        >
                            <Link
                                to={entry.to}
                                title={isOpen ? undefined : entry.label}
                                aria-label={entry.label}
                                onMouseEnter={closePeek}
                                onFocus={closePeek}
                                className={cn(
                                    "flex h-10 items-center rounded-xl text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                                    isOpen ? "w-full gap-2.5 px-2.5" : "w-10 justify-center"
                                )}
                            >
                                <span className="shrink-0">{entry.icon}</span>
                                {isOpen && (
                                    <span className="truncate text-sm font-medium">{entry.label}</span>
                                )}
                            </Link>
                        </div>
                    ))}
                    <div className={cn("flex py-0.5", isOpen ? "px-2" : "justify-center")}>
                        <button
                            type="button"
                            onClick={onToggle}
                            onMouseEnter={closePeek}
                            onFocus={closePeek}
                            aria-expanded={isOpen}
                            aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
                            title={isOpen ? undefined : "Expand sidebar"}
                            className={cn(
                                "flex h-10 cursor-pointer items-center rounded-xl text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                                isOpen ? "w-full gap-2.5 px-2.5" : "w-10 justify-center"
                            )}
                        >
                            <span className="shrink-0">
                                {isOpen ? (
                                    <AnimatedIcon name="panel-close" size={16} />
                                ) : (
                                    <AnimatedIcon name="panel-open" size={16} />
                                )}
                            </span>
                            {isOpen && <span className="truncate text-sm font-medium">Collapse</span>}
                        </button>
                    </div>
                </div>

                {peek && peekModule && (
                    <div
                        role="menu"
                        aria-label={peekModule.panelTitle}
                        className="fixed z-50 flex w-56 origin-top-left flex-col rounded-xl border border-sidebar-border bg-sidebar py-2 shadow-xl animate-pop-in motion-reduce:animate-none"
                        style={{ top: peek.top, left: peek.left, maxHeight: "70vh" }}
                    >
                        <ModulePanel
                            navModule={peekModule}
                            activeRoute={active?.to ?? null}
                            permissions={permissions}
                            badges={badges}
                        />
                    </div>
                )}
            </div>

            <BottomBar isSidebarOpen={isOpen} />
        </aside>
    );
};

export default Sidebar;
