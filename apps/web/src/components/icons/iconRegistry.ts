import {
    ArrowDownLeft,
    ArrowUpRight,
    BarChart2,
    Bell,
    Box,
    Briefcase,
    Building2,
    ChevronRight,
    ChevronUp,
    ClipboardCheck,
    Download,
    Home,
    Landmark,
    LifeBuoy,
    MoreVertical,
    PanelLeftClose,
    PanelLeftOpen,
    Percent,
    Plus,
    Receipt,
    RefreshCw,
    Search,
    Settings,
    ShieldCheck,
    ShoppingBag,
    Sparkles,
    SquarePen,
    Trash2,
    Users,
    X,
    XCircle,
} from "lucide-react";
import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";

/**
 * The static glyph behind every animated icon.
 *
 * This is what an AnimatedIcon renders before its variant has loaded, when the
 * reader prefers reduced motion, when no variant exists for the name, and if
 * the chunk fails to fetch. It is therefore the *contract*: an animated icon
 * must be pixel-identical to its entry here at rest, which is what
 * variants.parity.test.ts enforces.
 */
export type StaticIcon = ForwardRefExoticComponent<
    Omit<SVGProps<SVGSVGElement>, "ref"> & {
        size?: string | number;
        absoluteStrokeWidth?: boolean;
    } & RefAttributes<SVGSVGElement>
>;

/**
 * Names are SEMANTIC, not glyph names: `dashboard`, not `house`.
 *
 * That is the whole payoff of routing icons through a registry rather than
 * importing lucide at each call site. Re-glyphing a module — deciding that
 * Taxation reads better as a ledger than as a percent sign — becomes a one-line
 * edit here instead of a sweep through navigation.tsx, the command palette and
 * whatever else grew a copy. The chrome entries below are named for their role
 * for the same reason.
 */
export const ICON_REGISTRY = {
    // --- Nav modules (lib/navigation.tsx) ---
    dashboard: Home,
    purchases: ShoppingBag,
    inventory: Box,
    sales: Receipt,
    contacts: Users,
    accounts: Landmark,
    taxation: Percent,
    "fixed-assets": Building2,
    reports: BarChart2,
    payroll: Briefcase,
    "audit-trail": ShieldCheck,
    approvals: ClipboardCheck,
    // Was MdSecurity from react-icons/md — the one nav glyph not from lucide.
    // Sparkles reads as "the machine did this", which is what the module is.
    "ai-extractions": Sparkles,

    // --- Shell chrome ---
    bell: Bell,
    settings: Settings,
    help: LifeBuoy,
    search: Search,
    "chevron-right": ChevronRight,
    "chevron-up": ChevronUp,
    plus: Plus,
    "panel-close": PanelLeftClose,
    "panel-open": PanelLeftOpen,

    // --- Table & modal chrome ---
    "more-vertical": MoreVertical,
    "close-circle": XCircle,
    close: X,
    trash: Trash2,
    edit: SquarePen,
    download: Download,
    refresh: RefreshCw,
    "trend-up": ArrowUpRight,
    "trend-down": ArrowDownLeft,
} as const satisfies Record<string, StaticIcon>;

export type IconName = keyof typeof ICON_REGISTRY;

/**
 * Which names have a motion variant.
 *
 * Statically importable on purpose: the seam has to answer "is this icon worth
 * loading the chunk for?" without loading the chunk. Kept honest by
 * iconRegistry.test.ts, which reads the variants directory off disk rather than
 * importing it (importing would drag `motion` into the test process and prove
 * nothing about the boundary).
 *
 * Every name absent from this list still renders — as its static glyph. That is
 * the designed halfway state, not a gap to be embarrassed about: an icon with
 * no good animation is better left still.
 */
export const ANIMATED_ICON_NAMES = [
    "dashboard",
    "purchases",
    "inventory",
    "sales",
    "contacts",
    "accounts",
    "taxation",
    "fixed-assets",
    "reports",
    "payroll",
    "audit-trail",
    "approvals",
    "ai-extractions",
    "bell",
    "settings",
    "search",
    "chevron-right",
    "plus",
    "panel-close",
    "panel-open",
    "more-vertical",
    "close-circle",
    "trash",
    "edit",
    "download",
    "refresh",
    "trend-up",
    "trend-down",
] as const satisfies readonly IconName[];

export type AnimatedIconName = (typeof ANIMATED_ICON_NAMES)[number];

const ANIMATED = new Set<string>(ANIMATED_ICON_NAMES);

export const hasVariant = (name: IconName): boolean => ANIMATED.has(name);
