import { describe, expect, it } from 'vitest';

import { resolveBreadcrumb } from './breadcrumb';
import { buildCommands } from './commandPalette';

// No permission rows: canView fails open, so this is the full tree.
const commands = buildCommands([]);
const labels = (pathname: string) =>
    resolveBreadcrumb(pathname, commands).map((crumb) => crumb.label);

describe('resolveBreadcrumb', () => {
    it('names the root without repeating it', () => {
        expect(labels('/')).toEqual(['Dashboard']);
    });

    it('puts a top-level destination under the root', () => {
        expect(labels('/contacts')).toEqual(['Dashboard', 'Contacts']);
    });

    it('lists the menus a nested destination sits under', () => {
        expect(labels('/accounting/reports/ap-aging')).toEqual([
            'Dashboard',
            'Accounts Management',
            'Finance Reports',
            'AP Aging',
        ]);
    });

    it('prefers the most specific route, not the first prefix match', () => {
        // "/inventory" is a prefix of "/inventory/cost-layers"; a first-match
        // walk resolves both to "Inventory".
        expect(labels('/inventory/cost-layers')).toEqual([
            'Dashboard',
            'Inventory Management',
            'Cost Layers (FIFO)',
        ]);
    });

    it('follows a viewer route home to the list it belongs to', () => {
        expect(labels('/view-invoice/abc-123')).toEqual([
            'Dashboard',
            'Sales Management',
            'Invoices',
        ]);
    });

    it('carries a detail route up to its list page', () => {
        expect(labels('/contacts/edit/42')).toEqual(['Dashboard', 'Contacts']);
    });

    it('links the root crumb and leaves the rest as text', () => {
        const crumbs = resolveBreadcrumb('/accounting/reports/ap-aging', commands);
        expect(crumbs[0]).toEqual({ label: 'Dashboard', to: '/' });
        expect(crumbs.slice(1).every((crumb) => crumb.to === undefined)).toBe(true);
    });

    it('returns nothing rather than guessing at an unlisted route', () => {
        expect(labels('/some/route/that/does/not/exist')).toEqual([]);
    });

    it('does not match a sibling that merely shares a prefix string', () => {
        // "/reports" must not claim "/reports-archive".
        expect(labels('/reports-archive')).toEqual([]);
    });
});
