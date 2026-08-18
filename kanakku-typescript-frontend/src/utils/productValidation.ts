/**
 * Shared product-form validation. Both ProductForm (full page) and
 * CreateProductForm (inline modal) call this — previously each hand-rolled its
 * own `validateForm`, and the two had drifted (different description min-length,
 * and only the modal checked the price relationship / stock-when-tracked rules).
 * Merged rule set (union of both forms' checks — see task report; updated
 * 2026-07-12 for the lean Items spec — name is the only required field):
 *   - Name: required, trimmed length between 2 and 255.
 *   - Selling price < purchase price is only an error when BOTH are non-empty
 *     (equal or zero on either side is fine).
 *   - Stock must be > 0, but only when inventory tracking is enabled.
 */

export interface ProductValidationInput {
    name: string;
    unit: string;
    selling_price: string | number;
    purchase_price: string | number;
    enable_inventory: boolean;
    stock: string | number;
}

export function validateProductForm(data: ProductValidationInput): Record<string, string> {
    const errors: Record<string, string> = {};

    const trimmedName = String(data.name ?? '').trim();
    if (!trimmedName) {
        errors.name = 'Name is required';
    } else if (trimmedName.length < 2 || trimmedName.length > 255) {
        errors.name = 'Name must be between 2 and 255 characters';
    }

    // Price relationship only checked when BOTH prices are actually entered.
    if (data.selling_price !== '' && data.purchase_price !== ''
        && Number(data.selling_price) < Number(data.purchase_price)) {
        errors.selling_price = 'Selling price must be greater than purchase price';
    }

    if (data.enable_inventory && Number(data.stock) <= 0) {
        errors.stock = 'Stock must be greater than 0';
    }

    return errors;
}
