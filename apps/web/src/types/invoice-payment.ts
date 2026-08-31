export interface InvoicePaymentDetails {
    id: string,
    invoiceNumber: string,
    invoiceDate: string,
    customer: string,
    totalAmount: number,
    referenceNo: string,
    status: string,
    /** Present on the live API response (used to look up the Account Credit balance). */
    contactId?: string | null,
    payment: {
        isFullyPaid: boolean,
        isPartiallyPaid: boolean,
        paymentCount: number,
        remaining: number,
        totalPaid: number
    },
    paymentMethods: PaymentMethod[],
}

export interface PaymentMethod {
    id: string;
    name: string;
    slug: string;
    status: boolean;
}

export interface InvoicePaymentFormData {
    invoiceId: string,
    received_on: Date | null,
    amount: number,
    payment_method: string | null,
    bankId: string | null,
    notes: string | null,
    reference: string | null,
}

/** A single recorded payment row returned by GET /admin/invoices/:id/payments */
export interface InvoicePaymentRow {
    id: string;
    amount: string;
    received_on: string;
    reference: string | null;
    notes: string | null;
    isVoided: boolean;
    voidedAt: string | null;
    voidReason: string | null;
    paymentMode: { name: string } | null;
    bank: { bankName: string } | null;
    /** Confirmed key from API: receivedByUser (NOT receivedBy) */
    receivedByUser: { firstName: string; lastName: string } | null;
    voidedBy: { firstName: string; lastName: string } | null;
}

/** Payment summary totals returned alongside the payments list */
export interface InvoicePaymentSummary {
    total: number;
    paid: number;
    remaining: number;
    status: string;
}

/** A single audit-log entry returned by GET /admin/invoices/:id/activity */
export interface InvoiceActivityEntry {
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    entityLabel: string | null;
    summary: string | null;
    userName: string | null;
    createdAt: string;
}