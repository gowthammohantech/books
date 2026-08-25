// lib/ledger/postingRules.spec.ts
import { describe, it, expect } from 'vitest';
import { POSTING_RULES, type CashRole, type CashSettlementRole, type AssetRole } from './postingRules';
import { toDecimal, sumDecimals } from './money';
import type { LineInstruction } from './types';

const baseSum = (lines: LineInstruction[]) => {
  const d = sumDecimals(lines.filter((l) => l.side === 'debit').map((l) => toDecimal(l.amount)));
  const c = sumDecimals(lines.filter((l) => l.side === 'credit').map((l) => toDecimal(l.amount)));
  return { d, c };
};
const balanced = (lines: LineInstruction[]) => {
  const { d, c } = baseSum(lines);
  return d.equals(c);
};

describe('posting rules', () => {
  it('invoice.issued: Dr AR total, Cr SALES_REVENUE net, Cr OUTPUT_TAX tax', () => {
    const lines = POSTING_RULES['invoice.issued']({ net: '100', tax: '18' });
    expect(lines).toEqual([
      { roleKey: 'AR', side: 'debit', amount: '118' },
      { roleKey: 'SALES_REVENUE', side: 'credit', amount: '100' },
      { roleKey: 'OUTPUT_TAX', side: 'credit', amount: '18', taxRoleKey: 'OUTPUT_TAX' },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it('invoice.issued omits the tax line when tax is zero', () => {
    const lines = POSTING_RULES['invoice.issued']({ net: '100', tax: '0' });
    expect(lines).toHaveLength(2);
    expect(balanced(lines)).toBe(true);
  });

  it('invoice.payment: Dr cash/bank, Cr AR', () => {
    const lines = POSTING_RULES['invoice.payment']({ amount: '50', into: 'BANK' as CashSettlementRole });
    expect(lines).toEqual([
      { roleKey: 'BANK', side: 'debit', amount: '50' },
      { roleKey: 'AR', side: 'credit', amount: '50' },
    ]);
  });

  it('creditNote.issued: Dr SALES_RETURNS net + Dr OUTPUT_TAX tax, Cr AR total', () => {
    const lines = POSTING_RULES['creditNote.issued']({ net: '100', tax: '18' });
    expect(lines).toEqual([
      { roleKey: 'SALES_RETURNS', side: 'debit', amount: '100' },
      { roleKey: 'OUTPUT_TAX', side: 'debit', amount: '18', taxRoleKey: 'OUTPUT_TAX' },
      { roleKey: 'AR', side: 'credit', amount: '118' },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it('creditNote.issued omits the tax line when tax is zero', () => {
    const lines = POSTING_RULES['creditNote.issued']({ net: '100', tax: '0' });
    expect(lines).toHaveLength(2);
    expect(balanced(lines)).toBe(true);
  });

  it('purchase.received: Dr asset net + Dr INPUT_TAX tax, Cr AP total', () => {
    const lines = POSTING_RULES['purchase.received']({ net: '200', tax: '36', asset: 'INVENTORY' as AssetRole });
    expect(lines).toEqual([
      { roleKey: 'INVENTORY', side: 'debit', amount: '200' },
      { roleKey: 'INPUT_TAX', side: 'debit', amount: '36', taxRoleKey: 'INPUT_TAX' },
      { roleKey: 'AP', side: 'credit', amount: '236' },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it('purchase.received omits the tax line when tax is zero', () => {
    const lines = POSTING_RULES['purchase.received']({ net: '200', tax: '0', asset: 'INVENTORY' as AssetRole });
    expect(lines).toHaveLength(2);
    expect(balanced(lines)).toBe(true);
  });

  it('purchase.payment: Dr AP, Cr cash/bank', () => {
    const lines = POSTING_RULES['purchase.payment']({ amount: '120', from: 'BANK' as CashSettlementRole });
    expect(lines).toEqual([
      { roleKey: 'AP', side: 'debit', amount: '120' },
      { roleKey: 'BANK', side: 'credit', amount: '120' },
    ]);
  });

  it('debitNote.issued: Dr AP total, Cr INPUT_TAX tax, Cr asset net', () => {
    const lines = POSTING_RULES['debitNote.issued']({ net: '200', tax: '36', asset: 'INVENTORY' as AssetRole });
    expect(lines).toEqual([
      { roleKey: 'AP', side: 'debit', amount: '236' },
      { roleKey: 'INPUT_TAX', side: 'credit', amount: '36', taxRoleKey: 'INPUT_TAX' },
      { roleKey: 'INVENTORY', side: 'credit', amount: '200' },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it('debitNote.issued omits the tax line when tax is zero', () => {
    const lines = POSTING_RULES['debitNote.issued']({ net: '200', tax: '0', asset: 'INVENTORY' as AssetRole });
    expect(lines).toHaveLength(2);
    expect(balanced(lines)).toBe(true);
  });

  it('expense.recorded: Dr expense account + Dr INPUT_TAX, Cr source', () => {
    const lines = POSTING_RULES['expense.recorded']({
      net: '90', tax: '10', expenseAccountId: 'acc-rent', paidFrom: 'BANK' as CashRole,
    });
    expect(lines).toEqual([
      { accountId: 'acc-rent', side: 'debit', amount: '90' },
      { roleKey: 'INPUT_TAX', side: 'debit', amount: '10', taxRoleKey: 'INPUT_TAX' },
      { roleKey: 'BANK', side: 'credit', amount: '100' },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it('cogs.recognized: Dr COGS, Cr INVENTORY at cost', () => {
    const lines = POSTING_RULES['cogs.recognized']({ cost: '70' });
    expect(lines).toEqual([
      { roleKey: 'COGS', side: 'debit', amount: '70' },
      { roleKey: 'INVENTORY', side: 'credit', amount: '70' },
    ]);
  });
});
