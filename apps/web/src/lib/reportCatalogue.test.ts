import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reportCategories, reports } from './reportCatalogue';

/**
 * The catalogue is hand-maintained, the router is hand-maintained, and nothing
 * in the type system connects them. The failure that follows is quiet: a route
 * gets renamed, the catalogue keeps the old path, and the Reports Center grows a
 * row that navigates to the 404 page. Nobody notices until a customer clicks it.
 *
 * So the router file itself is the fixture. Reading it as text — rather than
 * importing it, which would pull in ~160 page components and a Redux store into
 * a node-environment test run — is the cheap way to ask the only question that
 * matters: does this path exist over there?
 */
const routerSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../routes/AdminRoute.tsx'),
    'utf8',
);

const declaredPaths = new Set(
    [...routerSource.matchAll(/\bpath="([^"]+)"/g)].map((match) => match[1]),
);

describe('reportCatalogue', () => {
    it('finds routes to check against at all', () => {
        // Guards the regex itself: if AdminRoute ever switches to `path={...}`
        // this suite would otherwise pass vacuously by matching nothing.
        expect(declaredPaths.size).toBeGreaterThan(100);
    });

    it.each(reports.map((report) => [report.name, report.path] as const))(
        '%s points at a route the router declares (%s)',
        (_name, path) => {
            expect(declaredPaths.has(path)).toBe(true);
        },
    );

    it('gives every report a unique id', () => {
        const ids = reports.map((report) => report.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('gives every report a unique path', () => {
        const paths = reports.map((report) => report.path);
        expect(new Set(paths).size).toBe(paths.length);
    });

    it('only uses categories the left rail knows how to render', () => {
        const known = new Set<string>(reportCategories);
        const unknown = reports
            .filter((report) => !known.has(report.category))
            .map((report) => `${report.id}: ${report.category}`);
        expect(unknown).toEqual([]);
    });

    it('lists no category the catalogue never uses', () => {
        // An empty category is a permanently-zero row in the rail.
        const used = new Set(reports.map((report) => report.category));
        expect(reportCategories.filter((category) => !used.has(category))).toEqual([]);
    });

    it('uses kebab-case ids, since they are persisted storage keys', () => {
        expect(reports.filter((report) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(report.id))).toEqual([]);
    });
});
