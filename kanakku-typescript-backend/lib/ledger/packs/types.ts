import type { AccountType } from '@prisma/client';
import type { LedgerRole } from '../roles';

export type TaxRegime =
  | 'GST_INDIA' | 'VAT_UK' | 'VAT_EU' | 'SALES_TAX_US' | 'GST_AU' | 'GST_NZ';

export interface PackAccount {
  code: string;
  name: string;
  accountType: AccountType;
  parentCode?: string;
  role?: LedgerRole; // set on the canonical account for that role
}

export interface CountryPack {
  countryCode: string;
  name: string;
  defaultFunctionalCurrency: string;
  fiscalYearStartMonth: number; // 1-12
  taxRegime: TaxRegime;
  accounts: PackAccount[];
  roleMap: Record<LedgerRole, string>; // role -> account code
}

export interface StandardPackOptions {
  countryCode: string;
  name: string;
  defaultFunctionalCurrency: string;
  fiscalYearStartMonth: number;
  taxRegime: TaxRegime;
  outputTaxName: string;
  inputTaxName: string;
  /** US sales tax paid is a cost, not reclaimable; when true INPUT_TAX is an EXPENSE account. */
  inputTaxIsExpense?: boolean;
}
