/**
 * tests/moneyGuards.createAsPaid.test.ts
 *
 * P2 bug 4: createInvoice's create-as-PAID auto-payment booked the payment at
 * `enforcedTotal` while the invoice persisted at `authTotal` (they diverge for
 * flat tax regimes after the server recompute → "PAID" invoice with paid ≠ total)
 * AND never moved the bank register / wrote a bankTransaction even with a bank
 * chosen. The auto-payment now books the SAME persisted total and — when a bank
 * is chosen — moves the register + writes a linked bankTransaction with
 * movedBankBalance=true (mirroring recordInvoicePayment).
 *
 * approvalsEnabled=true here defers GL posting, isolating the auto-payment +
 * register move (which are intentionally NOT gated on posting).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { captured, mocks } = vi.hoisted(() => ({
  captured: {} as {
    invoice?: Record<string, unknown>;
    payment?: Record<string, unknown>;
    bankTxn?: Record<string, unknown>;
    bankUpdate?: Record<string, unknown>;
  },
  mocks: {
    contactFindFirst: vi.fn(),
    companySettingsFindFirst: vi.fn(),
    paymentModeFindUnique: vi.fn(),
    bankDetailFindFirst: vi.fn(),
    bankDetailUpdate: vi.fn(),
    bankTransactionCreate: vi.fn(),
    invoicePaymentCreate: vi.fn(),
    invoiceCreate: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => {
  const db: Record<string, unknown> = {
    generalSetting: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    invoice: { findFirst: vi.fn().mockResolvedValue(null), create: mocks.invoiceCreate },
    contact: { findFirst: mocks.contactFindFirst },
    companySettings: { findFirst: mocks.companySettingsFindFirst },
    product: { findUnique: vi.fn().mockResolvedValue(null) },
    inventory: { findFirst: vi.fn().mockResolvedValue(null) },
    customFieldValue: { createMany: vi.fn() },
    paymentMode: { findUnique: mocks.paymentModeFindUnique },
    bankDetail: { findFirst: mocks.bankDetailFindFirst, update: mocks.bankDetailUpdate },
    bankTransaction: { create: mocks.bankTransactionCreate },
    invoicePayment: { create: mocks.invoicePaymentCreate },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { prisma: db };
});
vi.mock('../utils/mailer', () => ({ sendMail: vi.fn() }));

import { createInvoice } from '../controllers/Admin/Invoice/invoiceController';
import { reverseInvoicePaymentEffects, type PaymentEffectsTx } from '../lib/ledger/voidPaymentEffects';

function makeReqRes(body: Record<string, unknown>) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    params: {},
    query: {},
    body,
    file: undefined,
    files: [],
    protocol: 'http',
    get: vi.fn().mockReturnValue('localhost'),
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  captured.invoice = undefined;
  captured.payment = undefined;
  captured.bankTxn = undefined;
  captured.bankUpdate = undefined;
  mocks.contactFindFirst.mockResolvedValue({ id: 'c1', currencyCode: null, defaultTaxTreatment: null });
  // approvalsEnabled=true defers GL posting; GST_INDIA → no flat recompute.
  mocks.companySettingsFindFirst.mockResolvedValue({ approvalsEnabled: true, taxRegime: 'GST_INDIA' });
  mocks.paymentModeFindUnique.mockResolvedValue({ id: 'pm-1', slug: 'bank' });
  mocks.bankDetailFindFirst.mockResolvedValue({ id: 'bank-1', currentBalance: 1000, accountId: 'gl-bank' });
  mocks.bankDetailUpdate.mockImplementation(async (arg: { data: Record<string, unknown> }) => {
    captured.bankUpdate = arg.data;
    return {};
  });
  mocks.bankTransactionCreate.mockImplementation(async (arg: { data: Record<string, unknown> }) => {
    captured.bankTxn = arg.data;
    return { id: 'btx-1', ...arg.data };
  });
  mocks.invoicePaymentCreate.mockImplementation(async (arg: { data: Record<string, unknown> }) => {
    captured.payment = arg.data;
    return { id: 'ip-1', amount: arg.data.amount };
  });
  mocks.invoiceCreate.mockImplementation(async (arg: { data: Record<string, unknown> }) => {
    captured.invoice = arg.data;
    return { id: 'inv-new', invoiceNumber: 'INV-1', referenceNo: '', ...arg.data };
  });
});

describe('createInvoice — create-as-PAID auto-payment', () => {
  it('books the auto-payment at the PERSISTED invoice total (paid == total)', async () => {
    const { req, res } = makeReqRes({
      contactId: 'c1',
      billFrom: TENANT_ID,
      status: 'PAID',
      payment_method: 'pm-1',
      bank: 'bank-1',
      items: [{ qty: 2, rate: 100, taxes: [{ percent: 9 }, { percent: 9 }] }],
    });

    await createInvoice(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(captured.payment).toBeDefined();
    // paid amount === the invoice's persisted TotalAmount (both derive from authTotal).
    expect(Number(captured.payment!.amount)).toBe(Number(captured.invoice!.TotalAmount));
    expect(Number(captured.payment!.amount)).toBe(236);
  });

  it('moves the bank register + writes a bankTransaction with movedBankBalance=true', async () => {
    const { req, res } = makeReqRes({
      contactId: 'c1',
      billFrom: TENANT_ID,
      status: 'PAID',
      payment_method: 'pm-1',
      bank: 'bank-1',
      items: [{ qty: 2, rate: 100, taxes: [{ percent: 9 }, { percent: 9 }] }],
    });

    await createInvoice(req, res);

    expect(captured.payment!.movedBankBalance).toBe(true);
    // Register moved by the base amount (236) → 1000 + 236 = 1236.
    expect(mocks.bankDetailUpdate).toHaveBeenCalled();
    expect(Number(captured.bankUpdate!.currentBalance)).toBe(1236);
    expect(mocks.bankTransactionCreate).toHaveBeenCalled();
    expect(Number(captured.bankTxn!.amount)).toBe(236);
    expect(captured.bankTxn!.relatedType).toBe('INVOICE_PAYMENT');
    expect(captured.bankTxn!.relatedId).toBe('ip-1');
  });

  it('FOREIGN currency: persists exchangeRate on the auto-payment so reversal is symmetric', async () => {
    const { req, res } = makeReqRes({
      contactId: 'c1',
      billFrom: TENANT_ID,
      status: 'PAID',
      payment_method: 'pm-1',
      bank: 'bank-1',
      currencyCode: 'USD',
      exchangeRate: 83,
      items: [{ qty: 2, rate: 100, taxes: [{ percent: 9 }, { percent: 9 }] }],
    });

    await createInvoice(req, res);

    // authTotal is 236 (foreign units); the auto-payment persists the SAME
    // docExchangeRate the register-move used, so reverseInvoicePaymentEffects'
    // baseFor(amount, exchangeRate) computes the identical base value on void.
    expect(Number(captured.payment!.amount)).toBe(236);
    expect(Number(captured.payment!.exchangeRate)).toBe(83);
    // Register moved by authTotal × docExchangeRate = 236 × 83 = 19588.
    expect(Number(captured.bankUpdate!.currentBalance)).toBe(1000 + 236 * 83);
    expect(Number(captured.bankTxn!.amount)).toBe(236 * 83);

    // Symmetry check: reverseInvoicePaymentEffects must refund the SAME base
    // amount the create-move applied, using the persisted exchangeRate.
    const voidTx = {
      bankDetail: { update: vi.fn().mockResolvedValue({}) },
      bankTransaction: { create: vi.fn().mockResolvedValue({}) },
      invoicePayment: { update: vi.fn() },
      // reverseDocument no-ops when there's nothing posted for this source.
      journalEntry: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await reverseInvoicePaymentEffects(voidTx as unknown as PaymentEffectsTx, {
      userId: TENANT_ID,
      payment: {
        id: 'ip-1',
        amount: captured.payment!.amount as never,
        exchangeRate: captured.payment!.exchangeRate as never,
        paymentModeId: 'pm-1',
        bank: { id: 'bank-1', currentBalance: 1000 + 236 * 83 },
        paymentMode: { slug: 'bank' },
        movedBankBalance: true,
      },
    });
    // Register nets back to the pre-payment balance (1000 + 19588 - 19588) — no drift.
    expect(Number(voidTx.bankDetail.update.mock.calls[0][0].data.currentBalance)).toBe(1000);
  });

  it('a CASH auto-payment does NOT move the register (movedBankBalance=false)', async () => {
    mocks.paymentModeFindUnique.mockResolvedValue({ id: 'pm-1', slug: 'cash' });
    const { req, res } = makeReqRes({
      contactId: 'c1',
      billFrom: TENANT_ID,
      status: 'PAID',
      payment_method: 'pm-1',
      items: [{ qty: 1, rate: 100 }],
    });

    await createInvoice(req, res);

    expect(captured.payment!.movedBankBalance).toBe(false);
    expect(mocks.bankDetailUpdate).not.toHaveBeenCalled();
    expect(mocks.bankTransactionCreate).not.toHaveBeenCalled();
  });
});
