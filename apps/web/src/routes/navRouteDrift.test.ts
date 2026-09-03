/**
 * The sidebar and the router must agree about what exists.
 *
 * `lib/navigation.tsx` carries its own copy of 52 paths and 65 permission slugs;
 * `routes/AdminRoute.tsx` declares 161 routes with their own path literals and
 * `moduleSlug` values. Nothing linked the two, so a renamed route produced a
 * sidebar entry that navigates to nothing — a failure that is silent until
 * someone clicks it, and one `lib/navPaths.ts` already exists to patch by hand
 * for two viewer routes.
 *
 * This is deliberately a TEST rather than a shared table. Collapsing 161 routes
 * of interleaved JSX — drawer fallbacks, redirects and two shells mixed in with
 * the pages — into a generated manifest is a large rewrite of the one file whose
 * mistakes are invisible until runtime. The drift is what actually hurts, and a
 * test closes it at a fraction of the risk.
 *
 * It reads both files as text on purpose: importing AdminRoute.tsx would need
 * jsdom and a router, and this suite runs under `environment: 'node'`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

const adminRoute = read('./AdminRoute.tsx');
const navigation = read('../lib/navigation.tsx');
const appRoutes = read('./AppRoutes.tsx');

/** Every `path="..."` declared in the admin router, plus the index route. */
const routePaths = new Set(
  [...adminRoute.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).concat('/'),
);

/** Every `moduleSlug="..."` a ProtectedRoute group guards on. */
const routeSlugs = new Set([...adminRoute.matchAll(/moduleSlug="([^"]+)"/g)].map((m) => m[1]));

/** Every `to: "..."` the sidebar navigates to. */
const navPaths = [...navigation.matchAll(/\bto:\s*"([^"]+)"/g)].map((m) => m[1]);

/** Every `slug: "..."` the sidebar gates visibility on. */
const navSlugs = [...navigation.matchAll(/\bslug:\s*"([^"]+)"/g)].map((m) => m[1]);

/**
 * A nav target matches a route when the route is literal, or when a
 * parameterised route (`/products/edit/:id`) covers it by prefix.
 */
function isRouted(path: string): boolean {
  if (routePaths.has(path)) return true;
  if (appRoutes.includes(`"${path}"`)) return true; // handled outside the admin shell
  for (const p of routePaths) {
    if (!p.includes(':')) continue;
    const prefix = p.slice(0, p.indexOf(':'));
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Group headers. These carry a slug so the rail can gate a whole section, but
 * they navigate nowhere and no route guards them — documented as intentional in
 * documentation/product/modules-to-modify.md §4.
 */
const UNGUARDED_BY_DESIGN = new Set([
  'band-finance',
  'band-operations',
  'band-oversight',
  'band-overview',
  'band-workforce',
  'payroll',
  'purchases',
  'reports',
  'sales',
]);

/**
 * Real drift, pinned rather than fixed here.
 *
 * The sidebar gates /my-money on `my-money` while its route guards `petty-cash`,
 * and /vehicles on `vehicles` while its route guards `contacts`. A role granted
 * the nav slug but not the route slug sees the entry and gets a 403 on click;
 * a role with the reverse can reach the page but never sees the link.
 *
 * Deciding which slug is correct is a permissions question, not a refactor —
 * it is the failure mode modules-to-modify.md §3 describes, and fixing it means
 * choosing whether these are separate modules or aliases.
 */
const KNOWN_SLUG_DRIFT = new Set(['my-money', 'vehicles']);

describe('sidebar / router drift', () => {
  it('found paths and slugs on both sides (the parse still works)', () => {
    // If a refactor changes either file's shape, this fails first and loudly
    // rather than the assertions below passing vacuously on an empty set.
    expect(routePaths.size).toBeGreaterThan(100);
    expect(routeSlugs.size).toBeGreaterThan(20);
    expect(navPaths.length).toBeGreaterThan(40);
    expect(navSlugs.length).toBeGreaterThan(40);
  });

  it('every sidebar link points at a route that exists', () => {
    const dead = navPaths.filter((p) => !isRouted(p));
    expect(dead).toEqual([]);
  });

  it('every sidebar permission slug is one the router also guards on', () => {
    // The reverse does not hold and should not: the router guards slugs for
    // pages reached from a list rather than the rail.
    const unknown = [...new Set(navSlugs)].filter(
      (s) => !routeSlugs.has(s) && !UNGUARDED_BY_DESIGN.has(s) && !KNOWN_SLUG_DRIFT.has(s),
    );
    expect(unknown).toEqual([]);
  });

  // Guard the exception lists themselves: if someone fixes the drift below, this
  // fails and tells them to delete the entry rather than leaving a stale excuse
  // in place.
  it('the known-drift list still describes real drift', () => {
    const stillDrifting = [...KNOWN_SLUG_DRIFT].filter((s) => !routeSlugs.has(s));
    expect(stillDrifting).toEqual([...KNOWN_SLUG_DRIFT]);
  });
});
