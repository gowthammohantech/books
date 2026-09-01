/**
 * tests/moneyGuards.pettyCashReturn.test.ts
 *
 * P2 bug 2: returnPettyCash only guarded `pettyBalance < returnAmount`, so a
 * negative amount slipped through — a return of -500 INCREASED petty cash while
 * DRAINING the bank (a NaN amount blew up the Decimal). It now rejects <=0/NaN
 * amounts (mirroring createPettyCash), touching neither register.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const {
  mockPettyCashFindFirst,
  mockPettyCashUpdate,
  mockBankDetailFindUnique,
  mockBankDetailUpdate,
  mockBankTransactionCreate,
  mockPettyCashTransactionCreate,
  mockPaymentModeFindUnique,
} = vi.hoisted(() => ({
  mockPettyCashFindFirst: vi.fn(),
  mockPettyCashUpdate: vi.fn(),
  mockBankDetailFindUnique: vi.fn(),
  mockBankDetailUpdate: vi.fn(),
  mockBankTransactionCreate: vi.fn(),
  mockPettyCashTransactionCreate: vi.fn(),
  mockPaymentModeFindUnique: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const tx = {
    pettyCash: { findFirst: mockPettyCashFindFirst, update: mockPettyCashUpdate },
    pettyCashTransaction: { create: mockPettyCashTransactionCreate },
    bankDetail: { findUnique: mockBankDetailFindUnique, update: mockBankDetailUpdate },
    bankTransaction: { create: mockBankTransactionCreate },
    paymentMode: { findUnique: mockPaymentModeFindUnique },
  };
  return {
    prisma: { $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) },
  };
});

import { returnPettyCash } from '../controllers/pettyCashController';

function makeReqRes(body: Record<string, unknown>) {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, query: {}, body } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPaymentModeFindUnique.mockResolvedValue({ id: 'pm-1', name: 'Cash', slug: 'cash' });
  mockPettyCashFindFirst.mockResolvedValue({ id: 'pc-1', currentBalance: 100 });
  mockBankDetailFindUnique.mockResolvedValue({ id: 'bank-1', isDeleted: false, currentBalance: 1000 });
  mockPettyCashUpdate.mockResolvedValue({ id: 'pc-1' });
  mockBankDetailUpdate.mockResolvedValue({});
  mockBankTransactionCreate.mockResolvedValue({ id: 'btx-1' });
  mockPettyCashTransactionCreate.mockResolvedValue({ id: 'pct-1' });
});

describe('returnPettyCash — non-positive / NaN amount guard', () => {
  it('rejects a NEGATIVE return with 400 and touches neither register', async () => {
    const { req, res } = makeReqRes({ bankAccountId: 'bank-1', amount: -500, paymentModeId: 'pm-1' });
    await returnPettyCash(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockBankDetailUpdate).not.toHaveBeenCalled();
    expect(mockPettyCashUpdate).not.toHaveBeenCalled();
    expect(mockBankTransactionCreate).not.toHaveBeenCalled();
  });

  it('rejects a NaN return with 400 and touches neither register', async () => {
    const { req, res } = makeReqRes({ bankAccountId: 'bank-1', amount: 'abc', paymentModeId: 'pm-1' });
    await returnPettyCash(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockBankDetailUpdate).not.toHaveBeenCalled();
    expect(mockPettyCashUpdate).not.toHaveBeenCalled();
  });

  it('rejects a ZERO return with 400', async () => {
    const { req, res } = makeReqRes({ bankAccountId: 'bank-1', amount: 0, paymentModeId: 'pm-1' });
    await returnPettyCash(req, res);
    // amount:0 passes the "required" presence check but is rejected by the <=0 guard.
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockBankDetailUpdate).not.toHaveBeenCalled();
  });

  it('still ACCEPTS a valid positive return (moves both registers)', async () => {
    const { req, res } = makeReqRes({ bankAccountId: 'bank-1', amount: 50, paymentModeId: 'pm-1' });
    await returnPettyCash(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockBankDetailUpdate).toHaveBeenCalled();
    expect(mockPettyCashUpdate).toHaveBeenCalled();
  });
});
