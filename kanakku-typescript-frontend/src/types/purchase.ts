export interface PurchaseShape {
    id: string;
    purchaseId: string;
    purchaseOrderId: string;
    purchaseDate: string;
    dueDate: string;
    referenceNo: string | null;
    status: string;
    paymentMode: string;
    currencyCode?: string | null;
    taxableAmount: number;
    totalDiscount: number;
    totalTax: number;
    totalAmount: number;
    paidAmount: number;
    balanceAmount: number;
    items: Item[];
    billFrom: {
        id: string;
        name: string;
        email: string;
        phone: string;
        address: string | null;
        profileImage: string;
    }
    billTo: {
        id: string;
        name: string;
        email: string;
        phone: string;
        address: string | null;
        profileImage: string;
    }
    notes: string | null;
    termsAndCondition: string | null;
    sign_type: string;
    signature: {
        name: string;
        image: string;
    }
    bank: {
        name: string;
        accountNumber: string;
        accountHolderName: string;
        ifscCode: string;
        branchName: string;
    }
    createdAt: string;
}

export interface Item {
    id: string;
    product: {
        id: string;
        name: string;
    }
    name: string;
    unit: string;
    qty: number;
    rate: number;
    discount: number;
    tax: number;
    tax_group_id?: string;
    tax_rate_id?: string;
    discount_type: string | 'Fixed' | 'Percentage';
    discount_value: number | null;
    amount: number;
    customFields?: Record<string, unknown>;
}

export interface PendingPurchase {
    id: string;
    purchaseId: string;
    referenceNo: string | null;
    purchaseDate: string;
    status: string;
    totalAmount: number;
    vendor: {
        id: string;

    }
    payment: {
        amount: number;
        paidAmount: number;
        dueAmount: number;
        paymentDate: string | null;
    }
}