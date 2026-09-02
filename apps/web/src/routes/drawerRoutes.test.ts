import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  backgroundPathFor,
  DRAWER_ROUTES,
  drawerCloseAction,
  isDrawerPath,
  parentOf,
} from "./drawerRoutes";

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

describe("close behaviour", () => {
  it("goes back when the drawer was pushed onto a real history entry", () => {
    expect(drawerCloseAction("abc123", "/invoices/create-invoice")).toEqual({
      action: "back",
    });
  });

  it("lands on the list when the drawer IS the first entry", () => {
    // A pasted link, a refresh, or EditInvoice's window.open(..., '_blank').
    // navigate(-1) here would leave the app.
    expect(drawerCloseAction("default", "/invoices/create-invoice")).toEqual({
      action: "replace",
      to: "/invoices",
    });
  });

  it("uses the mapped parent, not the path minus a segment", () => {
    expect(drawerCloseAction("default", "/recurring-schedules/new")).toEqual({
      action: "replace",
      to: "/recurring-invoices",
    });
    expect(drawerCloseAction("default", "/customers/new")).toEqual({
      action: "replace",
      to: "/contacts",
    });
  });
});

describe("cold-load background", () => {
  it("supplies the list for every drawer route", () => {
    for (const { path, parent } of DRAWER_ROUTES) {
      expect(backgroundPathFor(path)).toBe(parent);
    }
  });

  it("is null for a route that is not a drawer", () => {
    expect(backgroundPathFor("/invoices")).toBeNull();
    expect(backgroundPathFor("/invoices/edit-invoice/abc")).toBeNull();
  });
});
