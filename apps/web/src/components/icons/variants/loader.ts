import type { AnimatedIconVariant } from "./types";

export type VariantMap = Partial<Record<string, AnimatedIconVariant>>;

/**
 * The one and only dynamic import of `motion`.
 *
 * ONE chunk, not one per icon. Per-icon chunks would mean a request per glyph
 * on a sidebar hover-sweep, and Rollup would hoist `motion/react` into a shared
 * chunk anyway — so it buys N+1 requests instead of 1 for no size win. The
 * variants themselves are SVG path data and a few keyframes; against motion's
 * ~35 kB they are rounding error. Worth revisiting past ~60 variants.
 */

let cache: VariantMap | null = null;
let inflight: Promise<VariantMap> | null = null;

/**
 * Synchronous peek. Non-null from the second hover onward — which is the point:
 * it is what lets AnimatedIcon seed its state at mount and swap without a
 * frame of delay, where React.lazy would have to suspend.
 */
export const peekVariants = (): VariantMap | null => cache;

export const loadVariants = (): Promise<VariantMap> => {
    if (cache) return Promise.resolve(cache);
    inflight ??= import("./index")
        .then((module) => (cache = module.ANIMATED_VARIANTS))
        .catch((error: unknown) => {
            // Clearing `inflight` is what makes a dropped request retryable.
            // Leaving a rejected promise cached would strand every icon in the
            // tab on its static glyph until a reload — a worse outcome than the
            // flaky network that caused it.
            inflight = null;
            throw error;
        });
    return inflight;
};

let warmed = false;

/**
 * Fetch the chunk while the browser is idle.
 *
 * This is not an optimisation, it is what makes the feature work. On a pointer
 * sweep down the rail the ~35 kB lands long after the pointer has left, so
 * "import on first hover" animates nothing on the first hover — and the first
 * hover is the one a reader notices. Warming turns that into a real animation.
 *
 * Called only by an icon that has already decided it is `animated`, so a page
 * with no animated icons never pays and reduced motion never warms.
 */
export const warmVariants = (): void => {
    if (warmed || cache || inflight) return;
    warmed = true;
    const idle: (callback: () => void) => void =
        typeof window.requestIdleCallback === "function"
            ? (callback) => window.requestIdleCallback(callback, { timeout: 3000 })
            : // Safari only shipped requestIdleCallback in 17.
              (callback) => window.setTimeout(callback, 1500);
    // Staying static forever is a perfectly good failure: swallow it rather
    // than logging on every reader whose network dropped one request.
    idle(() => void loadVariants().catch(() => {}));
};
