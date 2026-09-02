import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Holds every animated icon to the exact shape of its static twin.
 *
 * An AnimatedIcon renders the plain lucide glyph until its variant loads, then
 * swaps. If the two are not the same drawing, that swap is a visible pop on
 * hover — and the failure is silent: nothing throws, the icon merely looks
 * slightly wrong, on a surface nobody screenshots. pqoqubbw's published copies
 * have already drifted from lucide 0.525 exactly this way.
 *
 * Generation makes them identical; this makes them STAY identical. The realistic
 * way to break it is bumping `lucide-react` without re-running `npm run
 * gen:icons`, which changes the static glyph and leaves the variant behind.
 *
 * Both sides are read as TEXT rather than imported: importing the variants
 * would pull `motion` into the test process, which is slow and proves nothing
 * about the chunk boundary the rest of this feature depends on.
 */

const variantsDir = fileURLToPath(
    new URL("./variants", import.meta.url),
);
const lucideDir = fileURLToPath(
    new URL("../../../../../node_modules/lucide-react/dist/esm/icons", import.meta.url),
);

/** Every geometry attribute we emit, in a comparable form. */
const GEOMETRY = /\b(d|cx|cy|r|x|y|x1|x2|y1|y2|width|height|rx|ry|points)=/;

const fromVariant = (source: string): string[] => {
    const hits: string[] = [];
    // Generated form: d={"M3 6h18"} / cx={"12"}
    for (const [, key, value] of source.matchAll(
        /\b(d|cx|cy|r|x1|x2|y1|y2|rx|ry|points)=\{"([^"]*)"\}/g,
    )) {
        hits.push(`${key}:${value}`);
    }
    // width/height/x/y appear on <rect>, but also as the component's own
    // width={size}/height={size} — only the quoted literals are geometry.
    for (const [, key, value] of source.matchAll(
        /\b(width|height|x|y)=\{"([^"]*)"\}/g,
    )) {
        hits.push(`${key}:${value}`);
    }
    return hits.sort();
};

const fromLucide = (source: string): string[] => {
    const match = source.match(/__iconNode\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) throw new Error("no __iconNode");
    const nodes = new Function(`return ${match[1]}`)() as [
        string,
        Record<string, string>,
    ][];
    const hits: string[] = [];
    for (const [, props] of nodes) {
        for (const [key, value] of Object.entries(props)) {
            if (key === "key") continue;
            if (!GEOMETRY.test(`${key}=`)) continue;
            hits.push(`${key}:${String(value)}`);
        }
    }
    return hits.sort();
};

/** Which lucide icon each variant was generated from. */
const lucideNameOf = (source: string): string => {
    const match = source.match(/lucide-react's\s*\n?\s*\*?\s*`([a-z0-9-]+)`/);
    if (!match) throw new Error("variant does not name its lucide source");
    return match[1];
};

const variants = readdirSync(variantsDir).filter((f) => f.endsWith(".tsx"));

describe("animated variants match lucide-react", () => {
    it("finds the installed lucide icons", () => {
        // A skip here would pass silently while checking nothing — the exact
        // failure mode check-legacy-tokens.mjs warns about. Fail loudly instead
        // so a lucide packaging change is a red build, not a quiet no-op.
        expect(
            existsSync(lucideDir),
            `lucide-react icons not found at ${lucideDir}. If the package layout changed, update this path — do not skip this test.`,
        ).toBe(true);
    });

    it("generated at least the nav and chrome set", () => {
        expect(variants.length).toBeGreaterThanOrEqual(28);
    });

    it.each(variants)("%s is pixel-identical to its lucide glyph", (file) => {
        const source = readFileSync(join(variantsDir, file), "utf8");
        const lucide = lucideNameOf(source);
        const lucideFile = join(lucideDir, `${lucide}.js`);

        expect(existsSync(lucideFile), `${lucide}.js is missing`).toBe(true);

        expect(
            fromVariant(source),
            `${file} has drifted from lucide's ${lucide}. Run: npm run gen:icons`,
        ).toEqual(fromLucide(readFileSync(lucideFile, "utf8")));
    });
});
