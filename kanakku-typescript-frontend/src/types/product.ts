/** Uniform product tax object (backend contract C4). taxRateId is null for
 *  legacy N-member groups (name = group name, rate = summed). */
export interface ProductTaxRate {
    taxRateId: string | null;
    name: string;
    rate: number;
}

export interface ProductFormData {
    name: string;
    unit: string;
    description: string;
    selling_price: string | number;
    taxRateId: string;
    currencyCode?: string;
}

export interface Product {
    id: string;
    item_type: string;
    name: string;
    code: string;
    unit: { id: string; name: string; } | null;
    prices: { selling: number; purchase: number; };
    discount: { type: 'Fixed' | 'Percentage'; value: number; } | null;
    tax: { group_id: string; group_name: string; total_rate: number; } | null;
    tax_rate?: ProductTaxRate | null;
    quantity: number;
    rate: number;
    amount: number;
}

export interface ProductItem {
    id: string;
    name: string;
    unit: string;
    qty: number;
    rate: number;
    discount: number;
    tax: number;
    amount: number;
    tax_group_id?: string;
    tax_rate_id?: string;
    discount_type?: 'Fixed' | 'Percentage';
    discount_value?: number;
}