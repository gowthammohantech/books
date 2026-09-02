import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DRAWER_ROUTES, isDrawerPath, parentOf } from "./drawerRoutes";

/**
 * The drawer table names routes by string, so a renamed list route would
 * silently produce an empty page behind a drawer — visible only on a cold
 * load, which is the case nobody clicks through by hand. Read the router the
 * same way e2e/routes.ts does and assert both ends of every pair exist.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "AdminRoute.tsx"), "utf8");
const declared = new Set([...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));

describe("drawer routes", () => {
  it.each(DRAWER_ROUTES)(
    "$path renders over $parent, and both are declared routes",
    ({ path, parent }) => {
      expect(declared.has(path)).toBe(true);
      expect(declared.has(parent)).toBe(true);
    },
  );

  it("has a parent for every drawer path", () => {
    for (const { path } of DRAWER_ROUTES) {
      expect(isDrawerPath(path)).toBe(true);
      expect(parentOf(path)).toBeTruthy();
    }
  });

  it("never points a drawer at another drawer", () => {
    for (const { parent } of DRAWER_ROUTES) {
      expect(isDrawerPath(parent)).toBe(false);
    }
  });

  it("does not treat an ordinary path as a drawer path", () => {
    expect(isDrawerPath("/invoices")).toBe(false);
    expect(parentOf("/invoices")).toBeUndefined();
  });
});
