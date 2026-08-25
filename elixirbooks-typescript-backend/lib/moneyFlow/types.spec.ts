import { describe, it, expect } from 'vitest';
import { TRANSACTION_TYPES, getTransactionType } from './types';

describe('transaction type registry', () => {
  it('has all four flows represented', () => {
    const flows = new Set(TRANSACTION_TYPES.map(t => t.flow));
    expect(flows).toEqual(new Set(['MONEY_IN','MONEY_OUT','MONEY_IN_USER','MONEY_OUT_USER']));
  });
  it('Payment is a generic expense with category+tax', () => {
    const t = getTransactionType('payment');
    expect(t?.postingBehaviour).toBe('generic_category');
    expect(t?.fields).toContain('category');
    expect(t?.fields).toContain('tax');
  });
  it('user-flow types have no tax field and taxApplicable=false', () => {
    const div = getTransactionType('dividend');
    expect(div?.flow).toBe('MONEY_OUT_USER');
    expect(div?.taxApplicable).toBe(false);
    expect(div?.fields).toContain('person');
    expect(div?.fields).not.toContain('tax');
  });
  it('invoice receipt links an invoice', () => {
    expect(getTransactionType('invoice_receipt')?.postingBehaviour).toBe('invoice_link');
  });
});
