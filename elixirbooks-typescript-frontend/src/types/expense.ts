export interface ExpenseFormData {
    id?: string;
    amount: number;
    expenseDate: Date | null;
    expenseCategoryId: string;
    sourceType: 'BANK' | 'PETTY_CASH' | 'EMPLOYEE_PAID' | string;
    bankId: string | null;
    paymentMode: string | null;
    paymentStatus: string;
    description: string;
    attachment?: File | null;
    attachmentUrl?: string | null;
    supplierId?: string | null;
    paidByUserId?: string | null;
}

export interface ExpenseListShape {
    id: string;
    expenseId: string;
    referenceNo: string;
    amount: number;
    expenseDate: string;
    sourceType: string;
    paymentMode: {
        id: string;
        name: string;
    } | null;
    bank: {
        id: string;
        bankName: string;
        accountNumber: string;
    } | null;
    expenseCategory: {
        id: string;
    };
    supplierId?: string | null;
    supplier?: {
        id: string;
        name: string;
    } | null;
    paymentStatus: string;
    description: string | null;
    attachment: string | null;
    createdBy: {
        id: string;
        email: string;
    }
    createdAt: string
}

export interface ExpenseCategoryFormData {
    id?: string;
    title: string;
    description: string;
    status: boolean
}

export interface ExpenseCategoryShape {
    id: string;
    title: string;
    description: string;
    status: boolean;
    createdAt: string
}