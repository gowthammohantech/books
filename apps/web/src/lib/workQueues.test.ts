import { describe, expect, it } from 'vitest';

import { badgesByRoute, WORK_QUEUES } from './workQueues';
import { navItems } from './navigation';
import type { NavItemType } from '@models/sidebar';

const collectRoutes = (items: NavItemType[], out = new Set<string>()): Set<string> => {
    for (const item of items) {
        if (item.type === 'link') out.add(item.to);
        if (item.type === 'collapsible') collectRoutes(item.children, out);
    }
    return out;
};

describe('badgesByRoute', () => {
    it('maps a count onto the nav entry that carries it', () => {
        expect(badgesByRoute({ invoicesOverdue: 3 })).toEqual({ '/invoices': 3 });
    });

    it('keeps queues on separate routes separate', () => {
        expect(badgesByRoute({ invoicesOverdue: 3, quotationsExpiring: 2 })).toEqual({
            '/invoices': 3,
            '/quotations': 2,
        });
    });

    it('omits empty queues rather than badging a zero', () => {
        expect(badgesByRoute({ invoicesOverdue: 0, billsUnpaid: 4 })).toEqual({
            '/purchases': 4,
        });
    });

    it('ignores counts the server did not send', () => {
        expect(badgesByRoute({})).toEqual({});
    });
});

describe('WORK_QUEUES', () => {
    it('badges only nav routes that actually exist', () => {
        // A stale route here is silent: the badge simply never renders.
        const routes = collectRoutes(navItems);
        for (const queue of WORK_QUEUES) {
            expect(routes, `${queue.key} -> ${queue.navTo}`).toContain(queue.navTo);
        }
    });

    it('has one entry per key', () => {
        const keys = WORK_QUEUES.map((queue) => queue.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('sends every tile somewhere real', () => {
        // The tile target may carry a query string the nav entry does not.
        const routes = collectRoutes(navItems);
        for (const queue of WORK_QUEUES) {
            expect(routes, `${queue.key} -> ${queue.to}`).toContain(queue.to.split('?')[0]);
        }
    });
});
