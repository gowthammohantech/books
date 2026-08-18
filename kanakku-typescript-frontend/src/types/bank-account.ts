export interface BankAccountCreatedResponse {
    id: string;
    accountHoldername: string;
    bankName: string;
    branchName: string;
    accountNumber: string;
    IFSCCode: string;
    status: string;
}

export interface BankAccount {
    id: string;
    userId: string;
    accountHoldername: string;
    bankName: string;
    branchName: string;
    accountNumber: string;
    IFSCCode: string;
    status: boolean;
    accountType: string;
    bankCodeType?: string | null;
    openingBalance: number;
    currentBalance: number;
    asOnDate: string;
    currencyCode?: string | null;
    createdAt: string;
}

export interface BankAccountFormData {
    id?: string;
    userId?: string;
    accountHoldername: string;
    bankName: string;
    branchName: string;
    accountNumber: string;
    IFSCCode: string;
    status?: boolean;
    accountType: string;
    bankCodeType?: string | null;
    openingBalance: number;
    currencyCode?: string | null;
}