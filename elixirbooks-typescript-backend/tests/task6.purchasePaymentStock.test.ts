/**
 * Task 6 — P0-4: purchase payment & stock integrity on update paths.
 *
 * Behavioural specs for the three defects:
 *   1. updatePurchase MUST NOT delete/recreate SupplierPayment rows; it derives
 *      paidAmount/balanceAmount/status from the preserved rows.
 *   2. updatePurchaseStatus stock is idempotent (no double stock-in when flipping
 *      an already-stocked purchase to paid) and reverses stock + voids the
 *      received GL entry when cancelling a stocked purchase.
 *   3. createSupplierPayment / updateSupplierPayment compute the remaining due
 *      server-side (server total − Σ existing payments, 0.005 tolerance), reject
 *      overpayment with 400, and derive status from the remainder — ignoring the
 *      client-sent dueAmount.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const m = vi.hoisted(() => ({
  purchaseFindFirst: vi.fn(),
  purchaseUpdate: vi.fn(),
  purchaseFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  contactFindFirst: vi.fn(),
  supplierFindFirst: vi.fn(),
  productFindUnique: vi.fn(),
  productFindMany: vi.fn(),
  spFindFirst: vi.fn(),
  spCreate: vi.fn(),
  spUpdate: vi.fn(),
  spDeleteMany: vi.fn(),
  spAggregate: vi.fn(),
  bankFindFirst: vi.fn(),
  bankUpdate: vi.fn(),
  bankTxnCreate: vi.fn(),
  pettyFindFirst: vi.fn(),
  paymentModeFindUnique: vi.fn(),
  companySettingsFindFirst: vi.fn(),
  poUpdateMany: vi.fn(),
  cfvDeleteMany: vi.fn(),
  cfvCreateMany: vi.fn(),
  // side-effect spies
  applyStockAdjustment: vi.fn(),
  voidDocument: vi.fn(),
  postPurchaseReceived: vi.fn(),
  postSupplierPayment: vi.fn(),
  reverseDocument: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const db: Record<string, unknown> = {
    purchase: {
      findFirst: m.purchaseFindFirst,
      update: m.purchaseUpdate,
      findMany: m.purchaseFindMany,
    },
    user: { findUnique: m.userFindUnique },
    contact: { findFirst: m.contactFindFirst },
    supplier: { findFirst: m.supplierFindFirst },
    product: { findUnique: m.productFindUnique, findMany: m.productFindMany },
    supplierPayment: {
      findFirst: m.spFindFirst,
      create: m.spCreate,
      update: m.spUpdate,
      deleteMany: m.spDeleteMany,
      aggregate: m.spAggregate,
    },
    bankDetail: { findFirst: m.bankFindFirst, update: m.bankUpdate },
    bankTransaction: { create: m.bankTxnCreate },
    pettyCash: { findFirst: m.pettyFindFirst },
    paymentMode: { findUnique: m.paymentModeFindUnique },
    companySettings: { findFirst: m.companySettingsFindFirst },
    purchaseOrder: { updateMany: m.poUpdateMany },
    customFieldValue: { deleteMany: m.cfvDeleteMany, createMany: m.cfvCreateMany },
    customField: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { prisma: db };
});

vi.mock('../lib/inventory/stockAdjust', () => ({
  applyStockAdjustment: m.applyStockAdjustment,
}));

vi.mock('../lib/ledger/ledgerPosting', () => ({
  postPurchaseReceived: m.postPurchaseReceived,
  postSupplierPayment: m.postSupplierPayment,
  voidDocument: m.voidDocument,
  reverseDocument: m.reverseDocument,
}));

vi.mock('../lib/ledger/bankAccount', () => ({
  resolveBankGlAccountId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/ledger/postingGate', () => ({
  shouldPost: vi.fn().mockReturnValue(true),
}));

vi.mock('../utils/mailer', () => ({ sendMail: vi.fn() }));

vi.mock('express-validator', () => ({
  validationResult: vi.fn(() => ({ isEmpty: () => true, array: () => [] })),
}));

import { updatePurchase, updatePurchaseStatus } from '../controllers/Admin/Purchases/purchaseController';
import {
  createSupplierPayment,
  updateSupplierPayment,
} from '../controllers/Admin/Purchases/supplierPaymentController';

function makeReqRes(opts: {
  body?: Record<string, unknown>;
  params?: Record<string, string>;
} = {}) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    params: opts.params ?? {},
    query: {},
    body: opts.body ?? {},
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
  m.userFindUnique.mockResolvedValue({ id: TENANT_ID });
  m.contactFindFirst.mockResolvedValue({ id: 'c1', currencyCode: null, defaultTaxTreatment: null });
  m.supplierFindFirst.mockResolvedValue(null);
  m.productFindUnique.mockResolvedValue({ item_type: 'Product' });
  m.productFindMany.mockResolvedValue([]);
  m.spFindFirst.mockResolvedValue(null);
  m.spAggregate.mockResolvedValue({ _sum: { paidAmount: null } });
  m.companySettingsFindFirst.mockResolvedValue({ approvalsEnabled: false });
  m.poUpdateMany.mockResolvedValue({});
  m.cfvDeleteMany.mockResolvedValue({});
  m.bankFindFirst.mockResolvedValue({ id: 'bank-1', currentBalance: 100000 });
  m.paymentModeFindUnique.mockResolvedValue({ id: 'pm-1', slug: 'cash' });
});

// ---------------------------------------------------------------------------
// Defect 1 — updatePurchase preserves payments, recomputes from rows
// ---------------------------------------------------------------------------

describe('Defect 1 — updatePurchase preserves SupplierPayment rows', () => {
  const existing = {
    id: 'pur-1',
    purchaseId: 'PUR-1',
    userId: TENANT_ID,
    contactId: 'c1',
    supplierId: null,
    status: 'pending',
    items: [{ productId: 'p1', qty: 2, rate: 100, amount: 200 }],
    totalAmount: 200,
    totalTax: 0,
    taxTreatment: 'STANDARD',
    paidAmount: 0,
    balanceAmount: 200,
    purchaseDate: new Date('2026-01-01'),
    referenceNo: 'R1',
    paymentModeId: null,
    sign_type: 'none',
    signatureId: null,
    signatureImage: null,
    signatureName: null,
    notes: '',
    termsAndCondition: '',
    checkNumber: null,
    bankId: null,
    isDeleted: false,
  };
  const body = {
    id: 'pur-1',
    contactId: 'c1',
    billFrom: TENANT_ID,
    items: [{ productId: 'p1', qty: 2, rate: 100, amount: 200 }],
    status: 'pending',
    // Legacy sp_* fields are sent by some clients — they MUST be ignored for state.
    sp_amount: 999,
    sp_paid_amount: 999,
  };

  beforeEach(() => {
    m.purchaseFindFirst.mockResolvedValue(existing);
    m.purchaseUpdate.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({
      ...existing,
      ...arg.data,
    }));
  });

  it('never calls supplierPayment.deleteMany or create on update', async () => {
    m.spAggregate.mockResolvedValue({ _sum: { paidAmount: 120 } });
    const { req, res } = makeReqRes({ body });
    await updatePurchase(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(m.spDeleteMany).not.toHaveBeenCalled();
    expect(m.spCreate).not.toHaveBeenCalled();
  });

  it('recomputes partially_paid + paid/balance from the preserved payment sum (2 payments = 120 of 200)', async () => {
    m.spAggregate.mockResolvedValue({ _sum: { paidAmount: 120 } });
    const { req, res } = makeReqRes({ body });
    await updatePurchase(req, res);

    const data = m.purchaseUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('partially_paid');
    expect(Number(data.paidAmount)).toBe(120);
    expect(Number(data.balanceAmount)).toBe(80);
    // aggregate excluded voided/deleted rows
    expect(m.spAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ purchaseId: 'pur-1', isVoided: false, isDeleted: false }),
        _sum: { paidAmount: true },
      }),
    );
  });

  it('derives paid + zero balance when the preserved payments fully cover the total', async () => {
    m.spAggregate.mockResolvedValue({ _sum: { paidAmount: 200 } });
    const { req, res } = makeReqRes({ body });
    await updatePurchase(req, res);

    const data = m.purchaseUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('paid');
    expect(Number(data.paidAmount)).toBe(200);
    expect(Number(data.balanceAmount)).toBe(0);
  });

  it('keeps the requested base status when there are no payments (none → as-is)', async () => {
    m.spAggregate.mockResolvedValue({ _sum: { paidAmount: null } });
    const { req, res } = makeReqRes({ body });
    await updatePurchase(req, res);

    const data = m.purchaseUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('pending');
    expect(Number(data.paidAmount)).toBe(0);
    expect(Number(data.balanceAmount)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Defect 2 — updatePurchaseStatus stock idempotency + cancel reversal
// ---------------------------------------------------------------------------

describe('Defect 2 — updatePurchaseStatus stock integrity', () => {
  const baseItems = [{ productId: 'p1', qty: 2, rate: 100, amount: 200 }];

  function primeExisting(status: string) {
    m.purchaseFindFirst.mockResolvedValue({
      id: 'pur-1',
      purchaseId: 'PUR-1',
      userId: TENANT_ID,
      status,
      items: baseItems,
      totalAmount: 200,
      paidAmount: 0,
      balanceAmount: 200,
      purchaseOrderId: null,
      landedCost: null,
      purchaseDate: new Date('2026-01-01'),
      supplierId: null,
      billTo: null,
      paymentModeId: null,
    });
    m.purchaseUpdate.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({
      id: 'pur-1',
      purchaseId: 'PUR-1',
      userId: TENANT_ID,
      items: baseItems,
      totalAmount: 200,
      landedCost: null,
      purchaseDate: new Date('2026-01-01'),
      purchaseOrderId: null,
      ...arg.data,
    }));
  }

  it('does NOT re-stock when flipping an already-stocked pending purchase to paid', async () => {
    primeExisting('pending');
    const { req, res } = makeReqRes({ params: { id: 'pur-1' }, body: { status: 'paid' } });
    await updatePurchaseStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(m.applyStockAdjustment).not.toHaveBeenCalled();
    expect(m.voidDocument).not.toHaveBeenCalled();
  });

  it('is idempotent — flipping paid → paid moves no stock and voids nothing', async () => {
    primeExisting('paid');
    const { req, res } = makeReqRes({ params: { id: 'pur-1' }, body: { status: 'paid' } });
    await updatePurchaseStatus(req, res);

    expect(m.applyStockAdjustment).not.toHaveBeenCalled();
    expect(m.voidDocument).not.toHaveBeenCalled();
  });

  it('stocks IN via applyStockAdjustment when transitioning new → pending', async () => {
    primeExisting('new');
    const { req, res } = makeReqRes({ params: { id: 'pur-1' }, body: { status: 'pending' } });
    await updatePurchaseStatus(req, res);

    expect(m.applyStockAdjustment).toHaveBeenCalledTimes(1);
    const arg = m.applyStockAdjustment.mock.calls[0][1];
    expect(arg).toMatchObject({ productId: 'p1', qtyDelta: 2, type: 'stock_in', referenceId: 'pur-1' });
    expect(arg.unitCost).toBe(100);
  });

  it('reverses stock (stock_out) AND voids the received GL entry when cancelling a stocked purchase', async () => {
    primeExisting('paid');
    const { req, res } = makeReqRes({ params: { id: 'pur-1' }, body: { status: 'cancelled' } });
    await updatePurchaseStatus(req, res);

    expect(m.applyStockAdjustment).toHaveBeenCalledTimes(1);
    expect(m.applyStockAdjustment.mock.calls[0][1]).toMatchObject({
      productId: 'p1',
      qtyDelta: -2,
      type: 'stock_out',
    });
    expect(m.voidDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceType: 'Purchase', sourceId: 'pur-1', event: 'received' }),
    );
  });

  // -------------------------------------------------------------------------
  // Fix round 1 (reviewer finding): GL/inventory tie-out gap on cancelled ->
  // stocked reactivation.
  // -------------------------------------------------------------------------

  it('new -> cancelled is a full no-op (no stock movement, no GL void)', async () => {
    primeExisting('new');
    const { req, res } = makeReqRes({ params: { id: 'pur-1' }, body: { status: 'cancelled' } });
    await updatePurchaseStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(m.applyStockAdjustment).not.toHaveBeenCalled();
    expect(m.voidDocument).not.toHaveBeenCalled();
    expect(m.postPurchaseReceived).not.toHaveBeenCalled();
  });

  it('cancel-then-reactivate: stocked -> cancelled voids GL + stock_out, then cancelled -> paid re-stocks AND re-posts a fresh received GL', async () => {
    // Step 1: stocked -> cancelled (reverses stock, voids the received GL).
    primeExisting('paid');
    const step1 = makeReqRes({ params: { id: 'pur-1' }, body: { status: 'cancelled' } });
    await updatePurchaseStatus(step1.req, step1.res);

    expect(m.applyStockAdjustment).toHaveBeenCalledTimes(1);
    expect(m.applyStockAdjustment.mock.calls[0][1]).toMatchObject({ qtyDelta: -2, type: 'stock_out' });
    expect(m.voidDocument).toHaveBeenCalledTimes(1);
    expect(m.postPurchaseReceived).not.toHaveBeenCalled();

    // Isolate step 2's assertions from step 1's call history.
    m.applyStockAdjustment.mockClear();
    m.voidDocument.mockClear();
    m.postPurchaseReceived.mockClear();

    // Step 2: cancelled -> paid (reactivation). Must re-stock AND re-post a
    // FRESH live received-GL entry (voidDocument mangled the old entry's event
    // to free the idempotency slot, so this is a new post, not a no-op).
    primeExisting('cancelled');
    const step2 = makeReqRes({ params: { id: 'pur-1' }, body: { status: 'paid' } });
    await updatePurchaseStatus(step2.req, step2.res);

    expect(step2.res.status).toHaveBeenCalledWith(200);
    expect(m.applyStockAdjustment).toHaveBeenCalledTimes(1);
    expect(m.applyStockAdjustment.mock.calls[0][1]).toMatchObject({
      productId: 'p1',
      qtyDelta: 2,
      type: 'stock_in',
    });
    expect(m.voidDocument).not.toHaveBeenCalled();
    expect(m.postPurchaseReceived).toHaveBeenCalledTimes(1);
    expect(m.postPurchaseReceived.mock.calls[0][1]).toMatchObject({
      purchaseId: 'pur-1',
      total: '200',
      tax: '0',
    });
  });

  // -------------------------------------------------------------------------
  // Fix round 2 (Task 6 review, Important): a PENDING (maker-checker) purchase
  // must reject status changes outright, and the stock-in GL post must be
  // unconditional (not gated on prevStatus === 'cancelled') so a fresh purchase
  // that skips approvePurchase's posting path is never left GL-less.
  // -------------------------------------------------------------------------

  it('rejects a status change on a PENDING purchase with 409 and performs no side effects', async () => {
    m.purchaseFindFirst.mockResolvedValue({
      id: 'pur-1',
      purchaseId: 'PUR-1',
      userId: TENANT_ID,
      status: 'new',
      approvalStatus: 'PENDING',
      items: baseItems,
      totalAmount: 200,
      paidAmount: 0,
      balanceAmount: 200,
      purchaseOrderId: null,
      landedCost: null,
      purchaseDate: new Date('2026-01-01'),
      supplierId: null,
      billTo: null,
      paymentModeId: null,
    });
    const { req, res } = makeReqRes({ params: { id: 'pur-1' }, body: { status: 'paid' } });
    await updatePurchaseStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(m.purchaseUpdate).not.toHaveBeenCalled();
    expect(m.applyStockAdjustment).not.toHaveBeenCalled();
    expect(m.postPurchaseReceived).not.toHaveBeenCalled();
    expect(m.voidDocument).not.toHaveBeenCalled();
  });

  it('approvals-off new -> paid: stocks in AND posts the received GL entry (idempotent no-op downstream is fine)', async () => {
    primeExisting('new'); // approvalStatus left undefined (NOT_REQUIRED-equivalent) — approvals-off path
    const { req, res } = makeReqRes({ params: { id: 'pur-1' }, body: { status: 'paid' } });
    await updatePurchaseStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(m.applyStockAdjustment).toHaveBeenCalledTimes(1);
    expect(m.postPurchaseReceived).toHaveBeenCalledTimes(1);
    expect(m.postPurchaseReceived.mock.calls[0][1]).toMatchObject({
      purchaseId: 'pur-1',
      total: '200',
    });
  });
});

// ---------------------------------------------------------------------------
// Final-review Finding 2 — updatePurchase edit-to-cancelled must void-only GL
// Final-review Finding 3 — updatePurchase must guard PENDING approval
// ---------------------------------------------------------------------------

describe('Final-review Findings 2 & 3 — updatePurchase GL/approval integrity', () => {
  const existing = {
    id: 'pur-1',
    purchaseId: 'PUR-1',
    userId: TENANT_ID,
    contactId: 'c1',
    supplierId: null,
    status: 'pending', // stocked (not new/cancelled)
    items: [{ productId: 'p1', qty: 2, rate: 100, amount: 200 }],
    totalAmount: 200,
    totalTax: 0,
    taxTreatment: 'STANDARD',
    paidAmount: 0,
    balanceAmount: 200,
    purchaseDate: new Date('2026-01-01'),
    referenceNo: 'R1',
    paymentModeId: null,
    sign_type: 'none',
    signatureId: null,
    signatureImage: null,
    signatureName: null,
    notes: '',
    termsAndCondition: '',
    checkNumber: null,
    bankId: null,
    isDeleted: false,
    approvalStatus: 'NOT_REQUIRED',
  };
  const body = {
    id: 'pur-1',
    contactId: 'c1',
    billFrom: TENANT_ID,
    items: [{ productId: 'p1', qty: 2, rate: 100, amount: 200 }],
  };

  it('Finding 2: edit-to-cancelled reverses stock, voids the received GL, and does NOT re-post received', async () => {
    m.purchaseFindFirst.mockResolvedValue(existing);
    m.purchaseUpdate.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({ ...existing, ...arg.data }));
    const { req, res } = makeReqRes({ body: { ...body, status: 'cancelled' } });
    await updatePurchase(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // status persisted as cancelled
    expect(m.purchaseUpdate.mock.calls[0][0].data.status).toBe('cancelled');
    // stock reverted (existing was stocked) via a single stock_out, none re-applied
    expect(m.applyStockAdjustment).toHaveBeenCalledTimes(1);
    expect(m.applyStockAdjustment.mock.calls[0][1]).toMatchObject({
      productId: 'p1',
      qtyDelta: -2,
      type: 'stock_out',
    });
    // received entry voided but NOT re-posted (would overstate AP/inventory)
    expect(m.voidDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceType: 'Purchase', sourceId: 'pur-1', event: 'received' }),
    );
    expect(m.postPurchaseReceived).not.toHaveBeenCalled();
  });

  it('Finding 2: a non-cancelling edit still void+re-posts the received GL', async () => {
    m.purchaseFindFirst.mockResolvedValue(existing);
    m.purchaseUpdate.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({ ...existing, ...arg.data }));
    const { req, res } = makeReqRes({ body: { ...body, status: 'pending' } });
    await updatePurchase(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(m.voidDocument).toHaveBeenCalledTimes(1);
    expect(m.postPurchaseReceived).toHaveBeenCalledTimes(1);
  });

  it('Finding 3: editing a PENDING purchase is rejected with 409 and performs no mutation/GL/stock', async () => {
    m.purchaseFindFirst.mockResolvedValue({ ...existing, approvalStatus: 'PENDING' });
    m.purchaseUpdate.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({ ...existing, ...arg.data }));
    const { req, res } = makeReqRes({ body: { ...body, status: 'pending' } });
    await updatePurchase(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(m.purchaseUpdate).not.toHaveBeenCalled();
    expect(m.applyStockAdjustment).not.toHaveBeenCalled();
    expect(m.voidDocument).not.toHaveBeenCalled();
    expect(m.postPurchaseReceived).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Defect 3 — server-authoritative supplier-payment due tracking
// ---------------------------------------------------------------------------

describe('Defect 3 — createSupplierPayment server-side due', () => {
  beforeEach(() => {
    m.purchaseFindFirst.mockResolvedValue({
      id: 'pur-1',
      userId: TENANT_ID,
      totalAmount: 100,
      exchangeRate: null,
    });
    m.spCreate.mockResolvedValue({
      id: 'sp-1',
      paymentDate: new Date(),
      amount: 0,
      paidAmount: 0,
      dueAmount: 0,
    });
    m.purchaseUpdate.mockResolvedValue({});
  });

  it('rejects overpayment with 400 when the purchase is already fully paid', async () => {
    m.spAggregate.mockResolvedValue({ _sum: { paidAmount: 100 } }); // due = 0
    const { req, res } = makeReqRes({
      body: { purchaseId: 'pur-1', sourceType: 'BANK', bankId: 'bank-1', paymentMode: 'pm-1', paidAmount: 50, dueAmount: 0 },
    });
    await createSupplierPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(m.spCreate).not.toHaveBeenCalled();
  });

  it('accepts an exact-remainder payment (0.005 tolerance) and marks the purchase paid', async () => {
    m.spAggregate.mockResolvedValue({ _sum: { paidAmount: null } }); // due = 100
    const { req, res } = makeReqRes({
      body: { purchaseId: 'pur-1', sourceType: 'BANK', bankId: 'bank-1', paymentMode: 'pm-1', paidAmount: 100, dueAmount: 999 },
    });
    await createSupplierPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const data = m.purchaseUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('paid');
    expect(Number(data.paidAmount)).toBe(100);
    expect(Number(data.balanceAmount)).toBe(0);
  });

  it('derives partially_paid from the server remainder despite a bogus client dueAmount=0', async () => {
    m.spAggregate.mockResolvedValue({ _sum: { paidAmount: null } }); // due = 100
    const { req, res } = makeReqRes({
      body: { purchaseId: 'pur-1', sourceType: 'BANK', bankId: 'bank-1', paymentMode: 'pm-1', paidAmount: 60, dueAmount: 0 },
    });
    await createSupplierPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const data = m.purchaseUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('partially_paid');
    expect(Number(data.paidAmount)).toBe(60);
    expect(Number(data.balanceAmount)).toBe(40);
  });
});

describe('Defect 3 — updateSupplierPayment server-side due', () => {
  it('rejects when the edited amount exceeds total − other payments', async () => {
    m.spFindFirst.mockResolvedValue({
      id: 'sp-1',
      purchaseId: 'pur-1',
      paidAmount: 30,
      dueAmount: 0,
      amount: 30,
      attachment: null,
      referenceNumber: null,
      paymentDate: new Date(),
      paymentModeId: 'pm-1',
      notes: null,
      contactId: null,
      sourceType: 'BANK',
      bankId: 'bank-1',
    });
    m.purchaseFindFirst.mockResolvedValue({ id: 'pur-1', userId: TENANT_ID, totalAmount: 100 });
    m.spAggregate.mockResolvedValue({ _sum: { paidAmount: 80 } }); // other payments = 80 → remaining 20

    const { req, res } = makeReqRes({ body: { paidAmount: 50, dueAmount: 0 }, params: { id: 'sp-1' } });
    await updateSupplierPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(m.spUpdate).not.toHaveBeenCalled();
    // aggregate excluded the edited row itself
    expect(m.spAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 'sp-1' } }) }),
    );
  });
});
