import type { LedgerRole } from '../roles';
import type { CountryPack, PackAccount, StandardPackOptions } from './types';

/** Canonical account codes per role — identical across countries; only labels/metadata vary. */
const CODE: Record<LedgerRole, string> = {
  CASH: '1001',
  BANK: '1002',
  AR: '1100',
  INVENTORY: '1200',
  INPUT_TAX: '1300',
  AP: '2001',
  OUTPUT_TAX: '2100',
  OPENING_BALANCE_EQUITY: '3050',
  RETAINED_EARNINGS: '3100',
  CURRENT_YEAR_EARNINGS: '3200',
  SALES_REVENUE: '4001',
  SALES_RETURNS: '4090',
  COGS: '5001',
  PURCHASES: '5002',
  ROUNDING: '5900',
  FX_GAIN_LOSS: '7000',
  FIXED_ASSET: '1500',
  ACCUMULATED_DEPRECIATION: '1510',
  DEPRECIATION_EXPENSE: '5300',
  GAIN_ON_DISPOSAL: '4200',
  LOSS_ON_DISPOSAL: '5400',
  ACCOUNT_CREDIT: '2200',
  CUSTOMER_CREDIT_EXPENSE: '5500',
};

export function buildStandardPack(o: StandardPackOptions): CountryPack {
  const inputTaxType = o.inputTaxIsExpense ? 'EXPENSE' : 'ASSET';
  const inputTaxParent = o.inputTaxIsExpense ? '5000' : '1000';

  const accounts: PackAccount[] = [
    // ASSETS
    { code: '1000', name: 'Assets', accountType: 'ASSET' },
    { code: CODE.CASH, name: 'Cash on Hand', accountType: 'ASSET', parentCode: '1000', role: 'CASH' },
    { code: CODE.BANK, name: 'Bank Accounts', accountType: 'ASSET', parentCode: '1000', role: 'BANK' },
    { code: CODE.AR, name: 'Accounts Receivable', accountType: 'ASSET', parentCode: '1000', role: 'AR' },
    { code: CODE.INVENTORY, name: 'Inventory', accountType: 'ASSET', parentCode: '1000', role: 'INVENTORY' },
    // LIABILITIES
    { code: '2000', name: 'Liabilities', accountType: 'LIABILITY' },
    { code: CODE.AP, name: 'Accounts Payable', accountType: 'LIABILITY', parentCode: '2000', role: 'AP' },
    { code: CODE.OUTPUT_TAX, name: o.outputTaxName, accountType: 'LIABILITY', parentCode: '2000', role: 'OUTPUT_TAX' },
    { code: CODE.ACCOUNT_CREDIT, name: 'Customer Account Credit', accountType: 'LIABILITY', parentCode: '2000', role: 'ACCOUNT_CREDIT' },
    // EQUITY
    { code: '3000', name: 'Equity', accountType: 'EQUITY' },
    { code: CODE.OPENING_BALANCE_EQUITY, name: 'Opening Balance Equity', accountType: 'EQUITY', parentCode: '3000', role: 'OPENING_BALANCE_EQUITY' },
    { code: CODE.RETAINED_EARNINGS, name: 'Retained Earnings', accountType: 'EQUITY', parentCode: '3000', role: 'RETAINED_EARNINGS' },
    { code: CODE.CURRENT_YEAR_EARNINGS, name: 'Current Year Earnings', accountType: 'EQUITY', parentCode: '3000', role: 'CURRENT_YEAR_EARNINGS' },
    // INCOME
    { code: '4000', name: 'Income', accountType: 'INCOME' },
    { code: CODE.SALES_REVENUE, name: 'Sales Revenue', accountType: 'INCOME', parentCode: '4000', role: 'SALES_REVENUE' },
    { code: CODE.SALES_RETURNS, name: 'Sales Returns', accountType: 'INCOME', parentCode: '4000', role: 'SALES_RETURNS' },
    { code: '4100', name: 'Other Income', accountType: 'INCOME', parentCode: '4000' },
    // EXPENSES
    { code: '5000', name: 'Expenses', accountType: 'EXPENSE' },
    { code: CODE.COGS, name: 'Cost of Goods Sold', accountType: 'EXPENSE', parentCode: '5000', role: 'COGS' },
    { code: CODE.PURCHASES, name: 'Purchases', accountType: 'EXPENSE', parentCode: '5000', role: 'PURCHASES' },
    { code: CODE.ROUNDING, name: 'Rounding Off', accountType: 'EXPENSE', parentCode: '5000', role: 'ROUNDING' },
    { code: CODE.CUSTOMER_CREDIT_EXPENSE, name: 'Customer Credits & Promotions', accountType: 'EXPENSE', parentCode: '5000', role: 'CUSTOMER_CREDIT_EXPENSE' },
    // INPUT TAX (asset, or expense for US)
    { code: CODE.INPUT_TAX, name: o.inputTaxName, accountType: inputTaxType, parentCode: inputTaxParent, role: 'INPUT_TAX' },
    // FX
    { code: CODE.FX_GAIN_LOSS, name: 'Foreign Exchange Gain/Loss', accountType: 'EXPENSE', parentCode: '5000', role: 'FX_GAIN_LOSS' },
    // FIXED ASSETS
    { code: CODE.FIXED_ASSET, name: 'Fixed Assets', accountType: 'ASSET', parentCode: '1000', role: 'FIXED_ASSET' },
    { code: CODE.ACCUMULATED_DEPRECIATION, name: 'Accumulated Depreciation', accountType: 'ASSET', parentCode: '1000', role: 'ACCUMULATED_DEPRECIATION' },
    // DEPRECIATION EXPENSE
    { code: CODE.DEPRECIATION_EXPENSE, name: 'Depreciation Expense', accountType: 'EXPENSE', parentCode: '5000', role: 'DEPRECIATION_EXPENSE' },
    // DISPOSAL GAIN / LOSS
    { code: CODE.GAIN_ON_DISPOSAL, name: 'Gain on Disposal of Assets', accountType: 'INCOME', parentCode: '4000', role: 'GAIN_ON_DISPOSAL' },
    { code: CODE.LOSS_ON_DISPOSAL, name: 'Loss on Disposal of Assets', accountType: 'EXPENSE', parentCode: '5000', role: 'LOSS_ON_DISPOSAL' },
  ];

  const roleMap = Object.fromEntries(
    (Object.keys(CODE) as LedgerRole[]).map((r) => [r, CODE[r]]),
  ) as Record<LedgerRole, string>;

  return {
    countryCode: o.countryCode,
    name: o.name,
    defaultFunctionalCurrency: o.defaultFunctionalCurrency,
    fiscalYearStartMonth: o.fiscalYearStartMonth,
    taxRegime: o.taxRegime,
    accounts,
    roleMap,
  };
}
