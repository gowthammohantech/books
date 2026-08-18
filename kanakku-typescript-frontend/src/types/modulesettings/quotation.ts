export interface QuotationPreference {
    // Terms & notes were retired in favor of Document Defaults (defaultTerms/
    // defaultNotes); only the sales-person role remains in quotation preferences.
    quoteSalesPersonRole: string;
}