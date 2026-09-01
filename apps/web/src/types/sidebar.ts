import type { ReactNode } from "react";

export type NavLinkItem = {
    type: 'link';
    to: string;
    title: string;
    slug: string;
    icon?: ReactNode;
    addPath?: string;
    /** Match active on the exact path only (not sub-routes). Use when this
     *  link's `to` is a prefix of a sibling link (e.g. /banking vs
     *  /banking/transactions) so both don't highlight at once. */
    exact?: boolean;
};

export type NavCollapsibleItem = {
    type: 'collapsible';
    id: string;
    icon: ReactNode;
    title: string;
    slug: string;
    children: (NavLinkItem | NavCollapsibleItem)[]; // Recursive type
    addPath?: string;
};

export type NavHeaderItem = { type: 'header'; title: string, slug: string };

export type NavItemType = NavLinkItem | NavCollapsibleItem | NavHeaderItem;
