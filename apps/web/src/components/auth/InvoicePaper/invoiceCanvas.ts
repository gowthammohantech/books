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
 */

/**
 * The drawing is authored at A4 proportions and then scaled to whatever
 * texture size the device warrants, so every measurement below is in these
 * units and none of them change with dpr.
 */
const DESIGN_WIDTH = 1536;
const DESIGN_HEIGHT = 2172;
const MARGIN = 104;
const CONTENT_RIGHT = DESIGN_WIDTH - MARGIN;

const FONT_STACK = 'ui-sans-serif, Inter, Helvetica, Arial, sans-serif';

export interface InvoiceCanvasOptions {
    /** Long edge of the produced canvas, in device pixels. */
    size?: number;
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

const ITEMS: LineItem[] = [
    { description: "Ergonomic task chair, mesh back", code: "9401", qty: 12, unit: "Nos", rate: 4850 },
    { description: "Height-adjustable desk, 1500 mm", code: "9403", qty: 8, unit: "Nos", rate: 7940 },
    { description: "Filing cabinet, 4-drawer steel", code: "9403", qty: 6, unit: "Nos", rate: 3120 },
    { description: "Installation & on-site assembly", code: "9987", qty: 1, unit: "Job", rate: 15763 },
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
    ctx.lineWidth = 1.5;
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

const labelValue = (
    ctx: CanvasRenderingContext2D,
    label: string,
    value: string,
    x: number,
    labelY: number,
    ink: string,
): void => {
    ctx.textAlign = "left";
    ctx.fillStyle = withAlpha(ink, 0.55);
    ctx.font = font(600, 20);
    trackedText(ctx, label.toUpperCase(), x, labelY, 2.4);
    ctx.fillStyle = ink;
    ctx.font = font(600, 27);
    ctx.fillText(value, x, labelY + 38);
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

    const rule = withAlpha(ink, 0.16);
    const faint = withAlpha(ink, 0.55);

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
    ctx.fillStyle = ink;
    roundedRect(ctx, MARGIN, 96, 78, 78, 18);
    ctx.fill();

    ctx.fillStyle = paper;
    ctx.font = font(700, 32);
    ctx.textAlign = "center";
    ctx.fillText("EB", MARGIN + 39, 147);

    ctx.textAlign = "left";
    ctx.fillStyle = ink;
    ctx.font = font(700, 36);
    ctx.fillText("Elixir Book Traders", MARGIN + 104, 131);
    ctx.fillStyle = faint;
    ctx.font = font(500, 23);
    ctx.fillText("Indiranagar, Bengaluru 560038", MARGIN + 104, 166);

    ctx.fillStyle = ink;
    ctx.font = font(700, 42);
    trackedText(ctx, "TAX INVOICE", CONTENT_RIGHT, 132, 13, "right");
    ctx.fillStyle = faint;
    ctx.font = font(600, 20);
    trackedText(ctx, "ORIGINAL FOR RECIPIENT", CONTENT_RIGHT, 168, 2.4, "right");

    hairline(ctx, 214, rule);

    // --- Invoice meta ------------------------------------------------------
    const metaColumns = [MARGIN, MARGIN + 470, MARGIN + 930];
    labelValue(ctx, "Invoice no.", "EB/2026/0417", metaColumns[0], 272, ink);
    labelValue(ctx, "Invoice date", "17 Apr 2026", metaColumns[1], 272, ink);
    labelValue(ctx, "Due date", "01 May 2026", metaColumns[2], 272, ink);
    labelValue(ctx, "GSTIN", "29ABCDE1234F1Z5", metaColumns[0], 372, ink);
    labelValue(ctx, "Place of supply", "Karnataka (29)", metaColumns[1], 372, ink);
    labelValue(ctx, "Reverse charge", "No", metaColumns[2], 372, ink);

    hairline(ctx, 462, rule);

    // --- Bill to -----------------------------------------------------------
    ctx.fillStyle = faint;
    ctx.font = font(600, 20);
    trackedText(ctx, "BILL TO", MARGIN, 522, 2.4);

    ctx.fillStyle = ink;
    ctx.font = font(700, 31);
    ctx.fillText("Nandi Ridge Workspaces Pvt Ltd", MARGIN, 568);
    ctx.fillStyle = faint;
    ctx.font = font(500, 24);
    ctx.fillText("4th Floor, Rukmini Towers, Residency Road", MARGIN, 608);
    ctx.fillText("Bengaluru, Karnataka 560025", MARGIN, 642);
    ctx.fillText("GSTIN 29AAGCN4321M1ZP", MARGIN, 676);

    hairline(ctx, 720, rule);

    // --- Line items --------------------------------------------------------
    const amountX = CONTENT_RIGHT - 16;
    const rateX = amountX - 236;
    const qtyX = rateX - 152;
    const codeX = qtyX - 128;
    const descriptionX = MARGIN + 74;

    const headerTop = 758;
    const headerHeight = 60;
    // 6% of the ink, not a grey: a neutral tint against a warm-white stock
    // reads as a printing artefact rather than as part of the design.
    ctx.fillStyle = withAlpha(ink, 0.06);
    ctx.fillRect(MARGIN, headerTop, CONTENT_RIGHT - MARGIN, headerHeight);

    ctx.fillStyle = faint;
    ctx.font = font(700, 20);
    const headerBaseline = headerTop + 39;
    ctx.textAlign = "left";
    trackedText(ctx, "#", MARGIN + 22, headerBaseline, 2);
    trackedText(ctx, "DESCRIPTION", descriptionX, headerBaseline, 2);
    trackedText(ctx, "HSN/SAC", codeX, headerBaseline, 2, "right");
    trackedText(ctx, "QTY", qtyX, headerBaseline, 2, "right");
    trackedText(ctx, "RATE", rateX, headerBaseline, 2, "right");
    trackedText(ctx, "AMOUNT", amountX, headerBaseline, 2, "right");

    const rowHeight = 82;
    let taxable = 0;
    ITEMS.forEach((item, index) => {
        const amount = item.qty * item.rate;
        taxable += amount;
        const top = headerTop + headerHeight + rowHeight * index;
        const baseline = top + 40;

        ctx.textAlign = "left";
        ctx.fillStyle = faint;
        ctx.font = font(500, 23);
        ctx.fillText(String(index + 1), MARGIN + 22, baseline);

        ctx.fillStyle = ink;
        ctx.font = font(600, 26);
        ctx.fillText(item.description, descriptionX, baseline);
        ctx.fillStyle = faint;
        ctx.font = font(500, 21);
        ctx.fillText(`${item.qty} ${item.unit} · GST 18%`, descriptionX, baseline + 30);

        ctx.textAlign = "right";
        ctx.fillStyle = faint;
        ctx.font = font(500, 24);
        ctx.fillText(item.code, codeX, baseline);
        ctx.fillStyle = ink;
        ctx.fillText(String(item.qty), qtyX, baseline);
        ctx.fillText(money.format(item.rate), rateX, baseline);
        ctx.font = font(600, 25);
        ctx.fillText(money.format(amount), amountX, baseline);

        hairline(ctx, top + rowHeight, rule);
    });

    // --- Totals ------------------------------------------------------------
    const halfTax = Math.round(taxable * GST_HALF_RATE * 100) / 100;
    const beforeRounding = taxable + halfTax * 2;
    const total = Math.round(beforeRounding);
    const roundOff = Math.round((total - beforeRounding) * 100) / 100;

    const totalsLabelX = amountX - 470;
    let totalsY = headerTop + headerHeight + rowHeight * ITEMS.length + 84;
    const totalsRow = (label: string, value: string) => {
        ctx.textAlign = "left";
        ctx.fillStyle = faint;
        ctx.font = font(500, 24);
        ctx.fillText(label, totalsLabelX, totalsY);
        ctx.textAlign = "right";
        ctx.fillStyle = ink;
        ctx.font = font(600, 25);
        ctx.fillText(value, amountX, totalsY);
        totalsY += 48;
    };

    totalsRow("Taxable value", money.format(taxable));
    totalsRow("CGST 9%", money.format(halfTax));
    totalsRow("SGST 9%", money.format(halfTax));
    totalsRow("Round off", `${roundOff < 0 ? "−" : "+"}${money.format(Math.abs(roundOff))}`);

    hairline(ctx, totalsY - 22, rule, totalsLabelX, amountX);

    totalsY += 34;
    ctx.textAlign = "left";
    ctx.fillStyle = ink;
    ctx.font = font(700, 34);
    ctx.fillText("Total", totalsLabelX, totalsY);
    ctx.textAlign = "right";
    ctx.font = font(700, 40);
    ctx.fillText(`₹ ${money.format(total)}`, amountX, totalsY);

    hairline(ctx, totalsY + 26, withAlpha(ink, 0.3), totalsLabelX, amountX);

    ctx.textAlign = "left";
    ctx.fillStyle = faint;
    ctx.font = font(600, 20);
    trackedText(ctx, "AMOUNT IN WORDS", MARGIN, totalsY + 96, 2.4);
    ctx.fillStyle = ink;
    ctx.font = font(500, 24);
    // Matches the computed total above; if ITEMS change, this line does too.
    ctx.fillText(
        "Rupees One Lakh Eighty Four Thousand Three Hundred Twenty Only",
        MARGIN,
        totalsY + 136,
    );

    // --- PAID stamp --------------------------------------------------------
    // Under the type rather than over it: a stamp that obscures a figure is a
    // stamp that makes the invoice unreadable, which is the one thing this
    // decoration must not do. 8% keeps it as texture.
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.translate(MARGIN + 300, totalsY - 40);
    ctx.rotate((-16 * Math.PI) / 180);
    ctx.fillStyle = gold;
    ctx.strokeStyle = gold;
    ctx.lineWidth = 9;
    roundedRect(ctx, -230, -96, 460, 192, 24);
    ctx.stroke();
    ctx.font = font(700, 116);
    trackedText(ctx, "PAID", 0, 42, 18, "center");
    ctx.restore();

    // --- Signature block ---------------------------------------------------
    ctx.textAlign = "left";
    ctx.fillStyle = faint;
    ctx.font = font(600, 20);
    trackedText(ctx, "DECLARATION", MARGIN, 1888, 2.4);
    ctx.font = font(500, 21);
    ctx.fillText(
        "We certify that the particulars given above are true and correct, and",
        MARGIN,
        1926,
    );
    ctx.fillText("that this invoice reflects the actual price of the goods supplied.", MARGIN, 1958);

    ctx.textAlign = "right";
    ctx.fillStyle = ink;
    ctx.font = font(600, 24);
    ctx.fillText("For Elixir Book Traders", CONTENT_RIGHT, 1888);
    hairline(ctx, 1998, withAlpha(ink, 0.3), CONTENT_RIGHT - 380, CONTENT_RIGHT);
    ctx.fillStyle = faint;
    ctx.font = font(500, 21);
    ctx.fillText("Authorised signatory", CONTENT_RIGHT, 2036);

    return canvas;
};
