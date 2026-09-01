import { useState, useMemo, useEffect, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
    Plus,
    LifeBuoy,
    PanelLeftClose,
    PanelLeftOpen,
    Settings,
} from "lucide-react";
import { useSelector } from "react-redux";
import BottomBar from "./layouts/BottomBar";
import { cn } from "@lib/cn";
import { resolveCompanyLogo } from "@utils/companyLogo";
import { resolveNavPath as resolveSidebarPath } from "@lib/navPaths";
import { badgesByRoute } from "@lib/workQueues";
import { useWorkQueues } from "@hooks/useWorkQueues";
import { canCreate } from "@lib/navigation";
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
 * Two-column navigation: a module rail, and a panel listing the selected
 * module's destinations.
 *
 * This replaced a tree of nested accordions. The problem it solves is specific
 * to the size of this nav: Accounts Management alone holds sixteen entries
 * across two nested menus, so expanding it pushed every module below it off
 * screen, and switching modules re-scrolled the whole rail. Here the rail never
 * moves and never grows - only the panel's contents change - so the thing you
 * are aiming at stays where it was. navModules.ts does the flattening.
 *
 * Widths: 64px rail + 224px panel open, 64px rail alone collapsed. Collapsed,
 * the panel comes back as a flyout on hover, focus or click, so nothing is
 * unreachable at either width.
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
        <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary-foreground">
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
        <Plus size={14} />
    </Link>
);

const RailButton = ({
    navModule,
    isActive,
    count,
    onSelect,
    onPeek,
}: {
    navModule: NavModule;
    isActive: boolean;
    count: number;
    onSelect: () => void;
    onPeek: (element: HTMLElement) => void;
}) => {
    const label = count > 0 ? `${navModule.title} (${count} waiting)` : navModule.title;
    const classes = cn(
        "relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
        isActive
            ? "bg-sidebar-accent text-sidebar-primary"
            : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    );

    // The count is a dot here, not a number: at 40px a two-digit pill crowds the
    // icon out, and the exact figure is one row away on the panel leaf that owns
    // it. The ring keeps it legible where it overlaps the glyph.
    const body = (
        <>
            {navModule.icon}
            {count > 0 && (
                <span
                    aria-hidden="true"
                    className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar"
                />
            )}
        </>
    );

    return (
        <div className="relative flex justify-center py-0.5">
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
                    title={label}
                    aria-label={label}
                    aria-current={isActive ? "page" : undefined}
                    className={classes}
                    onClick={onSelect}
                    onMouseEnter={(event) => onPeek(event.currentTarget)}
                    onFocus={(event) => onPeek(event.currentTarget)}
                >
                    {body}
                </Link>
            ) : (
                <button
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(classes, "cursor-pointer")}
                    onClick={(event) => {
                        onSelect();
                        onPeek(event.currentTarget);
                    }}
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

/**
 * The selected module's destinations, flat. Shared by the docked panel and the
 * collapsed rail's flyout so the two cannot drift.
 */
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
                    <Plus size={15} />
                </Link>
            )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
            {navModule.sections.map((section, index) => (
                <div key={section.caption ?? `direct-${index}`} className={index > 0 ? "mt-3" : ""}>
                    {/* The old third accordion level, demoted to a caption. */}
                    {section.caption && (
                        <p className="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
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

    const modules = useMemo(() => buildNavModules(permissions), [permissions]);
    const active = useMemo(
        () => findActiveNavRoute(modules, resolveSidebarPath(pathname)),
        [modules, pathname]
    );

    // The panel follows the route, but a rail click can move it somewhere else
    // without navigating: looking inside a module before committing to a page
    // is the whole point of a rail you cannot expand.
    const [selectedId, setSelectedId] = useState<string | null>(null);
    useEffect(() => setSelectedId(null), [pathname]);

    const shownId = selectedId ?? active?.moduleId ?? modules[0]?.id;
    const shown = modules.find((navModule) => navModule.id === shownId) ?? modules[0];

    // Collapsed, the panel becomes a flyout anchored to the rail item. Fixed
    // rather than absolute: the rail scrolls, and an absolutely placed flyout
    // would be clipped by its own scroll container.
    const [peek, setPeek] = useState<{ id: string; top: number; left: number } | null>(null);
    const peekModule = peek ? modules.find((navModule) => navModule.id === peek.id) : undefined;
    const closePeek = useCallback(() => setPeek(null), []);

    const openPeek = useCallback(
        (navModule: NavModule, element: HTMLElement) => {
            if (isOpen) return;
            const rows = navModule.sections.reduce(
                (total, section) => total + section.items.length + (section.caption ? 1 : 0),
                0
            );
            const rect = element.getBoundingClientRect();
            const height = Math.min(0.7 * window.innerHeight, 56 + rows * 32);
            setPeek({
                id: navModule.id,
                left: rect.right + 8,
                top: Math.max(8, Math.min(rect.top - 8, window.innerHeight - height - 16)),
            });
        },
        [isOpen]
    );

    // A flyout that outlives what opened it is a stray menu: close it when the
    // rail is docked open again, when the route changes, and on Escape.
    useEffect(() => {
        if (isOpen) setPeek(null);
    }, [isOpen]);
    useEffect(() => setPeek(null), [pathname]);
    useEffect(() => {
        if (!peek) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setPeek(null);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [peek]);

    return (
        <aside
            className={cn(
                "z-0 flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
                isOpen ? "w-72" : "w-16"
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
                                        <span className="truncate text-[11px] leading-tight text-sidebar-foreground/60">
                                            {subtitle}
                                        </span>
                                    )}
                                </span>
                            )}
                        </>
                    )}
                </button>
            </div>

            {/* Rail and panel share this row; the flyout lives here too, so
                moving the pointer from a rail icon into it is not a leave. */}
            <div
                className="relative flex min-h-0 flex-1"
                onMouseLeave={closePeek}
            >
                <div className="flex w-16 shrink-0 flex-col border-r border-sidebar-border">
                    <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {modules.map((navModule, index) => (
                            <div key={navModule.id}>
                                {/* Bands survive as a hairline. At 64px a caption
                                    would truncate to nothing useful, and the
                                    grouping is what the caption was carrying. */}
                                {index > 0 && navModule.band !== modules[index - 1].band && (
                                    <div aria-hidden="true" className="mx-3 my-1.5 h-px bg-sidebar-border" />
                                )}
                                <RailButton
                                    navModule={navModule}
                                    isActive={navModule.id === shownId}
                                    count={countFor(moduleRoutes(navModule), badges)}
                                    onSelect={() => setSelectedId(navModule.id)}
                                    onPeek={(element) => openPeek(navModule, element)}
                                />
                            </div>
                        ))}
                    </nav>

                    {/* Settings and Get Help stay in the rail rather than the
                        panel: the panel's contents change with the selected
                        module, and these two have to be reachable from all of
                        them - and at both widths. */}
                    <div className="shrink-0 border-t border-sidebar-border py-1">
                        {[
                            { to: "/settings", icon: <Settings size={16} />, label: "Settings" },
                            { to: "/help", icon: <LifeBuoy size={16} />, label: "Get Help" },
                        ].map((entry) => (
                            <div key={entry.to} className="flex justify-center py-0.5">
                                <Link
                                    to={entry.to}
                                    title={entry.label}
                                    aria-label={entry.label}
                                    onMouseEnter={closePeek}
                                    className="flex h-10 w-10 items-center justify-center rounded-xl text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                >
                                    {entry.icon}
                                </Link>
                            </div>
                        ))}
                        <div className="flex justify-center py-0.5">
                            <button
                                type="button"
                                onClick={onToggle}
                                onMouseEnter={closePeek}
                                aria-expanded={isOpen}
                                aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
                                title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
                                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            >
                                {isOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
                            </button>
                        </div>
                    </div>
                </div>

                {isOpen && shown && (
                    <div className="flex min-w-0 flex-1 flex-col pt-2">
                        <ModulePanel
                            navModule={shown}
                            activeRoute={active?.to ?? null}
                            permissions={permissions}
                            badges={badges}
                        />
                    </div>
                )}

                {!isOpen && peek && peekModule && (
                    <div
                        className="fixed z-50 flex w-56 flex-col rounded-xl border border-sidebar-border bg-sidebar py-2 shadow-xl"
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
