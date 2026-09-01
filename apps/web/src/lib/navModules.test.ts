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

    it('demotes a nested menu to a captioned section, not another accordion', () => {
        const captions = moduleFor('accounts')
            .sections.map((section) => section.caption)
            .filter(Boolean);
        expect(captions).toEqual(['Financial Statements', 'Finance Reports']);

        const reports = moduleFor('accounts').sections.find(
            (section) => section.caption === 'Finance Reports'
        );
        expect(reports?.items.map((item) => item.title)).toContain('AP Aging');
    });

    it('shows a plain link its band rather than an empty panel', () => {
        const auditTrail = moduleFor('/activity-log');
        expect(auditTrail.panelTitle).toBe('Oversight');
        expect(auditTrail.sections[0].items.map((item) => item.title)).toEqual([
            'Audit Trail',
            'Approvals Queue',
            'AI Extractions',
        ]);
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
    it('lights up the module a nested destination belongs to', () => {
        expect(findActiveNavRoute(modules, '/accounting/reports/ap-aging')).toEqual({
            moduleId: 'accounts',
            to: '/accounting/reports/ap-aging',
        });
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
