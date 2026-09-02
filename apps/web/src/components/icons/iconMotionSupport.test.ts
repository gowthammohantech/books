import { describe, expect, it } from "vitest";

import { decideIconMotion, type IconMotionInput } from "./iconMotionSupport";

const input = (overrides: Partial<IconMotionInput> = {}): IconMotionInput => ({
    reducedMotion: false,
    hasVariant: true,
    trigger: "closest",
    ...overrides,
});

describe("decideIconMotion", () => {
    it("animates when everything is available", () => {
        expect(decideIconMotion(input())).toBe("animated");
    });

    it("stays static under reduced motion", () => {
        expect(decideIconMotion(input({ reducedMotion: true }))).toBe("static");
    });

    it("stays static when no variant is registered", () => {
        expect(decideIconMotion(input({ hasVariant: false }))).toBe("static");
    });

    it("stays static for a decorative icon", () => {
        expect(decideIconMotion(input({ trigger: "none" }))).toBe("static");
    });

    it("animates for either trigger mode", () => {
        expect(decideIconMotion(input({ trigger: "self" }))).toBe("animated");
        expect(decideIconMotion(input({ trigger: "closest" }))).toBe("animated");
    });

    /**
     * The load-bearing one. Reduced motion has to win over a *fully available*
     * icon, because the promise is that the chunk is never requested — not
     * merely that it never plays. Reordering the checks would keep every test
     * above green while quietly breaking that.
     */
    it("prefers reduced motion over an otherwise animatable icon", () => {
        expect(
            decideIconMotion({
                reducedMotion: true,
                hasVariant: true,
                trigger: "closest",
            }),
        ).toBe("static");
    });
});
