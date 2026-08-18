export interface InventoryReportShape {
    id: string;
    type: string;
    name: string;
    sku: string;
    sellingPrice: number;
    purchasePrice: number;
    alertQuantity: number;
    thumbnail: string;
    unit: string;
    categoryName: string;
    stock: number;
    currencyCode?: string | null;
}

export interface LowStockReportShape {
    id: string;
    type: string;
    name: string;
    sku: string;
    sellingPrice: number;
    purchasePrice: number;
    alertQuantity: number;
    thumbnail: string;
    unit: string;
    categoryName: string;
    stock: number;
    currencyCode?: string | null;
}

export interface OutOfStockReportShape {
    id: string;
    type: string;
    name: string;
    sku: string;
    sellingPrice: number;
    purchasePrice: number;
    alertQuantity: number;
    thumbnail: string;
    unit: string;
    categoryName: string;
    stock: number;
    currencyCode?: string | null;
}