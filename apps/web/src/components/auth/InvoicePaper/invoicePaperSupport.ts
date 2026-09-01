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

/**
 * The sheet's geometry, and where it hangs in the panel.
 *
 * These live here rather than in the scene for one reason: the invoice art is
 * authored against a 1536px-wide A4, and whether its type is legible depends
 * entirely on how many CSS pixels wide the sheet ends up on screen — which is
 * the output of the arithmetic below. Keeping it in the scene module put it
 * behind a `three` import, so the one thing worth asserting about this feature
 * ("is the invoice readable at the size we actually draw it?") could not be
 * asserted at all. Here it is a pure function of the panel's box, and
 * invoiceCanvas.test.ts checks the art against it.
 */
/** A4, as the geometry uses it: width 1, height √2. */
export const SHEET_WIDTH = 1;
export const SHEET_HEIGHT = 1.414;

export const FOV = 35;
const HALF_FOV = (FOV * Math.PI) / 360;

/**
 * Share of the panel's height the sheet occupies at rest, and the most of its
 * width it may take on a tall narrow panel.
 *
 * Sized against the copy, not the panel. The panel's text column is a fixed
 * `max-w-md` off the `p-10` gutter, so it ends at the same pixel however wide
 * the window is — the room left for the sheet is a pixel budget, and a sheet
 * sized as a share of the panel spends it before it exists. At 0.66 the sheet
 * reached back under the headline from about 1440px down, and the only thing
 * hiding the collision was a scrim heavy enough to erase the invoice with it.
 */
export const HEIGHT_FILL = 0.58;
export const WIDTH_FILL = 0.62;
/** Where the sheet's centre sits across the panel. 0 = left edge, 1 = right. */
export const SHEET_CENTER_X = 0.72;
/**
 * Half-widths of clearance kept between the sheet's centre and the frustum
 * edge. Above 0.5 because the sheet yaws and curls, so its silhouette is wider
 * than the flat plane in places.
 */
const EDGE_CLEARANCE = 0.62;

export interface SheetPlacement {
    /** Camera z. */
    distance: number;
    /** The sheet's x offset from the panel's centre, in world units. */
    offsetX: number;
    /** Frustum width at the sheet's plane, in world units. */
    visibleWidth: number;
}

/**
 * How far back the camera sits, and how far right the sheet slides.
 *
 * The distance is solved rather than hard-coded because the panel is half a
 * viewport: its aspect runs from about 0.4 on a tall 1024px window to 1.4 on an
 * ultrawide, and a fixed distance either crops the sheet at one end of that
 * range or strands it mid-panel at the other. The offset is clamped to the room
 * the frustum actually has, so asking for 0.72 costs nothing on a panel too
 * narrow to honour it — there the sheet simply stays nearer the middle.
 */
export const solveSheetPlacement = (width: number, height: number): SheetPlacement => {
    const aspect = width / Math.max(height, 1);
    const span = 2 * Math.tan(HALF_FOV);
    const forHeight = SHEET_HEIGHT / HEIGHT_FILL / span;
    const forWidth = SHEET_WIDTH / WIDTH_FILL / Math.max(aspect, 0.2) / span;
    const distance = Math.max(forHeight, forWidth);
    const visibleWidth = span * distance * aspect;
    const room = Math.max(visibleWidth / 2 - SHEET_WIDTH * EDGE_CLEARANCE, 0);
    return {
        distance,
        offsetX: Math.min(visibleWidth * (SHEET_CENTER_X - 0.5), room),
        visibleWidth,
    };
};

/** Frustum height at a given depth, for sizing the backdrop plane. */
export const frustumHeightAt = (distance: number): number =>
    2 * Math.tan(HALF_FOV) * distance;

/**
 * How wide the sheet renders, in CSS pixels, on a panel of the given box.
 *
 * The number the invoice art has to be legible at. Everything printed on the
 * sheet is authored in design units against a 1536-unit-wide page, so a design
 * unit is worth `sheetScreenWidth / 1536` CSS pixels — which on a 1920 window
 * is a little over a quarter. Type authored at a real invoice's 24 units lands
 * under 7 CSS pixels there, and no amount of texture resolution or anisotropy
 * recovers a glyph that small.
 */
export const sheetScreenWidth = (width: number, height: number): number =>
    (SHEET_WIDTH / solveSheetPlacement(width, height).visibleWidth) * width;

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

/**
 * How far the sheet may turn away from the viewer on either axis, in radians.
 *
 * Not a taste value — it is solved from the type on the sheet. Rotating by
 * θ foreshortens the print by cos θ, and the body type renders at about 9.8 CSS
 * pixels at rest on a 1920 window against a legibility floor of 8. It reaches
 * that floor at acos(8 / 9.8) = 35.3°, so 35° is the widest the sheet can turn
 * while the invoice is still an invoice. invoiceCanvas.test.ts holds the two
 * numbers together.
 */
export const MAX_TILT = (35 * Math.PI) / 180;

/**
 * …and the same limit on yaw, which is the one that was missing.
 *
 * Pitch was clamped from the start; yaw was not, so cursor parallax alone
 * reached -37.8° and a drag or a fling could spin the sheet edge-on. The print
 * was legible at rest and dissolved the moment anyone touched it, which is a
 * worse failure than being small: it happens exactly when someone is looking.
 */
export const MAX_YAW = MAX_TILT;

/**
 * How far the sheet may turn in total, counting both axes at once.
 *
 * Clamping yaw and pitch separately is not the same rule and does not give the
 * same guarantee. A diagonal drag pins both at 35°, and the angle between the
 * sheet's normal and the viewer is then acos(cos 35° · cos 35°) = 47.9°, not
 * 35° — the print foreshortens to 0.67 rather than 0.82 and the page skews as
 * well as shrinking. Screenshots of a two-axis drag are what showed this; the
 * per-axis test passed throughout, because a per-axis test cannot see it.
 *
 * Foreshortening is cos(pitch) · cos(yaw), so that product is the thing with a
 * floor, and this is that floor expressed as an angle.
 */
export const MAX_TURN = MAX_TILT;

/**
 * Scales a yaw/pitch pair back along its own diagonal until the sheet's total
 * turn is within `limit`.
 *
 * Proportional rather than per-axis so the direction of a drag is preserved:
 * clamping the axes independently would bend a diagonal gesture toward whichever
 * axis hit its wall first, which feels like the sheet fighting the cursor. The
 * loop converges in two passes because the turn is very nearly linear in the
 * scale over this range; the fourth is there so the function has no input that
 * can leave it out of bounds.
 */
export const clampTurn = (
    yaw: number,
    pitch: number,
    limit: number = MAX_TURN,
): { yaw: number; pitch: number } => {
    const turnOf = (y: number, p: number) =>
        Math.acos(Math.min(1, Math.max(-1, Math.cos(y) * Math.cos(p))));
    let scale = 1;
    for (let i = 0; i < 4; i += 1) {
        const turn = turnOf(yaw * scale, pitch * scale);
        if (turn <= limit) break;
        scale *= limit / turn;
    }
    return { yaw: yaw * scale, pitch: pitch * scale };
};

/** The share of its flat size the print keeps at a given yaw and pitch. */
export const foreshortening = (yaw: number, pitch: number): number =>
    Math.cos(yaw) * Math.cos(pitch);

/**
 * Clamps a rotation to the readable envelope. Used on both axes — `limit` is a
 * parameter precisely so yaw and pitch can share the arithmetic.
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
