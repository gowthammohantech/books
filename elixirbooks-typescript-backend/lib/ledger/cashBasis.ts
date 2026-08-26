// lib/ledger/cashBasis.ts
import { toDecimal } from './money';

export interface DocRatio { net: string; tax: string; total: string; }
export interface CashMovement { amount: string; doc: DocRatio; }

const num = (d: import('@prisma/client').Prisma.Decimal): number => Number(d.toFixed(4));

/** Split a cash amount into net + tax in the same proportion as its document. */
export function allocateByTaxRatio(amount: string, doc: DocRatio): { net: number; tax: number } {
  const amt = toDecimal(amount);
  const total = toDecimal(doc.total);
  if (total.lessThanOrEqualTo(0)) return { net: num(amt), tax: 0 };
  const net = amt.times(toDecimal(doc.net)).dividedBy(total);
  const tax = amt.minus(net);
  return { net: num(net), tax: num(tax) };
}

export function cashBasisProfitLoss(receipts: CashMovement[], cashOut: CashMovement[]) {
  let revenue = 0, outputTax = 0, expenses = 0, inputTax = 0;
  for (const r of receipts) {
    const a = allocateByTaxRatio(r.amount, r.doc);
    revenue += a.net; outputTax += a.tax;
  }
  for (const c of cashOut) {
    const a = allocateByTaxRatio(c.amount, c.doc);
    expenses += a.net; inputTax += a.tax;
  }
  const round = (x: number) => Number(x.toFixed(4));
  return {
    basis: 'cash' as const,
    revenue: { total: round(revenue) },
    expenses: { total: round(expenses) },
    netIncome: round(revenue - expenses),
    taxes: { outputTax: round(outputTax), inputTax: round(inputTax), netTax: round(outputTax - inputTax) },
  };
}
