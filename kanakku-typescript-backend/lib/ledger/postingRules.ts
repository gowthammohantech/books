// lib/ledger/postingRules.ts
import { toDecimal } from './money';
import type { LineInstruction } from './types';

export type CashSettlementRole = 'BANK' | 'CASH';
export type CashRole = 'BANK' | 'CASH' | 'AP'; // 'AP' used for expense-on-credit
export type AssetRole = 'INVENTORY' | 'PURCHASES';

const sum = (a: string, b: string): string => toDecimal(a).plus(toDecimal(b)).toString();
const isPositive = (v: string): boolean => toDecimal(v).greaterThan(0);

export const POSTING_RULES = {
  'invoice.issued': ({ net, tax }: { net: string; tax: string }): LineInstruction[] => {
    const lines: LineInstruction[] = [
      { roleKey: 'AR', side: 'debit', amount: sum(net, tax) },
      { roleKey: 'SALES_REVENUE', side: 'credit', amount: net },
    ];
    if (isPositive(tax)) lines.push({ roleKey: 'OUTPUT_TAX', side: 'credit', amount: tax, taxRoleKey: 'OUTPUT_TAX' });
    return lines;
  },

  'invoice.payment': ({ amount, into }: { amount: string; into: CashSettlementRole }): LineInstruction[] => [
    { roleKey: into, side: 'debit', amount },
    { roleKey: 'AR', side: 'credit', amount },
  ],

  'creditNote.issued': ({ net, tax }: { net: string; tax: string }): LineInstruction[] => {
    const lines: LineInstruction[] = [{ roleKey: 'SALES_RETURNS', side: 'debit', amount: net }];
    if (isPositive(tax)) lines.push({ roleKey: 'OUTPUT_TAX', side: 'debit', amount: tax, taxRoleKey: 'OUTPUT_TAX' });
    lines.push({ roleKey: 'AR', side: 'credit', amount: sum(net, tax) });
    return lines;
  },

  'purchase.received': ({ net, tax, asset }: { net: string; tax: string; asset: AssetRole }): LineInstruction[] => {
    const lines: LineInstruction[] = [{ roleKey: asset, side: 'debit', amount: net }];
    if (isPositive(tax)) lines.push({ roleKey: 'INPUT_TAX', side: 'debit', amount: tax, taxRoleKey: 'INPUT_TAX' });
    lines.push({ roleKey: 'AP', side: 'credit', amount: sum(net, tax) });
    return lines;
  },

  'purchase.payment': ({ amount, from }: { amount: string; from: CashSettlementRole }): LineInstruction[] => [
    { roleKey: 'AP', side: 'debit', amount },
    { roleKey: from, side: 'credit', amount },
  ],

  'debitNote.issued': ({ net, tax, asset }: { net: string; tax: string; asset: AssetRole }): LineInstruction[] => {
    const lines: LineInstruction[] = [{ roleKey: 'AP', side: 'debit', amount: sum(net, tax) }];
    if (isPositive(tax)) lines.push({ roleKey: 'INPUT_TAX', side: 'credit', amount: tax, taxRoleKey: 'INPUT_TAX' });
    lines.push({ roleKey: asset, side: 'credit', amount: net });
    return lines;
  },

  'expense.recorded': (
    { net, tax, expenseAccountId, paidFrom }:
    { net: string; tax: string; expenseAccountId: string; paidFrom: CashRole },
  ): LineInstruction[] => {
    const lines: LineInstruction[] = [{ accountId: expenseAccountId, side: 'debit', amount: net }];
    if (isPositive(tax)) lines.push({ roleKey: 'INPUT_TAX', side: 'debit', amount: tax, taxRoleKey: 'INPUT_TAX' });
    lines.push({ roleKey: paidFrom, side: 'credit', amount: sum(net, tax) });
    return lines;
  },

  'cogs.recognized': ({ cost }: { cost: string }): LineInstruction[] => [
    { roleKey: 'COGS', side: 'debit', amount: cost },
    { roleKey: 'INVENTORY', side: 'credit', amount: cost },
  ],
} as const;

export type PostingEvent = keyof typeof POSTING_RULES;
