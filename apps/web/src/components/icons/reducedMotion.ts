/**
 * One `prefers-reduced-motion` MediaQueryList for the whole app.
 *
 * A table page mounts fifty-odd kebabs and the sidebar another fifteen icons.
 * Giving each of them its own matchMedia + listener would be sixty-five
 * subscriptions answering one identical question, so the query lives at module
 * level and components subscribe to it.
 *
 * Read through `useSyncExternalStore`, not a one-shot read in an effect,
 * because macOS exposes "Reduce motion" as a live toggle: InvoicePaper.tsx
 * already re-decides on `change` rather than only at mount, and an icon that
 * kept animating until the next navigation would be a worse promise than one
 * that never animated at all.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

let mql: MediaQueryList | null = null;
const listeners = new Set<() => void>();

/** Lazily created: constructing it at import time would break SSR/node tests. */
const query = (): MediaQueryList => (mql ??= window.matchMedia(QUERY));

const notify = () => {
    for (const listener of listeners) listener();
};

export const prefersReducedMotion = (): boolean => query().matches;

export const subscribeReducedMotion = (onChange: () => void): (() => void) => {
    if (listeners.size === 0) query().addEventListener("change", notify);
    listeners.add(onChange);
    return () => {
        listeners.delete(onChange);
        // Drop the native listener once nothing is watching, so a route change
        // that unmounts every icon leaves nothing attached to the MQL.
        if (listeners.size === 0) query().removeEventListener("change", notify);
    };
};

/**
 * The server/no-DOM answer. `true` — i.e. "reduce" — so that anything rendering
 * without a window degrades to the static glyph rather than reaching for the
 * chunk it cannot load.
 */
export const getReducedMotionServerSnapshot = (): boolean => true;
