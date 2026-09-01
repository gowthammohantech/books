import type { Transition, Variants } from "motion/react";

/**
 * The animation vocabulary, shared by every variant.
 *
 * Adapted from pqoqubbw/icons (MIT). Kept as a handful of named recipes rather
 * than bespoke keyframes per icon so that thirty icons read as one system —
 * and so that an icon pqoqubbw does not ship (most of this app's nav) can be
 * authored in about a dozen lines instead of invented from scratch.
 */

/** lucide's defaultAttributes, reproduced exactly. */
export const SVG_BASE = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
} as const;

export const DEFAULT_TRANSITION: Transition = {
    duration: 0.5,
    ease: "easeInOut",
    opacity: { duration: 0.2 },
};

/**
 * pqoqubbw's signature move: the stroke draws itself in.
 *
 * The one thing here that CSS genuinely cannot do — `pathLength` needs the
 * path measured — and therefore the reason `motion` is a dependency at all.
 * Whole-element transforms stay in index.css where they cost nothing.
 */
export const DRAW: Variants = {
    normal: { pathLength: 1, opacity: 1 },
    animate: { pathLength: [0, 1], opacity: [0, 1] },
};

/** For glyphs with nothing to draw: the whole mark wobbles. */
export const SWING: Variants = {
    normal: { rotate: 0 },
    animate: { rotate: [0, -12, 10, -6, 3, 0] },
};

/** A half turn — the gear, and any icon whose meaning is "again". */
export const SPIN_HALF: Variants = {
    normal: { rotate: 0 },
    animate: { rotate: 180 },
};

export const SPIN: Variants = {
    normal: { rotate: 0 },
    animate: { rotate: 360 },
};

export const POP: Variants = {
    normal: { scale: 1 },
    animate: { scale: [1, 1.16, 1] },
};

export const NUDGE_X: Variants = {
    normal: { x: 0 },
    animate: { x: [0, 2.5, 0] },
};

export const NUDGE_Y: Variants = {
    normal: { y: 0 },
    animate: { y: [0, 2.5, 0] },
};

/**
 * The nth member of a group, entering just behind the one before it.
 *
 * For icons that are a row of things — a chart's bars, a bank's columns, a
 * kebab's dots. The delay is what makes it read as a sequence rather than a
 * flicker.
 */
export const stagger = (index: number): Variants => ({
    normal: { opacity: 1, scale: 1, y: 0 },
    animate: {
        opacity: [0, 1],
        scale: [0.7, 1],
        y: [3, 0],
        transition: { delay: index * 0.07, duration: 0.3 },
    },
});

/**
 * Makes a transform on an SVG child happen about that child's own box.
 *
 * Without `transformBox`, `transform-origin` on an SVG element resolves
 * against the viewBox origin, so a scaled dot flies in from the top-left
 * corner of the glyph instead of popping where it sits.
 */
export const SELF_BOX = {
    transformOrigin: "center",
    transformBox: "fill-box",
} as const;
