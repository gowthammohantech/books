export type ContactView =
  | 'all-active' | 'clients' | 'suppliers'
  | 'clients-open-invoices' | 'suppliers-open-bills' | 'hidden' | 'all';

export interface Contact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  organisation?: string | null;
  displayName?: string;
  email?: string | null;
  billingEmail?: string | null;
  telephone?: string | null;
  mobile?: string | null;
  addressLine1?: string | null; addressLine2?: string | null; addressLine3?: string | null;
  town?: string | null; region?: string | null; postcode?: string | null; countryId?: string | null;
  /** ISO-2 country code (e.g. "DE", "GB") used for EU cross-border reverse-charge detection */
  country?: string | null;
  defaultPaymentTermDays?: number | null;
  defaultTaxTreatment?: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'REVERSE_CHARGE' | 'OUT_OF_SCOPE';
  vatRegNumber?: string | null;
  /** Customer VAT number (UK/EU). Distinct from the legacy vatRegNumber display field. */
  vatNumber?: string | null;
  gstin?: string | null;
  invoiceLanguage?: string | null;
  currencyCode?: string | null;
  status?: 'ACTIVE' | 'HIDDEN';
  showNameOnInvoice?: boolean;
  notes?: string | null;
  invoiceSequencePrefix?: string | null;
  useContactEmailSettings?: boolean;
}
