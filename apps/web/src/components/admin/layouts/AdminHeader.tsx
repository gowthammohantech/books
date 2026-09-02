import { ChevronRight } from 'lucide-react';

import { AnimatedIcon } from '@components/icons';
import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link, useLocation } from 'react-router-dom';

import type { RootState } from '../../../store';
import { usePageHeader } from '../../../context/PageHeaderContext';
import { useCommandPalette } from '../../../context/CommandPaletteContext';
import { useAgentPanel } from '@context/AgentPanelContext';
import NotificationBell from './NotificationBell';
import { buildCommands } from '@lib/commandPalette';
import { resolveBreadcrumb } from '@lib/breadcrumb';
import lixiLogo from '@assets/images/lixi-logo.png';

/**
 * The top bar.
 *
 * Identity moved OUT of here. The avatar menu (name, profile, sign out) and the
 * workspace dropdown both now live in the sidebar footer, next to the company
 * they describe — they used to sit at the far right while the company name sat
 * at the bottom left, which split one question across two corners.
 *
 * The company name went with it, to sit under the wordmark in the rail. It was
 * the only thing on this bar that never changed as you moved around the app,
 * which made it the one piece of chrome earning the least from the position it
 * held.
 *
 * What is left is the answer to "where am I" — a breadcrumb — plus the three
 * things you reach for from anywhere: search, what is waiting, and Lixi.
 */
const AdminHeader = () => {
    // Page-supplied title + action buttons (null when no page sets them).
    const { title: pageTitle, actions: pageActions } = usePageHeader();
    const { open: openCommandPalette } = useCommandPalette();
    const { isOpen: isAgentOpen, isAvailable: isAgentAvailable, toggle: toggleAgent } =
        useAgentPanel();
    const { pathname } = useLocation();
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);

    // The shortcut hint has to name the key the visitor's own keyboard uses, or
    // it reads as wrong on whichever platform it does not match.
    const [shortcutHint, setShortcutHint] = useState('Ctrl K');

    useEffect(() => {
        if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
            setShortcutHint('⌘ K');
        }
    }, []);

    const permissions = systemSettings?.permissions;
    // Same flattened tree the palette searches, so the breadcrumb can never name
    // a destination the menu hides from this role.
    const commands = useMemo(() => buildCommands(permissions ?? []), [permissions]);
    const crumbs = useMemo(
        () => resolveBreadcrumb(pathname, commands),
        [pathname, commands],
    );

    // h-12 rather than padding-derived: the bar used to change height as the
    // breadcrumb wrapped or the page-actions slot filled, which made the
    // content pane a different height on every route.
    return (
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 px-4 bg-card border-b border-border relative z-30">
            <div className="flex min-w-0 items-center gap-3">
                {/* The trail is derived from the nav tree, so an unlisted route
                    (a create form, a detail page) yields nothing rather than a
                    guess. The page's own title covers those. */}
                {crumbs.length > 0 && (
                    <nav aria-label="Breadcrumb" className="min-w-0">
                        <ol className="flex min-w-0 items-center gap-1 text-sm">
                            {crumbs.map((crumb, index) => {
                                const isLast = index === crumbs.length - 1;
                                return (
                                    <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
                                        {index > 0 && (
                                            <ChevronRight
                                                size={14}
                                                className="shrink-0 text-muted-foreground/60"
                                                aria-hidden="true"
                                            />
                                        )}
                                        {crumb.to && !isLast ? (
                                            <Link
                                                to={crumb.to}
                                                className="truncate text-muted-foreground hover:text-foreground"
                                            >
                                                {crumb.label}
                                            </Link>
                                        ) : (
                                            <span
                                                className={`truncate ${isLast
                                                    ? 'font-semibold text-foreground'
                                                    : 'text-muted-foreground'
                                                    }`}
                                                aria-current={isLast ? 'page' : undefined}
                                            >
                                                {crumb.label}
                                            </span>
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    </nav>
                )}

                {/* Falls back to the page's own title where the trail is empty,
                    so a create form is still labelled. */}
                {crumbs.length === 0 && pageTitle && (
                    <h1 className="truncate text-lg font-semibold text-foreground">{pageTitle}</h1>
                )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
                {/* Command palette trigger. A search-box shape rather than an icon
                    button: the shortcut is only discoverable if something on screen
                    advertises it, and this is where people look for search. Given a
                    real field's width from lg up, where the label and hint appear;
                    below that it stays the compact icon button it has to be. */}
                <button
                    onClick={openCommandPalette}
                    aria-label="Search pages, invoices, contacts and items"
                    aria-keyshortcuts="Control+K Meta+K"
                    className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer lg:w-56 lg:justify-between xl:w-72"
                >
                    <span className="flex items-center gap-2">
                        <AnimatedIcon name="search" size={16} />
                        <span className="hidden lg:inline">Search…</span>
                    </span>
                    <kbd className="hidden lg:inline rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium">
                        {shortcutHint}
                    </kbd>
                </button>

                {/* Page-supplied action buttons, before the global quick-add. */}
                {pageActions && <div className="flex items-center gap-2">{pageActions}</div>}

                <NotificationBell />

                {/* Lixi. Always present, not gated on the AI config: the panel
                    behind it is the one part of the app you cannot reach any
                    other way, and a launcher that vanishes on some installs is
                    a launcher nobody learns. The status dot reports whether
                    the assistant is actually configured. */}
                <button
                    type="button"
                    onClick={toggleAgent}
                    aria-expanded={isAgentOpen}
                    aria-label="Toggle Lixi"
                    className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${isAgentOpen
                        ? 'border-transparent bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                >
                    {/* The mark carries the identity, the dot the status: the
                        dot rides the mark's corner so the pill still fits the
                        same slot it did as a bare dot + label. */}
                    <span className="relative flex shrink-0">
                        <img
                            src={lixiLogo}
                            alt=""
                            aria-hidden="true"
                            className="h-5 w-5 rounded-full"
                        />
                        <span
                            aria-hidden="true"
                            className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-card ${isAgentAvailable ? 'bg-success' : 'bg-muted-foreground/50'
                                }`}
                        />
                    </span>
                    Lixi
                </button>
            </div>
        </header>
    );
};

export default AdminHeader;
