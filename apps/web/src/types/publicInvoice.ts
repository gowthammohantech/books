import type { TaxLine } from './taxRate';

export interface PublicInvoiceItem {
  productId?: string;
  name?: string;
  qty?: number;
  rate?: number;
  discount?: number;
  taxes?: TaxLine[];
  totalTax?: number;
}

export interface PublicInvoicePayload {
  invoiceNumber: string | null;
  invoiceType: 'INVOICE' | 'PROFORMA';
  invoiceDate: string;
  dueDate: string;
  status: string;
  currency: string | null;
  items: PublicInvoiceItem[] | unknown;
  taxableAmount: string | number | null;
  totalDiscount: string | number | null;
  vat: string | number | null;
  TotalAmount: string | number | null;
  paymentOptions?: { name: string; url: string }[];
  customer: {
    name: string;
    email: string;
    phone: string | null;
    billingAddress: unknown;
  } | null;
  billFrom: { firstName: string; lastName: string } | null;
  notes: string | null;
  termsAndCondition: string | null;
  bank: {
    accountHoldername: string;
    bankName: string;
    branchName: string;
    accountNumber: string;
    IFSCCode: string;
  } | null;
  company: {
    companyName: string;
    email: string;
    phone: string | null;
    address: string;
    publicBaseUrl: string | null;
    merchantUpiId: string | null;
    merchantName: string | null;
    taxRegime?: string | null;
    gstin?: string | null;
    vatNumber?: string | null;
    abn?: string | null;
    nzGstNumber?: string | null;
  } | null;
}
