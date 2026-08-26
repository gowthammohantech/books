/**
 * tests/invoiceDraftLifecycle.test.ts
 *
 * P1 Task 3 — invoice draft lifecycle: stock & GL coherence.
 *
 * Model (documented in the task report): createInvoice deducts stock for EVERY
 * non-PROFORMA invoice (regardless of DRAFT) and posts GL when not deferred by
 * approvals. The bug was that a DRAFT edit (updateInvoice) never adjusted stock
 * and never re-posted GL, so:
 *   (b) editing quantities left inventory stale, and
 *   (c) delete (which restores the CURRENT items) then produced phantom stock.
 *
 * The fix keeps create-always-deducts (so it composes with the P1-1 deleteInvoice
 * that restores the current items) and makes updateInvoice keep both inventory and
 * the GL in step: fully revert the previously-applied issue, re-apply the issue for
 * the new lines (net = delta), and — only when the invoice was actually posted —
 * void + re-post the issued/cogs entries at the new totals.
 *
 * These are control-flow assertions over a mocked Prisma tx (the repo's established
 * controller-spec pattern): the GL engine and stock helper are mocked, so we assert
 * the exact stock deltas and GL calls, and that the net stock movement across
 * create + edit + delete is zero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

const TENANT_ID = 'tenant-alpha';

const {
  mockPostInvoiceIssued,
  mockPostInvoicePayment,
  mockPostSaleCogs,
  mockReverseDocument,
  mockVoidDocument,
  mockApplyStockAdjustment,
  stockCalls,
  m,
} = vi.hoisted(() => {
  const mk = () => vi.fn();
  const stockCalls: { qtyDelta: number; type: string }[] = [];
  return {
    mockPostInvoiceIssued: vi.fn().mockResolvedValue(undefined),
    mockPostInvoicePayment: vi.fn().mockResolvedValue(undefined),
    mockPostSaleCogs: vi.fn().mockResolvedValue(undefined),
    mockReverseDocument: vi.fn().mockResolvedValue(undefined),
    mockVoidDocument: vi.fn().mockResolvedValue(undefined),
    mockApplyStockAdjustment: vi.fn().mockImplementation(
      async (_tx: unknown, p: { qtyDelta: number; type: string }) => {
        stockCalls.push({ qtyDelta: p.qtyDelta, type: p.type });
        return new Prisma.Decimal(0);
      },
    ),
    stockCalls,
    m: {
      generalSettingFindUnique: mk(),
      generalSettingUpsert: mk(),
      invoiceFindFirst: mk(),
      invoiceCreate: mk(),
      invoiceUpdate: mk(),
      contactFindFirst: mk(),
      customerFindFirst: mk(),
      companySettingsFindFirst: mk(),
      productFindUnique: mk(),
      inventoryFindFirst: mk(),
      customFieldValueCreateMany: mk(),
      customFieldValueDeleteMany: mk(),
      invoicePaymentCreate: mk(),
      invoicePaymentFindMany: mk(),
      invoicePaymentUpdate: mk(),
      signatureFindFirst: mk(),
      paymentModeFindUnique: mk(),
    },
  };
});

vi.mock('../lib/prisma', () => {
  const db = {
    generalSetting: { findUnique: m.generalSettingFindUnique, upsert: m.generalSettingUpsert },
    invoice: { findFirst: m.invoiceFindFirst, create: m.invoiceCreate, update: m.invoiceUpdate },
    contact: { findFirst: m.contactFindFirst },
    customer: { findFirst: m.customerFindFirst },
    companySettings: { findFirst: m.companySettingsFindFirst },
    product: { findUnique: m.productFindUnique },
    inventory: { findFirst: m.inventoryFindFirst },
    customFieldValue: { createMany: m.customFieldValueCreateMany, deleteMany: m.customFieldValueDeleteMany },
    invoicePayment: { create: m.invoicePaymentCreate, findMany: m.invoicePaymentFindMany, update: m.invoicePaymentUpdate },
    signature: { findFirst: m.signatureFindFirst },
    paymentMode: { findUnique: m.paymentModeFindUnique },
    $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(db)),
  };
  return { prisma: db };
});

vi.mock('../lib/ledger/ledgerPosting', () => ({
  postInvoiceIssued: mockPostInvoiceIssued,
  postInvoicePayment: mockPostInvoicePayment,
  postSaleCogs: mockPostSaleCogs,
  reverseDocument: mockReverseDocument,
  voidDocument: mockVoidDocument,
}));
vi.mock('../lib/inventory/stockAdjust', () => ({ applyStockAdjustment: mockApplyStockAdjustment, resolveRestockUnitCost: vi.fn().mockResolvedValue(0) }));
vi.mock('../utils/mailer', () => ({ sendMail: vi.fn() }));

import {
  createInvoice,
  updateInvoice,
  deleteInvoice,
} from '../controllers/Admin/Invoice/invoiceController';

function makeReqRes(body: Record<string, unknown>, params: Record<string, unknown> = {}) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    params,
    query: {},
    body,
    file: undefined,
    files: [],
    protocol: 'http',
    get: vi.fn().mockReturnValue('localhost'),
  } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  return { req, res };
}

/** Sum of every qtyDelta passed to applyStockAdjustment so far. */
const netStock = () => stockCalls.reduce((s, c) => s + c.qtyDelta, 0);

beforeEach(() => {
  vi.clearAllMocks();
  stockCalls.length = 0;
  mockApplyStockAdjustment.mockImplementation(async (_tx: unknown, p: { qtyDelta: number; type: string }) => {
    stockCalls.push({ qtyDelta: p.qtyDelta, type: p.type });
    return new Prisma.Decimal(0);
  });
  m.generalSettingFindUnique.mockResolvedValue(null);
  m.generalSettingUpsert.mockResolvedValue({});
  m.invoiceFindFirst.mockResolvedValue(null);
  m.contactFindFirst.mockResolvedValue({ id: 'c1', currencyCode: null, defaultTaxTreatment: null });
  m.customerFindFirst.mockResolvedValue(null);
  m.companySettingsFindFirst.mockResolvedValue({ approvalsEnabled: false, taxRegime: 'NONE' });
  m.productFindUnique.mockResolvedValue({ item_type: 'Product', valuationMethod: 'WAC' });
  m.inventoryFindFirst.mockResolvedValue({
    id: 'inv-row', quantity: 100, quantityOnHand: new Prisma.Decimal(100), avgCost: new Prisma.Decimal(10), inventory_history: [],
  });
  m.customFieldValueCreateMany.mockResolvedValue({});
  m.customFieldValueDeleteMany.mockResolvedValue({});
  m.invoicePaymentCreate.mockResolvedValue({ id: 'pay-1', amount: new Prisma.Decimal(0) });
  m.invoicePaymentFindMany.mockResolvedValue([]);
  m.invoicePaymentUpdate.mockResolvedValue({});
  m.signatureFindFirst.mockResolvedValue({ id: 'sig-1', userId: TENANT_ID });
  m.paymentModeFindUnique.mockResolvedValue({ slug: 'bank_transfer' });
  m.invoiceCreate.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({
    id: 'inv-new', referenceNo: '', ...arg.data,
  }));
  m.invoiceUpdate.mockImplementation(async (arg: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: arg.where.id, referenceNo: '', invoiceType: 'INVOICE', ...arg.data,
  }));
});

// ===========================================================================
// 1. updateInvoice — a POSTED draft edit adjusts stock by the delta and re-posts GL
// ===========================================================================
describe('updateInvoice keeps stock and GL in step on a posted draft', () => {
  it('reverts the old issue, re-applies the new issue, voids + re-posts issued/cogs', async () => {
    m.invoiceFindFirst.mockResolvedValue({
      id: 'inv-1', userId: TENANT_ID, status: 'DRAFT', approvalStatus: 'NOT_REQUIRED',
      invoiceType: 'INVOICE', invoiceNumber: 'INV-1', convertedAt: null,
      items: [{ productId: 'p1', qty: 5, rate: 100 }],
      taxTreatment: 'STANDARD', reverseCharge: false, reverseChargeNote: null,
      sign_type: 'none', signatureImage: null, signatureName: null, signatureId: null,
      billFrom: TENANT_ID, contactId: 'c1',
    });

    const { req, res } = makeReqRes(
      { items: [{ productId: 'p1', qty: 10, rate: 100 }], billFrom: TENANT_ID },
      { id: 'inv-1' },
    );
    await updateInvoice(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Revert the original issue: stock_in +5.
    expect(mockApplyStockAdjustment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'stock_in', qtyDelta: 5, productId: 'p1' }),
    );
    // Re-apply the new issue: stock_out -10.
    expect(mockApplyStockAdjustment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'stock_out', qtyDelta: -10, productId: 'p1' }),
    );
    // Net stock movement of the edit == the delta (−5).
    expect(netStock()).toBe(-5);
    // GL: stale issued + cogs voided, then re-posted at the new totals.
    expect(mockVoidDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceType: 'Invoice', sourceId: 'inv-1', event: 'issued' }));
    expect(mockVoidDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceType: 'Invoice', sourceId: 'inv-1', event: 'cogs' }));
    expect(mockPostInvoiceIssued).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ invoiceId: 'inv-1', total: '1000' }));
    expect(mockPostSaleCogs).toHaveBeenCalled();
  });
});

// ===========================================================================
// 2. updateInvoice — a PENDING (unapproved) draft edit adjusts stock but NEVER posts GL
// ===========================================================================
describe('updateInvoice never posts an unapproved (PENDING) draft', () => {
  it('adjusts inventory by the delta but skips void + re-post (approval will post later)', async () => {
    m.companySettingsFindFirst.mockResolvedValue({ approvalsEnabled: true, taxRegime: 'NONE' });
    m.invoiceFindFirst.mockResolvedValue({
      id: 'inv-2', userId: TENANT_ID, status: 'DRAFT', approvalStatus: 'PENDING',
      invoiceType: 'INVOICE', invoiceNumber: 'INV-2', convertedAt: null,
      items: [{ productId: 'p1', qty: 5, rate: 100 }],
      taxTreatment: 'STANDARD', reverseCharge: false, reverseChargeNote: null,
      sign_type: 'none', signatureImage: null, signatureName: null, signatureId: null,
      billFrom: TENANT_ID, contactId: 'c1',
    });

    const { req, res } = makeReqRes(
      { items: [{ productId: 'p1', qty: 10, rate: 100 }], billFrom: TENANT_ID },
      { id: 'inv-2' },
    );
    await updateInvoice(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Stock still tracked to the current items (create-always-deducts model).
    expect(netStock()).toBe(-5);
    // But an unapproved draft is NEVER posted to the GL from the edit path.
    expect(mockVoidDocument).not.toHaveBeenCalled();
    expect(mockPostInvoiceIssued).not.toHaveBeenCalled();
    expect(mockPostSaleCogs).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3. updateInvoice — Service lines never move stock
// ===========================================================================
describe('updateInvoice leaves Service lines out of inventory', () => {
  it('does not adjust stock for a Service product', async () => {
    m.productFindUnique.mockResolvedValue({ item_type: 'Service', valuationMethod: 'WAC' });
    m.invoiceFindFirst.mockResolvedValue({
      id: 'inv-3', userId: TENANT_ID, status: 'DRAFT', approvalStatus: 'NOT_REQUIRED',
      invoiceType: 'INVOICE', invoiceNumber: 'INV-3', convertedAt: null,
      items: [{ productId: 'svc', qty: 5, rate: 100 }],
      taxTreatment: 'STANDARD', reverseCharge: false, reverseChargeNote: null,
      sign_type: 'none', signatureImage: null, signatureName: null, signatureId: null,
      billFrom: TENANT_ID, contactId: 'c1',
    });
    const { req, res } = makeReqRes(
      { items: [{ productId: 'svc', qty: 10, rate: 100 }], billFrom: TENANT_ID },
      { id: 'inv-3' },
    );
    await updateInvoice(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockApplyStockAdjustment).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. THE INVARIANT — create qty5 → edit to qty10 → delete nets stock to ZERO
// ===========================================================================
describe('net stock across create + edit + delete is zero (no phantom stock)', () => {
  it('create −5, edit (+5 revert, −10 re-apply), delete +10  ⇒  Σ qtyDelta = 0', async () => {
    // --- create (qty 5) ---
    m.invoiceFindFirst.mockResolvedValue(null); // dup-check + numbering
    const createReqRes = makeReqRes({
      contactId: 'c1', billFrom: TENANT_ID, status: 'DRAFT',
      items: [{ productId: 'p1', qty: 5, rate: 100 }],
    });
    await createInvoice(createReqRes.req, createReqRes.res);
    expect(createReqRes.res.status).toHaveBeenCalledWith(201);
    expect(netStock()).toBe(-5); // one stock_out −5

    // --- edit (qty 5 → 10) ---
    m.invoiceFindFirst.mockResolvedValue({
      id: 'inv-1', userId: TENANT_ID, status: 'DRAFT', approvalStatus: 'NOT_REQUIRED',
      invoiceType: 'INVOICE', invoiceNumber: 'INV-1', convertedAt: null,
      items: [{ productId: 'p1', qty: 5, rate: 100 }],
      taxTreatment: 'STANDARD', reverseCharge: false, reverseChargeNote: null,
      sign_type: 'none', signatureImage: null, signatureName: null, signatureId: null,
      billFrom: TENANT_ID, contactId: 'c1',
    });
    const editReqRes = makeReqRes(
      { items: [{ productId: 'p1', qty: 10, rate: 100 }], billFrom: TENANT_ID },
      { id: 'inv-1' },
    );
    await updateInvoice(editReqRes.req, editReqRes.res);
    expect(editReqRes.res.status).toHaveBeenCalledWith(200);
    expect(netStock()).toBe(-10); // −5 (create) +5 (revert) −10 (re-apply)

    // --- delete (current items are now qty 10) ---
    m.invoiceFindFirst.mockResolvedValue({
      id: 'inv-1', userId: TENANT_ID, isDeleted: false, invoiceType: 'INVOICE',
      invoiceNumber: 'INV-1', items: [{ productId: 'p1', qty: 10, unit: 'u1' }],
    });
    const delReqRes = makeReqRes({}, { id: 'inv-1' });
    await deleteInvoice(delReqRes.req, delReqRes.res);
    expect(delReqRes.res.status).toHaveBeenCalledWith(200);

    // The whole lifecycle nets to zero — no phantom stock left behind.
    expect(netStock()).toBe(0);
  });
});

// ===========================================================================
// 5. updateInvoice — a POSTED invoice demoted to PROFORMA voids GL but never re-posts
// ===========================================================================
describe('updateInvoice demotes a posted invoice to PROFORMA', () => {
  it('voids the stale issued/cogs entries, does NOT re-post, and reverts stock without re-applying', async () => {
    m.invoiceFindFirst.mockResolvedValue({
      id: 'inv-5', userId: TENANT_ID, status: 'DRAFT', approvalStatus: 'NOT_REQUIRED',
      invoiceType: 'INVOICE', invoiceNumber: 'INV-5', convertedAt: null,
      items: [{ productId: 'p1', qty: 5, rate: 100 }],
      taxTreatment: 'STANDARD', reverseCharge: false, reverseChargeNote: null,
      sign_type: 'none', signatureImage: null, signatureName: null, signatureId: null,
      billFrom: TENANT_ID, contactId: 'c1',
    });

    const { req, res } = makeReqRes(
      { invoiceType: 'PROFORMA', items: [{ productId: 'p1', qty: 5, rate: 100 }], billFrom: TENANT_ID },
      { id: 'inv-5' },
    );
    await updateInvoice(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Stock reverted (the old issue for qty 5) and NOT re-applied (PROFORMA is never stocked).
    expect(mockApplyStockAdjustment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'stock_in', qtyDelta: 5, productId: 'p1' }),
    );
    expect(mockApplyStockAdjustment).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'stock_out' }),
    );
    expect(netStock()).toBe(5);
    // GL: the stale issued + cogs entries are voided...
    expect(mockVoidDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceType: 'Invoice', sourceId: 'inv-5', event: 'issued' }));
    expect(mockVoidDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceType: 'Invoice', sourceId: 'inv-5', event: 'cogs' }));
    // ...but a proforma carries no GL, so there is NO re-post.
    expect(mockPostInvoiceIssued).not.toHaveBeenCalled();
    expect(mockPostSaleCogs).not.toHaveBeenCalled();
  });
});
