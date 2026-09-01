import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { formatDistanceToNow } from "date-fns";
import { Search, Star } from "lucide-react";

import Table from "@components/admin/Table";
import NoRecords from "@components/admin/NoRecords";
import { PageHeader } from "@context/PageHeaderContext";
import { useDebounce } from "@hooks/useDebounce";
import { useReportPrefs } from "@hooks/useReportPrefs";
import { rankCommands, type Command } from "@lib/commandPalette";
import {
    reportCategories,
    reports,
    type ReportCategory,
    type ReportEntry,
} from "@lib/reportCatalogue";
import { canView } from "@lib/navigation";
import type { RootState } from "@store/index";
import type { PermissionSet } from "@models/permissions";

/**
 * The Reports Center — the index of every report the app can render.
 *
 * The 29 report pages live in four unrelated corners of the router and were, up
 * to now, indexed only by a sidebar accordion that listed twelve of them. This
 * page is the whole set, browsable: categories on the left, a searchable table
 * on the right, and per-user stars and last-visited so the four reports someone
 * actually runs every month stop being four clicks deep in a menu.
 *
 * Everything it renders comes from `reportCatalogue.ts`, which is asserted
 * against the router by test, so a row here always leads somewhere real.
 */

/**
 * The left rail's selection. Categories are their own view ids because their
 * names cannot collide with the three fixed views above them.
 */
type ViewId = "home" | "favorites" | "recent" | ReportCategory;

const FIXED_VIEWS: ReadonlyArray<{ id: ViewId; label: string }> = [
    { id: "home", label: "Home" },
    { id: "favorites", label: "Favorites" },
    { id: "recent", label: "Recently Visited" },
];

const HEADERS = ["★", "Report Name", "Report Category", "Last Visited"];
const COL_WIDTHS = ["w-14", "", "w-56", "w-44"];

/**
 * The active-row vocabulary the sidebar uses for its sub-links
 * (`getSubLinkClasses`): a left accent bar that is transparent until selected,
 * so rows never shift by a pixel as the selection moves. The colours are the
 * page-content tokens rather than the `sidebar-*` ones, because this rail sits
 * on a card in the content area, not in the rail chrome.
 */
const railRowClasses = (isActive: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-md border-l-4 px-2 py-2 text-left text-sm font-medium transition-colors duration-200 ${
        isActive
            ? "border-primary bg-accent text-primary"
            : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
    }`;

/** "3 days ago", or an em dash for a report this workspace has never opened. */
const formatLastVisited = (iso: string | undefined): string => {
    if (!iso) return "–";
    const at = new Date(iso);
    // A hand-edited or older-format stored value must not take the page down.
    if (Number.isNaN(at.getTime())) return "–";
    return formatDistanceToNow(at, { addSuffix: true });
};

const ReportCenter = () => {
    const navigate = useNavigate();
    const { data: systemSettings } = useSelector(
        (state: RootState) => state.systemSettings,
    );
    // Left undefaulted: `?? []` here would be a fresh array on every render and
    // would invalidate the memo below each time.
    const permissions: PermissionSet[] | undefined = systemSettings?.permissions;

    const { isFavorite, toggleFavorite, lastVisited, recordVisit } = useReportPrefs();

    const [view, setView] = useState<ViewId>("home");
    const [searchInput, setSearchInput] = useState("");
    const query = useDebounce(searchInput, 500);

    // Gated with the sidebar's own canView, not the stricter hasPermission.
    // The two disagree on the un-configured case: hasPermission fails closed,
    // while canView fails open on purpose (permissions are client-gating only,
    // so a slug with no matching row shows rather than silently vanishing).
    // Using the stricter one here would hide reports the sidebar and the
    // palette still offer, for any workspace whose permission set omits a row.
    const visible = useMemo(
        () =>
            reports.filter(
                (report) =>
                    report.slug === null || canView(report.slug, permissions ?? []),
            ),
        [permissions],
    );

    const countsByCategory = useMemo(() => {
        const counts = new Map<ReportCategory, number>();
        for (const report of visible) {
            counts.set(report.category, (counts.get(report.category) ?? 0) + 1);
        }
        return counts;
    }, [visible]);

    const favoriteCount = visible.filter((report) => isFavorite(report.id)).length;
    const recentCount = visible.filter((report) => lastVisited[report.id]).length;

    const activeLabel =
        FIXED_VIEWS.find((fixed) => fixed.id === view)?.label ?? (view as string);

    /** The rows the selected view is about, before the search box narrows them. */
    const inView = useMemo(() => {
        if (view === "favorites") {
            return visible.filter((report) => isFavorite(report.id));
        }
        if (view === "recent") {
            return visible
                .filter((report) => lastVisited[report.id])
                .sort((a, b) => lastVisited[b.id].localeCompare(lastVisited[a.id]));
        }
        if (view === "home") return visible;
        return visible.filter((report) => report.category === view);
    }, [view, visible, isFavorite, lastVisited]);

    /**
     * Search reuses the command palette's ranking rather than growing a second
     * matcher — it already handles prefix, word-start, substring and
     * initials-style subsequence matches ("bs" -> Balance Sheet), and one
     * matcher means one set of behaviours to reason about.
     *
     * The synthetic commands carry an empty `group` and no keywords on purpose:
     * the palette scores those too, and here the brief is to filter by report
     * NAME. An empty query returns the list untouched, in view order.
     */
    const rows = useMemo(() => {
        const trimmed = query.trim();
        if (!trimmed) return inView;

        const byPath = new Map(inView.map((report) => [report.path, report]));
        const commands: Command[] = inView.map((report) => ({
            id: `nav:${report.path}`,
            kind: "navigate",
            title: report.name,
            group: "",
            path: report.path,
            keywords: [],
        }));

        return rankCommands(commands, trimmed)
            .map(({ command }) => byPath.get(command.path))
            .filter((report): report is ReportEntry => Boolean(report));
    }, [inView, query]);

    const open = (report: ReportEntry) => {
        recordVisit(report.id);
        navigate(report.path);
    };

    return (
        <>
            <PageHeader title="Reports Center" />

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                {/* Left rail */}
                <nav
                    aria-label="Report views"
                    className="w-full shrink-0 rounded-xl border border-border bg-card p-3 shadow-sm lg:w-64"
                >
                    <ul className="space-y-1">
                        {FIXED_VIEWS.map((fixed) => (
                            <li key={fixed.id}>
                                <button
                                    type="button"
                                    aria-current={view === fixed.id ? "true" : undefined}
                                    onClick={() => setView(fixed.id)}
                                    className={railRowClasses(view === fixed.id)}
                                >
                                    <span>{fixed.label}</span>
                                    {fixed.id !== "home" && (
                                        <span className="text-[11px] text-muted-foreground">
                                            {fixed.id === "favorites"
                                                ? favoriteCount
                                                : recentCount}
                                        </span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>

                    <h2 className="mt-4 mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Report Category
                    </h2>
                    <ul className="space-y-1">
                        {reportCategories.map((category) => (
                            <li key={category}>
                                <button
                                    type="button"
                                    aria-current={view === category ? "true" : undefined}
                                    onClick={() => setView(category)}
                                    className={railRowClasses(view === category)}
                                >
                                    <span>{category}</span>
                                    <span className="text-[11px] text-muted-foreground">
                                        {countsByCategory.get(category) ?? 0}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </nav>

                {/* Right pane */}
                <section className="min-w-0 flex-1 rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-semibold text-foreground">
                                {activeLabel}
                            </h2>
                            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                {rows.length}
                            </span>
                        </div>

                        <div className="relative w-full sm:w-64">
                            <Search
                                size={16}
                                aria-hidden="true"
                                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                            />
                            <input
                                type="search"
                                value={searchInput}
                                onChange={(event) => setSearchInput(event.target.value)}
                                placeholder="Search reports"
                                aria-label="Search reports"
                                className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                            />
                        </div>
                    </div>

                    <Table headers={HEADERS} fitWidth colWidths={COL_WIDTHS}>
                        {rows.length === 0 ? (
                            <NoRecords
                                colSpan={HEADERS.length}
                                message={
                                    query.trim()
                                        ? `No reports match “${query.trim()}”`
                                        : "No reports to show here yet"
                                }
                            />
                        ) : (
                            rows.map((report) => {
                                const starred = isFavorite(report.id);
                                return (
                                    <tr
                                        key={report.id}
                                        onClick={() => open(report)}
                                        className="cursor-pointer border-b border-border transition-colors hover:bg-accent/60"
                                    >
                                        <td className="px-3 py-2">
                                            <button
                                                type="button"
                                                aria-pressed={starred}
                                                aria-label={
                                                    starred
                                                        ? `Remove ${report.name} from favorites`
                                                        : `Add ${report.name} to favorites`
                                                }
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    toggleFavorite(report.id);
                                                }}
                                                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
                                            >
                                                <Star
                                                    size={16}
                                                    aria-hidden="true"
                                                    className={
                                                        starred
                                                            ? "fill-primary text-primary"
                                                            : ""
                                                    }
                                                />
                                            </button>
                                        </td>
                                        <td className="px-3 py-2 text-sm font-medium text-foreground">
                                            {report.name}
                                        </td>
                                        <td className="px-3 py-2 text-sm text-muted-foreground">
                                            {report.category}
                                        </td>
                                        <td className="px-3 py-2 text-sm text-muted-foreground">
                                            {formatLastVisited(lastVisited[report.id])}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </Table>
                </section>
            </div>
        </>
    );
};

export default ReportCenter;
