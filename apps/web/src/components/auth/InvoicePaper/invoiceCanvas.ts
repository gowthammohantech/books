/**
 * Draws the invoice that gets printed on the floating sheet — plain Canvas 2D,
 * no `three` import anywhere in this file.
 *
 * That last part is the whole reason this is its own module. The static
 * fallback (reduced motion, narrow viewport, no WebGL) still wants the real
 * invoice art rather than a grey rectangle, and it must get it without pulling
 * the 3D chunk down. So the drawing lives here, `invoiceTexture.ts` is the
 * thin `three` wrapper on top, and only the scene chunk ever reaches the
 * wrapper.
 *
 * Everything on the page is fictional and internally consistent: the line
 * amounts add up to the taxable value, 9% + 9% of that plus the round-off give
 * the printed total, and supplier and buyer are both in Karnataka, which is
 * why the tax splits CGST/SGST rather than being IGST. Someone who reads
 * invoices for a living will look at this; it should survive that.
 *
 * It is drawn for a sheet about 440 CSS pixels wide, not for A4. That is the
 * constraint the first version missed: authored at a real invoice's
 * proportions, the body type came out under 7 CSS pixels on a 1920 window — the
 * page was there, correct to the last rupee, and unreadable. Type is sized
 * through `TYPE` below and checked against the sheet's real on-screen width in
 * invoiceCanvas.test.ts, and the content was cut back until that type fitted.
 * A hero invoice is a different document from a printed one and has to be set
 * like one.
 */

import { BRAND_MARK } from "@utils/brandLogo";

/**
 * The drawing is authored at A4 proportions and then scaled to whatever
 * texture size the device warrants, so every measurement below is in these
 * units and none of them change with dpr.
 */
export const DESIGN_WIDTH = 1536;
export const DESIGN_HEIGHT = 2172;
const MARGIN = 104;
const CONTENT_RIGHT = DESIGN_WIDTH - MARGIN;
/** Nothing is drawn below this. */
const CONTENT_BOTTOM = DESIGN_HEIGHT - MARGIN;

/**
 * Every type size on the sheet, in design units.
 *
 * Named and collected rather than spelled inline at each `ctx.font` so the
 * legibility test can walk them: the rule this feature broke is "no type on the
 * sheet may render below ~8 CSS pixels", and that rule can only be enforced
 * against a list. A literal size in the drawing code below is a hole in it.
 */
export const TYPE = {
    /** Tracked all-caps field labels — the smallest thing on the page. */
    micro: 30,
    /** HSN codes and other secondary column values. */
    small: 32,
    body: 34,
    strong: 36,
    /** Meta values: invoice number, dates, GSTIN. */
    field: 40,
    mark: 46,
    party: 46,
    totalLabel: 48,
    brand: 52,
    totalValue: 60,
    title: 64,
    stamp: 148,
} as const;

const FONT_STACK = 'ui-sans-serif, Inter, Helvetica, Arial, sans-serif';

export interface InvoiceCanvasOptions {
    /** Long edge of the produced canvas, in device pixels. */
    size?: number;
    /**
     * The decoded brand logo, if it has loaded.
     *
     * Optional, and the drawing is complete without it: this is baked
     * synchronously so the scene's init effect can stay synchronous, and the
     * first bake usually happens before the PNG has decoded. Absent, the
     * letterhead falls back to the "EB" monogram it always drew, and the caller
     * rebakes once `loadBrandLogo` resolves. An invoice with no letterhead at
     * all would be the one visibly broken state.
     */
    logo?: CanvasImageSource | null;
    /** Printed ink. */
    ink?: string;
    /** Stock colour. */
    paper?: string;
    /** The PAID stamp. */
    gold?: string;
}

interface LineItem {
    description: string;
    /** HSN for goods, SAC for the service line. */
    code: string;
    qty: number;
    unit: string;
    rate: number;
}

/**
 * Three lines, not four, and the descriptions are short.
 *
 * Both are consequences of the type scale. At `TYPE.body` a fourth row pushes
 * the totals into the signature block, and a description longer than about
 * twenty-five characters runs into the HSN column. Two goods lines and a
 * service line is still enough to be a real invoice — it is what makes the
 * SAC code and the mixed unit column believable.
 */
const ITEMS: LineItem[] = [
    { description: "Ergonomic task chair", code: "9401", qty: 12, unit: "Nos", rate: 4850 },
    { description: "Height-adjustable desk", code: "9403", qty: 8, unit: "Nos", rate: 7940 },
    { description: "Installation & assembly", code: "9987", qty: 1, unit: "Job", rate: 15763 },
];

const GST_HALF_RATE = 0.09;

const money = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

/** Ink at a reduced strength, for labels and rules. */
const withAlpha = (hex: string, alpha: number): string => {
    const value = hex.replace("#", "");
    const full =
        value.length === 3
            ? value
                  .split("")
                  .map((c) => c + c)
                  .join("")
            : value;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const font = (weight: number, size: number): string =>
    `${weight} ${size}px ${FONT_STACK}`;

/**
 * Letterspacing, drawn a glyph at a time.
 *
 * `ctx.letterSpacing` would be one line, but it is Chromium-only and this same
 * canvas backs the no-WebGL fallback, which is exactly the browser least
 * likely to have it.
 */
const trackedText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    tracking: number,
    align: "left" | "center" | "right" = "left",
): void => {
    const glyphs = [...text];
    const widths = glyphs.map((glyph) => ctx.measureText(glyph).width);
    const total =
        widths.reduce((sum, width) => sum + width, 0) +
        tracking * Math.max(0, glyphs.length - 1);
    const previousAlign = ctx.textAlign;
    ctx.textAlign = "left";
    let cursor = x;
    if (align === "right") cursor = x - total;
    if (align === "center") cursor = x - total / 2;
    glyphs.forEach((glyph, index) => {
        ctx.fillText(glyph, cursor, y);
        cursor += widths[index] + tracking;
    });
    ctx.textAlign = previousAlign;
};

const hairline = (
    ctx: CanvasRenderingContext2D,
    y: number,
    color: string,
    from = MARGIN,
    to = CONTENT_RIGHT,
): void => {
    ctx.strokeStyle = color;
    // A hair at this scale is a hair no longer: the sheet is minified about
    // 1.6x into its texture and then again onto ~440 screen pixels, and a
    // 1.5-unit rule disappears into the mip. 2.4 survives it and still reads
    // as a rule rather than a border.
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(from, y);
    ctx.lineTo(to, y);
    ctx.stroke();
};

const roundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
): void => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
};

/**
 * The page's vertical rhythm, as data.
 *
 * Baselines were inline numbers before, which is how the type scale and the
 * layout got to disagree without anything noticing. Collected here they can be
 * asserted in order and against the bottom margin, so a future size change that
 * pushes the signature block off the page fails a test rather than shipping.
 */
export const BASELINES = {
    brand: 152,
    brandAddress: 196,
    title: 156,
    titleNote: 200,
    headerRule: 252,

    metaLabelTop: 322,
    metaValueTop: 376,
    metaLabelBottom: 452,
    metaValueBottom: 506,
    metaRule: 556,

    billToLabel: 616,
    billToName: 676,
    billToStreet: 724,
    billToCity: 768,
    billToGstin: 812,
    billToRule: 864,

    tableHeaderTop: 906,
    tableRowsTop: 982,

    totalsTop: 1390,
    totalRule: 1600,
    total: 1654,
    totalUnderline: 1690,

    wordsLabel: 1776,
    words: 1828,

    declarationLabel: 1920,
    declaration: 1968,
    signatureRule: 2010,
    signatory: 2050,
} as const;

const TABLE_HEADER_HEIGHT = 76;
const TABLE_ROW_HEIGHT = 104;
const TOTALS_ROW_STEP = 60;

/**
 * The item table's right-aligned column edges, in design units.
 *
 * Spaced by the widest value each column can hold at its own type size rather
 * than evenly: "15,763.00" at `TYPE.body` is about 160 units, so anything under
 * that gap puts the rate hard against the quantity.
 */
const COLUMNS = {
    index: MARGIN + 22,
    description: MARGIN + 64,
    code: 776,
    qty: 950,
    rate: 1148,
    amount: CONTENT_RIGHT,
} as const;

const labelValue = (
    ctx: CanvasRenderingContext2D,
    label: string,
    value: string,
    x: number,
    labelY: number,
    valueY: number,
    ink: string,
): void => {
    ctx.textAlign = "left";
    ctx.fillStyle = withAlpha(ink, 0.58);
    ctx.font = font(600, TYPE.micro);
    trackedText(ctx, label.toUpperCase(), x, labelY, 3);
    ctx.fillStyle = ink;
    ctx.font = font(600, TYPE.field);
    ctx.fillText(value, x, valueY);
};

/**
 * Bakes the invoice into an offscreen canvas.
 *
 * Called once per texture size — on mount and on a devicePixelRatio change —
 * and never per frame; at 2048px this is a few milliseconds of Canvas 2D work
 * that would otherwise be a dropped frame every frame.
 */
export const createInvoiceCanvas = ({
    size = 2048,
    logo = null,
    ink = "#1a1f3a",
    paper = "#f6f7fb",
    gold = "#f0b429",
}: InvoiceCanvasOptions = {}): HTMLCanvasElement => {
    const scale = size / DESIGN_HEIGHT;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(DESIGN_WIDTH * scale);
    canvas.height = Math.round(size);

    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.scale(scale, scale);
    ctx.textBaseline = "alphabetic";

    // Both a step up from the first version. Ink that reads as a soft grey on a
    // full-size page reads as nothing once the page is a third of a panel, and
    // the sheet is translucent on top of that.
    const rule = withAlpha(ink, 0.24);
    // 0.68, not the 0.58 a printed page would use. Screenshots at 1x showed the
    // secondary lines — the addresses, the HSN codes, the totals labels — as the
    // only things still reading as grey mush, because they carry two penalties
    // the primary ink does not: they are set lighter *and* smaller, and the
    // sheet is translucent underneath both.
    const faint = withAlpha(ink, 0.68);

    // --- Stock -------------------------------------------------------------
    // A flat fill reads as a screenshot pasted onto a plane. The gradient is
    // barely perceptible on its own but it is what sells the sheet as paper
    // once the transmission and the curl are on top of it.
    const stock = ctx.createLinearGradient(0, 0, 0, DESIGN_HEIGHT);
    stock.addColorStop(0, paper);
    stock.addColorStop(0.55, "#ffffff");
    stock.addColorStop(1, paper);
    ctx.fillStyle = stock;
    ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

    // --- Header ------------------------------------------------------------
    // The chevron mark, not the full lockup: the company name is set in type
    // immediately to its right, and the lockup carries its own wordmark — the
    // letterhead would read "Elixir Books Elixir Book Traders".
    //
    // The mark is narrower than the monogram block it replaced, so the name
    // tracks whichever was drawn rather than sitting at a fixed x. A constant
    // there would leave a 66-unit hole in the letterhead on the logo path and
    // an overlap on the fallback.
    const LETTERHEAD_HEIGHT = 112;
    let letterheadRight: number;
    if (logo) {
        const width = (BRAND_MARK.width / BRAND_MARK.height) * LETTERHEAD_HEIGHT;
        ctx.drawImage(
            logo,
            BRAND_MARK.x,
            BRAND_MARK.y,
            BRAND_MARK.width,
            BRAND_MARK.height,
            MARGIN,
            96,
            width,
            LETTERHEAD_HEIGHT,
        );
        letterheadRight = MARGIN + width;
    } else {
        ctx.fillStyle = ink;
        roundedRect(ctx, MARGIN, 96, LETTERHEAD_HEIGHT, LETTERHEAD_HEIGHT, 26);
        ctx.fill();

        ctx.fillStyle = paper;
        ctx.font = font(700, TYPE.mark);
        ctx.textAlign = "center";
        ctx.fillText("EB", MARGIN + LETTERHEAD_HEIGHT / 2, 170);
        letterheadRight = MARGIN + LETTERHEAD_HEIGHT;
    }
    const nameX = letterheadRight + 32;

    ctx.textAlign = "left";
    ctx.fillStyle = ink;
    ctx.font = font(700, TYPE.brand);
    ctx.fillText("Elixir Book Traders", nameX, BASELINES.brand);
    ctx.fillStyle = faint;
    ctx.font = font(500, TYPE.small);
    ctx.fillText("Indiranagar, Bengaluru 560038", nameX, BASELINES.brandAddress);

    ctx.fillStyle = ink;
    ctx.font = font(700, TYPE.title);
    trackedText(ctx, "TAX INVOICE", CONTENT_RIGHT, BASELINES.title, 18, "right");
    ctx.fillStyle = faint;
    ctx.font = font(600, TYPE.micro);
    trackedText(ctx, "ORIGINAL FOR RECIPIENT", CONTENT_RIGHT, BASELINES.titleNote, 3, "right");

    hairline(ctx, BASELINES.headerRule, rule);

    // --- Invoice meta ------------------------------------------------------
    // Three columns still, because dropping to two would have meant dropping
    // fields, and "whether tax is payable on reverse charge" is one a real tax
    // invoice has to carry. At TYPE.field the longest value here, the GSTIN, is
    // about 360 units against a 464-unit column.
    const metaColumns = [MARGIN, MARGIN + 464, MARGIN + 928];
    const meta = [
        ["Invoice no.", "EB/2026/0417"],
        ["Invoice date", "17 Apr 2026"],
        ["Due date", "01 May 2026"],
        ["GSTIN", "29ABCDE1234F1Z5"],
        ["Place of supply", "Karnataka (29)"],
        ["Reverse charge", "No"],
    ] as const;
    meta.forEach(([label, value], index) => {
        const bottomRow = index >= metaColumns.length;
        labelValue(
            ctx,
            label,
            value,
            metaColumns[index % metaColumns.length],
            bottomRow ? BASELINES.metaLabelBottom : BASELINES.metaLabelTop,
            bottomRow ? BASELINES.metaValueBottom : BASELINES.metaValueTop,
            ink,
        );
    });

    hairline(ctx, BASELINES.metaRule, rule);

    // --- Bill to -----------------------------------------------------------
    ctx.fillStyle = faint;
    ctx.font = font(600, TYPE.micro);
    trackedText(ctx, "BILL TO", MARGIN, BASELINES.billToLabel, 3);

    ctx.fillStyle = ink;
    ctx.font = font(700, TYPE.party);
    ctx.fillText("Nandi Ridge Workspaces Pvt Ltd", MARGIN, BASELINES.billToName);
    ctx.fillStyle = faint;
    ctx.font = font(500, TYPE.body);
    ctx.fillText("4th Floor, Rukmini Towers, Residency Road", MARGIN, BASELINES.billToStreet);
    ctx.fillText("Bengaluru, Karnataka 560025", MARGIN, BASELINES.billToCity);
    ctx.fillText("GSTIN 29AAGCN4321M1ZP", MARGIN, BASELINES.billToGstin);

    hairline(ctx, BASELINES.billToRule, rule);

    // --- Line items --------------------------------------------------------
    const headerTop = BASELINES.tableHeaderTop;
    // 7% of the ink, not a grey: a neutral tint against a warm-white stock
    // reads as a printing artefact rather than as part of the design.
    ctx.fillStyle = withAlpha(ink, 0.07);
    ctx.fillRect(MARGIN, headerTop, CONTENT_RIGHT - MARGIN, TABLE_HEADER_HEIGHT);

    ctx.fillStyle = faint;
    ctx.font = font(700, TYPE.micro);
    const headerBaseline = headerTop + 52;
    ctx.textAlign = "left";
    trackedText(ctx, "#", COLUMNS.index, headerBaseline, 2.5);
    trackedText(ctx, "DESCRIPTION", COLUMNS.description, headerBaseline, 2.5);
    trackedText(ctx, "HSN/SAC", COLUMNS.code, headerBaseline, 2.5, "right");
    trackedText(ctx, "QTY", COLUMNS.qty, headerBaseline, 2.5, "right");
    trackedText(ctx, "RATE", COLUMNS.rate, headerBaseline, 2.5, "right");
    trackedText(ctx, "AMOUNT", COLUMNS.amount, headerBaseline, 2.5, "right");

    let taxable = 0;
    ITEMS.forEach((item, index) => {
        const amount = item.qty * item.rate;
        taxable += amount;
        const top = BASELINES.tableRowsTop + TABLE_ROW_HEIGHT * index;
        const baseline = top + 62;

        ctx.textAlign = "left";
        ctx.fillStyle = faint;
        ctx.font = font(500, TYPE.small);
        ctx.fillText(String(index + 1), COLUMNS.index, baseline);

        ctx.fillStyle = ink;
        ctx.font = font(600, TYPE.body);
        ctx.fillText(item.description, COLUMNS.description, baseline);

        ctx.textAlign = "right";
        ctx.fillStyle = faint;
        ctx.font = font(500, TYPE.small);
        ctx.fillText(item.code, COLUMNS.code, baseline);
        ctx.fillStyle = ink;
        ctx.font = font(500, TYPE.body);
        ctx.fillText(`${item.qty} ${item.unit}`, COLUMNS.qty, baseline);
        ctx.fillText(money.format(item.rate), COLUMNS.rate, baseline);
        ctx.font = font(600, TYPE.strong);
        ctx.fillText(money.format(amount), COLUMNS.amount, baseline);

        hairline(ctx, top + TABLE_ROW_HEIGHT, rule);
    });

    // --- Totals ------------------------------------------------------------
    const halfTax = Math.round(taxable * GST_HALF_RATE * 100) / 100;
    const beforeRounding = taxable + halfTax * 2;
    const total = Math.round(beforeRounding);
    const roundOff = Math.round((total - beforeRounding) * 100) / 100;

    const totalsLabelX = COLUMNS.amount - 560;
    let totalsY = BASELINES.totalsTop;
    const totalsRow = (label: string, value: string) => {
        ctx.textAlign = "left";
        ctx.fillStyle = faint;
        ctx.font = font(500, TYPE.body);
        ctx.fillText(label, totalsLabelX, totalsY);
        ctx.textAlign = "right";
        ctx.fillStyle = ink;
        ctx.font = font(600, TYPE.strong);
        ctx.fillText(value, COLUMNS.amount, totalsY);
        totalsY += TOTALS_ROW_STEP;
    };

    totalsRow("Taxable value", money.format(taxable));
    totalsRow("CGST 9%", money.format(halfTax));
    totalsRow("SGST 9%", money.format(halfTax));
    totalsRow("Round off", `${roundOff < 0 ? "−" : "+"}${money.format(Math.abs(roundOff))}`);

    hairline(ctx, BASELINES.totalRule, rule, totalsLabelX, COLUMNS.amount);

    ctx.textAlign = "left";
    ctx.fillStyle = ink;
    ctx.font = font(700, TYPE.totalLabel);
    ctx.fillText("Total", totalsLabelX, BASELINES.total);
    ctx.textAlign = "right";
    ctx.font = font(700, TYPE.totalValue);
    ctx.fillText(`₹ ${money.format(total)}`, COLUMNS.amount, BASELINES.total);

    hairline(ctx, BASELINES.totalUnderline, withAlpha(ink, 0.34), totalsLabelX, COLUMNS.amount);

    ctx.textAlign = "left";
    ctx.fillStyle = faint;
    ctx.font = font(600, TYPE.micro);
    trackedText(ctx, "AMOUNT IN WORDS", MARGIN, BASELINES.wordsLabel, 3);
    ctx.fillStyle = ink;
    ctx.font = font(500, TYPE.body);
    // Matches the computed total above; if ITEMS change, this line does too.
    ctx.fillText(
        "Rupees One Lakh Sixty Two Thousand Two Hundred Thirty Only",
        MARGIN,
        BASELINES.words,
    );

    // --- PAID stamp --------------------------------------------------------
    // 8% keeps it as texture rather than as an obstruction: a stamp that
    // obscures a figure is a stamp that makes the invoice unreadable, which is
    // the one thing this decoration must not do. Parked left of the totals
    // column for the same reason.
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.translate(MARGIN + 330, 1560);
    ctx.rotate((-16 * Math.PI) / 180);
    ctx.fillStyle = gold;
    ctx.strokeStyle = gold;
    ctx.lineWidth = 11;
    roundedRect(ctx, -250, -105, 500, 210, 26);
    ctx.stroke();
    ctx.font = font(700, TYPE.stamp);
    trackedText(ctx, "PAID", 0, 54, 22, "center");
    ctx.restore();

    // --- Signature block ---------------------------------------------------
    ctx.textAlign = "left";
    ctx.fillStyle = faint;
    ctx.font = font(600, TYPE.micro);
    trackedText(ctx, "DECLARATION", MARGIN, BASELINES.declarationLabel, 3);
    ctx.font = font(500, TYPE.small);
    // One line, not two. The second was the first thing the type scale spent.
    ctx.fillText(
        "We certify that the particulars above are true and correct.",
        MARGIN,
        BASELINES.declaration,
    );

    ctx.textAlign = "right";
    ctx.fillStyle = ink;
    ctx.font = font(600, TYPE.strong);
    ctx.fillText("For Elixir Book Traders", CONTENT_RIGHT, BASELINES.declarationLabel);
    hairline(ctx, BASELINES.signatureRule, withAlpha(ink, 0.34), CONTENT_RIGHT - 460, CONTENT_RIGHT);
    ctx.fillStyle = faint;
    ctx.font = font(500, TYPE.micro);
    ctx.fillText("Authorised signatory", CONTENT_RIGHT, BASELINES.signatory);

    return canvas;
};

/** Where the table and totals end up, for the layout test to check the flow. */
export const layoutExtents = () => ({
    tableBottom: BASELINES.tableRowsTop + TABLE_ROW_HEIGHT * ITEMS.length,
    totalsBottom: BASELINES.totalsTop + TOTALS_ROW_STEP * 3,
    contentBottom: CONTENT_BOTTOM,
    itemCount: ITEMS.length,
});
