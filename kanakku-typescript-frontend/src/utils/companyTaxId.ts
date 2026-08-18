// Resolves the company's own regime-appropriate tax identifier for display on
// invoice/purchase view + print templates (India GSTIN, UK/EU/Generic VAT,
// Australia ABN, New Zealand GST). Additive/display-only — returns null when
// there is nothing to show (e.g. US_SALES_TAX, NONE, or unknown regimes have
// no company tax field at all).
export interface CompanyTaxFields {
    taxRegime?: string | null;
    gstin?: string | null;
    vatNumber?: string | null;
    abn?: string | null;
    nzGstNumber?: string | null;
}

export interface CompanyTaxId {
    label: string;
    value: string;
}

export function companyTaxId(company?: CompanyTaxFields | null): CompanyTaxId | null {
    if (!company) return null;

    let label: string | null = null;
    let rawValue: string | null | undefined;

    switch (company.taxRegime) {
        case 'GST_INDIA':
            label = 'GSTIN';
            rawValue = company.gstin;
            break;
        case 'VAT_UK':
        case 'VAT_EU':
        case 'VAT_GENERIC':
            label = 'VAT No.';
            rawValue = company.vatNumber;
            break;
        case 'GST_AU':
            label = 'ABN';
            rawValue = company.abn;
            break;
        case 'GST_NZ':
            label = 'GST No.';
            rawValue = company.nzGstNumber;
            break;
        default:
            // US_SALES_TAX, NONE, or unknown regimes have no company tax field.
            return null;
    }

    const value = rawValue?.trim();
    if (!label || !value) return null;

    return { label, value };
}
