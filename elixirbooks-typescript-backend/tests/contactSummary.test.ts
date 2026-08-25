import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { buildContactSummary } from '../lib/contacts/contactSummary';

describe('buildContactSummary', () => {
  it('totals reflect the full history, not just the trailing 12-month chart window', () => {
    const now = new Date('2026-07-05T00:00:00.000Z');
    const rows = [
      // 14 months before "now" — outside the 12-month chart window.
      { date: new Date('2025-05-01T00:00:00.000Z'), received: 1000, paid: 0 },
      // within the 12-month window.
      { date: new Date('2026-06-01T00:00:00.000Z'), received: 500, paid: 200 },
    ];
    const summary = buildContactSummary(rows, now);

    // Totals must include the old row too.
    expect(summary.totalReceived).toBe(1500);
    expect(summary.totalPaid).toBe(200);
    expect(summary.balance).toBe(1300);

    // The chart's monthly buckets stay scoped to the trailing 12 months only —
    // the old row must NOT appear in any month bucket.
    const bucketedTotal = summary.months.reduce((s, m) => s + m.received + m.paid, 0);
    expect(bucketedTotal).toBe(700); // only the within-window row (500 + 200)
  });
});

// ---------------------------------------------------------------------------
// getContactSummary — supplier-payment resolution via purchase.contactId
// ---------------------------------------------------------------------------
const mockContactFindFirst = vi.fn();
const mockInvoicePaymentFindMany = vi.fn();
const mockSupplierPaymentFindMany = vi.fn();
const mockInvoiceFindMany = vi.fn();
const mockPurchaseFindMany = vi.fn();
const mockDebitNoteFindMany = vi.fn();
// getContactSummary also surfaces accountCreditBalance (Account Credit slice) via
// lib/contacts/accountCreditBalance.ts's two aggregate() calls (GRANT/REDEMPTION sums).
const mockAccountCreditAggregate = vi.fn();

vi.mock('../lib/prisma', () => ({
  prisma: {
    contact: { findFirst: mockContactFindFirst },
    invoicePayment: { findMany: mockInvoicePaymentFindMany },
    supplierPayment: { findMany: mockSupplierPaymentFindMany },
    invoice: { findMany: mockInvoiceFindMany },
    purchase: { findMany: mockPurchaseFindMany },
    debitNote: { findMany: mockDebitNoteFindMany },
    accountCreditEntry: { aggregate: mockAccountCreditAggregate },
  },
}));

const { getContactSummary } = await import('../controllers/contactController');

function makeReqRes(contactId: string) {
  const req = { params: { id: contactId }, user: 'tenant-1', tenantId: 'tenant-1' } as unknown as Request;
  const jsonMock = vi.fn();
  const res = { status: vi.fn().mockReturnThis(), json: jsonMock } as unknown as Response;
  return { req, res, jsonMock };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockContactFindFirst.mockResolvedValue({ id: 'contact-1', firstName: 'A', lastName: 'B' });
  mockInvoicePaymentFindMany.mockResolvedValue([]);
  mockInvoiceFindMany.mockResolvedValue([]);
  mockPurchaseFindMany.mockResolvedValue([]);
  mockDebitNoteFindMany.mockResolvedValue([]);
  mockAccountCreditAggregate.mockResolvedValue({ _sum: { amount: null } });
});

describe('getContactSummary — supplier-payment resolution', () => {
  it('queries supplierPayment via purchase.contactId, not the payment\'s own contactId', async () => {
    mockSupplierPaymentFindMany.mockResolvedValue([
      { amount: 100, paymentDate: new Date('2026-07-01') },
    ]);
    const { req, res, jsonMock } = makeReqRes('contact-1');
    await getContactSummary(req, res);

    expect(mockSupplierPaymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ purchase: expect.objectContaining({ contactId: 'contact-1' }) }),
      }),
    );
    const body = jsonMock.mock.calls[0][0] as { data: { totalPaid: number } };
    expect(body.data.totalPaid).toBe(100);
  });

  it('excludes draft ("new") purchases from the payable (youOwe) calculation', async () => {
    mockPurchaseFindMany.mockResolvedValue([{ balanceAmount: 500 }]);
    const { req, res } = makeReqRes('contact-1');
    await getContactSummary(req, res);

    expect(mockPurchaseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { notIn: ['new', 'cancelled'] } }),
      }),
    );
  });
});
