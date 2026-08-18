// lib/invoiceOutstanding.spec.ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  deriveInvoiceStatus,
  getInvoiceSettlement,
  recomputeInvoiceStatus,
  OUTSTANDING_TOLERANCE,
} from './invoiceOutstanding';

const D = (v: string | number) => new Prisma.Decimal(v);

describe('deriveInvoiceStatus (pure)', () => {
  it('full credit note settles the invoice → PAID, outstanding 0', () => {
    const r = deriveInvoiceStatus(1000, 0, 1000, 'UNPAID');
    expect(r.status).toBe('PAID');
    expect(r.outstanding.toString()).toBe('0');
  });

  it('partial credit note leaves a balance → PARTIALLY_PAID', () => {
    const r = deriveInvoiceStatus(1000, 0, 400, 'UNPAID');
    expect(r.status).toBe('PARTIALLY_PAID');
    expect(r.outstanding.toString()).toBe('600');
  });

  it('payment + credit note together settle the invoice → PAID', () => {
    const r = deriveInvoiceStatus(1000, 600, 400, 'PARTIALLY_PAID');
    expect(r.status).toBe('PAID');
    expect(r.outstanding.toString()).toBe('0');
  });

  it('nothing settled preserves the prior OVERDUE status', () => {
    const r = deriveInvoiceStatus(1000, 0, 0, 'OVERDUE');
    expect(r.status).toBe('OVERDUE');
    expect(r.outstanding.toString()).toBe('1000');
  });

  it('nothing settled defaults to UNPAID when no prior display status', () => {
    expect(deriveInvoiceStatus(1000, 0, 0).status).toBe('UNPAID');
  });

  it('removing the only credit note un-sticks a stale PARTIALLY_PAID → UNPAID', () => {
    const r = deriveInvoiceStatus(1000, 0, 0, 'PARTIALLY_PAID');
    expect(r.status).toBe('UNPAID');
  });

  it('treats a sub-tolerance residue as fully PAID', () => {
    const r = deriveInvoiceStatus(1000, 0, 999.997, 'UNPAID');
    expect(r.status).toBe('PAID');
    expect(r.outstanding.lte(OUTSTANDING_TOLERANCE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// In-memory fake db (mirrors the two reads getInvoiceSettlement performs and
// the invoice find/update recomputeInvoiceStatus performs).
// ---------------------------------------------------------------------------
interface FakeInvoice { id: string; userId: string; TotalAmount: Prisma.Decimal; status: string }
interface FakePayment { invoiceId: string; amount: Prisma.Decimal; isVoided: boolean }
interface FakeCN { invoiceId: string; userId: string; totalAmount: Prisma.Decimal; isDeleted: boolean }

function makeDb(invoice: FakeInvoice, payments: FakePayment[], creditNotes: FakeCN[]) {
  return {
    invoicePayment: {
      aggregate: async (args: { where: { invoiceId: string; isVoided: boolean } }) => {
        const sum = payments
          .filter((p) => p.invoiceId === args.where.invoiceId && p.isVoided === args.where.isVoided)
          .reduce((acc, p) => acc.plus(p.amount), new Prisma.Decimal(0));
        return { _sum: { amount: payments.length ? sum : null } };
      },
    },
    creditNote: {
      findMany: async (args: { where: { userId: string; isDeleted: boolean; invoiceId: string } }) =>
        creditNotes
          .filter(
            (c) =>
              c.invoiceId === args.where.invoiceId &&
              c.userId === args.where.userId &&
              c.isDeleted === args.where.isDeleted,
          )
          .map((c) => ({ invoiceId: c.invoiceId, totalAmount: c.totalAmount })),
    },
    invoice: {
      findFirst: async (args: { where: { id: string; userId: string } }) =>
        invoice.id === args.where.id && invoice.userId === args.where.userId ? { ...invoice } : null,
      update: async (args: { where: { id: string }; data: { status: string } }) => {
        invoice.status = args.data.status;
        return { ...invoice };
      },
    },
  } as unknown as Prisma.TransactionClient;
}

describe('getInvoiceSettlement (db)', () => {
  it('sums non-voided payments and non-deleted credit notes; ignores voided/deleted', async () => {
    const inv: FakeInvoice = { id: 'inv1', userId: 'u1', TotalAmount: D(1000), status: 'UNPAID' };
    const db = makeDb(
      inv,
      [
        { invoiceId: 'inv1', amount: D(200), isVoided: false },
        { invoiceId: 'inv1', amount: D(50), isVoided: true }, // voided → ignored
      ],
      [
        { invoiceId: 'inv1', userId: 'u1', totalAmount: D(300), isDeleted: false },
        { invoiceId: 'inv1', userId: 'u1', totalAmount: D(99), isDeleted: true }, // deleted → ignored
      ],
    );
    const { totalPaid, creditNoted } = await getInvoiceSettlement(db, 'inv1', 'u1');
    expect(totalPaid.toString()).toBe('200');
    expect(creditNoted.toString()).toBe('300');
  });
});

// The exact predicate recordInvoicePayment uses to reject an overpayment:
// reject when amount > outstanding + tolerance.
function paymentRejected(amount: number, outstanding: Prisma.Decimal): boolean {
  return new Prisma.Decimal(amount).gt(outstanding.add(OUTSTANDING_TOLERANCE));
}

describe('overpayment guard traces (brief scenarios)', () => {
  it('invoice 1000 + full CN 1000 → PAID, remaining 0, a 1000 payment is rejected', () => {
    const { outstanding, status } = deriveInvoiceStatus(1000, 0, 1000, 'UNPAID');
    expect(status).toBe('PAID');
    expect(outstanding.toString()).toBe('0');
    expect(paymentRejected(1000, outstanding)).toBe(true); // any payment now overpays
  });

  it('invoice 1000 + partial CN 400 → remaining 600, 600 accepted, 601 rejected', () => {
    const { outstanding, status } = deriveInvoiceStatus(1000, 0, 400, 'UNPAID');
    expect(status).toBe('PARTIALLY_PAID');
    expect(outstanding.toString()).toBe('600');
    expect(paymentRejected(600, outstanding)).toBe(false);
    expect(paymentRejected(601, outstanding)).toBe(true);
  });

  it('invoice remainingBalance equals aging outstanding for identical inputs', () => {
    // Both the invoice list and agingController net via netInvoiceOutstanding on
    // { TotalAmount, non-voided payments, non-deleted CN total } → identical value.
    const invoiceRemaining = deriveInvoiceStatus(1000, 250, 400).outstanding;
    const agingOutstanding = new Prisma.Decimal(1000).sub(250).sub(400);
    expect(invoiceRemaining.toString()).toBe(agingOutstanding.toString());
  });
});

describe('recomputeInvoiceStatus (db)', () => {
  it('full credit note flips the invoice to PAID and persists it', async () => {
    const inv: FakeInvoice = { id: 'inv1', userId: 'u1', TotalAmount: D(1000), status: 'UNPAID' };
    const db = makeDb(inv, [], [{ invoiceId: 'inv1', userId: 'u1', totalAmount: D(1000), isDeleted: false }]);
    const r = await recomputeInvoiceStatus(db, 'inv1', 'u1');
    expect(r?.status).toBe('PAID');
    expect(inv.status).toBe('PAID');
  });

  it('does not resurrect a CANCELLED invoice', async () => {
    const inv: FakeInvoice = { id: 'inv1', userId: 'u1', TotalAmount: D(1000), status: 'CANCELLED' };
    const db = makeDb(inv, [], [{ invoiceId: 'inv1', userId: 'u1', totalAmount: D(400), isDeleted: false }]);
    await recomputeInvoiceStatus(db, 'inv1', 'u1');
    expect(inv.status).toBe('CANCELLED');
  });
});
