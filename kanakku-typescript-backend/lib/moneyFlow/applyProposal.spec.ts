// lib/moneyFlow/applyProposal.spec.ts
//
// TDD for the auto-analyse applier's durable write + the auto-post SIGNAL.
//
// The applier NEVER posts to the GL. It writes the durable FOR_APPROVAL queue row
// for an AUTO best (so the match is never lost) and surfaces `autoPostEligible` so
// a SEPARATE post-commit pass can auto-post it when the tenant opted in. All DB ops
// are stubbed — no live DB.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./autoMatch', () => ({ autoMatch: vi.fn() }));

import { applyAutoMatch } from './applyProposal';
import { autoMatch } from './autoMatch';

const autoMatchMock = autoMatch as unknown as ReturnType<typeof vi.fn>;

function makeTx() {
  return {
    invoice: { findMany: vi.fn() },
    purchase: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
    bankTransaction: { update: vi.fn().mockResolvedValue({}) },
  };
}

const MANUAL_UNEXPLAINED = {
  id: 'btx-1',
  type: 'DEPOSIT',
  amount: 100,
  relatedType: 'MANUAL',
  explainStatus: 'UNEXPLAINED',
};

beforeEach(() => autoMatchMock.mockReset());

describe('applyAutoMatch — durable write + auto-post signal', () => {
  it('AUTO + eligible → FOR_APPROVAL durable write AND autoPostEligible=true', async () => {
    autoMatchMock.mockResolvedValue({
      candidates: [],
      best: { transactionTypeKey: 'invoice_receipt', relatedType: 'INVOICE', relatedId: 'inv-1', score: 120, confidence: 'AUTO', autoPostEligible: true },
    });
    const tx = makeTx();
    const res = await applyAutoMatch(tx as never, MANUAL_UNEXPLAINED as never, 'user-1');
    expect(tx.bankTransaction.update).toHaveBeenCalledTimes(1);
    expect(tx.bankTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ explainStatus: 'FOR_APPROVAL' }) }),
    );
    expect(res.status).toBe('FOR_APPROVAL');
    expect(res.autoPostEligible).toBe(true);
  });

  it('AUTO but NOT eligible (weak single signal) → FOR_APPROVAL, autoPostEligible=false', async () => {
    autoMatchMock.mockResolvedValue({
      candidates: [],
      best: { transactionTypeKey: 'invoice_receipt', relatedType: 'INVOICE', relatedId: 'inv-2', score: 90, confidence: 'AUTO', autoPostEligible: false },
    });
    const tx = makeTx();
    const res = await applyAutoMatch(tx as never, MANUAL_UNEXPLAINED as never, 'user-1');
    expect(res.status).toBe('FOR_APPROVAL');
    expect(res.autoPostEligible).toBe(false);
  });

  it('SUGGEST/no AUTO best → UNEXPLAINED, no write, autoPostEligible=false', async () => {
    autoMatchMock.mockResolvedValue({
      candidates: [],
      best: { transactionTypeKey: 'invoice_receipt', relatedId: 'inv-3', score: 60, confidence: 'SUGGEST', autoPostEligible: false },
    });
    const tx = makeTx();
    const res = await applyAutoMatch(tx as never, MANUAL_UNEXPLAINED as never, 'user-1');
    expect(tx.bankTransaction.update).not.toHaveBeenCalled();
    expect(res.status).toBe('UNEXPLAINED');
    expect(res.autoPostEligible).toBe(false);
  });

  it('guard: non-MANUAL / already-explained → untouched, autoPostEligible=false', async () => {
    const tx = makeTx();
    const res = await applyAutoMatch(
      tx as never,
      { ...MANUAL_UNEXPLAINED, explainStatus: 'EXPLAINED' } as never,
      'user-1',
    );
    expect(autoMatchMock).not.toHaveBeenCalled();
    expect(tx.bankTransaction.update).not.toHaveBeenCalled();
    expect(res.autoPostEligible).toBe(false);
  });
});
