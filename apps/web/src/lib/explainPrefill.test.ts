import { describe, it, expect } from 'vitest';
import { deriveExplainPrefill } from './explainPrefill';
import { canOfferExplain, isBankTxnPaymentBorn } from '@models/bankTransaction';
import type { BankTransactionRow } from '@models/bankTransaction';

const baseRow = (over: Partial<BankTransactionRow> = {}): BankTransactionRow => ({
  id: 't1', bankAccountId: 'b1', bankAccount: null, transactionDate: '2026-07-01',
  type: 'WITHDRAWAL', amount: '100', balanceBefore: '0', balanceAfter: '0',
  paymentMode: null, referenceNo: '', remarks: 'coffee beans', relatedType: 'MANUAL',
  relatedId: null, isReconciled: false, reconciledBy: null, reconciliationDate: null,
  explainStatus: 'UNEXPLAINED', autoPosted: false, direction: 'money_out',
  currencyCode: 'GBP', isPaymentBorn: false, ...over,
});

describe('deriveExplainPrefill', () => {
  it('prefers persisted selection', () => {
    const p = deriveExplainPrefill(baseRow({
      explainStatus: 'EXPLAINED', transactionTypeKey: 'payment',
      category: { id: 'cat-1', name: 'Office' }, taxTreatment: 'ZERO',
      explainedDescription: 'saved note',
    }));
    expect(p.transactionTypeKey).toBe('payment');
    expect(p.categoryId).toBe('cat-1');
    expect(p.taxTreatment).toBe('ZERO');
    expect(p.description).toBe('saved note');
  });

  it('falls back to the AI proposal for FOR_APPROVAL rows', () => {
    const p = deriveExplainPrefill(baseRow({
      explainStatus: 'FOR_APPROVAL',
      proposal: {
        kind: 'category', label: 'Proposed: Office', confidence: 'HIGH', score: 90,
        transactionTypeKey: 'payment', categoryId: 'cat-9',
      },
    }));
    expect(p.transactionTypeKey).toBe('payment');
    expect(p.categoryId).toBe('cat-9');
  });

  it('prefills the linked document from a document proposal', () => {
    const p = deriveExplainPrefill(baseRow({
      explainStatus: 'FOR_APPROVAL',
      proposal: {
        kind: 'invoice', label: 'Proposed: Invoice INV-7', documentNo: 'INV-7',
        confidence: 'HIGH', score: 95, relatedType: 'INVOICE_PAYMENT', entityId: 'inv-7',
        transactionTypeKey: 'invoice_receipt', categoryId: null,
      },
    }));
    expect(p.linkedRelatedType).toBe('INVOICE_PAYMENT');
    expect(p.linkedDoc).toEqual({ id: 'inv-7', name: 'INV-7' });
  });

  it('prefills the linked document with entityId (document id), not relatedId (payment id)', () => {
    // Banking-explained invoice/bill rows: explanation.relatedId is the created
    // payment's id; entityId is the invoice/purchase id the picker must submit.
    const p = deriveExplainPrefill(baseRow({
      explainStatus: 'EXPLAINED', transactionTypeKey: 'invoice_receipt',
      relatedType: 'INVOICE_PAYMENT', relatedId: 'pay-1',
      explanation: {
        kind: 'invoice', label: 'Invoice INV-7 — Acme', documentNo: 'INV-7',
        relatedType: 'INVOICE_PAYMENT', relatedId: 'pay-1', entityId: 'inv-7',
      },
    }));
    expect(p.linkedDoc).toEqual({ id: 'inv-7', name: 'INV-7' });
  });

  it('falls back to remarks + AUTO when nothing saved or proposed', () => {
    const p = deriveExplainPrefill(baseRow());
    expect(p.transactionTypeKey).toBe('');
    expect(p.taxTreatment).toBe('AUTO');
    expect(p.description).toBe('coffee beans');
    expect(p.linkedDoc).toBeNull();
  });
});

describe('gates', () => {
  it('canOfferExplain: unexplained manual row yes; payment-born or non-unexplained no', () => {
    expect(canOfferExplain(baseRow())).toBe(true);
    expect(canOfferExplain(baseRow({ isPaymentBorn: true }))).toBe(false);
    expect(canOfferExplain(baseRow({ explainStatus: 'EXPLAINED' }))).toBe(false);
  });

  it('isBankTxnPaymentBorn reads the flag, not relatedType', () => {
    expect(isBankTxnPaymentBorn(baseRow({ relatedType: 'INVOICE_PAYMENT', isPaymentBorn: false }))).toBe(false);
    expect(isBankTxnPaymentBorn(baseRow({ isPaymentBorn: true }))).toBe(true);
  });
});
