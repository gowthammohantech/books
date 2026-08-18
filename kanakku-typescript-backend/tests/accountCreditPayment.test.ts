/**
 * tests/accountCreditPayment.test.ts
 *
 * Redeem a customer's Account Credit balance as an invoice-payment method —
 * no real cash/bank movement. Covers recordInvoicePayment's new
 * slug === 'account-credit' branch:
 *
 *   - no BankTransaction is created and no BankDetail.currentBalance is
 *     touched (bank lookup is skipped entirely, mirroring the existing cash
 *     exclusion),
 *   - the created InvoicePayment persists movedBankBalance: false,
 *   - a plain AccountCreditEntry (type REDEMPTION) is written in the same
 *     transaction for balance/history tracking — NOT a second GL posting,
 *   - a payment that exceeds the contact's available account-credit balance
 *     is rejected with an ACCOUNT_CREDIT_EXCEEDS domain error before any
 *     write happens (same response-building path as PAYMENT_EXCEEDS).
 *
 * getAccountCreditBalance (lib/contacts/accountCreditBalance.ts) and the
 * AccountCreditEntry model are being added by a parallel task — mocked /
 * stubbed here so this test can run ahead of that landing. postInvoicePayment
 * itself is mocked (the GL engine is exercised elsewhere) — cashRoleFor's
 * 'ACCOUNT_CREDIT' role resolution is unit-tested directly, not through this
 * controller-level test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

const TENANT_ID = 'tenant-alpha';

const {
  mockPostInvoicePayment,
  mockGetAccountCreditBalance,
  m,
} = vi.hoisted(() => {
  const mk = () => vi.fn();
  return {
    mockPostInvoicePayment: vi.fn().mockResolvedValue(undefined),
    mockGetAccountCreditBalance: vi.fn(),
    m: {
      invoiceFindFirst: mk(),
      invoiceUpdate: mk(),
      paymentModeFindUnique: mk(),
      companySettingsFindFirst: mk(),
      paymentTransactionCreate: mk(),
      invoicePaymentCreate: mk(),
      accountCreditEntryCreate: mk(),
      bankDetailFindFirst: mk(),
      bankDetailUpdate: mk(),
      bankTransactionCreate: mk(),
    },
  };
});

vi.mock('../lib/prisma', () => {
  const tx = {
    invoice: { findFirst: m.invoiceFindFirst, update: m.invoiceUpdate },
    paymentMode: { findUnique: m.paymentModeFindUnique },
    companySettings: { findFirst: m.companySettingsFindFirst },
    paymentTransaction: { create: m.paymentTransactionCreate },
    invoicePayment: { create: m.invoicePaymentCreate },
    accountCreditEntry: { create: m.accountCreditEntryCreate },
    bankDetail: { findFirst: m.bankDetailFindFirst, update: m.bankDetailUpdate },
    bankTransaction: { create: m.bankTransactionCreate },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('../lib/ledger/ledgerPosting', () => ({
  postInvoiceIssued: vi.fn(),
  postInvoicePayment: mockPostInvoicePayment,
  postSaleCogs: vi.fn(),
  reverseDocument: vi.fn(),
  voidDocument: vi.fn(),
}));

vi.mock('../lib/invoiceOutstanding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/invoiceOutstanding')>();
  return {
    ...actual,
    getInvoiceSettlement: vi.fn().mockResolvedValue({
      totalPaid: new Prisma.Decimal(0),
      creditNoted: new Prisma.Decimal(0),
    }),
  };
});

vi.mock('../lib/contacts/accountCreditBalance', () => ({
  getAccountCreditBalance: mockGetAccountCreditBalance,
}));

vi.mock('../utils/mailer', () => ({ sendMail: vi.fn() }));

import { recordInvoicePayment } from '../controllers/Admin/Invoice/invoiceController';

function makeReqRes(body: Record<string, unknown>) {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, params: {}, query: {}, body } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  return { req, res };
}

function dataOf(mock: ReturnType<typeof vi.fn>, idx = 0) {
  return (mock.mock.calls[idx]?.[0] as { data?: Record<string, unknown> })?.data ?? {};
}

const INVOICE = {
  id: 'inv-1',
  userId: TENANT_ID,
  status: 'UNPAID',
  TotalAmount: new Prisma.Decimal(100),
  contactId: 'contact-1',
  currencyCode: null,
  exchangeRate: null,
  invoiceNumber: 'INV-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  m.invoiceFindFirst.mockResolvedValue({ ...INVOICE });
  m.invoiceUpdate.mockResolvedValue({ status: 'PARTIALLY_PAID' });
  m.paymentModeFindUnique.mockResolvedValue({ id: 'pm-account-credit', slug: 'account-credit', name: 'Account Credit' });
  m.companySettingsFindFirst.mockResolvedValue(null);
  m.paymentTransactionCreate.mockResolvedValue({ id: 'ptxn-1' });
  m.invoicePaymentCreate.mockResolvedValue({ id: 'pay-1', amount: new Prisma.Decimal(60) });
  m.accountCreditEntryCreate.mockResolvedValue({ id: 'ace-1' });
  mockPostInvoicePayment.mockResolvedValue(undefined);
});

describe('recordInvoicePayment — account-credit redemption', () => {
  it('does not create a BankTransaction, persists movedBankBalance=false, and writes an AccountCreditEntry', async () => {
    mockGetAccountCreditBalance.mockResolvedValue(new Prisma.Decimal(500));

    const { req, res } = makeReqRes({ invoiceId: 'inv-1', amount: 60, payment_method: 'pm-account-credit' });
    await recordInvoicePayment(req, res);

    expect(res.status).toHaveBeenCalledWith(201);

    // Bank lookup skipped entirely for account-credit (mirrors the cash exclusion).
    expect(m.bankDetailFindFirst).not.toHaveBeenCalled();
    expect(m.bankTransactionCreate).not.toHaveBeenCalled();
    expect(m.bankDetailUpdate).not.toHaveBeenCalled();

    // InvoicePayment created with bankId null / movedBankBalance false.
    const paymentData = dataOf(m.invoicePaymentCreate);
    expect(paymentData.bankId).toBeNull();
    expect(paymentData.movedBankBalance).toBe(false);

    // GL posting still delegated to postInvoicePayment with the account-credit slug —
    // it, not this controller, resolves the ACCOUNT_CREDIT role via cashRoleFor.
    expect(mockPostInvoicePayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ paymentModeSlug: 'account-credit' }),
    );

    // A plain data row for balance/history — not a second GL posting.
    const entryData = dataOf(m.accountCreditEntryCreate);
    expect(entryData).toMatchObject({
      type: 'REDEMPTION',
      contactId: 'contact-1',
      invoiceId: 'inv-1',
      invoicePaymentId: 'pay-1',
      userId: TENANT_ID,
      createdById: TENANT_ID,
    });
    expect(Number(entryData.amount)).toBe(60);
  });

  it('rejects a payment that exceeds the available account-credit balance', async () => {
    mockGetAccountCreditBalance.mockResolvedValue(new Prisma.Decimal(20));

    const { req, res } = makeReqRes({ invoiceId: 'inv-1', amount: 60, payment_method: 'pm-account-credit' });
    await recordInvoicePayment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errors: expect.objectContaining({ amount: expect.stringContaining('account credit') }),
      }),
    );

    // Rejected before any write.
    expect(m.invoicePaymentCreate).not.toHaveBeenCalled();
    expect(m.accountCreditEntryCreate).not.toHaveBeenCalled();
    expect(mockPostInvoicePayment).not.toHaveBeenCalled();
  });
});
