import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
    ANIMATED_ICON_NAMES,
    hasVariant,
    ICON_REGISTRY,
    type IconName,
} from "./iconRegistry";

/**
 * The variants directory is read off disk rather than imported.
 *
 * Importing variants/index.ts would pull `motion` into the test process, which
 * is both slow and quietly self-defeating: the thing under test is that the
 * seam can answer "does this icon animate?" WITHOUT touching the chunk, and a
 * test that touches the chunk cannot show that.
 */
const variantsDir = fileURLToPath(new URL("./variants", import.meta.url));

const variantFiles = (): string[] =>
    readdirSync(variantsDir)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => f.replace(/\.tsx$/, ""));

describe("ICON_REGISTRY", () => {
    it("maps every name to a component", () => {
        for (const [name, Icon] of Object.entries(ICON_REGISTRY)) {
            expect(Icon, `${name} has no component`).toBeTruthy();
        }
    });

    it("has no duplicate names", () => {
        const names = Object.keys(ICON_REGISTRY);
        expect(new Set(names).size).toBe(names.length);
    });
});

describe("ANIMATED_ICON_NAMES", () => {
    it("only lists names that exist in the registry", () => {
        for (const name of ANIMATED_ICON_NAMES) {
            expect(ICON_REGISTRY, `${name} is not a registry name`).toHaveProperty(
                name,
            );
        }
    });

    it("matches the variant files actually on disk", () => {
        expect([...ANIMATED_ICON_NAMES].sort()).toEqual(variantFiles().sort());
    });

    it("agrees with hasVariant()", () => {
        for (const name of Object.keys(ICON_REGISTRY) as IconName[]) {
            expect(hasVariant(name)).toBe(
                (ANIMATED_ICON_NAMES as readonly string[]).includes(name),
            );
        }
    });
});
