import { createElement, type ReactNode } from "react";
import { BarChart2 } from "lucide-react";
import type { NavItemType } from "@models/sidebar";
import type { PermissionSet } from "@models/permissions";
import { navItems, canCreate, canView } from "./navigation";
import { allSettingsGroups } from "./settingsCatalogue";
import { reports } from "./reportCatalogue";

/**
 * Command palette model.
 *
 * A "command" is one thing the palette can take you to. Everything here is
 * derived from the app's nav sources — the sidebar tree in `navigation.tsx`,
 * the settings catalogue in `settingsCatalogue.tsx` and the report catalogue in
 * `reportCatalogue.ts` — so an entry added to any of them becomes searchable
 * here for free. There is no separate list to keep in sync.
 */

export type CommandKind = "navigate" | "create";

export interface Command {
    /** Stable across sessions: it is the key used to persist recents. */
    id: string;
    kind: CommandKind;
    title: string;
    /** Ancestor menu titles, e.g. "Reports › Transaction Reports". */
    group: string;
    path: string;
    /** Icon of the nearest ancestor that has one; menus carry icons, leaves usually do not. */
    icon?: ReactNode;
    /** Folded into matching but never displayed (ancestor titles, the URL, synonyms). */
    keywords: string[];
}

/**
 * "Invoices" -> "Invoice", "Journal Entries" -> "Journal Entry".
 * Only ever applied to the sidebar's own plural menu labels, so the two rules
 * below cover every case in the tree.
 */
const singularize = (title: string): string => {
    if (/ies$/i.test(title)) return title.replace(/ies$/i, "y");
    if (/[^s]s$/i.test(title)) return title.slice(0, -1);
    return title;
};

/** Hand-written synonyms for labels people search by a different word. */
const SYNONYMS: Record<string, string[]> = {
    "/": ["home", "overview"],
    "/contacts": ["customers", "clients", "suppliers", "vendors"],
    "/invoices": ["sales", "receivables", "ar"],
    "/purchases": ["bills", "payables", "ap"],
    "/products": ["items", "stock", "sku"],
    "/expenses": ["spending", "costs"],
    "/accounting/chart-of-accounts": ["coa", "ledger", "accounts"],
    "/accounting/journal-entries": ["je", "manual entry"],
    "/accounting/reports/profit-loss": ["pnl", "income statement"],
    "/accounting/reports/balance-sheet": ["bs"],
    "/accounting/reports/trial-balance": ["tb"],
    "/accounting/cost-centers": ["departments", "profit centres"],
    "/users": ["staff", "team", "members"],
    "/roles": ["permissions", "access"],
    "/settings/tax-rates": ["gst", "vat", "taxes"],
    "/activity-log": ["activity log", "audit", "change log", "history", "who changed"],
};

/**
 * Routable destinations the sidebar does not list.
 *
 * Some are deliberate omissions from the menu (Profile from the avatar menu),
 * others simply never got a menu entry. A palette that cannot reach them is a
 * palette with holes in it, so they are declared here — with the same
 * permission slug their route guard in AdminRoute uses, so gating still
 * matches the app.
 *
 * `slug: null` means the destination is ungated for any signed-in user.
 */
type ExtraCommand = Omit<Command, "icon"> & { slug: string | null };

/**
 * The icon every catalogue-sourced report row carries. Built with
 * `createElement` because this module is a `.ts` file — the catalogues that own
 * markup are `.tsx`, and the report catalogue deliberately holds no ReactNode
 * so it can stay importable from a plain node test.
 */
const REPORT_ICON: ReactNode = createElement(BarChart2, { size: 16 });

const EXTRA_COMMANDS: ReadonlyArray<ExtraCommand> = [
    {
        id: "nav:/expense-categories",
        kind: "navigate",
        title: "Expense Categories",
        group: "Banking & Finance",
        path: "/expense-categories",
        slug: "expenses",
        keywords: ["expense types", "categories"],
    },
    {
        id: "create:/recurring-schedules/new",
        kind: "create",
        title: "New Recurring Schedule",
        group: "Sales",
        path: "/recurring-schedules/new",
        slug: "recurring-invoices",
        keywords: ["create", "add", "new", "recurring invoice", "template"],
    },
    {
        id: "nav:/transactions",
        kind: "navigate",
        title: "Transactions",
        group: "Banking & Finance",
        path: "/transactions",
        slug: "expenses",
        keywords: ["bank transactions", "ledger"],
    },
    {
        id: "create:/settings/tax-rates/new",
        kind: "create",
        title: "New Tax",
        group: "Settings › Finance Settings",
        path: "/settings/tax-rates/new",
        slug: "finance-settings",
        keywords: ["create", "add", "new", "tax rate", "gst", "vat"],
    },
    {
        id: "nav:/settings",
        kind: "navigate",
        title: "All Settings",
        group: "Settings",
        path: "/settings",
        slug: null,
        keywords: ["preferences", "configuration", "setup", "admin"],
    },
    {
        id: "nav:/settings/account",
        kind: "navigate",
        title: "Account Settings",
        group: "Settings",
        path: "/settings/account",
        slug: "general-settings",
        keywords: ["subscription", "plan"],
    },
    // Gateway configuration screens, reached today only by clicking through the
    // Payment Gateways page. Their routes carry no guard of their own.
    {
        id: "nav:/settings/payment-gateways/razorpay",
        kind: "navigate",
        title: "Razorpay Configuration",
        group: "Settings › Payment Gateways",
        path: "/settings/payment-gateways/razorpay",
        slug: null,
        keywords: ["payment gateway", "upi"],
    },
    {
        id: "nav:/settings/payment-gateways/stripe",
        kind: "navigate",
        title: "Stripe Configuration",
        group: "Settings › Payment Gateways",
        path: "/settings/payment-gateways/stripe",
        slug: null,
        keywords: ["payment gateway", "card"],
    },
    {
        id: "nav:/settings/profile",
        kind: "navigate",
        title: "Profile Settings",
        group: "Account",
        path: "/settings/profile",
        slug: "general-settings",
        keywords: ["my account", "password", "avatar"],
    },
    {
        id: "nav:/help",
        kind: "navigate",
        title: "Get Help",
        group: "Account",
        path: "/help",
        slug: null,
        keywords: ["support", "contact us"],
    },
    {
        id: "nav:/documentation",
        kind: "navigate",
        title: "Documentation",
        group: "Account",
        path: "/documentation",
        slug: null,
        keywords: ["docs", "manual", "guide"],
    },
    {
        id: "nav:/logout",
        kind: "navigate",
        title: "Log Out",
        group: "Account",
        path: "/logout",
        slug: null,
        keywords: ["sign out", "exit"],
    },
];

/**
 * Flattens the nav tree into the commands the current user is allowed to reach.
 *
 * Permission gating mirrors the sidebar exactly (same `canView`/`canCreate`),
 * so the palette can never surface a destination the menu hides.
 */
export const buildCommands = (
    permissions: PermissionSet[],
    items: NavItemType[] = navItems
): Command[] => {
    const out: Command[] = [];
    const seen = new Set<string>();

    const push = (command: Command) => {
        if (seen.has(command.id)) return;
        seen.add(command.id);
        out.push(command);
    };

    const walk = (
        nodes: NavItemType[],
        ancestors: string[],
        inheritedIcon: ReactNode | undefined
    ) => {
        for (const node of nodes) {
            if (node.type === "header") continue;
            if (!canView(node.slug, permissions)) continue;

            const icon = node.icon ?? inheritedIcon;

            if (node.type === "collapsible") {
                walk(node.children, [...ancestors, node.title], icon);
                continue;
            }

            const group = ancestors.join(" › ");
            push({
                id: `nav:${node.to}`,
                kind: "navigate",
                title: node.title,
                group,
                path: node.to,
                icon,
                keywords: [...ancestors, node.to, ...(SYNONYMS[node.to] ?? [])],
            });

            // A few menu entries point `addPath` back at their own list page
            // (the list itself opens the create form). Those would otherwise
            // produce a "New X" row that just reopens the list.
            if (
                node.addPath &&
                node.addPath !== node.to &&
                canCreate(node.slug, permissions)
            ) {
                push({
                    id: `create:${node.addPath}`,
                    kind: "create",
                    title: `New ${singularize(node.title)}`,
                    group,
                    path: node.addPath,
                    icon,
                    keywords: ["create", "add", "new", node.title, ...ancestors],
                });
            }
        }
    };

    walk(items, [], undefined);

    for (const { slug, ...command } of EXTRA_COMMANDS) {
        if (slug === null) {
            push(command);
            continue;
        }
        const allowed =
            command.kind === "create"
                ? canCreate(slug, permissions)
                : canView(slug, permissions);
        if (allowed) push(command);
    }

    // The settings catalogue is the app's *other* nav source: it drives the
    // /settings landing cards and the settings shell's left nav, and none of it
    // appears in `navItems`. Flattened here so the palette still reaches every
    // settings page.
    //
    // Only for the real tree. A caller that supplies its own `items` is
    // exercising the flattener against a fixture and should get exactly the
    // destinations it declared, not the app's.
    //
    // Pushed last so a hand-written EXTRA_COMMANDS entry wins the id: those
    // carry better palette labels ("Account Settings" over the catalogue's
    // in-context "General") and their own synonyms.
    if (items === navItems) {
        // The report catalogue is the app's third nav source. The sidebar's
        // Reports accordion collapsed into a single link to the Reports Center,
        // which took twelve destinations out of `navItems` — and the seventeen
        // accounting/tax/time reports were never in it to begin with. Flattened
        // here so every report stays one keystroke away.
        //
        // No report has a menu entry any more: the Financial Statements and
        // Finance Reports menus were the last ones, and they came out of the
        // tree once the Reports Center indexed the same eleven paths. So this
        // loop is the only writer for every report id, and a report's group is
        // its catalogue category ("Reports › Payables") — which is also the
        // breadcrumb resolveBreadcrumb will show for it.
        for (const report of reports) {
            if (report.slug !== null && !canView(report.slug, permissions)) {
                continue;
            }
            push({
                id: `nav:${report.path}`,
                kind: "navigate",
                title: report.name,
                group: `Reports › ${report.category}`,
                path: report.path,
                icon: REPORT_ICON,
                keywords: [
                    "report",
                    report.category,
                    report.path,
                    ...(SYNONYMS[report.path] ?? []),
                ],
            });
        }

        for (const group of allSettingsGroups) {
            for (const link of group.links) {
                if (link.slug !== null && !canView(link.slug, permissions)) {
                    continue;
                }
                push({
                    id: `nav:${link.to}`,
                    kind: "navigate",
                    title: link.title,
                    group: `Settings › ${group.title}`,
                    path: link.to,
                    icon: group.icon,
                    keywords: [
                        "settings",
                        group.title,
                        link.to,
                        ...(SYNONYMS[link.to] ?? []),
                    ],
                });
            }
        }
    }

    return out;
};

// --- Matching ---------------------------------------------------------------

const norm = (value: string) => value.toLowerCase();

/**
 * Greedy subsequence match ("crno" -> "Credit Notes"). Returns a tightness
 * bonus (0-10, higher = fewer gaps between matched characters), or null when
 * `token` is not a subsequence of `text`.
 */
const subsequenceBonus = (text: string, token: string): number | null => {
    let from = 0;
    let gaps = 0;
    let lastHit = -1;
    for (const ch of token) {
        const found = text.indexOf(ch, from);
        if (found === -1) return null;
        if (lastHit !== -1 && found > lastHit + 1) gaps += 1;
        lastHit = found;
        from = found + 1;
    }
    return Math.max(0, 10 - gaps);
};

/** Splits on the separators used in titles and paths, for word-prefix matches. */
const wordStarts = (text: string): string[] =>
    text.split(/[\s/›&-]+/).filter(Boolean);

/**
 * Scores one whitespace-separated token against a command, or null when the
 * token does not match at all. The caller requires every token to match (AND
 * semantics) so "sales report" does not return every report.
 */
const scoreToken = (command: Command, token: string): number | null => {
    const title = norm(command.title);
    if (title === token) return 100;
    if (title.startsWith(token)) return 90;
    if (wordStarts(title).some((word) => word.startsWith(token))) return 80;
    if (title.includes(token)) return 65;

    const titleSub = subsequenceBonus(title, token);
    if (titleSub !== null) return 45 + titleSub;

    const rest = norm([command.group, ...command.keywords].join(" "));
    if (wordStarts(rest).some((word) => word.startsWith(token))) return 35;
    if (rest.includes(token)) return 25;
    return null;
};

export interface RankedCommand {
    command: Command;
    score: number;
}

/**
 * Ranks commands for `query`. An empty query returns recents first and then
 * the full list in nav order, which is what the palette shows on open.
 */
export const rankCommands = (
    commands: Command[],
    query: string,
    recentIds: string[] = []
): RankedCommand[] => {
    const recentBonus = (id: string) => {
        const index = recentIds.indexOf(id);
        return index === -1 ? 0 : (recentIds.length - index) * 3;
    };

    const trimmed = query.trim();
    if (!trimmed) {
        const byId = new Map(commands.map((command) => [command.id, command]));
        const recent = recentIds
            .map((id) => byId.get(id))
            .filter((command): command is Command => Boolean(command));
        const recentIdSet = new Set(recent.map((command) => command.id));
        return [
            ...recent,
            ...commands.filter((command) => !recentIdSet.has(command.id)),
        ].map((command) => ({ command, score: 0 }));
    }

    const tokens = norm(trimmed).split(/\s+/).filter(Boolean);

    const ranked: RankedCommand[] = [];
    for (const command of commands) {
        let total = 0;
        let matched = true;
        for (const token of tokens) {
            const score = scoreToken(command, token);
            if (score === null) {
                matched = false;
                break;
            }
            total += score;
        }
        if (!matched) continue;
        // Prefer the shorter of two equally-matching labels ("Invoices" over
        // "Recurring Invoices"), and pages over their create actions, so a bare
        // noun lands on the list rather than a blank form.
        total -= Math.min(command.title.length, 30) / 10;
        if (command.kind === "create") total -= 4;
        ranked.push({ command, score: total + recentBonus(command.id) });
    }

    return ranked.sort(
        (a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title)
    );
};

/**
 * Character ranges of `title` covered by the query, for bolding in the list.
 * Only contiguous occurrences are highlighted — a subsequence-only match
 * renders plain rather than speckling every other letter.
 */
export const highlightRanges = (
    title: string,
    query: string
): Array<[number, number]> => {
    const tokens = norm(query.trim()).split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const lower = norm(title);

    const ranges: Array<[number, number]> = [];
    for (const token of tokens) {
        const at = lower.indexOf(token);
        if (at !== -1) ranges.push([at, at + token.length]);
    }
    if (!ranges.length) return [];

    // Merge overlaps so nested tokens do not produce split highlight runs.
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [[...ranges[0]] as [number, number]];
    for (const [start, end] of ranges.slice(1)) {
        const last = merged[merged.length - 1];
        if (start <= last[1]) last[1] = Math.max(last[1], end);
        else merged.push([start, end]);
    }
    return merged;
};
