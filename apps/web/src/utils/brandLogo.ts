/**
 * The Elixir Books logo, and the two boxes worth cropping out of it.
 *
 * The shipped asset is the full horizontal lockup — the chevron mark followed
 * by the "Elixir Books" wordmark, on transparency. Most places that used to
 * show a hand-set "EB" want only the mark: they already have the company name
 * set in type beside them, and dropping the wordmark in next to it prints the
 * name twice.
 *
 * The crops are source-pixel boxes rather than separate cropped assets so there
 * is one logo file in the repo and one thing to replace when the brand changes.
 * Both a canvas `drawImage` and a CSS `background-position` can take a box;
 * neither can take a promise that a second PNG stayed in sync.
 *
 * Measured off the alpha channel of the asset, not eyeballed. If the file is
 * ever replaced, re-measure — a logo with different padding will crop wrong,
 * and it will crop wrong silently.
 */
import lockupUrl from "@assets/images/elixir-books-lockup.png";

export const BRAND_LOGO_URL = lockupUrl;

/** Natural size of the asset, in pixels. */
export const BRAND_LOGO_SIZE = { width: 956, height: 405 } as const;

export interface LogoCrop {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The chevron mark on its own. Taller than it is wide. */
export const BRAND_MARK: LogoCrop = { x: 87, y: 22, width: 253, height: 364 };

/**
 * CSS for an element that shows exactly one crop of the logo and nothing else.
 *
 * The returned style sizes the element to the crop's own aspect at `height`
 * pixels, and that sizing is load-bearing rather than a convenience: a
 * background is clipped to its element's box and to nothing else, so an element
 * any wider than the crop paints whatever the image has there. Sizing it by the
 * crop alone — offsetting the image with background-position and stopping there
 * — puts the mark in the right place and then prints the first letters of the
 * wordmark beside it. That is what a 6x screenshot of the panel's brand chip
 * showed; no amount of checking the offsets would have found it, because the
 * offsets were right.
 *
 * A background rather than an `<img>`: cropping an `<img>` needs a wrapper with
 * `overflow: hidden` and an absolutely positioned child, which is three
 * elements and a stacking context for what is one paint. Centre it by putting
 * this element in a flex box, not by padding the crop.
 */
export const logoCropStyle = (crop: LogoCrop, height: number): React.CSSProperties => {
    const scale = height / crop.height;
    return {
        width: `${crop.width * scale}px`,
        height: `${height}px`,
        backgroundImage: `url(${BRAND_LOGO_URL})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${BRAND_LOGO_SIZE.width * scale}px ${BRAND_LOGO_SIZE.height * scale}px`,
        backgroundPosition: `${-crop.x * scale}px ${-crop.y * scale}px`,
    };
};

let pending: Promise<HTMLImageElement | null> | null = null;

/**
 * The logo as a decoded image, for the canvas drawings that need one.
 *
 * Resolves to `null` rather than rejecting if the image cannot be decoded: the
 * only callers are decoration, and every one of them has a typeset fallback
 * that is better than a thrown error on an auth page. Memoised, because the
 * invoice texture is rebaked on a devicePixelRatio change and the sheet should
 * not refetch its own letterhead to do it.
 */
export const loadBrandLogo = (): Promise<HTMLImageElement | null> => {
    pending ??= new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = BRAND_LOGO_URL;
    });
    return pending;
};
