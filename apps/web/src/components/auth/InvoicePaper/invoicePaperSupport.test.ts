import { describe, expect, it, vi } from "vitest";

import {
    clampTilt,
    damp,
    decideRenderMode,
    MAX_TILT,
    pickTextureSize,
    SCENE_MIN_VIEWPORT_WIDTH,
    stepInertia,
} from "./invoicePaperSupport";

const capable = {
    reducedMotion: false,
    viewportWidth: 1440,
    hasWebgl2: () => true,
};

describe("decideRenderMode", () => {
    it("renders the scene on a capable desktop", () => {
        expect(decideRenderMode(capable)).toBe("scene");
    });

    it("refuses the scene under prefers-reduced-motion", () => {
        // Not "stops animating" — never constructs a renderer. A CSS-only
        // motion-reduce: rule could not express that.
        expect(decideRenderMode({ ...capable, reducedMotion: true })).toBe("static");
    });

    it("refuses the scene below the breakpoint that shows the panel", () => {
        expect(
            decideRenderMode({
                ...capable,
                viewportWidth: SCENE_MIN_VIEWPORT_WIDTH - 1,
            }),
        ).toBe("static");
    });

    it("takes the panel's own breakpoint as wide enough", () => {
        expect(
            decideRenderMode({ ...capable, viewportWidth: SCENE_MIN_VIEWPORT_WIDTH }),
        ).toBe("scene");
    });

    it("refuses the scene without WebGL2", () => {
        expect(decideRenderMode({ ...capable, hasWebgl2: () => false })).toBe("static");
    });

    it("stays static when several reasons apply at once", () => {
        expect(
            decideRenderMode({
                reducedMotion: true,
                viewportWidth: 320,
                hasWebgl2: () => false,
            }),
        ).toBe("static");
    });

    // The probe is the only input that costs a WebGL context to answer, and
    // the promise is that the gated paths never create one. Asserting the
    // ordering here is the only place that can be checked without a browser.
    it("does not probe for WebGL under reduced motion", () => {
        const probe = vi.fn(() => true);
        decideRenderMode({ ...capable, reducedMotion: true, hasWebgl2: probe });
        expect(probe).not.toHaveBeenCalled();
    });

    it("does not probe for WebGL below the breakpoint", () => {
        const probe = vi.fn(() => true);
        decideRenderMode({ ...capable, viewportWidth: 800, hasWebgl2: probe });
        expect(probe).not.toHaveBeenCalled();
    });

    it("probes exactly once when nothing cheaper has ruled the scene out", () => {
        const probe = vi.fn(() => true);
        expect(decideRenderMode({ ...capable, hasWebgl2: probe })).toBe("scene");
        expect(probe).toHaveBeenCalledTimes(1);
    });
});

describe("pickTextureSize", () => {
    it("bakes the full 2048 for a retina desktop", () => {
        expect(pickTextureSize(2, true)).toBe(2048);
    });

    it("does not go past 2048 however high the dpr claims to be", () => {
        expect(pickTextureSize(4, true)).toBe(2048);
    });

    it("halves the ladder on a 1x display", () => {
        expect(pickTextureSize(1, true)).toBe(1024);
    });

    it("caps a phone at 1024 even at 3x", () => {
        expect(pickTextureSize(3, false)).toBe(1024);
    });

    it("never drops below a legible floor for a nonsense dpr", () => {
        expect(pickTextureSize(0, true)).toBe(1024);
    });
});

describe("stepInertia", () => {
    it("carries the value forward by the velocity", () => {
        expect(stepInertia({ value: 1, velocity: 0.5 }).value).toBe(1.5);
    });

    it("bleeds the velocity off each frame", () => {
        const { velocity } = stepInertia({ value: 0, velocity: 0.5 });
        expect(velocity).toBeCloseTo(0.47, 10);
    });

    it("comes to a full stop rather than drifting forever", () => {
        let state = { value: 0, velocity: 0.4 };
        for (let frame = 0; frame < 200; frame += 1) state = stepInertia(state);
        expect(state.velocity).toBe(0);
    });

    it("settles within about two seconds of a hard fling", () => {
        let state = { value: 0, velocity: 0.4 };
        let frames = 0;
        while (state.velocity !== 0 && frames < 600) {
            state = stepInertia(state);
            frames += 1;
        }
        expect(frames).toBeLessThan(120);
    });

    it("decays a leftward fling to rest too", () => {
        let state = { value: 0, velocity: -0.4 };
        for (let frame = 0; frame < 200; frame += 1) state = stepInertia(state);
        expect(state.velocity).toBe(0);
        expect(state.value).toBeLessThan(0);
    });
});

describe("clampTilt", () => {
    it("leaves a gentle tilt alone", () => {
        expect(clampTilt(0.1)).toBe(0.1);
    });

    it("holds the sheet off edge-on in both directions", () => {
        expect(clampTilt(Math.PI)).toBeCloseTo(MAX_TILT, 10);
        expect(clampTilt(-Math.PI)).toBeCloseTo(-MAX_TILT, 10);
    });
});

describe("damp", () => {
    it("closes the stated fraction in one 60fps frame", () => {
        expect(damp(0, 1, 0.08, 1 / 60)).toBeCloseTo(0.08, 10);
    });

    it("converges at the same rate on a 120Hz display", () => {
        const oneSixtieth = damp(0, 1, 0.08, 1 / 60);
        const twoOneTwentieths = damp(damp(0, 1, 0.08, 1 / 120), 1, 0.08, 1 / 120);
        expect(twoOneTwentieths).toBeCloseTo(oneSixtieth, 10);
    });

    it("stays put when it is already on target", () => {
        expect(damp(0.5, 0.5, 0.08, 1 / 60)).toBeCloseTo(0.5, 10);
    });
});
