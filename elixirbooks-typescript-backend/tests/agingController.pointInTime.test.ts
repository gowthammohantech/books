/**
 * tests/agingController.pointInTime.test.ts
 *
 * Task 6 (P1) — AR/AP aging as-of a PAST date must reflect balances AT that
 * date, not today. Previously `asOf` only bucketed rows; it never FILTERED the
 * source data, so a back-dated aging showed today's balances (invoices raised
 * after asOf appeared; payments made after asOf retroactively vanished).
 *
 * These drive the LEGACY (pre-ledger) path — companySettings.ledgerInitialized
 * is false — and assert:
 *   AR: an invoice dated after asOf is absent; a payment received after asOf
 *       does NOT reduce the aged balance; a now-PAID invoice settled BEFORE
 *       asOf is correctly zero.
 *   AP: a bill entered after asOf is absent; a supplier payment made after asOf
 *       is added back so a now-settled bill still shows open at asOf.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT = 'tenant-aging';

const {
  mockCompanySettingsFindFirst,
  mockInvoiceFindMany,
  mockCreditNoteFindMany,
  mockPurchaseFindMany,
} = vi.hoisted(() => ({
  mockCompanySettingsFindFirst: vi.fn(),
  mockInvoiceFindMany: vi.fn(),
  mockCreditNoteFindMany: vi.fn(),
  mockPurchaseFindMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    companySettings: { findFirst: mockCompanySettingsFindFirst },
    invoice: { findMany: mockInvoiceFindMany },
    creditNote: { findMany: mockCreditNoteFindMany },
    purchase: { findMany: mockPurchaseFindMany },
  },
}));

import { arAging, apAging } from '../controllers/agingController';

const D = (s: string) => new Date(s);
const ASOF = '2024-06-15';

const INVOICES = [
  // E: dated before asOf; its only payment lands AFTER asOf → full 1000 open at asOf.
  { id: 'inv-e', userId: TENANT, isDeleted: false, invoiceType: 'INVOICE', status: 'UNPAID',
    invoiceNumber: 'INV-E', invoiceDate: D('2024-06-01'), dueDate: D('2024-06-10'), TotalAmount: 1000,
    customer: { name: 'Acme' },
    payments: [{ amount: 400, isVoided: false, received_on: D('2024-06-20') }] },
  // F: dated AFTER asOf → must be absent from a back-dated aging.
  { id: 'inv-f', userId: TENANT, isDeleted: false, invoiceType: 'INVOICE', status: 'UNPAID',
    invoiceNumber: 'INV-F', invoiceDate: D('2024-07-01'), dueDate: D('2024-07-10'), TotalAmount: 999,
    customer: { name: 'Beta' }, payments: [] },
  // G: now PAID, settled BEFORE asOf → zero outstanding at asOf → absent.
  { id: 'inv-g', userId: TENANT, isDeleted: false, invoiceType: 'INVOICE', status: 'PAID',
    invoiceNumber: 'INV-G', invoiceDate: D('2024-06-05'), dueDate: D('2024-06-12'), TotalAmount: 500,
    customer: { name: 'Gamma' },
    payments: [{ amount: 500, isVoided: false, received_on: D('2024-06-10') }] },
  // H: created via the unified-contact flow — legacy `customer` is null, only the
  // unified `contact` is set. Must resolve a non-blank name (not "Deleted User").
  { id: 'inv-h', userId: TENANT, isDeleted: false, invoiceType: 'INVOICE', status: 'UNPAID',
    invoiceNumber: 'INV-H', invoiceDate: D('2024-06-03'), dueDate: D('2024-06-13'), TotalAmount: 250,
    customer: null,
    contact: { id: 'contact-h', firstName: 'Cara', lastName: 'Contactly', organisation: null },
    payments: [] },
];

const PURCHASES = [
  // P1: now fully paid (balance 0) but the payment landed AFTER asOf → add back 800.
  { id: 'pur-1', userId: TENANT, isDeleted: false, status: 'paid', purchaseId: 'PUR-1',
    purchaseDate: D('2024-06-01'), dueDate: D('2024-06-30'), balanceAmount: 0,
    contact: null, billFromUser: { firstName: 'Sup', lastName: 'One' },
    supplierPayments: [{ amount: 800, isVoided: false, paymentDate: D('2024-06-20') }] },
  // P2: entered AFTER asOf → absent.
  { id: 'pur-2', userId: TENANT, isDeleted: false, status: 'pending', purchaseId: 'PUR-2',
    purchaseDate: D('2024-07-01'), dueDate: D('2024-07-30'), balanceAmount: 700,
    contact: null, billFromUser: { firstName: 'Sup', lastName: 'Two' }, supplierPayments: [] },
  // P3: open, no later payments → 300 at asOf.
  { id: 'pur-3', userId: TENANT, isDeleted: false, status: 'pending', purchaseId: 'PUR-3',
    purchaseDate: D('2024-06-02'), dueDate: D('2024-06-28'), balanceAmount: 300,
    contact: null, billFromUser: { firstName: 'Sup', lastName: 'Three' }, supplierPayments: [] },
];

function le(d: Date, lte?: Date) { return !lte || d <= lte; }
function gt(d: Date, g?: Date) { return !g || d > g; }

beforeEach(() => {
  vi.clearAllMocks();
  mockCompanySettingsFindFirst.mockResolvedValue({ ledgerInitialized: false });
  mockCreditNoteFindMany.mockResolvedValue([]);

  mockInvoiceFindMany.mockImplementation(async ({ where, select }: any) => {
    let list = INVOICES.filter((i) => i.userId === where.userId && !i.isDeleted && i.invoiceType === where.invoiceType);
    if (where.status?.notIn) list = list.filter((i) => !where.status.notIn.includes(i.status));
    if (where.invoiceDate?.lte) list = list.filter((i) => le(i.invoiceDate, where.invoiceDate.lte));
    const pw = select?.payments?.where;
    return list.map((i) => ({
      ...i,
      payments: i.payments.filter((p) => !p.isVoided && (!pw?.received_on?.lte || le(p.received_on, pw.received_on.lte))),
    }));
  });

  mockPurchaseFindMany.mockImplementation(async ({ where, select }: any) => {
    let list = PURCHASES.filter((p) => p.userId === where.userId && !p.isDeleted);
    if (where.status?.not) list = list.filter((p) => p.status !== where.status.not);
    if (where.purchaseDate?.lte) list = list.filter((p) => le(p.purchaseDate, where.purchaseDate.lte));
    const sw = select?.supplierPayments?.where;
    return list.map((p) => ({
      ...p,
      supplierPayments: p.supplierPayments.filter((sp) => !sp.isVoided && (!sw?.paymentDate?.gt || gt(sp.paymentDate, sw.paymentDate.gt))),
    }));
  });
});

function makeReq(): Request {
  return { tenantId: TENANT, user: TENANT, query: { asOf: ASOF } } as unknown as Request;
}
function makeRes(): Response & { body: any } {
  const res: any = { body: null };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  return res;
}

describe('arAging — point-in-time as-of a past date', () => {
  it('excludes later invoices and does not let later payments reduce the aged balance', async () => {
    const res = makeRes();
    await arAging(makeReq(), res);
    const data = res.body.data;
    const ids = data.rows.map((r: any) => r.id);

    expect(ids).toContain('inv-e');
    expect(ids).not.toContain('inv-f'); // raised after asOf
    expect(ids).not.toContain('inv-g'); // settled before asOf → zero

    const e = data.rows.find((r: any) => r.id === 'inv-e');
    expect(e.amount).toBe(1000); // the after-asOf payment of 400 must NOT apply
    expect(data.total).toBe(1250); // 1000 (inv-e) + 250 (inv-h, contact-linked)
  });

  it('resolves a contact-linked row (legacy customer null) to a non-blank name', async () => {
    const res = makeRes();
    await arAging(makeReq(), res);
    const data = res.body.data;
    const h = data.rows.find((r: any) => r.id === 'inv-h');
    expect(h).toBeDefined();
    expect(h.label).toContain('Cara Contactly');
    expect(h.label).not.toContain('undefined');
  });
});

describe('apAging — point-in-time as-of a past date', () => {
  it('adds back supplier payments made after asOf and excludes later bills', async () => {
    const res = makeRes();
    await apAging(makeReq(), res);
    const data = res.body.data;
    const ids = data.rows.map((r: any) => r.id);

    expect(ids).toContain('pur-1'); // now paid, but the payment was after asOf
    expect(ids).toContain('pur-3');
    expect(ids).not.toContain('pur-2'); // entered after asOf

    const p1 = data.rows.find((r: any) => r.id === 'pur-1');
    expect(p1.amount).toBe(800); // 0 current balance + 800 later payment added back
    expect(data.total).toBe(1100); // 800 + 300
  });
});
