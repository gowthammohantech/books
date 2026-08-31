import type { TaxRegime, TaxKind } from '@models/taxRate';

export interface StarterRate {
    name: string;
    rate: number;
    taxKind: TaxKind | null;
}

export const STARTER_RATES: Record<TaxRegime, StarterRate[]> = {
    GST_INDIA: [
        { name: 'CGST 2.5%', rate: 2.5, taxKind: 'CGST' },
        { name: 'CGST 9%', rate: 9, taxKind: 'CGST' },
        { name: 'CGST 14%', rate: 14, taxKind: 'CGST' },
        { name: 'SGST 2.5%', rate: 2.5, taxKind: 'SGST' },
        { name: 'SGST 9%', rate: 9, taxKind: 'SGST' },
        { name: 'SGST 14%', rate: 14, taxKind: 'SGST' },
        { name: 'IGST 5%', rate: 5, taxKind: 'IGST' },
        { name: 'IGST 18%', rate: 18, taxKind: 'IGST' },
        { name: 'IGST 28%', rate: 28, taxKind: 'IGST' },
    ],
    VAT_GENERIC: [
        { name: 'VAT 5%', rate: 5, taxKind: 'VAT' },
        { name: 'VAT 20%', rate: 20, taxKind: 'VAT' },
    ],
    US_SALES_TAX: [],
    NONE: [],
    // The schema has supported these four for some time; the hand-written
    // frontend union did not list them, so they were invisible here. No preset
    // rates — same as US_SALES_TAX above, the user defines their own. Filling
    // these in with real UK/EU/AU/NZ rates is a product decision.
    VAT_UK: [],
    VAT_EU: [],
    GST_AU: [],
    GST_NZ: [],
};
