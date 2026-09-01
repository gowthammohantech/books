import type { ReactNode } from "react";
import {
    Building2,
    Users,
    Percent,
    SlidersHorizontal,
    Palette,
    Boxes,
    CreditCard,
    Receipt,
    ShoppingBag,
    LandmarkIcon,
} from "lucide-react";

/**
 * The settings catalogue: one description of every settings destination.
 *
 * Two surfaces render it — the /settings landing page of grouped cards and the
 * settings shell's left nav — and the command palette flattens it into
 * searchable destinations. Adding an entry here lights up all three, which is
 * the whole reason it is a config array rather than markup repeated in each
 * place.
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

export type SettingsBand = {
    id: string;
    title: string;
    groups: SettingsGroup[];
};

export const settingsBands: SettingsBand[] = [
    {
        id: "organization",
        title: "Organization Settings",
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
                    { title: "AI Integration", to: "/settings/ai", slug: "ai" },
                ],
            },
            {
                id: "users-roles",
                title: "Users & Roles",
                icon: <Users size={16} />,
                links: [
                    { title: "Users", to: "/users", slug: "manage-users" },
                    {
                        title: "Roles & Permissions",
                        to: "/roles",
                        slug: "manage-users",
                    },
                    {
                        title: "User Preferences",
                        to: "/settings/profile",
                        slug: "general-settings",
                    },
                    {
                        title: "Activity Log",
                        to: "/activity-log",
                        slug: "activity-log",
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
                id: "setup",
                title: "Setup & Configurations",
                icon: <SlidersHorizontal size={16} />,
                links: [
                    {
                        title: "General",
                        to: "/settings/account",
                        slug: "general-settings",
                    },
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
        ],
    },
    {
        id: "module-settings",
        title: "Module Settings",
        groups: [
            {
                id: "module-general",
                title: "General",
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
                    {
                        title: "Accountant",
                        to: "/settings/accounting-integrations",
                        slug: null,
                    },
                ],
            },
            {
                id: "online-payments",
                title: "Online Payments",
                icon: <CreditCard size={16} />,
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
        ],
    },
];

/**
 * Catalogue paths that are a strict prefix of another catalogue path.
 *
 * NavLink matches by path segment, so without `end` the "Customer Payments"
 * row (/settings/payment-gateways) would also light up on its Razorpay and
 * Stripe children. Only those parents need it — "Taxes" has to stay
 * highlighted on /settings/tax-rates/new, which is not a catalogue entry.
 */
const PREFIX_PATHS: ReadonlySet<string> = (() => {
    const all = settingsBands.flatMap((band) =>
        band.groups.flatMap((group) => group.links.map((link) => link.to)),
    );
    return new Set(
        all.filter((path) =>
            all.some((other) => other !== path && other.startsWith(`${path}/`)),
        ),
    );
})();

/** Whether a catalogue link must match its path exactly to count as active. */
export const isExactSettingsLink = (to: string): boolean => PREFIX_PATHS.has(to);
