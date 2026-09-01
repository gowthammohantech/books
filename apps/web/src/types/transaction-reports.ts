export interface PurchaseReportShape {
    purchaseId: string;
    vendor: {
        name: string;
        email: string;
        phone: string | null;
        image: string | null;
    };
    totalAmount: number;
    paidAmount: number;
    balance: number;
    status: string;
    createdAt: string;
    currencyCode?: string | null;
}

export interface PurchaseOrderReportShape {
    purchaseOrderId: string;
    vendor: {
        name: string;
        email: string;
        phone: string | null;
        image: string | null;
    };
    totalAmount: number;
    status: string;
    purchaseOrderDate: string;
    currencyCode?: string | null;
}

export interface PurchaseReturnReportShape {
    debitNoteId: string;
    vendor: {
        name: string;
        email: string;
        phone: string | null;
        image: string | null;
    };
    totalAmount: number;
    status: string;
    debitNoteDate: string;
    currencyCode?: string | null;
}

export interface QuotationReportShape {
    quotationId: string;
    customer: {
        name: string;
        email: string;
        phone: string | null;
        image: string | null;
    };
    totalAmount: number;
    status: string;
    quotationDate: string;
    currencyCode?: string | null;
}

export interface SalesReportShape {
    invoiceId: string;
    invoiceNumber: string;
    customer: {
        name: string;
        email: string;
        phone: string | null;
        image: string | null;
    };
    amount: number;
    paidAmount: number;
    remainingBalance: number;
    status: string;
    invoiceDate: string;
    currencyCode?: string | null;
}

export interface SalesReturnReportShape {
    creditNoteId: string;
    creditNoteNumber: string;
    customer: {
        name: string;
        email: string;
        phone: string | null;
        image: string | null;
    };
    refundAmount: number;
    status: string;
    creditNoteDate: string;
    currencyCode?: string | null;
}