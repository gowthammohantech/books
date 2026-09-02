import { describe, expect, it } from 'vitest';
import { buildCommands, highlightRanges, rankCommands } from './commandPalette';
import type { NavItemType } from '@models/sidebar';
import type { PermissionSet } from '@models/permissions';
import { navItems } from './navigation';
import { applyModulePreferences, withIncluded } from './setupModules';

const perm = (slug: string, over: Partial<PermissionSet> = {}): PermissionSet => ({
    id: `p-${slug}`, roleId: 'r1', moduleId: `m-${slug}`, moduleName: slug, moduleSlug: slug,
    view: true, create: true, edit: true, delete: true, allowAll: false, ...over,
});

// No user fixture any more: gating is a pure function of the permission rows
// the server issued for the active workspace. There is no longer a kind of
// person the permission rows do not apply to.

const tree: NavItemType[] = [
    { type: 'link', to: '/', title: 'Dashboard', slug: 'dashboard' },
    {
        type: 'collapsible', id: 'sales', title: 'Sales', slug: 'sales', icon: null,
        children: [
            { type: 'link', to: '/invoices', title: 'Invoices', slug: 'invoices', addPath: '/invoices/create-invoice' },
            { type: 'link', to: '/credit-notes', title: 'Credit Notes', slug: 'credit-notes' },
            {
                type: 'collapsible', id: 'reports', title: 'Reports', slug: 'reports', icon: null,
                children: [
                    { type: 'link', to: '/reports/sales', title: 'Sales', slug: 'reports' },
                ],
            },
        ],
    },
    // Same `to` as its own list page: must not yield a redundant "New Budget" row.
    { type: 'link', to: '/budgets', title: 'Budgets', slug: 'accounting', addPath: '/budgets' },
];

const allPerms = ['dashboard', 'sales', 'invoices', 'credit-notes', 'reports', 'accounting'].map((s) => perm(s));
const build = (permissions = allPerms) => buildCommands(permissions, tree);
const titles = (permissions = allPerms) => build(permissions).map((c) => c.title);

describe('buildCommands', () => {
    it('flattens nested menus and records the ancestor breadcrumb', () => {
        const salesReport = build().find((c) => c.path === '/reports/sales');
        expect(salesReport?.group).toBe('Sales › Reports');
    });

    it('emits a create command for addPath, singularizing the label', () => {
        const create = build().find((c) => c.kind === 'create');
        expect(create).toMatchObject({ title: 'New Invoice', path: '/invoices/create-invoice' });
    });

    it('skips a create command whose addPath is the list page itself', () => {
        expect(titles()).not.toContain('New Budget');
    });

    it('hides a whole subtree when the parent menu is not viewable', () => {
        const noSales = allPerms.map((p) => (p.moduleSlug === 'sales' ? perm('sales', { view: false }) : p));
        expect(titles(noSales)).not.toContain('Invoices');
        expect(titles(noSales)).not.toContain('Credit Notes');
        expect(titles(noSales)).toContain('Dashboard');
    });

    it('keeps the page but drops the create action without create permission', () => {
        const viewOnly = allPerms.map((p) => (p.moduleSlug === 'invoices' ? perm('invoices', { create: false }) : p));
        expect(titles(viewOnly)).toContain('Invoices');
        expect(titles(viewOnly)).not.toContain('New Invoice');
    });

    it('always appends the account destinations that have no sidebar entry', () => {
        expect(titles()).toContain('Log Out');
    });

    it('includes routable pages the sidebar omits', () => {
        // These have no menu entry at all, so the palette is the only way to
        // reach them by keyboard — regressing this is how modules go missing.
        const all = titles();
        expect(all).toContain('Expense Categories');
        expect(all).toContain('Account Settings');
    });

    it('gates the sidebar-less pages on the slug their route guard uses', () => {
        const noExpenses = allPerms
            .filter((p) => p.moduleSlug !== 'expenses')
            .concat(perm('expenses', { view: false }));
        expect(titles(noExpenses)).not.toContain('Expense Categories');
        // ...while the ungated account destinations survive.
        expect(titles(noExpenses)).toContain('Log Out');
    });
});

describe('coverage of the real sidebar tree', () => {
    // Guards against the palette silently drifting behind the menu: every
    // top-level module must be reachable. Passing NO permission rows exercises
    // canView's fail-open branch, which is what makes this a coverage check of
    // the tree rather than of the gating.
    const superAdminCommands = buildCommands([]);

    it.each([
        'Dashboard', 'Parties', 'Invoices', 'Quotations', 'Purchases',
        'Purchase Orders', 'Debit Notes', 'Credit Notes', 'Items', 'Inventory',
        'Banking', 'Expenses', 'Petty Cash', 'Chart of Accounts',
        'Journal Entries', 'Budgets', 'Fixed Assets', 'Payroll Profiles',
        'Pay Runs', 'Time Tracking', 'Holidays', 'Users', 'Roles & Permissions',
        'Audit Trail', 'Company Settings', 'Email Settings', 'Bank Accounts',
        'Currencies', 'Vehicles', 'Delivery Challans',
    ])('reaches %s', (title) => {
        expect(superAdminCommands.map((c) => c.title)).toContain(title);
    });

    it('covers the whole tree, not a truncated slice of it', () => {
        expect(superAdminCommands.length).toBeGreaterThan(100);
    });
});

describe('module preferences', () => {
    // The palette used to decide whether to append the report and settings
    // catalogues by testing `items === navItems`. A module-filtered tree is a
    // COPY of the real tree, so that identity test failed and every report and
    // settings destination silently vanished from the palette. The
    // `includeCatalogues` flag exists to say so explicitly.
    const filtered = applyModulePreferences(navItems, withIncluded(['sales']));

    it('keeps the report and settings catalogues when handed a filtered tree', () => {
        const titles = buildCommands([], filtered, true).map((c) => c.title);
        expect(titles).toContain('Company Settings');
        expect(titles).toContain('Email Settings');
        // A report that lives only in the report catalogue, never in navItems.
        expect(titles).toContain('Trial Balance');
    });

    it('would drop them without the flag - which is why the flag is passed', () => {
        const titles = buildCommands([], filtered).map((c) => c.title);
        expect(titles).not.toContain('Company Settings');
    });

    it('stops offering a module the workspace switched off', () => {
        // Assert on PATHS, not titles. "Purchase Orders" is also the name of a
        // Settings > Module Settings page (/settings/module-settings/
        // purchase-order), which is a settings destination and stays reachable
        // no matter which operational modules are switched off.
        const paths = buildCommands([], filtered, true).map((c) => c.path);
        expect(paths).toContain('/invoices');
        expect(paths).not.toContain('/purchase-orders');
        expect(paths).not.toContain('/purchases');
        expect(paths).not.toContain('/payroll/pay-runs');
    });

    it('keeps the Settings pages of a switched-off module - Settings is its own area', () => {
        const paths = buildCommands([], filtered, true).map((c) => c.path);
        expect(paths).toContain('/settings/module-settings/purchase-order');
    });

    it('still appends the catalogues by default for the unfiltered tree', () => {
        // applyModulePreferences returns navItems by reference when there is no
        // preference, so the historic default keeps working untouched.
        expect(applyModulePreferences(navItems, null)).toBe(navItems);
        expect(buildCommands([], applyModulePreferences(navItems, null)).map((c) => c.title))
            .toContain('Company Settings');
    });
});

describe('rankCommands', () => {
    const commands = build();
    const top = (query: string, recents: string[] = []) =>
        rankCommands(commands, query, recents)[0]?.command.title;

    it('an empty query lists recents first, then nav order', () => {
        const ranked = rankCommands(commands, '', ['nav:/credit-notes']);
        expect(ranked[0].command.title).toBe('Credit Notes');
        expect(ranked[1].command.title).toBe('Dashboard');
    });

    it('prefers an exact title over a partial one', () => {
        expect(top('invoices')).toBe('Invoices');
    });

    it('ranks the page above its own create action', () => {
        const ranked = rankCommands(commands, 'invoice', []);
        expect(ranked.map((r) => r.command.title).slice(0, 2)).toEqual(['Invoices', 'New Invoice']);
    });

    it('matches an initials-style subsequence', () => {
        expect(top('crno')).toBe('Credit Notes');
    });

    it('requires every token to match, so a multi-word query narrows', () => {
        const results = rankCommands(commands, 'sales report', []);
        expect(results.map((r) => r.command.path)).toEqual(['/reports/sales']);
    });

    it('matches on keywords that are not in the visible title', () => {
        // "receivables" is a registered synonym for the invoices list.
        expect(rankCommands(commands, 'receivables', []).map((r) => r.command.path))
            .toContain('/invoices');
    });

    it('returns nothing when no command matches', () => {
        expect(rankCommands(commands, 'zzzzqq', [])).toEqual([]);
    });

    it('lets a recent command break a tie without overriding a better match', () => {
        // "Credit Notes" is recent but "Invoices" is an exact title match.
        expect(top('invoices', ['nav:/credit-notes'])).toBe('Invoices');
    });
});

describe('highlightRanges', () => {
    it('returns the matched run of a contiguous match', () => {
        expect(highlightRanges('Credit Notes', 'note')).toEqual([[7, 11]]);
    });

    it('merges overlapping token matches into one run', () => {
        expect(highlightRanges('Invoices', 'inv invo')).toEqual([[0, 4]]);
    });

    it('returns nothing for a subsequence-only match, rather than speckling', () => {
        expect(highlightRanges('Credit Notes', 'crno')).toEqual([]);
    });

    it('returns nothing for an empty query', () => {
        expect(highlightRanges('Invoices', '   ')).toEqual([]);
    });
});
