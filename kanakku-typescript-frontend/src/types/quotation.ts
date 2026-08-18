export interface QuotationDetail {
    id: string;
    quotationId: string;
    salesPerson: string | null;
    quotationDate: string;
    referenceNo: string | null;
    status: string;
    currencyCode?: string | null;
    /** Tax treatment for this document (null / 'STANDARD' = no notice shown on template) */
    taxTreatment?: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'REVERSE_CHARGE' | 'OUT_OF_SCOPE' | null;
    taxableAmount: number;
    totalDiscount: number;
    vat: number;
    TotalAmount: number;
    items: Item[];
    billFrom: {
        id: string;
        name: string;
        email: string;
        phone: string;
        profileImage: string | null;
        address: string | null;
    } | null;
    billTo: {
        id: string;
        name: string;
        email: string;
        phone: string;
        image: string | null;
        /** Party VAT registration number (EU/UK/AU/NZ/etc.) */
        vatRegNumber?: string | null;
        /** Party GSTIN (India) */
        gstin?: string | null;
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
    description: string;
    unit: string;
    qty: number;
    rate: number;
    discount: number;
    tax: number;
    tax_group_id: string | null;
    tax_rate_id?: string | null;
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