export interface CustomersShape {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    address: string | null;
    imageUrl: string | null;
    createdAt: string;
}

export interface SuppliersShape {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    profileImageUrl: string | null;
    createdAt: string;
}

export interface RecentInvoices {
    id: string;
    invoiceNumber: string;
    totalAmount: number;
    status: string;
    customer : {
        id : string;
        name: string;
        email: string;
        phone: string | null;
        imageUrl: string | null;
    };
    createdAt: string;
}

export interface RecentPurchase {
    id: string;
    purchaseId: string;
    totalAmount: number;
    status: string;
    vendor : {
        id : string;
        name: string;
        email: string;
        phone: string | null;
        profileImage: string | null;
    };
    createdAt: string;
}

export interface RecentPayments {
    id: string;
    paymentId: string;
    amount: number;
    payment_method : {
        id: string;
        name: string;
    };
    received_on: string;
    invoice : {
        id: string;
        invoiceNumber: string;
        totalAmount: number;
    }
    createdAt: string;
}

export interface SaleStats {
    totalSalesAmount: number;
    totalDueAmount: number;
    receivedAmount: number;
    quotationCount: number;
}

export interface PurchaseStats {
    totalPurchasesAmount: number;
    totalPaidPurchases: number;
    totalDuePurchases: number;
    debitNoteCount: number;
}

export interface PirchartShape {
    totalQty: number;
    totalSales: number;
    name: string;
}