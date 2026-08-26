export const LEDGER_ROLES = [
  'AR',                     // Accounts Receivable
  'AP',                     // Accounts Payable
  'SALES_REVENUE',          // Revenue from sales
  'SALES_RETURNS',          // Returns and allowances
  'PURCHASES',              // Purchase expense
  'COGS',                   // Cost of Goods Sold
  'INVENTORY',              // Inventory asset
  'OUTPUT_TAX',             // Tax collected on sales
  'INPUT_TAX',              // Tax paid on purchases
  'BANK',                   // Bank clearing / settlement
  'CASH',                   // Petty cash / cash on hand
  'ROUNDING',               // Rounding differences
  'OPENING_BALANCE_EQUITY', // Equity used for opening balances
  'RETAINED_EARNINGS',      // Accumulated retained earnings
  'CURRENT_YEAR_EARNINGS',  // P&L summary for current year
  'FX_GAIN_LOSS',           // Foreign-exchange realised gain/loss
  'FIXED_ASSET',            // Fixed assets (property, plant & equipment)
  'ACCUMULATED_DEPRECIATION', // Contra-asset: accumulated depreciation
  'DEPRECIATION_EXPENSE',   // Periodic depreciation charge
  'GAIN_ON_DISPOSAL',       // Gain on disposal of fixed assets
  'LOSS_ON_DISPOSAL',       // Loss on disposal of fixed assets
  'ACCOUNT_CREDIT',         // Liability: unredeemed per-contact account credit owed to customers
  'CUSTOMER_CREDIT_EXPENSE', // Expense: cost of granting customer account credit
] as const;

export type LedgerRole = (typeof LEDGER_ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(LEDGER_ROLES);

export function isLedgerRole(value: string): value is LedgerRole {
  return ROLE_SET.has(value);
}
