import { describe, expect, it } from 'vitest';

import {
    buildNavModules,
    findActiveNavRoute,
    matchesNavRoute,
    moduleRoutes,
} from './navModules';
import type { PermissionSet } from '@models/permissions';

// No permission rows: canView fails open, so this is the full tree.
const modules = buildNavModules([]);
const moduleFor = (id: string) => {
    const found = modules.find((navModule) => navModule.id === id);
    if (!found) throw new Error(`no module ${id}`);
    return found;
};

describe('buildNavModules', () => {
    it('makes one rail entry per top-level nav entry', () => {
        expect(modules.map((navModule) => navModule.id)).toContain('accounts');
        expect(modules.map((navModule) => navModule.id)).toContain('/reports');
    });

    it('leads a module with its own links, uncaptioned', () => {
        const [first] = moduleFor('accounts').sections;
        expect(first.caption).toBeUndefined();
        expect(first.items.map((item) => item.title)).toContain('Chart of Accounts');
    });

    it('leaves no menu inside a menu in the shipped tree', () => {
        // Financial Statements and Finance Reports were the last two, and their
        // eleven paths are indexed by the Reports Center now. Nothing in the
        // rail should reintroduce a level the panel has to caption around.
        const captions = modules.flatMap((navModule) =>
            navModule.sections.map((section) => section.caption).filter(Boolean)
        );
        expect(captions).toEqual([]);
    });

    it('demotes a nested menu to a captioned section, not another accordion', () => {
        // Against a fixture: the rule outlives the tree that needed it, so it is
        // pinned here rather than left untested until a menu grows a submenu.
        const [navModule] = buildNavModules([], [
            { type: 'header', title: 'Finance', slug: 'band-finance' },
            {
                type: 'collapsible',
                id: 'ledger',
                icon: null,
                title: 'Ledger',
                slug: 'accounting',
                children: [
                    { type: 'link', to: '/journals', title: 'Journals', slug: 'accounting' },
                    {
                        type: 'collapsible',
                        id: 'statements',
                        icon: null,
                        title: 'Statements',
                        slug: 'accounting',
                        children: [
                            { type: 'link', to: '/pl', title: 'P&L', slug: 'accounting' },
                        ],
                    },
                ],
            },
        ]);

        expect(navModule.sections).toEqual([
            { items: [{ type: 'link', to: '/journals', title: 'Journals', slug: 'accounting' }] },
            {
                caption: 'Statements',
                items: [{ type: 'link', to: '/pl', title: 'P&L', slug: 'accounting' }],
            },
        ]);
    });

    it('gives a plain link no panel, so the rail has nothing to fly out', () => {
        // Dashboard and the Oversight links are destinations, not menus: a
        // flyout on hover would be a menu nobody asked for.
        expect(moduleFor('/').sections).toEqual([]);
        expect(moduleFor('/activity-log').sections).toEqual([]);
        expect(moduleFor('/reports').sections).toEqual([]);
    });

    it('carries the band through so the rail can rule between groups', () => {
        expect(moduleFor('sales').band).toBe('Operations');
        expect(moduleFor('taxation').band).toBe('Finance');
    });

    it('drops a module the role cannot see', () => {
        const noPayroll: PermissionSet[] = [
            {
                id: 'p1',
                roleId: 'r1',
                moduleId: 'm1',
                moduleName: 'Payroll',
                moduleSlug: 'payroll',
                allowAll: false,
                view: false,
                create: false,
                edit: false,
                delete: false,
            },
        ];
        const ids = buildNavModules(noPayroll).map((navModule) => navModule.id);
        expect(ids).not.toContain('payroll');
    });
});

describe('matchesNavRoute', () => {
    it('does not let a route own its longer-named neighbour', () => {
        expect(matchesNavRoute('/purchases', '/purchases-archive')).toBe(false);
        expect(matchesNavRoute('/purchases', '/purchases/42')).toBe(true);
    });

    it('honours exact for a route that prefixes a sibling', () => {
        expect(matchesNavRoute('/banking', '/banking/transactions', true)).toBe(false);
    });

    it('treats "/" as the dashboard, not as everything', () => {
        expect(matchesNavRoute('/', '/')).toBe(true);
        expect(matchesNavRoute('/', '/dashboard/sales')).toBe(true);
        expect(matchesNavRoute('/', '/invoices')).toBe(false);
    });
});

describe('findActiveNavRoute', () => {
    it('lights up the module a destination belongs to', () => {
        expect(findActiveNavRoute(modules, '/accounting/journal-entries')).toEqual({
            moduleId: 'accounts',
            to: '/accounting/journal-entries',
        });
    });

    it('claims no rail module for a report that only the catalogue lists', () => {
        // /reports is where these live now, and the Reports Center is a module
        // of its own - the accounting rail entry must not light up for them.
        expect(findActiveNavRoute(modules, '/accounting/reports/ap-aging')).toBeNull();
    });

    it('prefers the most specific route, not the first prefix match', () => {
        expect(findActiveNavRoute(modules, '/inventory/cost-layers')).toEqual({
            moduleId: 'products-inventory',
            to: '/inventory/cost-layers',
        });
    });

    it('keeps a detail route on the list it came from', () => {
        expect(findActiveNavRoute(modules, '/invoices/edit/42')?.to).toBe('/invoices');
    });

    it('credits a plain link with itself, not with its band siblings', () => {
        // Reports and Fixed Assets share a panel; only one of them owns /reports.
        expect(findActiveNavRoute(modules, '/reports')?.moduleId).toBe('/reports');
    });

    it('returns nothing rather than guessing at an unlisted route', () => {
        expect(findActiveNavRoute(modules, '/no/such/page')).toBeNull();
    });
});

describe('moduleRoutes', () => {
    it('sums a menu over everything inside it', () => {
        expect(moduleRoutes(moduleFor('sales'))).toContain('/invoices');
        expect(moduleRoutes(moduleFor('sales'))).toContain('/quotations');
    });

    it('sums a plain link over itself alone', () => {
        expect(moduleRoutes(moduleFor('/activity-log'))).toEqual(['/activity-log']);
    });
});
