import { describe, it, expect } from 'vitest';
import { LEDGER_ROLES, isLedgerRole, type LedgerRole } from './roles';

describe('ledger roles', () => {
  it('exposes every required role key', () => {
    const expected = [
      'AR', 'AP', 'SALES_REVENUE', 'SALES_RETURNS', 'PURCHASES', 'COGS',
      'INVENTORY', 'OUTPUT_TAX', 'INPUT_TAX', 'BANK', 'CASH', 'ROUNDING',
      'OPENING_BALANCE_EQUITY', 'RETAINED_EARNINGS', 'CURRENT_YEAR_EARNINGS',
      'FX_GAIN_LOSS', 'FIXED_ASSET', 'ACCUMULATED_DEPRECIATION', 'DEPRECIATION_EXPENSE',
      'GAIN_ON_DISPOSAL', 'LOSS_ON_DISPOSAL', 'ACCOUNT_CREDIT', 'CUSTOMER_CREDIT_EXPENSE',
    ];
    expect([...LEDGER_ROLES].sort()).toEqual([...expected].sort());
  });
  it('validates known and unknown role strings', () => {
    expect(isLedgerRole('AR')).toBe(true);
    expect(isLedgerRole('NOT_A_ROLE')).toBe(false);
  });
  it('LedgerRole type is assignable from a valid string literal', () => {
    const r: LedgerRole = 'COGS';
    expect(isLedgerRole(r)).toBe(true);
  });
});
