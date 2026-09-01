import { useEffect, useMemo, useRef } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, X } from "lucide-react";
import { useSelector } from "react-redux";

import DemoBanner from "../DemoBanner";
import {
    PageHeaderProvider,
    usePageHeader,
} from "../../../context/PageHeaderContext";
import { CommandPaletteProvider } from "../../../context/CommandPaletteContext";
import { canView } from "@lib/navigation";
import { isExactSettingsLink, settingsBands } from "@lib/settingsCatalogue";
import type { SettingsBand } from "@lib/settingsCatalogue";
import type { RootState } from "@store/index";
import type { PermissionSet } from "@models/permissions";

/**
 * The settings shell.
 *
 * A sibling of AdminLayout rather than a branch inside it: AdminLayout owns the
 * app sidebar, the AI FAB and the sidebar-width preference, none of which exist
 * in here. Entering settings swaps the whole shell — its own nav, its own way
 * out — which is what "Close Settings" means.
 */

// Mirrors Sidebar.tsx's getSubLinkClasses so a settings row looks like any
// other nav row in the app.
const getSettingsLinkClasses = ({ isActive }: { isActive: boolean }) =>
    `block py-1.5 px-2 text-sm font-medium rounded-md transition-colors duration-200 ${isActive
        ? "bg-sidebar-accent text-sidebar-primary border-l-4 border-sidebar-primary"
        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border-l-4 border-transparent"
    }`;

/** Same filter the /settings landing page applies: hide what the user cannot reach. */
const visibleBands = (permissions: PermissionSet[]): SettingsBand[] =>
    settingsBands
        .map((band) => ({
            ...band,
            groups: band.groups
                .map((group) => ({
                    ...group,
                    // `slug: null` is an ungated route: always show it.
                    links: group.links.filter(
                        (link) =>
                            link.slug === null || canView(link.slug, permissions),
                    ),
                }))
                .filter((group) => group.links.length > 0),
        }))
        .filter((band) => band.groups.length > 0);

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
                <button
                    type="button"
                    onClick={onClose}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                    <X size={16} />
                    <span>Close Settings</span>
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
    const permissions = systemSettings?.permissions;

    const bands = useMemo(() => visibleBands(permissions ?? []), [permissions]);

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
                <div className="flex h-screen bg-background font-sans print:block print:h-auto">
                    <aside className="flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground print:hidden">
                        <Link
                            to="/settings"
                            className="flex h-12 items-center gap-2 px-4 text-sidebar-foreground hover:text-sidebar-primary"
                        >
                            <ChevronLeft size={16} />
                            <span className="text-base font-semibold">All Settings</span>
                        </Link>

                        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2">
                            {bands.map((band) => (
                                <div key={band.id} className="mb-4">
                                    <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                                        {band.title}
                                    </p>
                                    {band.groups.map((group) => (
                                        <div key={group.id} className="mb-2">
                                            <p className="mb-1 flex items-center gap-2 px-2 text-xs font-medium text-sidebar-foreground/70">
                                                {group.icon}
                                                <span>{group.title}</span>
                                            </p>
                                            <div className="space-y-0.5 pl-2">
                                                {group.links.map((link) => (
                                                    <NavLink
                                                        key={link.to}
                                                        to={link.to}
                                                        end={isExactSettingsLink(link.to)}
                                                        className={getSettingsLinkClasses}
                                                    >
                                                        {link.title}
                                                    </NavLink>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </nav>
                    </aside>

                    <div className="flex flex-1 flex-col overflow-hidden print:overflow-visible">
                        <SettingsTopBar onClose={() => navigate("/")} />

                        <main
                            ref={mainRef}
                            className="flex-1 overflow-y-auto overflow-x-hidden p-4 print:overflow-visible"
                        >
                            <DemoBanner />
                            <Outlet />
                        </main>
                    </div>
                </div>
            </CommandPaletteProvider>
        </PageHeaderProvider>
    );
};

export default SettingsLayout;
