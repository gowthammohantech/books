import { describe, expect, it } from 'vitest';
import { buildCommands, highlightRanges, rankCommands } from './commandPalette';
import type { NavItemType } from '@models/sidebar';
import type { PermissionSet } from '@models/permissions';

const perm = (slug: string, over: Partial<PermissionSet> = {}): PermissionSet => ({
    id: `p-${slug}`, roleId: 'r1', moduleId: `m-${slug}`, moduleName: slug, moduleSlug: slug,
    view: true, create: true, edit: true, delete: true, allowAll: false, ...over,
});

// No user fixture any more: gating is a pure function of the permission rows
// the server issued for the active workspace. There is no longer a kind of
// person the permission rows do not apply to.

const tree: NavItemType[] = [
    { type: 'link', to: '/admin', title: 'Dashboard', slug: 'dashboard' },
    {
        type: 'collapsible', id: 'sales', title: 'Sales', slug: 'sales', icon: null,
        children: [
            { type: 'link', to: '/admin/invoices', title: 'Invoices', slug: 'invoices', addPath: '/admin/invoices/create-invoice' },
            { type: 'link', to: '/admin/credit-notes', title: 'Credit Notes', slug: 'credit-notes' },
            {
                type: 'collapsible', id: 'reports', title: 'Reports', slug: 'reports', icon: null,
                children: [
                    { type: 'link', to: '/admin/reports/sales', title: 'Sales', slug: 'reports' },
                ],
            },
        ],
    },
    // Same `to` as its own list page: must not yield a redundant "New Budget" row.
    { type: 'link', to: '/admin/budgets', title: 'Budgets', slug: 'accounting', addPath: '/admin/budgets' },
];

const allPerms = ['dashboard', 'sales', 'invoices', 'credit-notes', 'reports', 'accounting'].map((s) => perm(s));
const build = (permissions = allPerms) => buildCommands(permissions, tree);
const titles = (permissions = allPerms) => build(permissions).map((c) => c.title);

describe('buildCommands', () => {
    it('flattens nested menus and records the ancestor breadcrumb', () => {
        const salesReport = build().find((c) => c.path === '/admin/reports/sales');
        expect(salesReport?.group).toBe('Sales › Reports');
    });

    it('emits a create command for addPath, singularizing the label', () => {
        const create = build().find((c) => c.kind === 'create');
        expect(create).toMatchObject({ title: 'New Invoice', path: '/admin/invoices/create-invoice' });
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
        expect(all).toContain('Sales Dashboard');
        expect(all).toContain('Accounts Dashboard');
        expect(all).toContain('Expenses Dashboard');
        expect(all).toContain('Expense Categories');
        expect(all).toContain('Account Settings');
    });

    it('gates the sidebar-less pages on the slug their route guard uses', () => {
        const noDashboard = allPerms
            .filter((p) => p.moduleSlug !== 'dashboard')
            .concat(perm('dashboard', { view: false }));
        expect(titles(noDashboard)).not.toContain('Sales Dashboard');
        // ...while the ungated account destinations survive.
        expect(titles(noDashboard)).toContain('Log Out');
    });
});

describe('coverage of the real sidebar tree', () => {
    // Guards against the palette silently drifting behind the menu: every
    // top-level module must be reachable. Passing NO permission rows exercises
    // canView's fail-open branch, which is what makes this a coverage check of
    // the tree rather than of the gating.
    const superAdminCommands = buildCommands([]);

    it.each([
        'Dashboard', 'Contacts', 'Invoices', 'Quotations', 'Purchases',
        'Purchase Orders', 'Debit Notes', 'Credit Notes', 'Items', 'Inventory',
        'Banking', 'Expenses', 'Petty Cash', 'Chart of Accounts',
        'Journal Entries', 'Budgets', 'Fixed Assets', 'Payroll Profiles',
        'Pay Runs', 'Time Tracking', 'Holidays', 'Users', 'Roles & Permissions',
        'Activity Log', 'Company Settings', 'Email Settings', 'Bank Accounts',
        'Currencies', 'Vehicles', 'Delivery Challans',
    ])('reaches %s', (title) => {
        expect(superAdminCommands.map((c) => c.title)).toContain(title);
    });

    it('covers the whole tree, not a truncated slice of it', () => {
        expect(superAdminCommands.length).toBeGreaterThan(100);
    });
});

describe('rankCommands', () => {
    const commands = build();
    const top = (query: string, recents: string[] = []) =>
        rankCommands(commands, query, recents)[0]?.command.title;

    it('an empty query lists recents first, then nav order', () => {
        const ranked = rankCommands(commands, '', ['nav:/admin/credit-notes']);
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
        expect(results.map((r) => r.command.path)).toEqual(['/admin/reports/sales']);
    });

    it('matches on keywords that are not in the visible title', () => {
        // "receivables" is a registered synonym for the invoices list.
        expect(rankCommands(commands, 'receivables', []).map((r) => r.command.path))
            .toContain('/admin/invoices');
    });

    it('returns nothing when no command matches', () => {
        expect(rankCommands(commands, 'zzzzqq', [])).toEqual([]);
    });

    it('lets a recent command break a tie without overriding a better match', () => {
        // "Credit Notes" is recent but "Invoices" is an exact title match.
        expect(top('invoices', ['nav:/admin/credit-notes'])).toBe('Invoices');
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
