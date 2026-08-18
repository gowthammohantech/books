/**
 * tests/cashRoleFor.accountCredit.test.ts
 *
 * cashRoleFor (lib/ledger/ledgerPosting.ts) resolves the cash/bank leg role
 * for a posting. Redeeming a customer's Account Credit balance must resolve
 * to the 'ACCOUNT_CREDIT' liability role — checked BEFORE the existing
 * cash/bank binary — while every other slug keeps its prior behaviour
 * unchanged (purely additive).
 */
import { describe, it, expect } from 'vitest';
import { cashRoleFor } from '../lib/ledger/ledgerPosting';

describe('cashRoleFor', () => {
  it("resolves 'account-credit' to ACCOUNT_CREDIT", () => {
    expect(cashRoleFor({ paymentModeSlug: 'account-credit' })).toBe('ACCOUNT_CREDIT');
  });

  it('still resolves petty cash / cash slugs to CASH unchanged', () => {
    expect(cashRoleFor({ sourceType: 'PETTY_CASH' })).toBe('CASH');
    expect(cashRoleFor({ paymentModeSlug: 'cash' })).toBe('CASH');
    expect(cashRoleFor({ paymentModeSlug: 'petty-cash' })).toBe('CASH');
  });

  it('still falls through to BANK for every other slug unchanged', () => {
    expect(cashRoleFor({ paymentModeSlug: 'bank-transfer' })).toBe('BANK');
    expect(cashRoleFor({ paymentModeSlug: 'upi' })).toBe('BANK');
    expect(cashRoleFor({})).toBe('BANK');
  });
});
