import type { PermissionSet } from "./permissions";

export interface Company {
    id: string;
    userId: string;
    companyName: string;
    email: string;
    phone: string;
    address: string;
    pincode: string;
    siteLogo: string;
    companyLogo: string;
    favicon: string;
    taxRegime?: string;
    gstin?: string;
    vatNumber?: string;
    abn?: string;
    nzGstNumber?: string;
    countryCode?: string;
    itemPickerShowRate?: boolean;
    itemPickerShowStock?: boolean;
    itemPickerShowImage?: boolean;
    publicBaseUrl?: string;
    merchantUpiId?: string;
    merchantName?: string;
}

export interface Currency {
    id: string;
    code: string;
    symbol: string;
    name: string;
    status: boolean;
    isDefault: boolean;
}

export interface DateFormat {
    id: string;
    title: string;
    format: string;
    isActive: boolean;
}

export interface TimeFormat {
    id: string;
    name: string;
    format: string;
    isActive: boolean;
}

export interface TimeZone {
    id: string;
    name: string;
    utc_offset: string;
}

export interface InvoiceTemplate {
    id: string;
    userId: string;
    default_invoice_template: string;
}
export interface SystemSettings {
    company: Company;
    currency: Currency;
    dateFormat: DateFormat;
    timeFormat: TimeFormat;
    timezone: TimeZone;
    permissions: PermissionSet[];
    invoiceTemplate: InvoiceTemplate;
    invoicePrefix: string;
    invoiceNumberType: 'auto' | 'manual';
    /** Per-role configurable post-login landing page (moduleSlug). Backend
     *  defaults this to "dashboard" when the role hasn't set one. */
    defaultRoute?: string;
}
