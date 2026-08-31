import { describe, expect, it } from "vitest";
import type { PermissionSet } from "@models/permissions";

import { hasPermission } from "./hasPermission";

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

describe("hasPermission", () => {
    it("allows an action the permission row grants", () => {
        expect(hasPermission([perm("invoices", { view: true })], "invoices", "view")).toBe(true);
    });

    it("denies an action the same row does not grant", () => {
        expect(hasPermission([perm("invoices", { view: true })], "invoices", "delete")).toBe(false);
    });

    it("treats allowAll as every action", () => {
        const permissions = [perm("invoices", { allowAll: true })];
        for (const action of ["view", "create", "edit", "delete"] as const) {
            expect(hasPermission(permissions, "invoices", action)).toBe(true);
        }
    });

    it("denies a module with no row at all", () => {
        expect(hasPermission([perm("invoices", { allowAll: true })], "payroll", "view")).toBe(false);
    });

    it("is a pure function of its arguments — the user_type bypass is gone", () => {
        // The regression this file exists for. `hasPermission` used to read the
        // redux store and return true for `user.user_type === 1`, which meant:
        //   (a) the permissions argument was decorative for those users, and
        //   (b) the answer keyed off a property of the PERSON rather than of
        //       their membership — so someone who signed up as an admin of
        //       their own company had full access inside every other company
        //       they were later invited to.
        // With no store import there is nothing left that could reintroduce
        // either behaviour without changing this signature.
        expect(hasPermission([], "invoices", "view")).toBe(false);
        expect(hasPermission([perm("invoices")], "invoices", "view")).toBe(false);
    });
});
