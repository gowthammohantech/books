import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useOpenDrawer } from "@hooks/useOpenDrawer";
import { isDrawerPath } from "@/routes/drawerRoutes";
import { useSelector } from "react-redux";
import {
    CornerDownLeft,
    FileText,
    Loader2,
    Package,
    Plus,
    Search,
    Users,
} from "lucide-react";
import { useDebounce } from "@hooks/useDebounce";
import { useEntitySearch, entityLabel } from "@hooks/useEntitySearch";
import { useRecentCommands } from "@hooks/useRecentCommands";
import {
    buildCommands,
    highlightRanges,
    rankCommands,
    type Command,
} from "@lib/commandPalette";
import type { EntityResult, EntityType } from "@hooks/useEntitySearch";
import type { RootState } from "@store/index";

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
}

/** One selectable row. Sections are presentational; only these take focus. */
type PaletteItem =
    | { key: string; type: "command"; command: Command }
    | { key: string; type: "entity"; entity: EntityResult };

interface PaletteSection {
    label: string;
    items: PaletteItem[];
}

/**
 * How many command matches sit above the matching records.
 *
 * Not a cap: everything past this still renders, under "More pages". The split
 * exists because broad words match a lot of menu entries ("account" matches 33
 * of them), and an unbroken run of those would push the matching invoices and
 * contacts below the fold.
 */
const COMMANDS_BEFORE_RECORDS = 8;

const ENTITY_ICONS: Record<EntityType, typeof FileText> = {
    invoice: FileText,
    contact: Users,
    product: Package,
};

/** Renders `text` with the query's matched runs emphasised. */
const Highlighted = ({ text, query }: { text: string; query: string }) => {
    const ranges = highlightRanges(text, query);
    if (!ranges.length) return <>{text}</>;

    const parts: React.ReactNode[] = [];
    let cursor = 0;
    ranges.forEach(([start, end], index) => {
        if (start > cursor) parts.push(text.slice(cursor, start));
        parts.push(
            <span key={index} className="font-semibold text-primary">
                {text.slice(start, end)}
            </span>
        );
        cursor = end;
    });
    if (cursor < text.length) parts.push(text.slice(cursor));
    return <>{parts}</>;
};

const CommandPalette = ({ isOpen, onClose }: CommandPaletteProps) => {
    const navigate = useNavigate();
    const openDrawer = useOpenDrawer();
    const { user } = useSelector((state: RootState) => state.auth);
    const permissions = useSelector(
        (state: RootState) => state.systemSettings.data?.permissions
    );
    const { recentIds, remember } = useRecentCommands();

    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);

    const inputRef = useRef<HTMLInputElement>(null);
    const activeRowRef = useRef<HTMLButtonElement>(null);
    const previouslyFocusedRef = useRef<Element | null>(null);

    // 500ms matches the debounce every other remote-search field in the app
    // uses (ContactPicker, the list pages), so the palette does not feel like
    // a different kind of input.
    const debouncedQuery = useDebounce(query, 500);
    const { results: entityResults, loading: entitiesLoading } = useEntitySearch(
        isOpen ? debouncedQuery : ""
    );

    const commands = useMemo(
        () => buildCommands(permissions ?? []),
        [permissions, user]
    );

    const sections = useMemo<PaletteSection[]>(() => {
        const ranked = rankCommands(commands, query, recentIds);
        const trimmed = query.trim();

        const toItems = (list: Command[]): PaletteItem[] =>
            list.map((command) => ({
                key: command.id,
                type: "command" as const,
                command,
            }));

        // Idle: every destination the user can reach, recents pulled to the top.
        // The list scrolls, so there is no reason to truncate it — a palette
        // that hides half the app is the thing people complain about.
        if (!trimmed) {
            const recentSet = new Set(recentIds);
            const recent = ranked
                .filter((r) => recentSet.has(r.command.id))
                .map((r) => r.command);
            const rest = ranked
                .filter((r) => !recentSet.has(r.command.id))
                .map((r) => r.command);

            return [
                ...(recent.length ? [{ label: "Recent", items: toItems(recent) }] : []),
                { label: "Jump to", items: toItems(rest) },
            ];
        }

        const matched: PaletteSection[] = [];
        const rankedCommands = ranked.map((r) => r.command);
        const leading = rankedCommands.slice(0, COMMANDS_BEFORE_RECORDS);
        const trailing = rankedCommands.slice(COMMANDS_BEFORE_RECORDS);

        if (leading.length) {
            matched.push({ label: "Pages & actions", items: toItems(leading) });
        }

        // Group the live records by type so an invoice number and a customer
        // name never sit in the same undifferentiated run of rows.
        (["invoice", "contact", "product"] as EntityType[]).forEach((type) => {
            const ofType = entityResults.filter((entity) => entity.type === type);
            if (!ofType.length) return;
            matched.push({
                label: entityLabel(type),
                items: ofType.map((entity) => ({
                    key: entity.id,
                    type: "entity",
                    entity,
                })),
            });
        });

        if (trailing.length) {
            matched.push({ label: "More pages", items: toItems(trailing) });
        }

        return matched;
    }, [commands, query, recentIds, entityResults]);

    const flatItems = useMemo(
        () => sections.flatMap((section) => section.items),
        [sections]
    );

    // The list re-ranks on every keystroke, so an index held from the previous
    // query would point at an unrelated row. Snap back to the best match.
    useEffect(() => {
        setActiveIndex(0);
    }, [query, entityResults]);

    // Fresh state each time it opens: a palette that reopens showing the last
    // search is surprising, and the stale query would re-fire the remote search.
    // On close, focus goes back to whatever opened it (the header button, or the
    // element that had focus when the shortcut fired) rather than to <body>.
    useEffect(() => {
        if (!isOpen) return;
        previouslyFocusedRef.current = document.activeElement;
        setQuery("");
        setActiveIndex(0);
        inputRef.current?.focus();

        return () => {
            if (previouslyFocusedRef.current instanceof HTMLElement) {
                previouslyFocusedRef.current.focus();
            }
        };
    }, [isOpen]);

    useEffect(() => {
        activeRowRef.current?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);

    if (!isOpen) return null;

    const runItem = (item: PaletteItem | undefined) => {
        if (!item) return;
        if (item.type === "command") {
            remember(item.command.id);
            // Create commands open a drawer over the page the palette was
            // summoned from, rather than replacing it.
            if (isDrawerPath(item.command.path)) openDrawer(item.command.path);
            else navigate(item.command.path);
        } else {
            navigate(item.entity.path);
        }
        onClose();
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                if (flatItems.length)
                    setActiveIndex((prev) => (prev + 1) % flatItems.length);
                break;
            case "ArrowUp":
                event.preventDefault();
                if (flatItems.length)
                    setActiveIndex(
                        (prev) => (prev - 1 + flatItems.length) % flatItems.length
                    );
                break;
            case "Home":
                event.preventDefault();
                setActiveIndex(0);
                break;
            case "End":
                event.preventDefault();
                setActiveIndex(Math.max(0, flatItems.length - 1));
                break;
            case "Enter":
                event.preventDefault();
                runItem(flatItems[activeIndex]);
                break;
            case "Escape":
                event.preventDefault();
                onClose();
                break;
            case "Tab":
                // Every key the palette understands is handled here, on the
                // panel. Letting Tab move focus to the page behind the backdrop
                // would leave the palette open but deaf to the keyboard, and
                // there is nothing inside it worth tabbing to.
                event.preventDefault();
                break;
            default:
                break;
        }
    };

    // Sections render in order, so a section's first row sits at the running
    // total of every row before it — that offset is what maps a rendered row
    // back to its index in `flatItems` for keyboard selection.
    let renderedIndex = -1;

    return createPortal(
        <>
            <div
                className="fixed inset-0 z-[998] bg-black/50 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />
            <div className="fixed inset-0 z-[999] flex items-start justify-center px-4 pt-[12vh] pointer-events-none">
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Command palette"
                    className="pointer-events-auto w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
                    onKeyDown={handleKeyDown}
                >
                    <div className="flex items-center gap-3 border-b border-border px-4">
                        <Search size={18} className="shrink-0 text-muted-foreground" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search pages, invoices, contacts, items…"
                            aria-label="Search pages, invoices, contacts and items"
                            className="w-full bg-transparent py-3.5 text-sm text-popover-foreground outline-none placeholder:text-muted-foreground"
                            autoComplete="off"
                            spellCheck={false}
                        />
                        {entitiesLoading && (
                            <Loader2
                                size={16}
                                className="shrink-0 animate-spin text-muted-foreground"
                            />
                        )}
                        <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
                            Esc
                        </kbd>
                    </div>

                    <div className="max-h-[55vh] overflow-y-auto py-2">
                        {!flatItems.length && (
                            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                                {entitiesLoading
                                    ? "Searching…"
                                    : `No results for “${query.trim()}”`}
                            </p>
                        )}

                        {sections.map((section) => (
                            <div key={section.label} className="mb-1">
                                <p className="px-4 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                    {section.label}
                                </p>
                                {section.items.map((item) => {
                                    renderedIndex += 1;
                                    const index = renderedIndex;
                                    const isActive = index === activeIndex;
                                    const rowClasses = `flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                                        isActive
                                            ? "bg-accent text-accent-foreground"
                                            : "text-popover-foreground hover:bg-muted"
                                    }`;

                                    if (item.type === "command") {
                                        const { command } = item;
                                        return (
                                            <button
                                                key={item.key}
                                                ref={isActive ? activeRowRef : undefined}
                                                type="button"
                                                className={rowClasses}
                                                onMouseMove={() => setActiveIndex(index)}
                                                onClick={() => runItem(item)}
                                            >
                                                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                                                    {command.kind === "create" ? (
                                                        <Plus size={16} />
                                                    ) : (
                                                        command.icon ?? <Search size={14} />
                                                    )}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate text-sm">
                                                    <Highlighted text={command.title} query={query} />
                                                </span>
                                                {command.group && (
                                                    <span className="shrink-0 truncate text-xs text-muted-foreground">
                                                        {command.group}
                                                    </span>
                                                )}
                                                {isActive && (
                                                    <CornerDownLeft
                                                        size={14}
                                                        className="shrink-0 text-muted-foreground"
                                                    />
                                                )}
                                            </button>
                                        );
                                    }

                                    const { entity } = item;
                                    const EntityIcon = ENTITY_ICONS[entity.type];
                                    return (
                                        <button
                                            key={item.key}
                                            ref={isActive ? activeRowRef : undefined}
                                            type="button"
                                            className={rowClasses}
                                            onMouseMove={() => setActiveIndex(index)}
                                            onClick={() => runItem(item)}
                                        >
                                            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                                                <EntityIcon size={16} />
                                            </span>
                                            <span className="min-w-0 flex-1 truncate text-sm">
                                                <Highlighted text={entity.title} query={query} />
                                            </span>
                                            {entity.subtitle && (
                                                <span className="shrink-0 truncate text-xs text-muted-foreground">
                                                    {entity.subtitle}
                                                </span>
                                            )}
                                            {isActive && (
                                                <CornerDownLeft
                                                    size={14}
                                                    className="shrink-0 text-muted-foreground"
                                                />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center gap-4 border-t border-border bg-muted/50 px-4 py-2 text-[0.6875rem] text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <kbd className="rounded border border-border bg-card px-1">↑</kbd>
                            <kbd className="rounded border border-border bg-card px-1">↓</kbd>
                            navigate
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="rounded border border-border bg-card px-1">↵</kbd>
                            open
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="rounded border border-border bg-card px-1">esc</kbd>
                            close
                        </span>
                    </div>
                </div>
            </div>
        </>,
        document.body
    );
};

export default CommandPalette;
