import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

import { TENANT_SCOPED_KEYS } from "./tenantStorage";

/**
 * Source-level regression guards.
 *
 * The two properties below are invisible at runtime until someone is looking at
 * the wrong company's data, and neither is expressible as a unit test of any
 * one module — they are properties of the whole tree. So they are checked the
 * way the backend checks its equivalents (tests/routeCoverage.test.ts): by
 * reading the source and asserting a pattern is absent.
 *
 * A source scan is a blunt instrument, and it is the right one here precisely
 * because the failure it prevents is someone adding a NEW call site that looks
 * exactly like the old ones.
 */

const SRC = path.resolve(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            sourceFiles(full, out);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

/** Strip comments so a doc-comment explaining a deleted pattern is not a hit. */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FILES = sourceFiles(SRC).map((file) => ({
    rel: path.relative(SRC, file).split(path.sep).join("/"),
    code: stripComments(fs.readFileSync(file, "utf8")),
}));

describe("no authorization decision reads user_type", () => {
    it("finds a plausible number of source files (the scan itself works)", () => {
        // Without this, a broken glob makes every assertion below pass by
        // looking at nothing at all.
        expect(FILES.length).toBeGreaterThan(100);
    });

    it("nothing gates on the signed-in user's user_type", () => {
        // `user_type` describes the PERSON — how they signed up. Authorization
        // is a property of their MEMBERSHIP in the workspace they are currently
        // looking at, because the same account can own one company and be a
        // read-only member of another. Every gate that read `user.user_type`
        // therefore granted access in workspaces where it had not been given:
        // the route guard, the permission helper, the sidebar, the command
        // palette, the global search, the HMRC credentials panel and the backup
        // zip. Use the permission set, or `auth.activeTenant.isOwner`.
        //
        // Reading `user_type` off a ROW being rendered (a staff list, an
        // employee dropdown filter) is a different thing and stays allowed —
        // hence the deliberately narrow pattern.
        const offenders = FILES.filter(({ code }) => /\buser\??\.user_type\b/.test(code)).map(
            ({ rel }) => rel
        );
        expect(
            offenders,
            "These read user_type off the signed-in user. Authorization must come " +
                "from the permission set the server issued for the ACTIVE workspace, " +
                "or from auth.activeTenant.isOwner."
        ).toEqual([]);
    });
});

describe("no per-workspace value is cached under a bare key", () => {
    // tenantStorage owns the namespacing; authSlice deliberately removes the
    // pre-namespace keys on logout, and tenantStorage sweeps them once at boot.
    const ALLOWED = new Set([
        "utils/tenantStorage.ts",
        "store/auth/authSlice.ts",
    ]);

    it.each(TENANT_SCOPED_KEYS)("%s is never a bare Storage key", (key) => {
        const pattern = new RegExp(
            `(local|session)Storage\\s*\\.\\s*(get|set|remove)Item\\s*\\(\\s*['"\`]${key}['"\`]`
        );
        const offenders = FILES.filter(
            ({ rel, code }) => !ALLOWED.has(rel) && pattern.test(code)
        ).map(({ rel }) => rel);

        expect(
            offenders,
            `"${key}" holds data that differs per workspace. Read and write it ` +
                "through @utils/tenantStorage so it is keyed by the active " +
                "workspace — a bare key is served to whichever company the user " +
                "happens to be in."
        ).toEqual([]);
    });
});
