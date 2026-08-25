/**
 * tests/gstReports.pointInTime.test.ts
 *
 * Task 6 (P1) — GST filing correctness:
 *  1. Output tax EXCLUDES DRAFT + CANCELLED invoices (a draft is not a supply;
 *     a cancelled invoice was reversed).
 *  2. Non-cancelled sales credit notes (CDNR) are NETTED against output tax.
 *  3. GSTR-1 and GSTR-3B AGREE on the same period (GSTR-3B previously lacked
 *     the vat→IGST fallback GSTR-1 has, so an items-less invoice diverged).
 *
 * Strategy: a hand-mocked prisma that honours the status / date / type filters
 * the reports set, seeded with a draft, a cancelled, two valid invoices (one
 * items-less → exercises the fallback) and two credit notes (one cancelled →
 * excluded from netting). We then assert the netted totals and cross-report
 * agreement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT = 'tenant-gst';

const {
  mockInvoiceFindMany,
  mockCreditNoteFindMany,
  mockPurchaseFindMany,
  mockInvoiceAggregate,
} = vi.hoisted(() => ({
  mockInvoiceFindMany: vi.fn(),
  mockCreditNoteFindMany: vi.fn(),
  mockPurchaseFindMany: vi.fn(),
  mockInvoiceAggregate: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    invoice: { findMany: mockInvoiceFindMany, aggregate: mockInvoiceAggregate },
    creditNote: { findMany: mockCreditNoteFindMany },
    purchase: { findMany: mockPurchaseFindMany },
  },
}));

import { getGstSummary } from '../lib/financialQueries';
import { gstr1, gstr3b } from '../controllers/taxReportsController';

// ---------------------------------------------------------------------------
// Seed data — period is Jan 2024.
// ---------------------------------------------------------------------------
const D = (s: string) => new Date(s);
const igst = (amt: number) => [{ taxes: [{ kind: 'IGST', amount: amt }] }];
const cgstSgst = (c: number, s: number) => [{ taxes: [{ kind: 'CGST', amount: c }, { kind: 'SGST', amount: s }] }];

const INVOICES = [
  // DRAFT — must be excluded from output tax.
  { userId: TENANT, isDeleted: false, invoiceType: 'INVOICE', status: 'DRAFT',
    invoiceDate: D('2024-01-10'), taxableAmount: 1000, vat: 180, items: igst(180), billToCustomer: null },
  // CANCELLED — must be excluded.
  { userId: TENANT, isDeleted: false, invoiceType: 'INVOICE', status: 'CANCELLED',
    invoiceDate: D('2024-01-11'), taxableAmount: 500, vat: 90, items: igst(90), billToCustomer: null },
  // Valid PAID invoice: CGST 90 + SGST 90 on 1000.
  { userId: TENANT, isDeleted: false, invoiceType: 'INVOICE', status: 'PAID', invoiceNumber: 'INV-C',
    invoiceDate: D('2024-01-15'), taxableAmount: 1000, vat: 180, items: cgstSgst(90, 90), billToCustomer: null },
  // Valid SENT invoice with NO decomposable items → vat→IGST fallback (360).
  { userId: TENANT, isDeleted: false, invoiceType: 'INVOICE', status: 'SENT', invoiceNumber: 'INV-D',
    invoiceDate: D('2024-01-20'), taxableAmount: 2000, vat: 360, items: [], billToCustomer: null },
];

const CREDIT_NOTES = [
  // Non-cancelled CN against INV-C: CGST 18 + SGST 18 on 200 → netted.
  { userId: TENANT, isDeleted: false, status: 'PENDING', invoiceId: 'inv-c',
    creditNoteDate: D('2024-01-25'), taxableAmount: 200, vat: 36, items: cgstSgst(18, 18) },
  // Cancelled CN → excluded from netting.
  { userId: TENANT, isDeleted: false, status: 'CANCELLED', invoiceId: 'inv-c',
    creditNoteDate: D('2024-01-26'), taxableAmount: 100, vat: 18, items: igst(18) },
];

// ---------------------------------------------------------------------------
// Filter-aware mock impls.
// ---------------------------------------------------------------------------
function inRange(d: Date, w: { gte?: Date; lte?: Date }): boolean {
  if (w?.gte && d < w.gte) return false;
  if (w?.lte && d > w.lte) return false;
  return true;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoiceFindMany.mockImplementation(async ({ where }: any) => {
    let list = INVOICES.filter((i) => i.userId === where.userId && !i.isDeleted && i.invoiceType === where.invoiceType);
    if (where.status?.in) list = list.filter((i) => where.status.in.includes(i.status));
    if (where.status?.notIn) list = list.filter((i) => !where.status.notIn.includes(i.status));
    if (where.invoiceDate) list = list.filter((i) => inRange(i.invoiceDate, where.invoiceDate));
    return list;
  });
  mockCreditNoteFindMany.mockImplementation(async ({ where }: any) => {
    let list = CREDIT_NOTES.filter((c) => c.userId === where.userId && !c.isDeleted);
    if (where.status?.not) list = list.filter((c) => c.status !== where.status.not);
    if (where.creditNoteDate) list = list.filter((c) => inRange(c.creditNoteDate, where.creditNoteDate));
    return list;
  });
  mockPurchaseFindMany.mockResolvedValue([]);
  mockInvoiceAggregate.mockResolvedValue({ _count: { id: 0 }, _sum: { taxableAmount: null } });
});

function makeReq(query: Record<string, string>): Request {
  return { tenantId: TENANT, user: TENANT, query } as unknown as Request;
}
function makeRes(): Response & { body: any } {
  const res: any = { body: null };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  return res;
}

const PERIOD = { from: '2024-01-01', to: '2024-01-31' };

describe('getGstSummary — status filter + CDNR netting', () => {
  it('excludes DRAFT/CANCELLED invoices and nets non-cancelled credit notes', async () => {
    const gst = await getGstSummary(TENANT, D('2024-01-01'), D('2024-01-31'));
    // Gross outward = C(180) + D(360, via OTHER fallback) = 540; CN nets 36 → 504.
    expect(gst.outwardTotal).toBe(504);
    expect(gst.outwardByKind.CGST).toBe(72); // 90 − 18
    expect(gst.outwardByKind.SGST).toBe(72); // 90 − 18
    // Draft (180) + cancelled (90) never entered the total.
  });
});

describe('GSTR-1 / GSTR-3B — status filter, fallback, CDNR, agreement', () => {
  it('GSTR-1 excludes draft/cancelled, nets CN, applies vat fallback', async () => {
    const res = makeRes();
    await gstr1(makeReq(PERIOD), res);
    const s = res.body.data.summary;
    expect(s.totalInvoices).toBe(2); // only the two valid invoices
    expect(s.totalCgst).toBe(72);
    expect(s.totalSgst).toBe(72);
    expect(s.totalIgst).toBe(360); // INV-D fallback
    expect(s.totalTaxableValue).toBe(2800); // 3000 − 200 CN
    expect(s.totalTax).toBe(504);
  });

  it('GSTR-3B matches GSTR-1 output tax on the same period', async () => {
    const r1 = makeRes();
    const r3 = makeRes();
    await gstr1(makeReq(PERIOD), r1);
    await gstr3b(makeReq(PERIOD), r3);

    const out = r3.body.data['3.1_outwardSupplies'];
    expect(out.cgst).toBe(72);
    expect(out.sgst).toBe(72);
    expect(out.igst).toBe(360); // fallback now present in 3B too
    expect(out.taxableValue).toBe(2800);

    const g3bTotal = out.cgst + out.sgst + out.igst + out.cess;
    expect(g3bTotal).toBe(r1.body.data.summary.totalTax);
  });
});
