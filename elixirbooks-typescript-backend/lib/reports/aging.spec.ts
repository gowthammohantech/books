// lib/reports/aging.spec.ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  bucketAging,
  buildSubLedgerAging,
  creditNoteTotalsByInvoice,
  netInvoiceOutstanding,
  type AgingItem,
  type SubLedgerDoc,
  type SubLedgerLine,
} from './aging';

// Helper: build a date N days before asOf
function daysAgo(asOf: Date, n: number): Date {
  return new Date(asOf.getTime() - n * 86_400_000);
}

const asOf = new Date('2024-06-15T00:00:00.000Z');

describe('bucketAging', () => {
  it('places an item with dueDate = asOf in current bucket (daysOverdue = 0)', () => {
    const items: AgingItem[] = [
      { id: '1', label: 'INV-001 / Acme', amount: '100', dueDate: asOf },
    ];
    const result = bucketAging(items, asOf);
    expect(result.buckets.current.toString()).toBe('100');
    expect(result.buckets.d1_30.toString()).toBe('0');
    expect(result.rows[0].bucket).toBe('current');
    expect(result.rows[0].daysOverdue).toBe(0);
  });

  it('places an item 15 days overdue in d1_30 bucket', () => {
    const items: AgingItem[] = [
      { id: '2', label: 'INV-002 / Beta', amount: '200', dueDate: daysAgo(asOf, 15) },
    ];
    const result = bucketAging(items, asOf);
    expect(result.buckets.d1_30.toString()).toBe('200');
    expect(result.rows[0].bucket).toBe('d1_30');
    expect(result.rows[0].daysOverdue).toBe(15);
  });

  it('places an item 45 days overdue in d31_60 bucket', () => {
    const items: AgingItem[] = [
      { id: '3', label: 'INV-003 / Gamma', amount: '300', dueDate: daysAgo(asOf, 45) },
    ];
    const result = bucketAging(items, asOf);
    expect(result.buckets.d31_60.toString()).toBe('300');
    expect(result.rows[0].bucket).toBe('d31_60');
    expect(result.rows[0].daysOverdue).toBe(45);
  });

  it('places an item 75 days overdue in d61_90 bucket', () => {
    const items: AgingItem[] = [
      { id: '4', label: 'INV-004 / Delta', amount: '400', dueDate: daysAgo(asOf, 75) },
    ];
    const result = bucketAging(items, asOf);
    expect(result.buckets.d61_90.toString()).toBe('400');
    expect(result.rows[0].bucket).toBe('d61_90');
    expect(result.rows[0].daysOverdue).toBe(75);
  });

  it('places an item 120 days overdue in d90plus bucket', () => {
    const items: AgingItem[] = [
      { id: '5', label: 'INV-005 / Epsilon', amount: '500', dueDate: daysAgo(asOf, 120) },
    ];
    const result = bucketAging(items, asOf);
    expect(result.buckets.d90plus.toString()).toBe('500');
    expect(result.rows[0].bucket).toBe('d90plus');
    expect(result.rows[0].daysOverdue).toBe(120);
  });

  it('total equals sum of all items across buckets', () => {
    const items: AgingItem[] = [
      { id: '1', label: 'A', amount: '100', dueDate: asOf },
      { id: '2', label: 'B', amount: '200', dueDate: daysAgo(asOf, 15) },
      { id: '3', label: 'C', amount: '300', dueDate: daysAgo(asOf, 45) },
      { id: '4', label: 'D', amount: '400', dueDate: daysAgo(asOf, 75) },
      { id: '5', label: 'E', amount: '500', dueDate: daysAgo(asOf, 120) },
    ];
    const result = bucketAging(items, asOf);
    expect(result.total.toString()).toBe('1500');
    expect(result.buckets.current.toString()).toBe('100');
    expect(result.buckets.d1_30.toString()).toBe('200');
    expect(result.buckets.d31_60.toString()).toBe('300');
    expect(result.buckets.d61_90.toString()).toBe('400');
    expect(result.buckets.d90plus.toString()).toBe('500');
  });

  it('returns all-zero buckets and empty rows for empty input', () => {
    const result = bucketAging([], asOf);
    expect(result.total.toString()).toBe('0');
    expect(result.buckets.current.toString()).toBe('0');
    expect(result.buckets.d1_30.toString()).toBe('0');
    expect(result.buckets.d31_60.toString()).toBe('0');
    expect(result.buckets.d61_90.toString()).toBe('0');
    expect(result.buckets.d90plus.toString()).toBe('0');
    expect(result.rows).toHaveLength(0);
  });

  it('uses Prisma.Decimal for precise arithmetic', () => {
    const items: AgingItem[] = [
      { id: '1', label: 'A', amount: '1.005', dueDate: daysAgo(asOf, 5) },
      { id: '2', label: 'B', amount: '2.005', dueDate: daysAgo(asOf, 5) },
    ];
    const result = bucketAging(items, asOf);
    // Prisma.Decimal: 1.005 + 2.005 = 3.01 exactly
    expect(result.total.equals(new Prisma.Decimal('3.010'))).toBe(true);
  });

  it('places an item exactly 1 day overdue in d1_30', () => {
    const items: AgingItem[] = [
      { id: '6', label: 'F', amount: '50', dueDate: daysAgo(asOf, 1) },
    ];
    const result = bucketAging(items, asOf);
    expect(result.buckets.d1_30.toString()).toBe('50');
    expect(result.rows[0].bucket).toBe('d1_30');
  });

  it('places an item exactly 30 days overdue in d1_30', () => {
    const items: AgingItem[] = [
      { id: '7', label: 'G', amount: '70', dueDate: daysAgo(asOf, 30) },
    ];
    const result = bucketAging(items, asOf);
    expect(result.buckets.d1_30.toString()).toBe('70');
    expect(result.rows[0].bucket).toBe('d1_30');
  });

  it('places an item exactly 31 days overdue in d31_60', () => {
    const items: AgingItem[] = [
      { id: '8', label: 'H', amount: '80', dueDate: daysAgo(asOf, 31) },
    ];
    const result = bucketAging(items, asOf);
    expect(result.buckets.d31_60.toString()).toBe('80');
    expect(result.rows[0].bucket).toBe('d31_60');
  });

  it('places an item exactly 91 days overdue in d90plus', () => {
    const items: AgingItem[] = [
      { id: '9', label: 'I', amount: '90', dueDate: daysAgo(asOf, 91) },
    ];
    const result = bucketAging(items, asOf);
    expect(result.buckets.d90plus.toString()).toBe('90');
    expect(result.rows[0].bucket).toBe('d90plus');
  });
});

// FIX 2 (audit-ledger): credit-note netting so AR aging reconciles to GL AR control.
describe('creditNoteTotalsByInvoice', () => {
  it('sums multiple credit notes per invoice and keeps invoices independent', () => {
    const map = creditNoteTotalsByInvoice([
      { invoiceId: 'inv-1', totalAmount: '100' },
      { invoiceId: 'inv-1', totalAmount: '50.5' },
      { invoiceId: 'inv-2', totalAmount: '200' },
    ]);
    expect(map.get('inv-1')!.toString()).toBe('150.5');
    expect(map.get('inv-2')!.toString()).toBe('200');
    expect(map.has('inv-3')).toBe(false);
  });
});

describe('netInvoiceOutstanding', () => {
  it('outstanding = total - paid - creditNoted', () => {
    expect(netInvoiceOutstanding('1000', '300', '200').toString()).toBe('500');
  });
  it('a fully credit-noted invoice nets to zero (drops out of aging)', () => {
    expect(netInvoiceOutstanding('1000', '0', '1000').toString()).toBe('0');
  });
  it('reconciliation: aging total over a set nets out the CN total (the 64k hole)', () => {
    // Two invoices totalling 472,590 with CNs of 64,663.06 → 407,926.94 (GL AR control).
    const inv = [
      { total: '400000', paid: '0', cnByInv: '64663.06' },
      { total: '72590', paid: '0', cnByInv: '0' },
    ];
    const agingTotal = inv.reduce(
      (s, i) => s.add(netInvoiceOutstanding(i.total, i.paid, i.cnByInv)),
      new Prisma.Decimal(0),
    );
    expect(agingTotal.toString()).toBe('407926.94');
  });
});

// =============================================================================
// GL-derived aging — reconciles to the control account BY CONSTRUCTION.
// =============================================================================
describe('buildSubLedgerAging — AR control reconciliation', () => {
  const due = daysAgo(asOf, 45); // → d31_60 bucket
  const docs = new Map<string, SubLedgerDoc>([
    ['inv-1', { label: 'INV-1 / Acme', dueDate: due }],
    ['inv-2', { label: 'INV-2 / Beta', dueDate: due }],
    ['inv-3', { label: 'INV-3 / Gamma', dueDate: due }],
  ]);
  const arOpts = { nature: 'debit' as const, docs };

  function sumGl(lines: SubLedgerLine[]): Prisma.Decimal {
    // The GL AR control balance the Balance Sheet shows: Σ baseDebit − Σ baseCredit.
    return lines.reduce(
      (s, l) =>
        s.add(new Prisma.Decimal(l.baseDebit.toString())).sub(new Prisma.Decimal(l.baseCredit.toString())),
      new Prisma.Decimal(0),
    );
  }

  it('a credit note on a PAID invoice still reduces the total (the dropped-CN bug)', () => {
    // inv-1: issued 118 (Dr AR), paid 118 (Cr AR) → invoice is PAID.
    // CN on inv-1: posts Cr AR 100 (ex-tax leg, NOT the 118 totalAmount).
    // The legacy open-invoice netting drops this entirely (inv-1 not in open set);
    // the GL-derived path keeps it as a -100 customer credit row.
    const lines: SubLedgerLine[] = [
      { bucketKey: 'inv-1', baseDebit: '118', baseCredit: '0' }, // issue
      { bucketKey: 'inv-1', baseDebit: '0', baseCredit: '118' }, // payment
      { bucketKey: 'inv-1', baseDebit: '0', baseCredit: '100' }, // credit note (ex-tax AR leg)
      { bucketKey: 'inv-2', baseDebit: '500', baseCredit: '0' }, // open invoice
    ];
    const result = buildSubLedgerAging(lines, asOf, arOpts);
    // inv-1 nets to -100 (customer credit), inv-2 to 500 → grand total 400.
    expect(result.total.toString()).toBe('400');
    expect(result.total.equals(sumGl(lines))).toBe(true);
    const credit = result.rows.find((r) => r.id === 'inv-1');
    expect(credit?.amount).toBe('-100');
  });

  it('over-credit (CN > outstanding) yields a negative row and still ties to GL', () => {
    // inv-1: issued 200, paid 50, credit-noted 300 → net -150 (over-credited).
    const lines: SubLedgerLine[] = [
      { bucketKey: 'inv-1', baseDebit: '200', baseCredit: '0' },
      { bucketKey: 'inv-1', baseDebit: '0', baseCredit: '50' },
      { bucketKey: 'inv-1', baseDebit: '0', baseCredit: '300' },
    ];
    const result = buildSubLedgerAging(lines, asOf, arOpts);
    expect(result.total.toString()).toBe('-150');
    expect(result.total.equals(sumGl(lines))).toBe(true);
  });

  it('drops fully-settled invoices but keeps the grand total equal to the GL', () => {
    const lines: SubLedgerLine[] = [
      { bucketKey: 'inv-1', baseDebit: '100', baseCredit: '0' },
      { bucketKey: 'inv-1', baseDebit: '0', baseCredit: '100' }, // settled → dropped
      { bucketKey: 'inv-2', baseDebit: '300', baseCredit: '0' },
      { bucketKey: 'inv-2', baseDebit: '0', baseCredit: '120' }, // partial
    ];
    const result = buildSubLedgerAging(lines, asOf, arOpts);
    expect(result.rows.find((r) => r.id === 'inv-1')).toBeUndefined();
    expect(result.total.toString()).toBe('180');
    expect(result.total.equals(sumGl(lines))).toBe(true);
  });

  it('unattributed lines (opening / manual JE) collapse into one row and tie out', () => {
    const lines: SubLedgerLine[] = [
      { bucketKey: null, baseDebit: '1000', baseCredit: '0' }, // cutover opening AR
      { bucketKey: null, baseDebit: '0', baseCredit: '200' }, // manual JE on AR
      { bucketKey: 'inv-1', baseDebit: '500', baseCredit: '0' },
    ];
    const result = buildSubLedgerAging(lines, asOf, {
      ...arOpts,
      unappliedLabel: 'Unapplied credits / opening balance',
    });
    const opening = result.rows.find((r) => r.id === '__unapplied__');
    expect(opening?.amount).toBe('800');
    expect(opening?.label).toBe('Unapplied credits / opening balance');
    expect(opening?.bucket).toBe('current'); // dated asOf
    expect(result.total.toString()).toBe('1300');
    expect(result.total.equals(sumGl(lines))).toBe(true);
  });

  it('full demo shape: AR aging grand total == GL AR control (407,926.94)', () => {
    // Mirrors the live demo: 15 invoices Dr AR 1,313,930; payments Cr AR 841,340;
    // 3 CNs Cr AR 64,663.06 (ex-tax leg) — all CNs on PAID invoices.
    const lines: SubLedgerLine[] = [
      { bucketKey: 'inv-1', baseDebit: '1313930', baseCredit: '0' },
      { bucketKey: 'inv-1', baseDebit: '0', baseCredit: '841340' },
      { bucketKey: 'inv-1', baseDebit: '0', baseCredit: '64663.06' },
    ];
    const result = buildSubLedgerAging(lines, asOf, arOpts);
    expect(result.total.toString()).toBe('407926.94');
    expect(result.total.equals(sumGl(lines))).toBe(true);
  });
});

describe('buildSubLedgerAging — AP control (credit-natured, debit notes)', () => {
  const due = daysAgo(asOf, 10); // → d1_30
  const docs = new Map<string, SubLedgerDoc>([['po-1', { label: 'PO-1 / Supplier', dueDate: due }]]);
  const apOpts = { nature: 'credit' as const, docs };

  it('payable outstanding = Σ credit − Σ debit; debit note on a paid bill reduces it', () => {
    // po-1: received Cr AP 363,263; supplier payment Dr AP 209,892.50 → balance 153,370.50.
    const lines: SubLedgerLine[] = [
      { bucketKey: 'po-1', baseDebit: '0', baseCredit: '363263' },
      { bucketKey: 'po-1', baseDebit: '209892.50', baseCredit: '0' },
    ];
    const result = buildSubLedgerAging(lines, asOf, apOpts);
    expect(result.total.toString()).toBe('153370.5');
    // GL AP control balance = Σ baseDebit − Σ baseCredit = -153,370.50 (credit balance).
    const glCredit = lines.reduce(
      (s, l) =>
        s.add(new Prisma.Decimal(l.baseCredit.toString())).sub(new Prisma.Decimal(l.baseDebit.toString())),
      new Prisma.Decimal(0),
    );
    expect(result.total.equals(glCredit)).toBe(true);
  });
});
