// lib/ledger/inventoryCost.spec.ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { applyReceipt, applyIssue, type StockState } from './inventoryCost';
import { toDecimal } from './money';

const S = (qty: string, avg: string): StockState => ({ quantityOnHand: toDecimal(qty), avgCost: toDecimal(avg) });
const eq = (d: Prisma.Decimal, v: string) => d.equals(toDecimal(v));

describe('applyReceipt (WAC)', () => {
  it('first receipt sets average to unit cost', () => {
    const r = applyReceipt(S('0', '0'), '10', '5');
    expect(eq(r.quantityOnHand, '10')).toBe(true);
    expect(eq(r.avgCost, '5')).toBe(true);
  });
  it('blends average across receipts', () => {
    // 10 @ 5 then 10 @ 7 => 20 @ 6
    const r = applyReceipt(S('10', '5'), '10', '7');
    expect(eq(r.quantityOnHand, '20')).toBe(true);
    expect(eq(r.avgCost, '6')).toBe(true);
  });
  it('zero qtyIn leaves state unchanged', () => {
    const r = applyReceipt(S('10', '5'), '0', '99');
    expect(eq(r.quantityOnHand, '10')).toBe(true);
    expect(eq(r.avgCost, '5')).toBe(true);
  });

  // Bug 1: after an oversell (quantityOnHand < 0), a receipt must NOT blend the
  // incoming cost into the negative on-hand base — that can dilute or even flip
  // the average negative, producing negative COGS on the next sale.
  it('receipt after oversell (qoh<0, newQty>0) resets avg to incoming cost', () => {
    // qoh = -3 @ avg 6, receive 10 @ 5 → newQty 7, avg must be 5 (not blended 4.571…)
    const r = applyReceipt(S('-3', '6'), '10', '5');
    expect(eq(r.quantityOnHand, '7')).toBe(true);
    expect(eq(r.avgCost, '5')).toBe(true);
  });
  it('receipt when qoh is exactly zero resets avg to incoming cost', () => {
    // qoh = 0 @ stale avg 99, receive 4 @ 5 → avg must be 5 (fresh base)
    const r = applyReceipt(S('0', '99'), '4', '5');
    expect(eq(r.quantityOnHand, '4')).toBe(true);
    expect(eq(r.avgCost, '5')).toBe(true);
  });
  it('never yields a negative average even for a large oversell base', () => {
    // qoh = -10 @ avg 6, receive 11 @ 5 → blended base would be -5/1 = -5; guard resets to 5
    const r = applyReceipt(S('-10', '6'), '11', '5');
    expect(eq(r.quantityOnHand, '1')).toBe(true);
    expect(r.avgCost.greaterThanOrEqualTo(toDecimal('0'))).toBe(true);
    expect(eq(r.avgCost, '5')).toBe(true);
  });
  it('receipt that leaves newQty still <= 0 keeps prior avg (unchanged behaviour)', () => {
    // qoh = -5 @ avg 6, receive 3 @ 5 → newQty -2 (still negative); avg unchanged
    const r = applyReceipt(S('-5', '6'), '3', '5');
    expect(eq(r.quantityOnHand, '-2')).toBe(true);
    expect(eq(r.avgCost, '6')).toBe(true);
  });
});

describe('applyIssue (WAC)', () => {
  it('COGS = qtyOut * avgCost; quantity decremented; average unchanged', () => {
    const r = applyIssue(S('20', '6'), '5');
    expect(eq(r.cogs, '30')).toBe(true);
    expect(eq(r.state.quantityOnHand, '15')).toBe(true);
    expect(eq(r.state.avgCost, '6')).toBe(true);
  });
  it('issuing more than on hand allows negative quantity (COGS at current avg)', () => {
    const r = applyIssue(S('2', '6'), '5');
    expect(eq(r.cogs, '30')).toBe(true);
    expect(eq(r.state.quantityOnHand, '-3')).toBe(true);
  });
  it('zero qtyOut yields zero COGS, unchanged state', () => {
    const r = applyIssue(S('10', '6'), '0');
    expect(eq(r.cogs, '0')).toBe(true);
    expect(eq(r.state.quantityOnHand, '10')).toBe(true);
  });
});
