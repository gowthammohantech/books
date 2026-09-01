/**
 * Auto-generated product code/barcode helpers.
 * Extracted from CreateProductForm/ProductForm — the two forms had byte-identical
 * copies of this logic; kept here so they can't drift.
 */

export function generateProductCode(): string {
    return `PROD-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
}

export function generateRandomBarcode(): string {
    return Math.random().toString().slice(2, 15);
}
