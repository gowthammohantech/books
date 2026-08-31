export type TaxRegime = 'GST_INDIA' | 'VAT_GENERIC' | 'US_SALES_TAX' | 'NONE';
export type TaxKind = 'CGST' | 'SGST' | 'IGST' | 'UTGST' | 'CESS' | 'VAT' | 'SALES_TAX';

export interface TaxRate {
  id: string;
  name: string;
  rate: number;
  regime: TaxRegime;
  taxKind: TaxKind | null;
  countryId: string | null;
  stateId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaxLine {
  taxRateId: string;
  name: string;
  kind: TaxKind | null;
  percent: number;
  amount: number;
}
