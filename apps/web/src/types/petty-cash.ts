export interface PettyCashFormData {
    amount: number;
    paymentModeId: string;
    bankAccountId: string;
}

export interface PettyCash {
    id: string;
    openingBalance: number;
    currentBalance: number;
    asOnDate: string;
    createdAt: string;
    updatedAt: string;
}

export interface PettyCashTransaction {
    id: string;
    transactionDate: string;
    transactionType: 'ADD' | 'SPEND' | 'RETURN';
    relatedType: 'BANK' | 'SUPPLIER_PAYMENT' | 'EXPENSE' | 'PETTY_CASH';
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    remarks: string;
    paymentMode: PaymentMode;
    transactionSource: TransactionSource;
    createdAt: string;
    updatedAt: string;
}

interface PaymentMode {
    id?: string;
    name: string;
    slug: string;
}

interface TransactionSource {
    type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'PAYMENT' | 'RECEIPT' | 'EXPENSE_PAYMENT' | 'SUPPLIER_PAYMENT' | 'OTHER';
    description?: string;
    bankInfo?: BankDetails;
}

interface BankDetails {
    id?: string;
    bankName: string;
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
}
