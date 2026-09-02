/**
 * The parts of AnimatedIcon that are just decisions.
 *
 * Mirrors invoicePaperSupport.ts: vitest runs on `environment: 'node'` with
 * neither jsdom nor @testing-library installed, so the component itself cannot
 * be tested here. The rule worth getting wrong — when *not* to reach for
 * `motion` — is pulled out as a pure function with no DOM and no `motion`
 * import, and tested next door.
 *
 * Keeping this module DOM-free is also what lets AnimatedIcon.tsx call
 * `decideIconMotion` before it touches the lazy variants chunk.
 */

/** `'animated'` may fetch the motion chunk; `'static'` never does. */
export type IconMotionMode = "animated" | "static";

/**
 * Where the hover/focus that plays an icon comes from.
 *
 *   closest  walk up to the nearest interactive ancestor (the default: the
 *            icon is usually a child of the <Link>/<button> you actually hover)
 *   self     the icon's own parent element
 *   none     never animate — for decorative glyphs like a breadcrumb separator
 */
export type IconTrigger = "closest" | "self" | "none";

/**
 * The kill switch. Flip to false to make every AnimatedIcon in the app render
 * the plain lucide glyph, without touching a single call site and without ever
 * requesting the chunk. This is the cheapest of the four rollback levers.
 */
export const ICON_MOTION_ENABLED = true;

export interface IconMotionInput {
    /** `prefers-reduced-motion: reduce` is set. */
    reducedMotion: boolean;
    /** A variant is registered for this icon name. */
    hasVariant: boolean;
    trigger: IconTrigger;
}

/**
 * The capability gate.
 *
 * The ORDER is load-bearing. `reducedMotion` is checked first so that a reader
 * who has asked for less motion never causes the ~35 kB chunk to be requested —
 * not merely never sees it play. Checking `hasVariant` first would return the
 * same answer while quietly breaking that promise, which is the worst kind of
 * bug: invisible, and only findable by counting network requests.
 */
export const decideIconMotion = ({
    reducedMotion,
    hasVariant,
    trigger,
}: IconMotionInput): IconMotionMode => {
    if (!ICON_MOTION_ENABLED) return "static";
    if (reducedMotion) return "static";
    if (trigger === "none") return "static";
    if (!hasVariant) return "static";
    return "animated";
};

/**
 * What counts as "the thing you hovered", nearest first.
 *
 * `[data-icon-trigger]` leads so a container can opt in ahead of any button it
 * happens to contain. The rest is the set of things a reader can actually point
 * at: in this app that is the sidebar's <Link>/<button> rows, the command
 * palette's option rows, and ActionMenu's portalled menu items.
 */
export const TRIGGER_SELECTOR =
    '[data-icon-trigger],a[href],button,[role="menuitem"],[role="option"],[role="tab"]';

/**
 * How long a `pulseKey` bump holds "animate" before releasing.
 *
 * Slightly longer than the longest variant, so a pulse always completes; the
 * icon is idle either way once it lands back on "normal".
 */
export const ICON_PULSE_MS = 700;
