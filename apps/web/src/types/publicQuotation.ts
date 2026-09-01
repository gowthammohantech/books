export interface PublicQuotationItem {
  productId?: string;
  name?: string;
  qty?: number;
  rate?: number;
  discount?: number;
  tax?: number;
}

export interface PublicQuotationPayload {
  quotationNumber: string | null;
  quotationDate: string;
  expiryDate: string | null;
  status: string;
  currency: string | null;
  items: PublicQuotationItem[] | unknown;
  taxableAmount: string | number | null;
  totalDiscount: string | number | null;
  vat: string | number | null;
  TotalAmount: string | number | null;
  paymentTerms: string | null;
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    billingAddress: unknown;
  } | null;
  billFrom: { firstName: string; lastName: string } | null;
  notes: string | null;
  termsAndCondition: string | null;
  company: {
    companyName: string;
    email: string;
    phone: string | null;
    address: string;
    publicBaseUrl: string | null;
    taxRegime?: string | null;
    gstin?: string | null;
    vatNumber?: string | null;
    abn?: string | null;
    nzGstNumber?: string | null;
  } | null;
}
