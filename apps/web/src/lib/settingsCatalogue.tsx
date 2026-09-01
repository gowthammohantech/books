import type { ReactNode } from "react";
import {
    Building2,
    Users,
    Percent,
    SlidersHorizontal,
    Palette,
    Boxes,
    Plug,
    Receipt,
    ShoppingBag,
    LandmarkIcon,
    CircleUser,
} from "lucide-react";

import { canView } from "./navigation";
import type { PermissionSet } from "@models/permissions";

/**
 * The settings catalogue: one description of every settings destination.
 *
 * Three surfaces render it — the /settings landing page of grouped cards, the
 * settings shell's left rail and the flyouts that rail opens — and the command
 * palette flattens it into searchable destinations. Adding an entry here
 * lights up all of them, which is the whole reason it is a config array rather
 * than markup repeated in each place.
 *
 * The top level is a TAB, not a heading. Settings divide into what the product
 * does (General) and who the company is and what it is wired to (Workspace),
 * because those are answered by different people on different days; a tab
 * halves the rail instead of asking everyone to scroll past the other half.
 * One group is one flyout.
 *
 * `slug` is the module permission the destination's route guard uses, so both
 * filters agree with the router. `slug: null` means the route carries no
 * guard: any signed-in user can reach it.
 */

export type SettingsLink = {
    title: string;
    to: string;
    slug: string | null;
};

export type SettingsGroup = {
    id: string;
    title: string;
    icon: ReactNode;
    links: SettingsLink[];
};

export type SettingsTabId = "general" | "workspace";

export type SettingsTab = {
    id: SettingsTabId;
    title: string;
    groups: SettingsGroup[];
};

export const settingsTabs: SettingsTab[] = [
    {
        id: "general",
        title: "General",
        groups: [
            {
                id: "setup",
                title: "Setup & Configurations",
                icon: <SlidersHorizontal size={16} />,
                links: [
                    {
                        title: "Currencies",
                        to: "/settings/currencies",
                        slug: "finance-settings",
                    },
                    {
                        title: "Opening Balances",
                        to: "/settings/ledger-setup",
                        slug: "finance-settings",
                    },
                    {
                        title: "Document Defaults",
                        to: "/settings/document-defaults",
                        slug: "finance-settings",
                    },
                    {
                        title: "Reminders",
                        to: "/settings/reminders",
                        slug: "system-settings",
                    },
                ],
            },
            {
                id: "taxes-compliance",
                title: "Taxes & Compliance",
                icon: <Percent size={16} />,
                links: [
                    {
                        title: "Taxes",
                        to: "/settings/tax-rates",
                        slug: "finance-settings",
                    },
                ],
            },
            {
                id: "customization",
                title: "Customization",
                icon: <Palette size={16} />,
                links: [
                    {
                        title: "PDF Templates",
                        to: "/invoice-templates",
                        slug: "invoices",
                    },
                    {
                        title: "Email Settings",
                        to: "/settings/email-settings",
                        slug: "system-settings",
                    },
                    {
                        title: "Email Notifications",
                        to: "/settings/email-templates",
                        slug: "system-settings",
                    },
                    {
                        title: "SMS Notifications",
                        to: "/settings/messaging",
                        slug: null,
                    },
                    {
                        title: "Digital Signature",
                        to: "/settings/signatures",
                        slug: "system-settings",
                    },
                ],
            },
            {
                id: "module-general",
                title: "Items & Catalogue",
                icon: <Boxes size={16} />,
                links: [
                    {
                        title: "Items",
                        to: "/settings/module-settings/product",
                        slug: "module-settings",
                    },
                    {
                        title: "Categories",
                        to: "/settings/module-settings/category",
                        slug: "module-settings",
                    },
                    {
                        title: "Brands",
                        to: "/settings/module-settings/brand",
                        slug: "module-settings",
                    },
                    {
                        title: "Units",
                        to: "/settings/module-settings/unit",
                        slug: "module-settings",
                    },
                ],
            },
            {
                id: "module-sales",
                title: "Sales",
                icon: <Receipt size={16} />,
                links: [
                    {
                        title: "Quotes",
                        to: "/settings/module-settings/quotations",
                        slug: "module-settings",
                    },
                    {
                        title: "Invoices",
                        to: "/settings/module-settings/invoice",
                        slug: "module-settings",
                    },
                ],
            },
            {
                id: "module-purchases",
                title: "Purchases",
                icon: <ShoppingBag size={16} />,
                links: [
                    {
                        title: "Expenses",
                        to: "/settings/module-settings/expense",
                        slug: "module-settings",
                    },
                    {
                        title: "Purchase Orders",
                        to: "/settings/module-settings/purchase-order",
                        slug: "module-settings",
                    },
                    {
                        title: "Bills",
                        to: "/settings/module-settings/purchase",
                        slug: "module-settings",
                    },
                ],
            },
        ],
    },
    {
        id: "workspace",
        title: "Workspace",
        groups: [
            {
                id: "organization-profile",
                title: "Organization",
                icon: <Building2 size={16} />,
                links: [
                    {
                        title: "Company Settings",
                        to: "/settings/company-settings",
                        slug: "website-settings",
                    },
                    {
                        title: "Localization",
                        to: "/settings/localization",
                        slug: "website-settings",
                    },
                ],
            },
            {
                id: "people-access",
                title: "People & Access",
                icon: <Users size={16} />,
                links: [
                    { title: "Users", to: "/users", slug: "manage-users" },
                    {
                        title: "Roles & Permissions",
                        to: "/roles",
                        slug: "manage-users",
                    },
                    {
                        title: "Activity Log",
                        to: "/activity-log",
                        slug: "activity-log",
                    },
                ],
            },
            {
                id: "module-banking",
                title: "Banking",
                icon: <LandmarkIcon size={16} />,
                links: [
                    {
                        title: "Bank Accounts",
                        to: "/settings/bank-accounts",
                        slug: "finance-settings",
                    },
                    {
                        title: "Transaction Categories",
                        to: "/settings/transaction-categories",
                        slug: "finance-settings",
                    },
                ],
            },
            {
                id: "integrations",
                title: "Integrations",
                icon: <Plug size={16} />,
                links: [
                    {
                        title: "Customer Payments",
                        to: "/settings/payment-gateways",
                        slug: null,
                    },
                    {
                        title: "Razorpay",
                        to: "/settings/payment-gateways/razorpay",
                        slug: null,
                    },
                    {
                        title: "Stripe",
                        to: "/settings/payment-gateways/stripe",
                        slug: null,
                    },
                    {
                        title: "Accountant",
                        to: "/settings/accounting-integrations",
                        slug: null,
                    },
                    { title: "AI Integration", to: "/settings/ai", slug: "ai" },
                ],
            },
        ],
    },
];

/**
 * The signed-in user's own settings.
 *
 * Deliberately outside the tabs: nothing in here configures the company, so
 * filing it under General or Workspace would put a personal preference under
 * an organization heading. It sits below the tabbed rail, pinned, the way the
 * app sidebar pins Settings and Get Help.
 */
export const accountGroup: SettingsGroup = {
    id: "my-account",
    title: "My Account",
    icon: <CircleUser size={16} />,
    links: [
        { title: "Profile", to: "/settings/profile", slug: "general-settings" },
        {
            title: "Account & Data",
            to: "/settings/account",
            slug: "general-settings",
        },
    ],
};

/** Every group the catalogue holds, tabs first, then the account group. */
export const allSettingsGroups: SettingsGroup[] = [
    ...settingsTabs.flatMap((tab) => tab.groups),
    accountGroup,
];

/**
 * Catalogue paths that are a strict prefix of another catalogue path.
 *
 * Matched by path segment alone, the "Customer Payments" row
 * (/settings/payment-gateways) would also light up on its Razorpay and Stripe
 * children. Only those parents need the exact rule — "Taxes" has to stay
 * highlighted on /settings/tax-rates/new, which is not a catalogue entry.
 */
const PREFIX_PATHS: ReadonlySet<string> = (() => {
    const all = allSettingsGroups.flatMap((group) =>
        group.links.map((link) => link.to),
    );
    return new Set(
        all.filter((path) =>
            all.some((other) => other !== path && other.startsWith(`${path}/`)),
        ),
    );
})();

/** Whether a catalogue link must match its path exactly to count as active. */
export const isExactSettingsLink = (to: string): boolean => PREFIX_PATHS.has(to);

/**
 * Whether `pathname` is at, or inside, the destination `to`.
 *
 * One rule behind every active state in the settings shell: the rail's group
 * highlight, the row inside a flyout, and which tab a deep link opens on.
 */
export const isSettingsLinkActive = (to: string, pathname: string): boolean =>
    pathname === to || (!isExactSettingsLink(to) && pathname.startsWith(`${to}/`));

/** The tab holding `pathname`, or null when the route is not in the catalogue. */
export const findSettingsTab = (pathname: string): SettingsTabId | null =>
    settingsTabs.find((tab) =>
        tab.groups.some((group) =>
            group.links.some((link) => isSettingsLinkActive(link.to, pathname)),
        ),
    )?.id ?? null;

/**
 * Drops the destinations this user cannot reach, then any group left with
 * nothing in it — an empty card, or a flyout of nothing, is worse than no row.
 */
export const visibleGroups = (
    groups: SettingsGroup[],
    permissions: PermissionSet[],
): SettingsGroup[] =>
    groups
        .map((group) => ({
            ...group,
            // `slug: null` is an ungated route: always show it.
            links: group.links.filter(
                (link) => link.slug === null || canView(link.slug, permissions),
            ),
        }))
        .filter((group) => group.links.length > 0);

/** The same filter across the tabs, dropping any tab left empty. */
export const visibleSettingsTabs = (
    permissions: PermissionSet[],
): SettingsTab[] =>
    settingsTabs
        .map((tab) => ({ ...tab, groups: visibleGroups(tab.groups, permissions) }))
        .filter((tab) => tab.groups.length > 0);
