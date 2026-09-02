import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useSelector } from "react-redux";

import DemoBanner from "../DemoBanner";
import {
    PageHeaderProvider,
    usePageHeader,
} from "../../../context/PageHeaderContext";
import { CommandPaletteProvider } from "../../../context/CommandPaletteContext";
import { Tabs } from "@components/ui";
import { cn } from "@lib/cn";
import { useNavFlyout } from "@hooks/useNavFlyout";
import {
    accountGroup,
    findSettingsTab,
    isSettingsLinkActive,
    visibleGroups,
    visibleSettingsTabs,
} from "@lib/settingsCatalogue";
import type {
    SettingsGroup,
    SettingsTabId,
} from "@lib/settingsCatalogue";
import type { RootState } from "@store/index";

/**
 * The settings shell.
 *
 * A sibling of AdminLayout rather than a branch inside it: AdminLayout owns the
 * app sidebar, the AI FAB and the sidebar-width preference, none of which exist
 * in here. Entering settings swaps the whole shell — its own nav, its own way
 * out — which is what "Close Settings" means.
 *
 * The nav is the same mechanism as the app rail: a row per group, children in
 * a flyout beside it. It replaced a fully expanded tree, which listed all
 * thirty destinations at once and made the rail a wall of text you had to read
 * top to bottom to find anything. Two things cut that down — the flyout hides
 * a group until you point at it, and the General/Workspace tabs halve what the
 * rail lists at all.
 */

/** One flyout row: a single destination. */
const PanelRow = ({
    title,
    to,
    isActive,
}: {
    title: string;
    to: string;
    isActive: boolean;
}) => (
    <Link
        to={to}
        aria-current={isActive ? "page" : undefined}
        className={cn(
            "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
            isActive
                ? "bg-sidebar-accent font-medium text-sidebar-primary"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
    >
        <span className="truncate">{title}</span>
    </Link>
);

/** A rail row. Opens its group's flyout on hover, focus or click. */
const GroupRow = ({
    group,
    isActive,
    onPeek,
}: {
    group: SettingsGroup;
    isActive: boolean;
    onPeek: (element: HTMLElement) => void;
}) => (
    <div className="relative flex px-2 py-0.5">
        {/* Inset marker rather than a border on the row itself: it reads as the
            rail pointing at the group, and matches the app sidebar. */}
        {isActive && (
            <span
                aria-hidden="true"
                className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-sidebar-primary"
            />
        )}
        <button
            type="button"
            aria-haspopup="menu"
            aria-current={isActive ? "true" : undefined}
            onClick={(event) => onPeek(event.currentTarget)}
            onMouseEnter={(event) => onPeek(event.currentTarget)}
            onFocus={(event) => onPeek(event.currentTarget)}
            className={cn(
                "flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 transition-colors",
                isActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
        >
            <span className="shrink-0">{group.icon}</span>
            <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
                {group.title}
            </span>
            {/* Points at where the children will appear — to the side, not
                below. A chevron-down would promise an accordion. */}
            <ChevronRight
                size={14}
                aria-hidden="true"
                className="shrink-0 text-sidebar-foreground/40"
            />
        </button>
    </div>
);

/**
 * The shell's top bar. Settings pages announce themselves through
 * PageHeaderContext exactly as they do under the admin shell — without this
 * they would set a title with nothing to render it.
 */
const SettingsTopBar = ({ onClose }: { onClose: () => void }) => {
    const { title, actions } = usePageHeader();

    return (
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4 print:hidden">
            <h1 className="truncate text-base font-semibold text-foreground">
                {title}
            </h1>
            <div className="flex items-center gap-2">
                {actions}
                {/* Icon only: the label lives in aria-label/title so the
                    control is still announced and still names itself on hover. */}
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close settings"
                    title="Close Settings"
                    className="flex cursor-pointer items-center rounded-md p-1.5 text-destructive transition-colors hover:bg-destructive/10"
                >
                    <X size={16} />
                </button>
            </div>
        </header>
    );
};

const SettingsLayout = () => {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const mainRef = useRef<HTMLElement>(null);

    const { data: systemSettings } = useSelector(
        (state: RootState) => state.systemSettings,
    );
    const permissions = useMemo(
        () => systemSettings?.permissions ?? [],
        [systemSettings?.permissions],
    );

    const tabs = useMemo(() => visibleSettingsTabs(permissions), [permissions]);
    const accountLinks = useMemo(
        () => visibleGroups([accountGroup], permissions)[0]?.links ?? [],
        [permissions],
    );

    // The tab follows the route, so a deep link or the palette lands on the
    // half of settings that actually holds the open page. It is state and not
    // a derived value because switching tabs must not navigate: you browse the
    // other half, then pick from it.
    const [tab, setTab] = useState<SettingsTabId>(
        () => findSettingsTab(pathname) ?? "general",
    );
    useEffect(() => {
        const owner = findSettingsTab(pathname);
        if (owner) setTab(owner);
    }, [pathname]);

    const groups = useMemo(
        () => tabs.find((entry) => entry.id === tab)?.groups ?? tabs[0]?.groups ?? [],
        [tabs, tab],
    );

    const { flyout, openFlyout, closeFlyout } = useNavFlyout();
    const peekGroup = flyout
        ? groups.find((group) => group.id === flyout.id)
        : undefined;

    // Scroll the content area back to the top on every route change, as the
    // admin shell does.
    useEffect(() => {
        mainRef.current?.scrollTo({ top: 0 });
    }, [pathname]);

    return (
        <PageHeaderProvider>
            {/* Same Ctrl/Cmd+K palette as the admin shell: settings pages can
                still jump anywhere in the app. */}
            <CommandPaletteProvider>
                <div className="density-compact flex h-dvh overflow-hidden bg-background font-sans print:block print:h-auto print:overflow-visible">
                    <aside className="flex h-full min-h-0 w-56 2xl:w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground print:hidden">
                        <Link
                            to="/settings"
                            className="flex h-12 shrink-0 items-center gap-2 px-4 text-sidebar-foreground hover:text-sidebar-primary"
                        >
                            <ChevronLeft size={16} />
                            <span className="text-base font-semibold">All Settings</span>
                        </Link>

                        {/* The split, stated once at the top rather than as two
                            headings you scroll between. */}
                        {tabs.length > 1 && (
                            <div className="shrink-0 px-3 pb-2">
                                <Tabs
                                    variant="segmented"
                                    aria-label="Settings scope"
                                    className="w-full [&>button]:flex-1"
                                    tabs={tabs.map((entry) => ({
                                        key: entry.id,
                                        label: entry.title,
                                    }))}
                                    value={tab}
                                    onChange={(key) => {
                                        closeFlyout();
                                        setTab(key as SettingsTabId);
                                    }}
                                />
                            </div>
                        )}

                        {/* The flyout is a DOM child of this container even
                            though it paints outside it: mouseleave follows the
                            DOM, not the pixels, so crossing from a row into the
                            flyout is not a leave. */}
                        <div
                            className="relative flex min-h-0 flex-1 flex-col"
                            onMouseLeave={closeFlyout}
                        >
                            <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                {groups.map((group) => (
                                    <GroupRow
                                        key={group.id}
                                        group={group}
                                        isActive={group.links.some((link) =>
                                            isSettingsLinkActive(link.to, pathname),
                                        )}
                                        onPeek={(element) =>
                                            openFlyout(group.id, element, group.links.length)
                                        }
                                    />
                                ))}
                            </nav>

                            {/* Pinned below the tabs, not inside them: these are
                                the signed-in user's own settings, and they have
                                to be reachable from either half. */}
                            {accountLinks.length > 0 && (
                                <div className="shrink-0 border-t border-sidebar-border py-2">
                                    <p className="flex items-center gap-2 px-4 pb-1 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/60">
                                        {accountGroup.icon}
                                        <span>{accountGroup.title}</span>
                                    </p>
                                    <div className="px-2">
                                        {accountLinks.map((link) => (
                                            <PanelRow
                                                key={link.to}
                                                title={link.title}
                                                to={link.to}
                                                isActive={isSettingsLinkActive(link.to, pathname)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {peekGroup && flyout && (
                                <div
                                    role="menu"
                                    aria-label={peekGroup.title}
                                    className="fixed z-50 flex w-56 origin-top-left flex-col rounded-xl border border-sidebar-border bg-sidebar py-2 shadow-xl animate-pop-in motion-reduce:animate-none"
                                    style={{
                                        top: flyout.top,
                                        left: flyout.left,
                                        maxHeight: "70vh",
                                    }}
                                >
                                    <div className="flex h-10 shrink-0 items-center gap-2 px-3">
                                        <h2 className="truncate text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                                            {peekGroup.title}
                                        </h2>
                                    </div>
                                    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
                                        {peekGroup.links.map((link) => (
                                            <PanelRow
                                                key={link.to}
                                                title={link.title}
                                                to={link.to}
                                                isActive={isSettingsLinkActive(link.to, pathname)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </aside>

                    {/* min-w-0 was missing here where AdminLayout has it, so a
                        wide table under /settings/* squeezed the rail instead of
                        scrolling inside its own container. */}
                    <div className="flex flex-1 flex-col overflow-hidden print:overflow-visible min-w-0 min-h-0">
                        <SettingsTopBar onClose={() => navigate("/")} />

                        <main
                            ref={mainRef}
                            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 lg:p-4 print:overflow-visible"
                        >
                            <div className="mx-auto w-full max-w-(--content-max)">
                                <DemoBanner />
                                <Outlet />
                            </div>
                        </main>
                    </div>
                </div>
            </CommandPaletteProvider>
        </PageHeaderProvider>
    );
};

export default SettingsLayout;
