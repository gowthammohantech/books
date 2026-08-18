import { describe, expect, it } from "vitest";
import { resolveLandingPath, UNAUTHORIZED_PATH } from "./roleLanding";
import type { PermissionSet } from "@models/permissions";

const perm = (moduleSlug: string, overrides: Partial<PermissionSet> = {}): PermissionSet => ({
    id: moduleSlug,
    roleId: "role-1",
    moduleId: moduleSlug,
    moduleName: moduleSlug,
    moduleSlug,
    view: false,
    create: false,
    edit: false,
    delete: false,
    allowAll: false,
    ...overrides,
});

describe("resolveLandingPath", () => {
    it("(a) uses defaultRoute when it is set and still permitted", () => {
        const permissions = [
            perm("dashboard", { view: false }),
            perm("invoices", { view: true }),
        ];
        expect(resolveLandingPath("invoices", permissions)).toBe("/admin/invoices");
    });

    it("(b) falls back to the first permitted module when defaultRoute is set but not permitted", () => {
        const permissions = [
            perm("dashboard", { view: false }),
            perm("invoices", { view: false }),
            perm("contacts", { view: true }),
        ];
        // defaultRoute points at "invoices" but the role has no view/allowAll there
        expect(resolveLandingPath("invoices", permissions)).toBe("/admin/contacts");
    });

    it("(c) lands on dashboard when no defaultRoute is set and dashboard is permitted", () => {
        const permissions = [
            perm("dashboard", { view: true }),
            perm("invoices", { view: true }),
        ];
        expect(resolveLandingPath(undefined, permissions)).toBe("/admin/dashboard");
    });

    it("(d) falls back to another permitted module when dashboard is not permitted", () => {
        const permissions = [
            perm("dashboard", { view: false }),
            perm("purchase-list", { allowAll: true }),
        ];
        expect(resolveLandingPath(undefined, permissions)).toBe("/admin/purchases");
    });

    it("(e) returns /admin/unauthorized when nothing is permitted at all", () => {
        const permissions = [
            perm("dashboard", { view: false }),
            perm("invoices", { view: false }),
        ];
        expect(resolveLandingPath(undefined, permissions)).toBe(UNAUTHORIZED_PATH);
    });

    it("returns /admin/unauthorized when the permissions list is empty", () => {
        expect(resolveLandingPath(undefined, [])).toBe(UNAUTHORIZED_PATH);
    });

    it("ignores a defaultRoute that has no known landing page mapping", () => {
        const permissions = [perm("contacts", { view: true })];
        expect(resolveLandingPath("not-a-real-module", permissions)).toBe("/admin/contacts");
    });
});
