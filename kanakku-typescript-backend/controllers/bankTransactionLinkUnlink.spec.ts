// controllers/bankTransactionLinkUnlink.spec.ts
//
// Regression for P2 bug 1: reconciliation link/unlink integrity.
//  - link: a payment already reconciled to another non-deleted bank txn must be
//    rejected (exclusivity) — otherwise the same payment double-counts cleared
//    balances across multiple bank lines.
//  - link: a bank txn already explained/posted by the explain flow (explainStatus
//    'EXPLAINED' or postedSourceType set) must be rejected too, even though several
//    explain-flow outcomes (Expense/generic category, income, capital asset, owner
//    funds, user payment) leave relatedType at its default 'MANUAL' — so the
//    relatedType-based guard alone can't see them. Without this, link could stomp
//    an already-posted txn's relatedType/relatedId, and since unlink refuses to
//    touch payment-born lines, that mis-link would be PERMANENTLY stuck.
//  - unlink: must NOT force a payment-born / EXPLAINED txn back to MANUAL, which
//    would erase the linkage the double-post guard + explain flow rely on and let
//    a second explain double-post. Those must be undone by voiding the document.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const findFirst = vi.fn(async (_args?: unknown) => null as unknown);
const update = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'txn-1', ...args.data }));

vi.mock('../lib/prisma', () => ({
  prisma: {
    bankTransaction: {
      findFirst: (args: unknown) => findFirst(args),
      update: (args: { data: Record<string, unknown> }) => update(args),
    },
  },
}));

import { link, unlink } from './bankTransactionController';

function fakeReq(params: Record<string, string>, body: unknown = {}): Request {
  return { params, body, tenantId: 'tenant-1', user: 'tenant-1' } as unknown as Request;
}
function fakeRes(): Response & { body: any; statusCode: number } {
  const res = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { body: any; statusCode: number };
}

beforeEach(() => {
  findFirst.mockReset();
  update.mockClear();
});

describe('link — payment exclusivity', () => {
  it('rejects linking a payment already reconciled to another bank txn', async () => {
    findFirst.mockImplementation(async (args: unknown) => {
      const { where } = args as { where: Record<string, any> };
      // 1) the target txn lookup (has a concrete id string, MANUAL/unlinked)
      if (typeof where.id === 'string') {
        return { id: 'txn-1', relatedType: 'MANUAL', relatedId: null };
      }
      // 2) the exclusivity lookup (id: { not: ... }) → another txn already holds it
      return { id: 'txn-OTHER' };
    });

    const res = fakeRes();
    await link(fakeReq({ id: 'txn-1' }, { relatedType: 'INVOICE_PAYMENT', relatedId: 'pay-1' }), res);

    expect(res.statusCode).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it('links when the payment is not yet reconciled anywhere', async () => {
    findFirst.mockImplementation(async (args: unknown) => {
      const { where } = args as { where: Record<string, any> };
      if (typeof where.id === 'string') {
        return { id: 'txn-1', relatedType: 'MANUAL', relatedId: null };
      }
      return null; // no other txn holds this payment
    });

    const res = fakeRes();
    await link(fakeReq({ id: 'txn-1' }, { relatedType: 'INVOICE_PAYMENT', relatedId: 'pay-1' }), res);

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    expect(data.relatedType).toBe('INVOICE_PAYMENT');
    expect(data.isReconciled).toBe(true);
  });
});

describe('link — payment-born guard', () => {
  it('rejects linking a txn already EXPLAINED/posted (postedSourceType set, relatedType still MANUAL)', async () => {
    findFirst.mockImplementation(async (args: unknown) => {
      const { where } = args as { where: Record<string, any> };
      if (typeof where.id === 'string') {
        // Explain-flow outcome (e.g. Expense/generic category): relatedType never
        // moved off its default MANUAL, but the txn is already explained + posted.
        return {
          id: 'txn-1',
          relatedType: 'MANUAL',
          relatedId: null,
          explainStatus: 'EXPLAINED',
          postedSourceType: 'Expense',
        };
      }
      return null;
    });

    const res = fakeRes();
    await link(fakeReq({ id: 'txn-1' }, { relatedType: 'INVOICE_PAYMENT', relatedId: 'pay-1' }), res);

    expect(res.statusCode).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it('cannot be used to create a stuck mis-link: rejected by link, and unlink still refuses it', async () => {
    const explainedManualTxn = {
      id: 'txn-1',
      relatedType: 'MANUAL',
      relatedId: null,
      explainStatus: 'EXPLAINED',
      postedSourceType: 'Expense',
    };
    findFirst.mockImplementation(async (args: unknown) => {
      const { where } = args as { where: Record<string, any> };
      if (typeof where.id === 'string') return explainedManualTxn;
      return null;
    });

    const linkRes = fakeRes();
    await link(fakeReq({ id: 'txn-1' }, { relatedType: 'INVOICE_PAYMENT', relatedId: 'pay-1' }), linkRes);
    expect(linkRes.statusCode).toBe(409);

    const unlinkRes = fakeRes();
    await unlink(fakeReq({ id: 'txn-1' }), unlinkRes);
    expect(unlinkRes.statusCode).toBe(409);

    // Neither call ever mutated the txn — it can't get stuck in a half-linked state.
    expect(update).not.toHaveBeenCalled();
  });

  it('still links a genuinely MANUAL, unexplained, unlinked txn (legitimate flow not over-blocked)', async () => {
    findFirst.mockImplementation(async (args: unknown) => {
      const { where } = args as { where: Record<string, any> };
      if (typeof where.id === 'string') {
        return {
          id: 'txn-1',
          relatedType: 'MANUAL',
          relatedId: null,
          explainStatus: 'UNEXPLAINED',
          postedSourceType: null,
        };
      }
      return null;
    });

    const res = fakeRes();
    await link(fakeReq({ id: 'txn-1' }, { relatedType: 'INVOICE_PAYMENT', relatedId: 'pay-1' }), res);

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    expect(data.relatedType).toBe('INVOICE_PAYMENT');
    expect(data.isReconciled).toBe(true);
  });
});

describe('unlink — protects payment-born linkage', () => {
  it('refuses to unlink a payment-born / EXPLAINED txn (no MANUAL rewrite)', async () => {
    findFirst.mockResolvedValue({
      id: 'txn-1',
      relatedType: 'INVOICE_PAYMENT',
      relatedId: 'pay-1',
      explainStatus: 'EXPLAINED',
      postedSourceType: 'InvoicePayment',
      postedSourceId: 'pay-1',
    });

    const res = fakeRes();
    await unlink(fakeReq({ id: 'txn-1' }), res);

    expect(res.statusCode).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it('resets a link-created reconciliation back to MANUAL', async () => {
    findFirst.mockResolvedValue({
      id: 'txn-1',
      relatedType: 'INVOICE_PAYMENT',
      relatedId: 'pay-1',
      explainStatus: 'UNEXPLAINED',
      postedSourceType: null,
      postedSourceId: null,
    });

    const res = fakeRes();
    await unlink(fakeReq({ id: 'txn-1' }), res);

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    expect(data.relatedType).toBe('MANUAL');
    expect(data.relatedId).toBeNull();
    expect(data.isReconciled).toBe(false);
  });
});
