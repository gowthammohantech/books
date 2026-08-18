// lib/ledger/cashBasis.spec.ts
import { describe, it, expect } from 'vitest';
import { allocateByTaxRatio, cashBasisProfitLoss, type CashMovement } from './cashBasis';

describe('allocateByTaxRatio', () => {
  it('splits a payment into net + tax by the document ratio', () => {
    // invoice: net 100, tax 18, total 118; a 59 payment is half → net 50, tax 9
    const a = allocateByTaxRatio('59', { net: '100', tax: '18', total: '118' });
    expect(a.net).toBeCloseTo(50, 4);
    expect(a.tax).toBeCloseTo(9, 4);
  });
  it('treats a zero-total document as all-net (no tax)', () => {
    const a = allocateByTaxRatio('40', { net: '0', tax: '0', total: '0' });
    expect(a.net).toBeCloseTo(40, 4);
    expect(a.tax).toBeCloseTo(0, 4);
  });
});

describe('cashBasisProfitLoss', () => {
  it('recognizes revenue from receipts and expense from cash-out, net of tax', () => {
    const receipts: CashMovement[] = [
      { amount: '118', doc: { net: '100', tax: '18', total: '118' } }, // full invoice paid
    ];
    const cashOut: CashMovement[] = [
      { amount: '59', doc: { net: '100', tax: '18', total: '118' } },  // half a bill paid
      { amount: '40', doc: { net: '40', tax: '0', total: '40' } },     // an expense
    ];
    const pl = cashBasisProfitLoss(receipts, cashOut);
    expect(pl.revenue.total).toBeCloseTo(100, 4);
    expect(pl.taxes.outputTax).toBeCloseTo(18, 4);
    expect(pl.expenses.total).toBeCloseTo(90, 4); // 50 + 40
    expect(pl.taxes.inputTax).toBeCloseTo(9, 4);
    expect(pl.netIncome).toBeCloseTo(10, 4); // 100 - 90
  });

  it('empty inputs yield zeros', () => {
    const pl = cashBasisProfitLoss([], []);
    expect(pl.revenue.total).toBe(0);
    expect(pl.expenses.total).toBe(0);
    expect(pl.netIncome).toBe(0);
  });
});
