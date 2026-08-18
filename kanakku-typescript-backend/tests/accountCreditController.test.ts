/**
 * tests/accountCreditController.test.ts
 *
 * Coverage for controllers/accountCreditController.ts — grant/void of a
 * per-contact Account Credit (goodwill/promo balance a customer can later
 * redeem against an invoice; redemption itself is a separate parallel task).
 *
 *  - grantAccountCredit: creates a GRANT AccountCreditEntry, posts
 *    Dr CUSTOMER_CREDIT_EXPENSE / Cr ACCOUNT_CREDIT via post(), and returns
 *    the updated balance.
 *  - voidAccountCredit: succeeds when nothing has been redeemed yet; is
 *    REJECTED with 400 when voiding the grant would push the balance
 *    negative (i.e. part of it has already been redeemed against an
 *    invoice) — the core correctness guard for this endpoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'staff-1';
const CONTACT_ID = 'contact-1';

const {
  mockContactFindFirst,
  mockCurrencyFindFirst,
  mockEntryCreate,
  mockEntryFindFirst,
  mockTxEntryCreate,
  mockTxEntryUpdate,
  mockPost,
  mockVoidDocument,
  mockGetBalance,
} = vi.hoisted(() => ({
  mockContactFindFirst: vi.fn(),
  mockCurrencyFindFirst: vi.fn(),
  mockEntryCreate: vi.fn(),
  mockEntryFindFirst: vi.fn(),
  mockTxEntryCreate: vi.fn(),
  mockTxEntryUpdate: vi.fn(),
  mockPost: vi.fn(),
  mockVoidDocument: vi.fn(),
  mockGetBalance: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const tx = {
    accountCreditEntry: { create: mockTxEntryCreate, update: mockTxEntryUpdate },
  };
  return {
    prisma: {
      contact: { findFirst: mockContactFindFirst },
      currency: { findFirst: mockCurrencyFindFirst },
      accountCreditEntry: { create: mockEntryCreate, findFirst: mockEntryFindFirst },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('../lib/ledger/postingEngine', () => ({
  post: mockPost,
}));

vi.mock('../lib/ledger/ledgerPosting', () => ({
  voidDocument: mockVoidDocument,
}));

vi.mock('../lib/contacts/accountCreditBalance', () => ({
  getAccountCreditBalance: mockGetBalance,
}));

const { grantAccountCredit, voidAccountCredit } = await import('../controllers/accountCreditController');

function makeReqRes(params: Record<string, unknown>, body: Record<string, unknown> = {}) {
  const req = {
    tenantId: TENANT_ID,
    user: ACTOR_ID,
    params,
    body,
  } as unknown as Request;
  const statusMock = vi.fn().mockReturnThis();
  const jsonMock = vi.fn().mockReturnThis();
  const res = { status: statusMock, json: jsonMock } as unknown as Response;
  return { req, res, statusMock, jsonMock };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockContactFindFirst.mockResolvedValue({ id: CONTACT_ID, currencyCode: 'USD' });
  mockCurrencyFindFirst.mockResolvedValue({ code: 'USD' });
  mockPost.mockResolvedValue({ id: 'je-1' });
  mockVoidDocument.mockResolvedValue(undefined);
});

describe('grantAccountCredit', () => {
  it('creates a GRANT entry, posts Dr CUSTOMER_CREDIT_EXPENSE / Cr ACCOUNT_CREDIT, and returns the updated balance', async () => {
    mockTxEntryCreate.mockResolvedValue({ id: 'ace-1', userId: TENANT_ID, contactId: CONTACT_ID, type: 'GRANT', amount: new Prisma.Decimal(100) });
    mockGetBalance.mockResolvedValue(new Prisma.Decimal(100));

    const { req, res, statusMock, jsonMock } = makeReqRes({ id: CONTACT_ID }, { amount: 100, reason: 'goodwill' });
    await grantAccountCredit(req, res);

    expect(mockTxEntryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: TENANT_ID,
          contactId: CONTACT_ID,
          type: 'GRANT',
          reason: 'goodwill',
          currencyCode: 'USD',
          createdById: ACTOR_ID,
        }),
      }),
    );
    expect(mockPost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: TENANT_ID,
        sourceType: 'AccountCreditEntry',
        sourceId: 'ace-1',
        event: 'grant',
        instructions: [
          { roleKey: 'CUSTOMER_CREDIT_EXPENSE', side: 'debit', amount: '100' },
          { roleKey: 'ACCOUNT_CREDIT', side: 'credit', amount: '100' },
        ],
      }),
    );
    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ balance: 100 }) }),
    );
  });

  it('rejects a non-positive amount without touching the DB', async () => {
    const { req, res, statusMock, jsonMock } = makeReqRes({ id: CONTACT_ID }, { amount: 0 });
    await grantAccountCredit(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(mockTxEntryCreate).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('404s when the contact does not belong to this tenant', async () => {
    mockContactFindFirst.mockResolvedValue(null);
    const { req, res, statusMock } = makeReqRes({ id: 'foreign-contact' }, { amount: 100 });
    await grantAccountCredit(req, res);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(mockTxEntryCreate).not.toHaveBeenCalled();
  });
});

describe('voidAccountCredit', () => {
  it('succeeds when nothing has been redeemed yet', async () => {
    mockEntryFindFirst.mockResolvedValue({
      id: 'ace-1', userId: TENANT_ID, contactId: CONTACT_ID, type: 'GRANT', isVoided: false,
      amount: new Prisma.Decimal(100),
    });
    // Outside-tx guard check: full grant still outstanding (nothing redeemed).
    mockGetBalance.mockResolvedValueOnce(new Prisma.Decimal(100));
    // Inside-tx post-void balance.
    mockGetBalance.mockResolvedValueOnce(new Prisma.Decimal(0));
    mockTxEntryUpdate.mockResolvedValue({ id: 'ace-1', isVoided: true });

    const { req, res, statusMock, jsonMock } = makeReqRes({ id: CONTACT_ID, entryId: 'ace-1' }, { reason: 'mistake' });
    await voidAccountCredit(req, res);

    expect(mockVoidDocument).toHaveBeenCalledWith(
      expect.anything(),
      { userId: TENANT_ID, sourceType: 'AccountCreditEntry', sourceId: 'ace-1', event: 'grant' },
    );
    expect(mockTxEntryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ace-1' },
        data: expect.objectContaining({ isVoided: true, voidedById: ACTOR_ID, voidReason: 'mistake' }),
      }),
    );
    expect(statusMock).not.toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: { balance: 0 } }),
    );
  });

  it('is REJECTED with 400 when voiding would push the balance negative (already partly redeemed)', async () => {
    mockEntryFindFirst.mockResolvedValue({
      id: 'ace-1', userId: TENANT_ID, contactId: CONTACT_ID, type: 'GRANT', isVoided: false,
      amount: new Prisma.Decimal(100),
    });
    // 100 granted, 50 already redeemed against an invoice -> current balance 50.
    // Removing the full 100 grant would leave -50 -> must be rejected.
    mockGetBalance.mockResolvedValueOnce(new Prisma.Decimal(50));

    const { req, res, statusMock, jsonMock } = makeReqRes({ id: CONTACT_ID, entryId: 'ace-1' });
    await voidAccountCredit(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringMatching(/already been redeemed/i) }),
    );
    expect(mockVoidDocument).not.toHaveBeenCalled();
    expect(mockTxEntryUpdate).not.toHaveBeenCalled();
  });

  it('404s when the entry does not exist, is not a GRANT, or is already voided', async () => {
    mockEntryFindFirst.mockResolvedValue(null);
    const { req, res, statusMock } = makeReqRes({ id: CONTACT_ID, entryId: 'nope' });
    await voidAccountCredit(req, res);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(mockVoidDocument).not.toHaveBeenCalled();
  });
});
