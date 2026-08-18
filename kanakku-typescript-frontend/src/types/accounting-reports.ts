export interface IncomeReportShape {
    id: string;
    invoiceNumber: string;
    customer: {
        name: string;
        email: string;
        phone?: string | null;
        image?: string | null;
    }
    paidDate: string;
    amount: number;
    paymentMode: {
        id: string;
        name: string;
    }
    referenceNo: string | null;
    createdAt: string;
}

export interface ExpenseReportShape {
    Id: string;
    paymentId: string;
    supplier: {
        name: string;
        email: string;
        image?: string | null;
    }
    paidDate: string;
    amount: number;
    paymentMode: {
        id: string;
        name: string;
    }
    referenceNo: string | null;
    createdAt: string;
}