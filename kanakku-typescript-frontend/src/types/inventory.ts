export interface InventoryData {
    id: string;
    productId: string;
    quantity: number;
    productDetails: Product;
    createdAt: string;
}

export interface InventoryHistoryData {
    inventoryId: string;
    productId: {
        id: string;
        name: string;
        code: string;
        unitName: string;
    }
    currentQuantity: number;
    quantityOnHand?: number | null;
    avgCost?: number | null;
    valuationMethod?: string | null;
    alertQuantity?: number | null;
    currencyCode?: string | null;
    history: InventoryHistory[];
}
export interface InventoryHistory {
    id: string;
    unitId: string;
    unitName: string;
    quantity: number;
    notes: string;
    type: string;
    adjustment: number | null;
    referenceId: string | null;
    referenceType: string | null;
    createdBy?: {
        id: string;
        email: string;
    }
    createdAt: string;
    updatedAt: string;
}

export interface Product {
    id: string;
    item_type: string;
    name: string;
    code: string;
    selling_price: number;
    purchase_price: number;
    alert_quantity: number;
    product_image: string;
    unit_name: string;
    status: boolean;
    currencyCode?: string | null;
}