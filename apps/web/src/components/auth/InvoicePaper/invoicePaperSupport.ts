/**
 * The parts of InvoicePaper that are just arithmetic.
 *
 * The component itself cannot be unit-tested here: vitest runs on
 * `environment: 'node'` with neither jsdom nor @testing-library installed (see
 * the note in vitest.config.ts). Rather than leave the whole feature untested,
 * the decisions worth getting wrong — when *not* to boot WebGL, how large a
 * texture to bake, how a flung sheet comes to rest — are pulled out here as
 * pure functions with no DOM and no `three` import, and tested next door.
 *
 * Keeping this module DOM-free is also what lets InvoicePaper.tsx call
 * `decideRenderMode` before it touches the lazy scene chunk.
 */

/** `'scene'` builds a WebGL context; `'static'` never does. */
export type InvoiceRenderMode = "scene" | "static";

/**
 * The panel this sits in is `hidden … lg:flex`, so below Tailwind's `lg` it is
 * not laid out at all. Booting a renderer for a zero-height container would
 * cost a context and paint nothing.
 */
export const SCENE_MIN_VIEWPORT_WIDTH = 1024;

export interface RenderModeInput {
    /** `prefers-reduced-motion: reduce` is set. */
    reducedMotion: boolean;
    /** `window.innerWidth`, in CSS pixels. */
    viewportWidth: number;
    /**
     * Whether a `webgl2` context can actually be obtained — as a thunk, not a
     * value, and the order of the checks below is load-bearing because of it.
     *
     * The only way to answer this is to make a context, and "creates no WebGL
     * context under reduced motion" is one of the things this component
     * promises. Asking eagerly would break that promise while returning the
     * right answer, which is the worst kind of bug: invisible, and only
     * findable by counting getContext calls.
     */
    hasWebgl2: () => boolean;
}

/**
 * The capability gate.
 *
 * Deliberately a pure function rather than a chain of `if`s inside the effect:
 * this is the rule that keeps `three` out of three separate situations, and it
 * is the only part of the gate that can be checked without a browser.
 */
export const decideRenderMode = ({
    reducedMotion,
    viewportWidth,
    hasWebgl2,
}: RenderModeInput): InvoiceRenderMode => {
    if (reducedMotion) return "static";
    if (viewportWidth < SCENE_MIN_VIEWPORT_WIDTH) return "static";
    if (!hasWebgl2()) return "static";
    return "scene";
};

/** Long edge of the baked invoice texture, in device pixels. */
export const pickTextureSize = (dpr: number, isDesktop: boolean): number => {
    // A retina panel wants the full 2048; a 1x display gains nothing from it
    // and pays for the upload, so the ladder is driven by dpr and then capped.
    // Above 2x there is no further legibility to buy — the sheet is ~70% of a
    // half-viewport, not a full-bleed document.
    const clampedDpr = Math.min(Math.max(dpr, 1), 2);
    const cap = isDesktop ? 2048 : 1024;
    const wanted = Math.round(1024 * clampedDpr);
    return Math.min(cap, Math.max(512, wanted));
};

export interface InertiaState {
    /** Radians. */
    value: number;
    /** Radians per frame. */
    velocity: number;
}

export interface InertiaOptions {
    /** Per-frame velocity multiplier. Below 1, so a fling always ends. */
    damping?: number;
    /** Velocity at which the spin is called finished, in radians per frame. */
    restThreshold?: number;
}

/**
 * One frame of post-release spin.
 *
 * The threshold matters more than the damping: without it the velocity decays
 * geometrically and never reaches zero, so the sheet keeps drifting by a
 * ten-thousandth of a radian forever and the idle autorotate never takes back
 * over cleanly. Zeroing it is what lets the caller hand control back without a
 * visible snap.
 */
export const stepInertia = (
    { value, velocity }: InertiaState,
    { damping = 0.94, restThreshold = 0.001 }: InertiaOptions = {},
): InertiaState => {
    const next = value + velocity;
    const decayed = velocity * damping;
    return {
        value: next,
        velocity: Math.abs(decayed) < restThreshold ? 0 : decayed,
    };
};

/** How far the sheet may pitch away from the viewer, in radians (±35°). */
export const MAX_TILT = (35 * Math.PI) / 180;

/**
 * Clamps the X rotation. Past roughly 35° the sheet is edge-on and the invoice
 * stops being readable, which is the one thing this decoration must not do.
 */
export const clampTilt = (radians: number, limit: number = MAX_TILT): number =>
    Math.min(Math.max(radians, -limit), limit);

/**
 * Frame-rate-independent exponential approach, used for the cursor-follow and
 * for easing back to rest.
 *
 * `factor` is the fraction closed in one 60fps frame; `dt` scales it so a
 * 120Hz display does not converge twice as fast.
 */
export const damp = (
    current: number,
    target: number,
    factor: number,
    dt: number,
): number => {
    const alpha = 1 - Math.pow(1 - factor, dt * 60);
    return current + (target - current) * alpha;
};
