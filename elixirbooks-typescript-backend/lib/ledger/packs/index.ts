import { buildStandardPack } from './buildStandardPack';
import type { CountryPack } from './types';

export const COUNTRY_PACKS: Record<string, CountryPack> = {
  IN: buildStandardPack({
    countryCode: 'IN', name: 'India', defaultFunctionalCurrency: 'INR', fiscalYearStartMonth: 4,
    taxRegime: 'GST_INDIA', outputTaxName: 'GST Payable (Output)', inputTaxName: 'GST Receivable (Input)',
  }),
  GB: buildStandardPack({
    countryCode: 'GB', name: 'United Kingdom', defaultFunctionalCurrency: 'GBP', fiscalYearStartMonth: 4,
    taxRegime: 'VAT_UK', outputTaxName: 'VAT Payable (Output)', inputTaxName: 'VAT Reclaimable (Input)',
  }),
  EU: buildStandardPack({
    countryCode: 'EU', name: 'European Union', defaultFunctionalCurrency: 'EUR', fiscalYearStartMonth: 1,
    taxRegime: 'VAT_EU', outputTaxName: 'VAT Payable', inputTaxName: 'VAT Deductible',
  }),
  US: buildStandardPack({
    countryCode: 'US', name: 'United States', defaultFunctionalCurrency: 'USD', fiscalYearStartMonth: 1,
    taxRegime: 'SALES_TAX_US', outputTaxName: 'Sales Tax Payable', inputTaxName: 'Sales Tax Paid', inputTaxIsExpense: true,
  }),
  AU: buildStandardPack({
    countryCode: 'AU', name: 'Australia', defaultFunctionalCurrency: 'AUD', fiscalYearStartMonth: 7,
    taxRegime: 'GST_AU', outputTaxName: 'GST Collected', inputTaxName: 'GST Paid',
  }),
  NZ: buildStandardPack({
    countryCode: 'NZ', name: 'New Zealand', defaultFunctionalCurrency: 'NZD', fiscalYearStartMonth: 4,
    taxRegime: 'GST_NZ', outputTaxName: 'GST Payable', inputTaxName: 'GST Receivable',
  }),
};

export const COUNTRY_CODES = Object.keys(COUNTRY_PACKS);

export function getPack(countryCode: string): CountryPack | null {
  return COUNTRY_PACKS[countryCode] ?? null;
}
