export interface DeliveryChannalDetail {
    id: string;
    challanNumber: string;
    challanDate: string;
    referenceNo: string | null;
    status: string;
    currencyCode?: string | null;
    taxableAmount: number;
    totalDiscount: number;
    vat: number;
    totalAmount: number;
    items: Item[];
    billFrom: {
        id: string;
        name: string;
        email: string;
        phone: string;
        image: string | null;
        address: string | null;
    };
    billTo: {
        id: string;
        name: string;
        email: string;
        phone: string;
        image: string | null;
        billingAddress: {
            name: string;
            addressLine1: string | null;
            addressLine2: string | null;
            city: string | null;
            state: string | null;
            country: string | null;
            pincode: string | null;
        } | null;
    }
    bank: Bank | null;
    notes: string;
    termsAndCondition: string;
    sign_type: string;
    signature: {
        id?: string;
        name: string;
        image: string | null;
    } | null;
}

interface Item {
    id: string;
    name: string;
    unit: string;
    qty: number;
    rate: number;
    discount: number;
    tax: number;
    tax_group_id: string | null;
    discount_type: string;
    discount_value: number | null;
    amount: number;
    customFields?: Record<string, unknown>;
}

interface Bank {
    id: string;
    accountHoldername: string;
    bankName: string;
    branchName: string;
    accountNumber: string;
    IFSCCode: string;
}