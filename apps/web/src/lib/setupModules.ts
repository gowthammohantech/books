import { parseSetupModuleKeys, type BusinessType, type SetupModuleKey } from "@elixirbooks/enums";

import { navItems } from "./navigation";
import type { NavItemType } from "@models/sidebar";
import type { IconName } from "@components/icons/iconRegistry";

export type { BusinessType, SetupModuleKey };

/**
 * The module catalogue the setup wizard offers, and the filter that makes the
 * choice visible in the sidebar.
 *
 * WHAT THIS IS NOT. It is not access control. Unticking a module hides its rail
 * entry and its command-palette rows; the routes still resolve and the API still
 * answers. Access is Role/Permission (`canView`), and this deliberately writes
 * none of it - the wizard should not be able to lock someone out of a module on
 * day one, and Settings > Roles & Permissions stays the one place that can.
 *
 * WHY THE CATALOGUE POINTS AT NAV IDS, NOT PERMISSION SLUGS. A nav entry's
 * `slug` is its PERMISSION key, and permission keys are shared: `accounting` is
 * carried by Taxation, Fixed Assets AND Approvals (plus Budgets, Projects and
 * Cost Centers inside Taxation). Filtering by slug would take all of them out
 * when a user unticks one card. The pair (`NavCollapsibleItem.id`,
 * `NavLinkItem.to`) IS unique per top-level entry, and it is already the
 * identity `buildNavModules` gives each rail module - so the catalogue names the
 * same thing the rail does, and `setupModules.test.ts` can assert every name
 * still resolves.
 */

/**
 * `included` is on for everyone and cannot be unticked - the books do not work
 * without them. `recommended`/`optional` describe the preset, NOT a price tier:
 * `Tenant.plan` exists but nothing enforces it, and dressing these as
 * entitlements would imply a paywall that does not exist.
 */
export type SetupModuleTier = "included" | "recommended" | "optional";

export interface SetupModuleGroup {
    key: SetupModuleKey;
    label: string;
    blurb: string;
    tier: SetupModuleTier;
    /**
     * False when the product does not have this module yet. Such a card is
     * rendered locked rather than hidden, so the wizard tells the truth about
     * what is coming instead of quietly disagreeing with the marketing. An
     * unavailable group owns no nav ids and is excluded from every preset.
     */
    available: boolean;
    /** Top-level `NavCollapsibleItem.id` / `NavLinkItem.to` this group owns. */
    navIds: string[];
    /**
     * `AnimatedIcon` registry name, or null for a group with no module yet.
     * Typed against the registry so re-glyphing a module cannot leave the
     * wizard pointing at a name that no longer exists.
     */
    icon: IconName | null;
}

export const SETUP_MODULE_GROUPS: SetupModuleGroup[] = [
    {
        key: "accounts",
        label: "Accounts & Ledgers",
        blurb: "Double-entry books, banking, journals",
        tier: "included",
        available: true,
        navIds: ["accounts"],
        icon: "accounts",
    },
    {
        key: "taxation",
        label: "GST & Taxation",
        blurb: "GSTR-1 / 3B, tax returns and reports",
        tier: "included",
        available: true,
        navIds: ["taxation"],
        icon: "taxation",
    },
    {
        key: "auditTrail",
        label: "Audit Trail",
        blurb: "MCA-compliant change log",
        tier: "included",
        available: true,
        navIds: ["/activity-log"],
        icon: "audit-trail",
    },
    {
        key: "sales",
        label: "Sales & Receivables",
        blurb: "Quotation to Delivery Challan to Invoice, e-invoice / IRN",
        tier: "recommended",
        available: true,
        navIds: ["sales"],
        icon: "sales",
    },
    {
        key: "purchases",
        label: "Purchase & Payables",
        blurb: "Purchase orders, bills, supplier ledgers",
        tier: "optional",
        available: true,
        navIds: ["purchases"],
        icon: "purchases",
    },
    {
        key: "inventory",
        label: "Inventory",
        blurb: "Items, stock on hand, FIFO cost layers",
        tier: "optional",
        available: true,
        navIds: ["products-inventory"],
        icon: "inventory",
    },
    {
        key: "fixedAssets",
        label: "Fixed Assets",
        blurb: "Asset register, depreciation",
        tier: "optional",
        available: true,
        navIds: ["/accounting/fixed-assets"],
        icon: "fixed-assets",
    },
    {
        key: "projects",
        label: "Projects & Timesheets",
        blurb: "Track billable engagements",
        tier: "recommended",
        available: true,
        navIds: ["payroll"],
        icon: "payroll",
    },
    // ---- Not built yet. Shown locked; see documentation/product/erp-roadmap.md.
    {
        key: "production",
        label: "Production & BOM",
        blurb: "Bill of materials, work orders",
        tier: "optional",
        // Phase 2 of the roadmap, and gated behind the warehouse work in
        // Phase 1. There are no BOM or work-order routes to reveal.
        available: false,
        navIds: [],
        icon: null,
    },
    {
        key: "serviceBilling",
        label: "Service Billing",
        blurb: "Retainer & time invoices, SAC codes",
        tier: "recommended",
        // Retainers bill through Recurring Invoices today; there is no separate
        // Service Billing module to switch on.
        available: false,
        navIds: [],
        icon: null,
    },
];

const BY_KEY = new Map(SETUP_MODULE_GROUPS.map((g) => [g.key, g]));

/** Always on, never offered - unticking the books is not a choice. */
export const INCLUDED_KEYS: SetupModuleKey[] = SETUP_MODULE_GROUPS.filter(
    (g) => g.tier === "included"
).map((g) => g.key);

/** Offerable = exists in the product. Locked cards are never in a preset. */
export const SELECTABLE_KEYS: SetupModuleKey[] = SETUP_MODULE_GROUPS.filter(
    (g) => g.available
).map((g) => g.key);

/**
 * What each kind of business gets ticked on arrival, and what "Skip - use
 * recommended" commits.
 *
 * A services firm holds no stock and buys little, so Inventory and Purchases
 * start off; a manufacturer and a distributor both need them. Every preset is a
 * starting point, not a restriction - step 3 is editable, and so is Settings.
 */
export const PRESETS: Record<BusinessType, SetupModuleKey[]> = {
    MANUFACTURING: [...INCLUDED_KEYS, "sales", "purchases", "inventory", "fixedAssets"],
    TRADING: [...INCLUDED_KEYS, "sales", "purchases", "inventory"],
    SERVICES: [...INCLUDED_KEYS, "sales", "projects"],
};

/** The identity `buildNavModules` gives a top-level entry, or null for a band. */
const navIdOf = (item: NavItemType): string | null => {
    if (item.type === "header") return null;
    return item.type === "collapsible" ? item.id : item.to;
};

/**
 * Drop the top-level nav entries the workspace switched off.
 *
 * Returns `items` BY REFERENCE when there is no preference. That is load-
 * bearing, not an optimisation: `buildCommands` decides whether to append the
 * report and settings catalogues by testing `items === navItems`, so a
 * workspace that never chose modules must get the very same array back.
 *
 * Fails OPEN, like `canView`: an entry no group claims (Dashboard, Parties,
 * Reports, Approvals) is always kept. A new nav module is therefore visible
 * until someone deliberately adds it to the catalogue, rather than vanishing
 * from every existing workspace the day it ships.
 */
export const applyModulePreferences = (
    items: NavItemType[],
    enabled?: SetupModuleKey[] | null
): NavItemType[] => {
    if (!enabled || enabled.length === 0) return items;

    const on = new Set(enabled);
    const hidden = new Set<string>();
    for (const group of SETUP_MODULE_GROUPS) {
        if (group.tier === "included" || on.has(group.key)) continue;
        for (const navId of group.navIds) hidden.add(navId);
    }
    if (hidden.size === 0) return items;

    return items.filter((item) => {
        const navId = navIdOf(item);
        return navId === null || !hidden.has(navId);
    });
};

/**
 * Narrow whatever came back from the API to keys this build still knows.
 *
 * Shared with the API through @elixirbooks/enums, so a payload the server
 * accepted is a payload the sidebar can read.
 */
export const parseEnabledModules = parseSetupModuleKeys;

/**
 * Everything the wizard should commit for a given tick-set: the included
 * groups whether or not they were passed, and no group this build cannot
 * actually show.
 */
export const withIncluded = (keys: SetupModuleKey[]): SetupModuleKey[] => {
    const out = new Set<SetupModuleKey>(INCLUDED_KEYS);
    for (const key of keys) {
        if (BY_KEY.get(key)?.available) out.add(key);
    }
    return SETUP_MODULE_GROUPS.filter((g) => out.has(g.key)).map((g) => g.key);
};

/** Every top-level nav id the catalogue claims - used by the tests. */
export const claimedNavIds = (): string[] => SETUP_MODULE_GROUPS.flatMap((g) => g.navIds);

/** Top-level nav ids no group claims. Always visible. */
export const unclaimedNavIds = (items: NavItemType[] = navItems): string[] => {
    const claimed = new Set(claimedNavIds());
    return items
        .map(navIdOf)
        .filter((id): id is string => id !== null && !claimed.has(id));
};
