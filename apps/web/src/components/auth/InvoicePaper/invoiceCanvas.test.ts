/**
 * The invoice art, checked against the size the sheet is actually drawn at.
 *
 * `createInvoiceCanvas` itself cannot run here — vitest is on `environment:
 * 'node'`, there is no `document` and no Canvas 2D. What can run is the thing
 * that went wrong: the art was authored at a printed invoice's proportions
 * while the sheet renders about 440 CSS pixels wide, so the body type came out
 * under 7 CSS pixels and the invoice was present, arithmetically correct, and
 * unreadable. That is a units mismatch between two modules, and a units
 * mismatch is exactly what a unit test catches.
 *
 * So the type scale and the page's baselines are exported as data, and this
 * file holds them against `sheetScreenWidth`. A future change to HEIGHT_FILL, to
 * the panel breakpoint, or to a font size fails here rather than shipping a
 * blurred page.
 */
import { describe, expect, it } from "vitest";

import { BASELINES, DESIGN_WIDTH, TYPE, layoutExtents } from "./invoiceCanvas";
import {
    MAX_TILT,
    MAX_TURN,
    MAX_YAW,
    clampTurn,
    foreshortening,
    sheetScreenWidth,
} from "./invoicePaperSupport";

/**
 * The panel is half the viewport, full height. These are the three windows
 * worth caring about: the breakpoint itself, the common laptop, and 1080p.
 */
const PANELS = {
    "1024x800": [512, 800],
    "1440x900": [720, 900],
    "1920x1080": [960, 1080],
} as const;

/**
 * Smallest type that still reads on a translucent, tilted sheet, in CSS pixels.
 *
 * Not a typography rule — a rule about this sheet. Below about eight the
 * glyphs are gone by the time the texture has been minified into its mip chain
 * and the sheet has been yawed away from the viewer, and what is left reads as
 * grey noise where an invoice should be.
 */
const LEGIBLE_MIN = 8;
/** …and what the body of the document, the part meant to be read, should clear. */
const LEGIBLE_BODY = 9;

const designUnitInCssPx = (width: number, height: number) =>
    sheetScreenWidth(width, height) / DESIGN_WIDTH;

describe("invoice legibility at the size the sheet renders", () => {
    const [width, height] = PANELS["1920x1080"];
    const unit = designUnitInCssPx(width, height);

    it("renders no type below the legible floor", () => {
        const tooSmall = Object.entries(TYPE)
            .map(([name, size]) => [name, size * unit] as const)
            .filter(([, rendered]) => rendered < LEGIBLE_MIN);
        expect(tooSmall).toEqual([]);
    });

    it("renders the document's body type above the body floor", () => {
        expect(TYPE.body * unit).toBeGreaterThanOrEqual(LEGIBLE_BODY);
        expect(TYPE.field * unit).toBeGreaterThanOrEqual(LEGIBLE_BODY);
        expect(TYPE.title * unit).toBeGreaterThanOrEqual(LEGIBLE_BODY * 2);
    });

    it("keeps the smallest type legible down to the panel's own breakpoint", () => {
        // 1024 is the narrowest window that lays the panel out at all, and it
        // is the one case the sheet cannot be sized out of — the panel is 512px
        // wide and the copy needs most of it. A lower floor, honestly stated.
        const narrow = designUnitInCssPx(...PANELS["1024x800"]);
        expect(TYPE.micro * narrow).toBeGreaterThanOrEqual(6);
        expect(TYPE.body * narrow).toBeGreaterThanOrEqual(6.5);
    });

    it("keeps the body type legible at every reachable rotation", () => {
        // Swept rather than spot-checked at the axis limits. The version of
        // this test that only checked one axis at a time passed while a
        // two-axis drag turned the sheet 47.9 degrees, because that state is
        // not on either axis — it is in the corner between them, which is
        // exactly where a per-axis assertion has no opinion.
        const worst = [];
        for (let y = -MAX_YAW; y <= MAX_YAW; y += MAX_YAW / 24) {
            for (let p = -MAX_TILT; p <= MAX_TILT; p += MAX_TILT / 24) {
                const held = clampTurn(y, p);
                worst.push(TYPE.body * unit * foreshortening(held.yaw, held.pitch));
            }
        }
        expect(Math.min(...worst)).toBeGreaterThanOrEqual(LEGIBLE_MIN);
    });

    it("holds the total turn to the limit however the axes are combined", () => {
        const turn = (y: number, p: number) => Math.acos(foreshortening(y, p));
        // The corner case, stated plainly: both axes pinned.
        const pinned = clampTurn(MAX_YAW, MAX_TILT);
        expect(turn(pinned.yaw, pinned.pitch)).toBeLessThanOrEqual(MAX_TURN + 1e-6);
        // A single-axis drag still reaches the full limit — the combined clamp
        // must not quietly cost the sheet the rotation it is allowed.
        const pureYaw = clampTurn(MAX_YAW, 0);
        expect(pureYaw.yaw).toBeCloseTo(MAX_YAW, 6);
        // And a diagonal keeps its direction rather than being bent onto an axis.
        const diagonal = clampTurn(MAX_YAW, MAX_TILT * 0.5);
        expect(diagonal.yaw / diagonal.pitch).toBeCloseTo(MAX_YAW / (MAX_TILT * 0.5), 6);
    });

    it("grows the type as the window does", () => {
        const widths = Object.values(PANELS).map(([w, h]) => sheetScreenWidth(w, h));
        expect(widths).toEqual([...widths].sort((a, b) => a - b));
    });
});

describe("invoice page flow", () => {
    it("runs its baselines strictly down the page", () => {
        const order = Object.values(BASELINES);
        // `title` and `titleNote` sit beside the brand block rather than below
        // it, so the header is checked as a whole and the rest in sequence.
        const body = order.slice(order.indexOf(BASELINES.headerRule));
        expect(body).toEqual([...body].sort((a, b) => a - b));
    });

    it("fits the table and totals between the header and the signature", () => {
        const { tableBottom, totalsBottom } = layoutExtents();
        expect(tableBottom).toBeGreaterThan(BASELINES.tableHeaderTop);
        expect(tableBottom).toBeLessThan(BASELINES.totalsTop);
        expect(totalsBottom).toBeLessThan(BASELINES.totalRule);
        expect(BASELINES.words).toBeLessThan(BASELINES.declarationLabel);
    });

    it("keeps the last line above the bottom margin", () => {
        const { contentBottom } = layoutExtents();
        expect(BASELINES.signatory).toBeLessThanOrEqual(contentBottom);
    });
});
