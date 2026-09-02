import { describe, expect, it } from 'vitest';

import { buildNavModules } from './navModules';
import { navItems } from './navigation';
import {
    INCLUDED_KEYS,
    PRESETS,
    SELECTABLE_KEYS,
    SETUP_MODULE_GROUPS,
    applyModulePreferences,
    claimedNavIds,
    parseEnabledModules,
    unclaimedNavIds,
    withIncluded,
    type SetupModuleKey,
} from './setupModules';

// No permission rows: canView fails open, so this is the full tree.
const allModuleIds = buildNavModules([]).map((m) => m.id);
const idsFor = (enabled: SetupModuleKey[] | null) =>
    buildNavModules([], applyModulePreferences(navItems, enabled)).map((m) => m.id);

describe('the catalogue and the nav tree agree', () => {
    it('every nav id a group claims resolves to a real top-level module', () => {
        // The test that stops the two drifting apart: rename a collapsible id
        // in navigation.tsx and this fails rather than silently un-hiding it.
        for (const navId of claimedNavIds()) {
            expect(allModuleIds, `unknown navId "${navId}"`).toContain(navId);
        }
    });

    it('claims no nav id twice', () => {
        const claimed = claimedNavIds();
        expect(new Set(claimed).size).toBe(claimed.length);
    });

    it('leaves Dashboard, Parties, Reports and Approvals unclaimed, so they always show', () => {
        expect(unclaimedNavIds().sort()).toEqual(
            ['/', '/accounting/approvals', '/contacts', '/reports'].sort()
        );
    });

    it('gives every available group at least one nav id, and every unavailable group none', () => {
        for (const group of SETUP_MODULE_GROUPS) {
            if (group.available) expect(group.navIds.length).toBeGreaterThan(0);
            else expect(group.navIds).toEqual([]);
        }
    });
});

describe('presets', () => {
    it('include the always-on groups in every business type', () => {
        for (const keys of Object.values(PRESETS)) {
            for (const included of INCLUDED_KEYS) expect(keys).toContain(included);
        }
    });

    it('never offer a module this build does not have', () => {
        for (const keys of Object.values(PRESETS)) {
            for (const key of keys) expect(SELECTABLE_KEYS).toContain(key);
        }
    });

    it('give a services business no inventory, and a distributor both stock and purchasing', () => {
        expect(PRESETS.SERVICES).not.toContain('inventory');
        expect(PRESETS.SERVICES).toContain('projects');
        expect(PRESETS.TRADING).toEqual(expect.arrayContaining(['inventory', 'purchases']));
        expect(PRESETS.MANUFACTURING).toEqual(expect.arrayContaining(['inventory', 'purchases']));
    });
});

describe('applyModulePreferences', () => {
    it('returns the SAME ARRAY when there is no preference', () => {
        // Reference identity, not just equality: buildCommands appends the
        // report and settings catalogues only when `items === navItems`.
        expect(applyModulePreferences(navItems, null)).toBe(navItems);
        expect(applyModulePreferences(navItems, undefined)).toBe(navItems);
        expect(applyModulePreferences(navItems, [])).toBe(navItems);
    });

    it('hides exactly the modules that were switched off', () => {
        const ids = idsFor(withIncluded(['sales']));
        expect(ids).toContain('sales');
        expect(ids).not.toContain('purchases');
        expect(ids).not.toContain('products-inventory');
        expect(ids).not.toContain('payroll');
        expect(ids).not.toContain('/accounting/fixed-assets');
    });

    it('unticking Taxation does not take Fixed Assets or Approvals with it', () => {
        // The regression this whole design exists for. Taxation, Fixed Assets
        // and Approvals all carry `slug: "accounting"`, so a slug-keyed filter
        // would remove all three - plus Budgets, Projects and Cost Centers
        // nested inside Taxation - when the user unticks one card.
        const withoutTaxation = SELECTABLE_KEYS.filter((k) => k !== 'taxation');
        const ids = buildNavModules(
            [],
            applyModulePreferences(navItems, withoutTaxation)
        ).map((m) => m.id);

        // `taxation` is `included`, so it survives even when omitted...
        expect(ids).toContain('taxation');
        // ...and its slug-mates are untouched either way.
        expect(ids).toContain('/accounting/fixed-assets');
        expect(ids).toContain('/accounting/approvals');
    });

    it('always keeps the unclaimed modules', () => {
        const ids = idsFor(withIncluded([]));
        for (const navId of unclaimedNavIds()) expect(ids).toContain(navId);
    });

    it('keeps the always-on modules even when the stored list omits them', () => {
        const ids = buildNavModules(
            [],
            applyModulePreferences(navItems, ['sales'])
        ).map((m) => m.id);
        expect(ids).toEqual(expect.arrayContaining(['accounts', 'taxation', '/activity-log']));
    });

    it('drops a band that loses every module beneath it', () => {
        // Payroll & Time is the only entry under "Workforce".
        const modules = buildNavModules(
            [],
            applyModulePreferences(navItems, withIncluded(['sales']))
        );
        expect(modules.map((m) => m.band)).not.toContain('Workforce');
    });
});

describe('withIncluded', () => {
    it('adds the always-on groups', () => {
        expect(withIncluded([])).toEqual(expect.arrayContaining(INCLUDED_KEYS));
    });

    it('refuses a group this build cannot show', () => {
        expect(withIncluded(['production', 'serviceBilling'])).toEqual(INCLUDED_KEYS);
    });

    it('is order-stable and free of duplicates', () => {
        const out = withIncluded(['sales', 'sales', 'accounts']);
        expect(new Set(out).size).toBe(out.length);
        expect(out).toEqual(SETUP_MODULE_GROUPS.filter((g) => out.includes(g.key)).map((g) => g.key));
    });
});

describe('parseEnabledModules', () => {
    it('reads a stored list back', () => {
        expect(parseEnabledModules(['sales', 'accounts'])).toEqual(['sales', 'accounts']);
    });

    it('discards keys this build no longer knows, rather than trusting them', () => {
        expect(parseEnabledModules(['sales', 'crm', 42, null])).toEqual(['sales']);
    });

    it('treats anything that is not a usable list as "no preference"', () => {
        expect(parseEnabledModules(undefined)).toBeNull();
        expect(parseEnabledModules(null)).toBeNull();
        expect(parseEnabledModules('sales')).toBeNull();
        expect(parseEnabledModules([])).toBeNull();
        expect(parseEnabledModules(['nope'])).toBeNull();
    });
});
