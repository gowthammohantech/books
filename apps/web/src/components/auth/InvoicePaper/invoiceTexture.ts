/**
 * The `three` half of the invoice art: wraps the Canvas 2D drawing in a
 * CanvasTexture with the two settings that are easy to forget and impossible
 * to spot in a screenshot.
 *
 * Kept apart from invoiceCanvas.ts so that the static fallback — which must
 * never load `three` — can still draw the real invoice. This file is only ever
 * reached from the lazily-imported scene chunk.
 */
import { CanvasTexture, SRGBColorSpace } from "three";
import type { WebGLRenderer } from "three";

import { createInvoiceCanvas } from "./invoiceCanvas";
import type { InvoiceCanvasOptions } from "./invoiceCanvas";

export interface InvoiceTextureOptions extends InvoiceCanvasOptions {
    /** Needed only to read the device's anisotropy ceiling. */
    renderer: WebGLRenderer;
}

export const createInvoiceTexture = ({
    renderer,
    ...canvasOptions
}: InvoiceTextureOptions): CanvasTexture => {
    const texture = new CanvasTexture(createInvoiceCanvas(canvasOptions));
    // The canvas is authored in sRGB. Without this the paper renders washed
    // out and the ink loses most of its contrast against it — the exact
    // failure this component cannot afford.
    texture.colorSpace = SRGBColorSpace;
    // The sheet is nearly always seen at an angle. At anisotropy 1 the body
    // text turns to mush the moment it tilts, which is what the maximum buys
    // here — it is a page of 20px type, not a wall texture.
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
    return texture;
};
