// lib/moneyFlow/autoMatch.spec.ts
//
// TDD suite for the Banking Phase B / B2 auto-matcher.
//
// autoMatch(tx, bankTxn, userId) proposes the best explanation for an
// UNEXPLAINED MANUAL bank transaction by:
//   (a) consulting the learning store (lookupHint, payee -> type/category), and
//   (b) scoring candidate documents (open invoices inbound, open bills/expenses
//       outbound) by amount + date + reference (reuse reconciliationMatcher) plus
//       a party/contact-name bonus.
//
// All fetchers and the hint lookup are stubbed via a mocked Prisma tx client —
// no live DB needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// lookupHint is mocked per-test so we control the learning-store answer.
vi.mock('./explanationHints', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./explanationHints')>();
  return {
    ...actual,
    lookupHint: vi.fn().mockResolvedValue(null),
  };
});

import { autoMatch } from './autoMatch';
import { lookupHint } from './explanationHints';

const lookupHintMock = lookupHint as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';
const TXN_DATE = new Date('2026-06-20T00:00:00.000Z');

function makeTx(opts?: {
  invoices?: unknown[];
  purchases?: unknown[];
  expenses?: unknown[];
}) {
  return {
    invoice: {
      findMany: vi.fn().mockResolvedValue(opts?.invoices ?? []),
    },
    purchase: {
      findMany: vi.fn().mockResolvedValue(opts?.purchases ?? []),
    },
    expense: {
      findMany: vi.fn().mockResolvedValue(opts?.expenses ?? []),
    },
  };
}

function inboundBankTxn(over?: Record<string, unknown>) {
  return {
    id: 'btx-1',
    type: 'DEPOSIT',
    amount: 100,
    transactionDate: TXN_DATE,
    referenceNo: '',
    remarks: '',
    ...over,
  };
}

function outboundBankTxn(over?: Record<string, unknown>) {
  return {
    id: 'btx-2',
    type: 'WITHDRAWAL',
    amount: 100,
    transactionDate: TXN_DATE,
    referenceNo: '',
    remarks: '',
    ...over,
  };
}

beforeEach(() => {
  lookupHintMock.mockReset();
  lookupHintMock.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// (a) hint -> proposal with that type/category
// ---------------------------------------------------------------------------

describe('autoMatch — learning store (hint)', () => {
  it('yields a proposal carrying the hint type + category when a hint exists', async () => {
    lookupHintMock.mockResolvedValue({
      transactionTypeKey: 'payment',
      categoryId: 'cat-rent',
      payToUserId: null,
    });
    const tx = makeTx();
    const bankTxn = outboundBankTxn({ remarks: 'ACME LANDLORD LTD' });

    const { candidates, best } = await autoMatch(tx as never, bankTxn as never, USER_ID);

    // lookupHint normalises internally, so it receives the raw payee text.
    expect(lookupHintMock).toHaveBeenCalledWith(tx, USER_ID, 'ACME LANDLORD LTD');
    const hintProposal = candidates.find((c) => c.categoryId === 'cat-rent');
    expect(hintProposal).toBeDefined();
    expect(hintProposal!.transactionTypeKey).toBe('payment');
    expect(hintProposal!.categoryId).toBe('cat-rent');
    // a hint backs the proposal -> it should be the best.
    expect(best?.categoryId).toBe('cat-rent');
  });
});

// ---------------------------------------------------------------------------
// (b) inbound exact-amount + party-match open invoice -> invoice_receipt AUTO
// ---------------------------------------------------------------------------

describe('autoMatch — inbound open invoice', () => {
  it('proposes invoice_receipt AUTO for an exact-amount, party-matching open invoice', async () => {
    const tx = makeTx({
      invoices: [
        {
          id: 'inv-1',
          invoiceNumber: 'INV-000123',
          TotalAmount: 100,
          status: 'UNPAID',
          invoiceDate: TXN_DATE,
          referenceNo: '',
          customer: { name: 'Acme Corp' },
          contact: null,
        },
      ],
    });
    const bankTxn = inboundBankTxn({ amount: 100, remarks: 'ACME CORP' });

    const { candidates, best } = await autoMatch(tx as never, bankTxn as never, USER_ID);

    const proposal = candidates.find((c) => c.transactionTypeKey === 'invoice_receipt');
    expect(proposal).toBeDefined();
    expect(proposal!.relatedType).toBe('INVOICE');
    expect(proposal!.relatedId).toBe('inv-1');
    expect(proposal!.partyName).toBe('Acme Corp');
    expect(proposal!.confidence).toBe('AUTO');
    expect(best?.relatedId).toBe('inv-1');
    // only OPEN invoices are queried
    expect(tx.invoice.findMany).toHaveBeenCalled();
  });

  it('does not query bills/expenses for an inbound txn', async () => {
    const tx = makeTx();
    await autoMatch(tx as never, inboundBankTxn() as never, USER_ID);
    expect(tx.invoice.findMany).toHaveBeenCalled();
    expect(tx.purchase.findMany).not.toHaveBeenCalled();
    expect(tx.expense.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (c) outbound match open bill -> bill_payment
// ---------------------------------------------------------------------------

describe('autoMatch — outbound open bill', () => {
  it('proposes bill_payment for an exact-amount, party-matching open purchase', async () => {
    const tx = makeTx({
      purchases: [
        {
          id: 'pur-1',
          purchaseId: 'PUR-000045',
          totalAmount: 250,
          balanceAmount: 250,
          status: 'pending',
          purchaseDate: TXN_DATE,
          referenceNo: '',
          supplier: { name: 'TechSource' },
          contact: null,
        },
      ],
    });
    const bankTxn = outboundBankTxn({ amount: 250, remarks: 'TECHSOURCE' });

    const { candidates, best } = await autoMatch(tx as never, bankTxn as never, USER_ID);

    const proposal = candidates.find((c) => c.transactionTypeKey === 'bill_payment');
    expect(proposal).toBeDefined();
    expect(proposal!.relatedType).toBe('PURCHASE');
    expect(proposal!.relatedId).toBe('pur-1');
    expect(proposal!.partyName).toBe('TechSource');
    expect(proposal!.confidence).toBe('AUTO');
    expect(best?.relatedId).toBe('pur-1');
    expect(tx.invoice.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (d) outbound + hint, no doc match -> payment + learned category
// ---------------------------------------------------------------------------

describe('autoMatch — outbound hint, no doc', () => {
  it('proposes payment with the learned category when no doc matches', async () => {
    lookupHintMock.mockResolvedValue({
      transactionTypeKey: 'payment',
      categoryId: 'cat-utilities',
      payToUserId: null,
    });
    const tx = makeTx(); // no purchases, no expenses
    const bankTxn = outboundBankTxn({ amount: 75, remarks: 'BRITISH GAS' });

    const { candidates, best } = await autoMatch(tx as never, bankTxn as never, USER_ID);

    const proposal = candidates.find((c) => c.transactionTypeKey === 'payment');
    expect(proposal).toBeDefined();
    expect(proposal!.categoryId).toBe('cat-utilities');
    expect(proposal!.relatedId).toBeUndefined();
    expect(best?.categoryId).toBe('cat-utilities');
  });
});

// ---------------------------------------------------------------------------
// (e) confidence tiers + best threshold
// ---------------------------------------------------------------------------

describe('autoMatch — confidence + best', () => {
  it('exact amount + party -> AUTO', async () => {
    const tx = makeTx({
      invoices: [
        {
          id: 'inv-a',
          invoiceNumber: 'INV-1',
          TotalAmount: 100,
          status: 'UNPAID',
          invoiceDate: TXN_DATE,
          referenceNo: '',
          customer: { name: 'Acme Corp' },
          contact: null,
        },
      ],
    });
    const { best } = await autoMatch(
      tx as never,
      inboundBankTxn({ amount: 100, remarks: 'ACME CORP' }) as never,
      USER_ID,
    );
    expect(best?.confidence).toBe('AUTO');
  });

  it('amount match but no party/reference and no hint -> SUGGEST', async () => {
    const tx = makeTx({
      invoices: [
        {
          id: 'inv-b',
          invoiceNumber: 'INV-2',
          TotalAmount: 100,
          status: 'UNPAID',
          invoiceDate: TXN_DATE,
          referenceNo: '',
          customer: { name: 'Globex Ltd' },
          contact: null,
        },
      ],
    });
    // remarks don't match the party name -> party bonus absent -> SUGGEST
    const { candidates, best } = await autoMatch(
      tx as never,
      inboundBankTxn({ amount: 100, remarks: 'UNKNOWN PAYER' }) as never,
      USER_ID,
    );
    const proposal = candidates.find((c) => c.relatedId === 'inv-b');
    expect(proposal?.confidence).toBe('SUGGEST');
    // it still clears the score threshold (exact amount + same-day) -> best set
    expect(best?.relatedId).toBe('inv-b');
  });

  // -------------------------------------------------------------------------
  // autoPostEligible — the STRICTER bar for the auto-post tier.
  // Eligible iff AUTO AND (hint-backed OR doc-match with exact-amount AND party).
  // -------------------------------------------------------------------------

  it('autoPostEligible=true for a hint-backed proposal (no doc)', async () => {
    lookupHintMock.mockResolvedValue({
      transactionTypeKey: 'payment',
      categoryId: 'cat-utilities',
      payToUserId: null,
    });
    const tx = makeTx();
    const { best } = await autoMatch(
      tx as never,
      outboundBankTxn({ amount: 75, remarks: 'BRITISH GAS' }) as never,
      USER_ID,
    );
    expect(best?.confidence).toBe('AUTO');
    expect(best?.autoPostEligible).toBe(true);
  });

  it('autoPostEligible=true for an exact-amount + party document match', async () => {
    const tx = makeTx({
      invoices: [
        {
          id: 'inv-e',
          invoiceNumber: 'INV-9',
          TotalAmount: 100,
          status: 'UNPAID',
          invoiceDate: TXN_DATE,
          referenceNo: '',
          customer: { name: 'Acme Corp' },
          contact: null,
        },
      ],
    });
    const { best } = await autoMatch(
      tx as never,
      inboundBankTxn({ amount: 100, remarks: 'ACME CORP' }) as never,
      USER_ID,
    );
    expect(best?.confidence).toBe('AUTO');
    expect(best?.autoPostEligible).toBe(true);
  });

  it('autoPostEligible=false for AUTO by exact-amount + reference only (no party, no hint)', async () => {
    // Reference match makes it AUTO, but with no party name match and no hint it
    // is only a single weak signal -> must NOT auto-post.
    const tx = makeTx({
      invoices: [
        {
          id: 'inv-f',
          invoiceNumber: 'INV-10',
          TotalAmount: 100,
          status: 'UNPAID',
          invoiceDate: TXN_DATE,
          referenceNo: 'REF-XYZ',
          customer: { name: 'Globex Ltd' },
          contact: null,
        },
      ],
    });
    const { best } = await autoMatch(
      tx as never,
      // referenceNo matches the invoice ref; remarks do NOT name the party.
      inboundBankTxn({ amount: 100, referenceNo: 'REF-XYZ', remarks: 'UNKNOWN PAYER' }) as never,
      USER_ID,
    );
    expect(best?.relatedId).toBe('inv-f');
    expect(best?.confidence).toBe('AUTO');
    expect(best?.autoPostEligible).toBe(false);
  });

  it('autoPostEligible=false for a SUGGEST (amount-only) match', async () => {
    const tx = makeTx({
      invoices: [
        {
          id: 'inv-g',
          invoiceNumber: 'INV-11',
          TotalAmount: 100,
          status: 'UNPAID',
          invoiceDate: TXN_DATE,
          referenceNo: '',
          customer: { name: 'Globex Ltd' },
          contact: null,
        },
      ],
    });
    const { best } = await autoMatch(
      tx as never,
      inboundBankTxn({ amount: 100, remarks: 'UNKNOWN PAYER' }) as never,
      USER_ID,
    );
    expect(best?.confidence).toBe('SUGGEST');
    expect(best?.autoPostEligible).toBe(false);
  });

  it('autoPostEligible=true when a hint reinforces an EXACT-amount document candidate', async () => {
    lookupHintMock.mockResolvedValue({
      transactionTypeKey: 'bill_payment',
      categoryId: null,
      payToUserId: null,
    });
    const tx = makeTx({
      purchases: [
        {
          id: 'pur-h',
          purchaseId: 'PUR-1',
          totalAmount: 250,
          balanceAmount: 250, // EXACT match to the bank amount
          status: 'pending',
          purchaseDate: TXN_DATE,
          referenceNo: '',
          // party name does NOT match remarks -> reinforcement comes from the hint,
          // not the party bonus.
          supplier: { name: 'TechSource' },
          contact: null,
        },
      ],
    });
    const { best } = await autoMatch(
      tx as never,
      outboundBankTxn({ amount: 250, remarks: 'CARD PAYMENT 4823' }) as never,
      USER_ID,
    );
    expect(best?.relatedId).toBe('pur-h');
    expect(best?.confidence).toBe('AUTO');
    expect(best?.autoPostEligible).toBe(true);
  });

  it('hint reinforcing a NON-exact-amount doc -> AUTO but NOT auto-post eligible (queued)', async () => {
    // A hint substitutes for a party match but never for exact amount: a doc that
    // only matched within-1% (not exactly) must not auto-post as a partial payment.
    lookupHintMock.mockResolvedValue({
      transactionTypeKey: 'bill_payment',
      categoryId: null,
      payToUserId: null,
    });
    const tx = makeTx({
      purchases: [
        {
          id: 'pur-ne',
          purchaseId: 'PUR-2',
          totalAmount: 1000,
          balanceAmount: 1000, // bank amount 1005 -> within 1% (+40) + same day (+30) = candidate, but NOT exact
          status: 'pending',
          purchaseDate: TXN_DATE,
          referenceNo: '',
          supplier: { name: 'TechSource' },
          contact: null,
        },
      ],
    });
    const { best } = await autoMatch(
      tx as never,
      outboundBankTxn({ amount: 1005, remarks: 'CARD PAYMENT 9999' }) as never,
      USER_ID,
    );
    expect(best?.relatedId).toBe('pur-ne');
    expect(best?.confidence).toBe('AUTO'); // hint lifts confidence
    expect(best?.exactAmount).toBe(false);
    expect(best?.autoPostEligible).toBe(false); // ...but not eligible to auto-post
  });

  it('no candidates and no hint -> no best', async () => {
    const tx = makeTx();
    const { candidates, best } = await autoMatch(
      tx as never,
      inboundBankTxn({ amount: 999, remarks: 'NOBODY' }) as never,
      USER_ID,
    );
    expect(candidates).toHaveLength(0);
    expect(best).toBeUndefined();
  });

  it('amount far off (below threshold) -> not best even with party match', async () => {
    const tx = makeTx({
      invoices: [
        {
          id: 'inv-c',
          invoiceNumber: 'INV-3',
          TotalAmount: 5000,
          status: 'UNPAID',
          invoiceDate: new Date('2026-01-01T00:00:00.000Z'), // far date too
          referenceNo: '',
          customer: { name: 'Acme Corp' },
          contact: null,
        },
      ],
    });
    const { best } = await autoMatch(
      tx as never,
      inboundBankTxn({ amount: 100, remarks: 'ACME CORP' }) as never,
      USER_ID,
    );
    expect(best).toBeUndefined();
  });
});
