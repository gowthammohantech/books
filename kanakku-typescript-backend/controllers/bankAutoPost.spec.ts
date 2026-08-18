// controllers/bankAutoPost.spec.ts
//
// TDD for the AUTO-POST tier's post-commit pass (Option 1), driven through the
// `analyse` handler (simplest path: single txn, base prisma client).
//
// The matcher (applyAutoMatch) writes the durable FOR_APPROVAL row and flags
// autoPostEligible. The controller then runs a best-effort, tenant-gated pass that
// calls explainAndPost in its OWN transaction. Toggle OFF, non-eligible, or any
// posting error (incl. PeriodLockedError) must leave the row FOR_APPROVAL and never
// throw. All DB + posting deps are mocked — no live DB.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { PeriodLockedError } from '../lib/ledger/buildLines';

const companySettingsFindFirst = vi.fn(async (_a?: unknown) => ({ bankAutoPostEnabled: true }));

// Stateful atomic-claim simulation: an id can be claimed (FOR_APPROVAL→EXPLAINED)
// exactly once; a second claim on an already-claimed id returns count 0.
let claimedIds = new Set<string>();
const bankTransactionUpdateMany = vi.fn(
  async (args: { where: { id: string; explainStatus?: string }; data: { explainStatus: string } }) => {
    const { where, data } = args;
    if (data.explainStatus === 'EXPLAINED') {
      if (where.explainStatus === 'FOR_APPROVAL' && !claimedIds.has(where.id)) {
        claimedIds.add(where.id);
        return { count: 1 };
      }
      return { count: 0 };
    }
    // release (EXPLAINED→FOR_APPROVAL)
    claimedIds.delete(where.id);
    return { count: 1 };
  },
);
const bankTransactionFindFirst = vi.fn(async (_a?: unknown) => ({
  id: 'txn-1',
  type: 'WITHDRAWAL',
  amount: 75,
  transactionDate: new Date('2026-06-20T00:00:00.000Z'),
  referenceNo: '',
  remarks: 'BRITISH GAS',
  relatedType: 'MANUAL',
  explainStatus: 'FOR_APPROVAL',
  proposedTransactionTypeKey: 'payment',
  proposedCategoryId: 'cat-utilities',
  proposedRelatedType: null,
  proposedRelatedId: null,
  transactionTypeKey: null,
  categoryId: null,
  payToUserId: null,
  userPaymentReason: null,
  explainedDescription: null,
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    bankTransaction: {
      findFirst: (a: unknown) => bankTransactionFindFirst(a),
      updateMany: (a: unknown) => bankTransactionUpdateMany(a as never),
    },
    companySettings: { findFirst: (a: unknown) => companySettingsFindFirst(a) },
  },
}));

const applyAutoMatchMock = vi.fn(async () => ({
  status: 'FOR_APPROVAL',
  candidates: [],
  best: { transactionTypeKey: 'payment', confidence: 'AUTO', autoPostEligible: true },
  autoPostEligible: true,
}));
vi.mock('../lib/moneyFlow/applyProposal', () => ({
  applyAutoMatch: (...args: unknown[]) => applyAutoMatchMock(...(args as [])),
}));

const explainAndPostMock = vi.fn(async (_input: unknown) => ({ bankTxnId: 'txn-1' }));
vi.mock('../lib/moneyFlow/explainPosting', () => ({
  explainAndPost: (input: unknown) => explainAndPostMock(input),
  ExplainError: class ExplainError extends Error {},
}));

import { analyse } from './bankTransactionController';

function fakeReq(): Request {
  return { params: { id: 'txn-1' }, body: {}, tenantId: 'tenant-1', user: 'tenant-1' } as unknown as Request;
}
function fakeRes(): Response & { body: any; statusCode: number } {
  const res = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as unknown as Response & { body: any; statusCode: number };
}

beforeEach(() => {
  claimedIds = new Set<string>();
  bankTransactionUpdateMany.mockClear();
  companySettingsFindFirst.mockReset();
  companySettingsFindFirst.mockResolvedValue({ bankAutoPostEnabled: true });
  bankTransactionFindFirst.mockClear();
  applyAutoMatchMock.mockReset();
  applyAutoMatchMock.mockResolvedValue({
    status: 'FOR_APPROVAL',
    candidates: [],
    best: { transactionTypeKey: 'payment', confidence: 'AUTO', autoPostEligible: true },
    autoPostEligible: true,
  });
  explainAndPostMock.mockReset();
  explainAndPostMock.mockResolvedValue({ bankTxnId: 'txn-1' });
});

describe('auto-post pass — toggle gating', () => {
  it('(a) toggle OFF → AUTO stays queued, explainAndPost NOT called', async () => {
    companySettingsFindFirst.mockResolvedValue({ bankAutoPostEnabled: false });
    const res = fakeRes();
    await analyse(fakeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(explainAndPostMock).not.toHaveBeenCalled();
  });

  it('(b) toggle ON + eligible → auto-posts via explainAndPost with the proposal type', async () => {
    const res = fakeRes();
    await analyse(fakeReq(), res);
    expect(explainAndPostMock).toHaveBeenCalledTimes(1);
    const input = explainAndPostMock.mock.calls[0][0] as { transactionTypeKey: string; bankTxnId: string };
    expect(input.transactionTypeKey).toBe('payment');
    expect(input.bankTxnId).toBe('txn-1');
  });

  it('(d) toggle ON but NOT eligible → not posted (pass never invoked)', async () => {
    applyAutoMatchMock.mockResolvedValue({
      status: 'FOR_APPROVAL',
      candidates: [],
      best: { transactionTypeKey: 'payment', confidence: 'AUTO', autoPostEligible: false },
      autoPostEligible: false,
    });
    const res = fakeRes();
    await analyse(fakeReq(), res);
    expect(explainAndPostMock).not.toHaveBeenCalled();
    // toggle is never even consulted when nothing is eligible.
    expect(companySettingsFindFirst).not.toHaveBeenCalled();
  });
});

describe('auto-post pass — safe fallback (never throws, leaves FOR_APPROVAL)', () => {
  it('(c) PeriodLockedError → falls back to queue, no throw, 200', async () => {
    explainAndPostMock.mockRejectedValue(new PeriodLockedError('Accounting period is locked for 2026-06-20'));
    const res = fakeRes();
    await expect(analyse(fakeReq(), res)).resolves.toBeUndefined();
    expect(res.statusCode).toBe(200);
    expect(explainAndPostMock).toHaveBeenCalledTimes(1); // attempted, then swallowed
  });

  it('(f) any posting error → falls back to queue, no throw, 200', async () => {
    explainAndPostMock.mockRejectedValue(new Error('boom'));
    const res = fakeRes();
    await expect(analyse(fakeReq(), res)).resolves.toBeUndefined();
    expect(res.statusCode).toBe(200);
    expect(explainAndPostMock).toHaveBeenCalledTimes(1);
  });

  it('pass-level failure (settings read throws) never 500s — analyse still 200', async () => {
    companySettingsFindFirst.mockRejectedValue(new Error('db down'));
    const res = fakeRes();
    await expect(analyse(fakeReq(), res)).resolves.toBeUndefined();
    expect(res.statusCode).toBe(200);
    expect(explainAndPostMock).not.toHaveBeenCalled();
  });
});

describe('auto-post pass — atomic claim (double-post TOCTOU)', () => {
  it('two passes on the same row → exactly one posts, the other no-ops', async () => {
    // Both passes see FOR_APPROVAL + eligible (matcher is mocked), but the atomic
    // claim lets only ONE flip FOR_APPROVAL→EXPLAINED; the loser skips the post.
    const res1 = fakeRes();
    const res2 = fakeRes();
    await analyse(fakeReq(), res1);
    await analyse(fakeReq(), res2);
    expect(explainAndPostMock).toHaveBeenCalledTimes(1);
    // First claim wins (count 1), second claim loses (count 0).
    const claimCalls = bankTransactionUpdateMany.mock.calls.filter(
      (c) => (c[0] as { data: { explainStatus: string } }).data.explainStatus === 'EXPLAINED',
    );
    expect(claimCalls.length).toBe(2);
  });
});
