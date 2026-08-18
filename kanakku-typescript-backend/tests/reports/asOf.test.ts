/**
 * tests/reports/asOf.test.ts
 *
 * Task 6 (P1) review finding: `agingController.parseAsOf` was fixed to build
 * the `?asOf=` cutoff via `Date.UTC(...)` (an inclusive UTC end-of-day), but
 * `exportController.parseAsOf` and `reconciliationController.tallyCheck`'s
 * inline `asOf` construction still used `new Date(str); d.setHours(23,59,59,999)`
 * — a SERVER-LOCAL-TIMEZONE boundary. On a non-UTC server the same
 * `?asOf=2024-06-15` therefore produced a different cutoff INSTANT in the CSV
 * export / reconciliation tally than in the JSON aging API, so a document
 * dated near the boundary could be included by one and excluded by another.
 *
 * Fix: all three now import the single `parseAsOf` from `lib/reports/asOf.ts`.
 * This file proves:
 *   1. The shared parser returns the exact UTC-safe inclusive end-of-day
 *      instant (independent of process timezone).
 *   2. A document dated exactly AT that boundary instant is treated
 *      IDENTICALLY (included) by agingController.arAging/apAging,
 *      exportController.exportArAging/exportApAging, and
 *      reconciliationController.tallyCheck — and a document 1ms after the
 *      boundary is excluded by all three.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { parseAsOf } from '../../lib/reports/asOf';

const TENANT = 'tenant-asof';
const ASOF = '2024-06-15';

// The exact inclusive UTC boundary instant that parseAsOf must produce for
// ASOF, computed independently of the implementation under test.
const BOUNDARY = new Date(Date.UTC(2024, 5, 15, 23, 59, 59, 999));
const JUST_AFTER = new Date(BOUNDARY.getTime() + 1); // 2024-06-16T00:00:00.000Z

// =============================================================================
// 1. Unit tests on the shared parser itself.
// =============================================================================
describe('parseAsOf (lib/reports/asOf) — shared UTC-safe boundary', () => {
  it('returns an inclusive UTC end-of-day instant for a date-only string', () => {
    const d = parseAsOf(ASOF);
    expect(d.getTime()).toBe(BOUNDARY.getTime());
    expect(d.toISOString()).toBe('2024-06-15T23:59:59.999Z');
  });

  it('is independent of the process timezone (built from UTC field getters)', () => {
    // Regardless of what TZ the test runner's process is in, the boundary must
    // be computed from the UTC calendar fields, not local getHours/setHours.
    const input = new Date('2024-06-15T00:00:00.000Z');
    const d = parseAsOf(input.toISOString());
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(5);
    expect(d.getUTCDate()).toBe(15);
    expect(d.getUTCHours()).toBe(23);
    expect(d.getUTCMinutes()).toBe(59);
    expect(d.getUTCSeconds()).toBe(59);
    expect(d.getUTCMilliseconds()).toBe(999);
  });

  it('falls back to "now" (UTC end of day) for missing or invalid input', () => {
    const missing = parseAsOf(undefined);
    const invalid = parseAsOf('not-a-date');
    for (const d of [missing, invalid]) {
      expect(d.getUTCHours()).toBe(23);
      expect(d.getUTCMinutes()).toBe(59);
      expect(d.getUTCSeconds()).toBe(59);
      expect(d.getUTCMilliseconds()).toBe(999);
    }
  });
});

// =============================================================================
// 2. Cross-controller boundary equivalence: one shared prisma mock, one shared
//    dataset with a document exactly AT the boundary and one 1ms after it.
// =============================================================================
const {
  mockCompanySettingsFindFirst,
  mockInvoiceFindMany,
  mockCreditNoteFindMany,
  mockPurchaseFindMany,
  mockAccountFindMany,
  mockJournalEntryFindMany,
  mockBankDetailFindMany,
} = vi.hoisted(() => ({
  mockCompanySettingsFindFirst: vi.fn(),
  mockInvoiceFindMany: vi.fn(),
  mockCreditNoteFindMany: vi.fn(),
  mockPurchaseFindMany: vi.fn(),
  mockAccountFindMany: vi.fn(),
  mockJournalEntryFindMany: vi.fn(),
  mockBankDetailFindMany: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    companySettings: { findFirst: mockCompanySettingsFindFirst },
    invoice: { findMany: mockInvoiceFindMany },
    creditNote: { findMany: mockCreditNoteFindMany },
    purchase: { findMany: mockPurchaseFindMany },
    account: { findMany: mockAccountFindMany },
    journalEntry: { findMany: mockJournalEntryFindMany },
    bankDetail: { findMany: mockBankDetailFindMany },
  },
}));

import { arAging, apAging } from '../../controllers/agingController';
import { exportArAging, exportApAging } from '../../controllers/exportController';
import { tallyCheck } from '../../controllers/reconciliationController';

const D = (s: string) => new Date(s);

// Invoices: baseline (well before), boundary (exactly at the inclusive UTC
// cutoff), after (1ms past it). None have payments so amounts stay gross.
const INVOICES = [
  { id: 'inv-baseline', userId: TENANT, isDeleted: false, invoiceType: 'INVOICE', status: 'UNPAID',
    invoiceNumber: 'INV-BASELINE', invoiceDate: D('2024-06-01'), dueDate: D('2024-06-01'),
    TotalAmount: 1000, customer: { name: 'Baseline Co' }, payments: [] },
  { id: 'inv-boundary', userId: TENANT, isDeleted: false, invoiceType: 'INVOICE', status: 'UNPAID',
    invoiceNumber: 'INV-BOUNDARY', invoiceDate: BOUNDARY, dueDate: BOUNDARY,
    TotalAmount: 500, customer: { name: 'Boundary Co' }, payments: [] },
  { id: 'inv-after', userId: TENANT, isDeleted: false, invoiceType: 'INVOICE', status: 'UNPAID',
    invoiceNumber: 'INV-AFTER', invoiceDate: JUST_AFTER, dueDate: JUST_AFTER,
    TotalAmount: 300, customer: { name: 'After Co' }, payments: [] },
];

// Purchases: same baseline/boundary/after shape, via balanceAmount (no later
// supplier payments so add-back is inert).
const PURCHASES = [
  { id: 'pur-baseline', userId: TENANT, isDeleted: false, status: 'pending', purchaseId: 'PUR-BASELINE',
    purchaseDate: D('2024-06-01'), dueDate: D('2024-06-01'), balanceAmount: 700,
    contact: null, billFromUser: { firstName: 'Sup', lastName: 'Base' },
    supplier: { supplier_name: 'Sup Base' }, supplierPayments: [] },
  { id: 'pur-boundary', userId: TENANT, isDeleted: false, status: 'pending', purchaseId: 'PUR-BOUNDARY',
    purchaseDate: BOUNDARY, dueDate: BOUNDARY, balanceAmount: 500,
    contact: null, billFromUser: { firstName: 'Sup', lastName: 'Boundary' },
    supplier: { supplier_name: 'Sup Boundary' }, supplierPayments: [] },
  { id: 'pur-after', userId: TENANT, isDeleted: false, status: 'pending', purchaseId: 'PUR-AFTER',
    purchaseDate: JUST_AFTER, dueDate: JUST_AFTER, balanceAmount: 300,
    contact: null, billFromUser: { firstName: 'Sup', lastName: 'After' },
    supplier: { supplier_name: 'Sup After' }, supplierPayments: [] },
];

function le(d: Date, lte?: Date) { return !lte || d.getTime() <= lte.getTime(); }
function gt(d: Date, g?: Date) { return !g || d.getTime() > g.getTime(); }

beforeEach(() => {
  vi.clearAllMocks();
  mockCompanySettingsFindFirst.mockResolvedValue({ ledgerInitialized: false }); // legacy path everywhere
  mockCreditNoteFindMany.mockResolvedValue([]);
  mockAccountFindMany.mockResolvedValue([]);
  mockJournalEntryFindMany.mockResolvedValue([]);
  mockBankDetailFindMany.mockResolvedValue([]);

  mockInvoiceFindMany.mockImplementation(async ({ where, select }: any) => {
    let list = INVOICES.filter(
      (i) => i.userId === where.userId && !i.isDeleted && i.invoiceType === where.invoiceType,
    );
    if (where.status?.notIn) list = list.filter((i) => !where.status.notIn.includes(i.status));
    if (where.invoiceDate?.lte) list = list.filter((i) => le(i.invoiceDate, where.invoiceDate.lte));
    const pw = select?.payments?.where;
    return list.map((i) => ({
      ...i,
      payments: i.payments.filter(
        (p: any) => !p.isVoided && (!pw?.received_on?.lte || le(p.received_on, pw.received_on.lte)),
      ),
    }));
  });

  mockPurchaseFindMany.mockImplementation(async ({ where, select }: any) => {
    let list = PURCHASES.filter((p) => p.userId === where.userId && !p.isDeleted);
    if (where.status?.not) list = list.filter((p) => p.status !== where.status.not);
    if (where.purchaseDate?.lte) list = list.filter((p) => le(p.purchaseDate, where.purchaseDate.lte));
    const sw = select?.supplierPayments?.where;
    return list.map((p) => ({
      ...p,
      supplierPayments: p.supplierPayments.filter(
        (sp: any) => !sp.isVoided && (!sw?.paymentDate?.gt || gt(sp.paymentDate, sw.paymentDate.gt)),
      ),
    }));
  });
});

function makeReq(): Request {
  return { tenantId: TENANT, user: TENANT, query: { asOf: ASOF } } as unknown as Request;
}
function makeJsonRes(): Response & { body: any } {
  const res: any = { body: null };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  return res;
}
function makeCsvRes(): Response & { sent: string } {
  const res: any = { sent: '' };
  res.setHeader = vi.fn();
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn((s: string) => { res.sent = s; return res; });
  return res;
}

describe('Boundary equivalence across arAging / exportArAging / tallyCheck', () => {
  it('agingController.arAging includes baseline+boundary, excludes after', async () => {
    const res = makeJsonRes();
    await arAging(makeReq(), res);
    const data = res.body.data;
    expect(data.asOf).toBe('2024-06-15T23:59:59.999Z');
    const ids = data.rows.map((r: any) => r.id);
    expect(ids).toContain('inv-baseline');
    expect(ids).toContain('inv-boundary');
    expect(ids).not.toContain('inv-after');
    expect(data.total).toBe(1500);
  });

  it('exportController.exportArAging (CSV) includes baseline+boundary, excludes after', async () => {
    const res = makeCsvRes();
    await exportArAging(makeReq(), res as unknown as Response);
    expect(res.sent).toContain('INV-BASELINE');
    expect(res.sent).toContain('INV-BOUNDARY');
    expect(res.sent).not.toContain('INV-AFTER');
  });

  it('reconciliationController.tallyCheck AR sub-ledger includes baseline+boundary, excludes after', async () => {
    const res = makeJsonRes();
    await tallyCheck(makeReq(), res);
    const data = res.body.data;
    expect(data.asOf).toBe('2024-06-15T23:59:59.999Z');
    expect(data.ar.subledgerOpenInvoices).toBe(1500);
  });
});

describe('Boundary equivalence across apAging / exportApAging / tallyCheck (AP)', () => {
  it('agingController.apAging includes baseline+boundary, excludes after', async () => {
    const res = makeJsonRes();
    await apAging(makeReq(), res);
    const data = res.body.data;
    const ids = data.rows.map((r: any) => r.id);
    expect(ids).toContain('pur-baseline');
    expect(ids).toContain('pur-boundary');
    expect(ids).not.toContain('pur-after');
    expect(data.total).toBe(1200);
  });

  it('exportController.exportApAging (CSV) includes baseline+boundary, excludes after', async () => {
    const res = makeCsvRes();
    await exportApAging(makeReq(), res as unknown as Response);
    expect(res.sent).toContain('PUR-BASELINE');
    expect(res.sent).toContain('PUR-BOUNDARY');
    expect(res.sent).not.toContain('PUR-AFTER');
  });

  it('reconciliationController.tallyCheck AP sub-ledger includes baseline+boundary, excludes after', async () => {
    const res = makeJsonRes();
    await tallyCheck(makeReq(), res);
    const data = res.body.data;
    expect(data.ap.subledgerOpenBills).toBe(1200);
  });
});
