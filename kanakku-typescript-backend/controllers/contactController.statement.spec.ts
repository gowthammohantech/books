// controllers/contactController.statement.spec.ts
//
// Bug: a supplier contact's "Statement of Account" was empty and never
// reflected payments made to the supplier. getContactStatement only ever
// queried the customer/AR side (invoice + invoicePayment). This spec asserts
// the AP side (purchase bills + supplierPayment) is now included, with the
// sign convention mirrored against the existing AR lines: a bill is a CREDIT
// (increases what we owe) and a supplier payment is a DEBIT (reduces it back
// toward zero) on the one unified running balance.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    contact: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'c1',
        userId: 'u1',
        isDeleted: false,
        currencyCode: 'USD',
        firstName: null,
        lastName: null,
        organisation: 'Acme Supplies',
      }),
    },
    currency: { findFirst: vi.fn().mockResolvedValue({ code: 'USD' }) },
    invoice: { findMany: vi.fn().mockResolvedValue([]) },
    invoicePayment: { findMany: vi.fn().mockResolvedValue([]) },
    purchase: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'p1',
          purchaseId: 'PUR-0001',
          purchaseDate: new Date('2026-06-01'),
          totalAmount: '1000',
          status: 'completed',
          currencyCode: 'USD',
        },
      ]),
    },
    supplierPayment: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'sp1',
          purchaseId: 'p1',
          paidAmount: '400',
          paymentDate: new Date('2026-06-15'),
          notes: null,
          referenceNumber: null,
          purchase: { purchaseId: 'PUR-0001', currencyCode: 'USD' },
        },
      ]),
    },
    debitNote: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('../lib/contacts/contactIdentity', () => ({
  resolveDisplayName: (c: { organisation?: string | null }) => c.organisation ?? 'Unknown',
  validateContactIdentity: () => ({ ok: true }),
}));

import { getContactStatement } from './contactController';

function fakeRes() {
  return {
    statusCode: 0,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
}

const req = {
  params: { id: 'c1' },
  query: { from: '2026-01-01', to: '2026-12-31' },
  user: 'u1',
} as never;

beforeEach(() => vi.clearAllMocks());

describe('getContactStatement — supplier (AP) side', () => {
  it('includes a bill as a CREDIT and a supplier payment as a DEBIT, with a nonzero closing balance', async () => {
    const res = fakeRes();
    await getContactStatement(req, res as never);

    expect(res.statusCode).toBe(0); // no error status was set
    expect(res.body.success).toBe(true);
    const bucket = res.body.data.byCurrency.find((b: any) => b.currencyCode === 'USD');
    expect(bucket).toBeTruthy();

    const bill = bucket.lines.find((l: any) => l.kind === 'BILL');
    expect(bill).toBeTruthy();
    expect(bill.credit).toBe(1000);
    expect(bill.debit).toBe(0);
    expect(bill.reference).toBe('PUR-0001');

    const payment = bucket.lines.find((l: any) => l.kind === 'SUPPLIER_PAYMENT');
    expect(payment).toBeTruthy();
    expect(payment.debit).toBe(400);
    expect(payment.credit).toBe(0);
    expect(payment.reference).toBe('PUR-0001');

    // Bill (credit 1000) partially offset by payment (debit 400): net -600 —
    // we owe the supplier 600. Nonzero, and negative (payable), as expected.
    expect(bucket.closingBalance).toBe(-600);
    expect(bucket.totals.debit).toBe(400);
    expect(bucket.totals.credit).toBe(1000);
  });
});
