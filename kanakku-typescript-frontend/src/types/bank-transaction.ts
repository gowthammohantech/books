export interface BankTransaction {
    id: string;
    bankAccount: BankDetails;
    transactionDate: string;
    type: string;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    paymentMode: PaymentMode;
    referenceNo: string;
    remarks: string;
    relatedType: string;
    relatedId: string | null;
    createdAt: string;
}

interface BankDetails {
    id: string;
    accountHoldername: string;
    bankName: string;
    accountNumber: string;
}

interface PaymentMode {
    id: string;
    name: string;
    slug: string;
}

export interface TransactionOverview {
    relatedData: ExpenseData | ManualPayment | PettyCash | InvoicePayment | SupplierPayment;
}

interface ExpenseData {
    expenseId: string;
    expenseDate: string;
    paymentMode: string;
    description: string | null;
    attachment: string | null;
    category: string;
    user: {
        name: string;
        email: string;
        phone: string;
        profileImage: string | null;
    }
}

interface ManualPayment {
    remarks: string;
}

interface PettyCash {
    remarks: string;
}

interface InvoicePayment {
    invoiceNumber: string;
    payment_method: string;
    received_on: string;
    notes: string | null;
}

interface SupplierPayment {
    purchaseNumber: string;
    paymentMode: string;
    notes: string | null;
    attachment: string | null;
    supplier: {
        name: string;
        email: string;
        phone: string;
        profileImage: string | null;
    }
}