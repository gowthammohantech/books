/**
 * tests/moneyGuards.applyInvoiceReceipt.test.ts
 *
 * P2 bug 1: the bank-reconciliation explain→receipt path (applyInvoiceReceipt)
 * used a raw-float overpayment guard (`Number(TotalAmount) − Number(paid)`) that
 * (a) ignored applied credit notes and (b) could reject exact final receipts to
 * floating-point drift. It is now Decimal + 0.005 tolerance and CN-aware via the
 * shared getInvoiceSettlement/deriveInvoiceStatus, so it agrees with the invoice
 * module + AR aging.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the GL posting so these tests isolate the guard/status logic (no ledger mocks).
vi.mock('../lib/ledger/ledgerPosting', () => ({
  postInvoicePayment: vi.fn().mockResolvedValue(undefined),
}));

import { applyInvoiceReceipt, type ApplyDb } from '../lib/ledger/applyInvoiceReceipt';

const TENANT_ID = 'tenant-alpha';

type TestDb = ApplyDb & { updateArg: { data?: { status?: string } } };

function makeDb(opts: {
  total: number | string;
  paid?: number | string;
  creditNotes?: { totalAmount: number | string }[];
  status?: string;
}): TestDb {
  const db = {
    updateArg: {} as { data?: { status?: string } },
    invoice: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'inv-1',
        TotalAmount: opts.total,
        status: opts.status ?? 'UNPAID',
        userId: TENANT_ID,
        exchangeRate: null,
      }),
      update: vi.fn().mockImplementation(async (arg: { data: { status?: string } }) => {
        db.updateArg = arg;
        return {};
      }),
    },
    invoicePayment: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: opts.paid ?? 0 } }),
      create: vi.fn().mockResolvedValue({ id: 'ip-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    creditNote: {
      findMany: vi.fn().mockResolvedValue(
        (opts.creditNotes ?? []).map((c) => ({ invoiceId: 'inv-1', totalAmount: c.totalAmount })),
      ),
    },
  };
  return db as unknown as TestDb;
}

const baseInput = {
  userId: TENANT_ID,
  invoiceId: 'inv-1',
  date: new Date('2026-02-01'),
  bankAccountId: 'bank-1',
  paymentModeId: 'pm-1',
};

beforeEach(() => vi.clearAllMocks());

describe('applyInvoiceReceipt — Decimal + CN-aware overpayment guard', () => {
  it('accepts an EXACT final receipt (no float-drift rejection) and marks the invoice PAID', async () => {
    const db = makeDb({ total: 1000, paid: 500 });
    const res = await applyInvoiceReceipt(db, { ...baseInput, amount: '500' });
    expect(res.invoicePaymentId).toBe('ip-1');
    expect(db.invoice.update).toHaveBeenCalled();
    expect(db.updateArg.data?.status).toBe('PAID');
  });

  it('accepts a receipt within the 0.005 tolerance over outstanding', async () => {
    const db = makeDb({ total: 100, paid: 0 });
    await expect(applyInvoiceReceipt(db, { ...baseInput, amount: '100.004' })).resolves.toMatchObject({
      invoicePaymentId: 'ip-1',
    });
  });

  it('rejects a receipt that exceeds outstanding beyond tolerance', async () => {
    const db = makeDb({ total: 100, paid: 0 });
    await expect(applyInvoiceReceipt(db, { ...baseInput, amount: '100.01' })).rejects.toThrow(
      /PAYMENT_EXCEEDS/,
    );
    expect(db.invoicePayment.create).not.toHaveBeenCalled();
  });

  it('rejects any receipt on a FULLY credit-noted invoice (outstanding ≤ 0)', async () => {
    const db = makeDb({ total: 1000, paid: 0, creditNotes: [{ totalAmount: 1000 }] });
    await expect(applyInvoiceReceipt(db, { ...baseInput, amount: '100' })).rejects.toThrow(
      /PAYMENT_EXCEEDS/,
    );
    expect(db.invoicePayment.create).not.toHaveBeenCalled();
  });

  it('accepts a receipt that clears the credit-note-reduced balance and flips to PAID', async () => {
    // total 1000, CN 600 → outstanding 400; a 400 receipt settles it.
    const db = makeDb({ total: 1000, paid: 0, creditNotes: [{ totalAmount: 600 }] });
    await applyInvoiceReceipt(db, { ...baseInput, amount: '400' });
    expect(db.updateArg.data?.status).toBe('PAID');
  });
});
