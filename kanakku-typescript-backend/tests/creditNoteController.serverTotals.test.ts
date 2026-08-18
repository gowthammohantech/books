/**
 * Final-review Finding 1 — server-authoritative credit-note totals.
 *
 * Credit notes POST GL (issued + COGS) and REDUCE AR, and updateCreditNote
 * void+re-posts a LIVE entry. So a client-spoofed subTotal/totalTax/grandTotal
 * must NEVER reach the persisted row or the GL: both createCreditNote AND
 * updateCreditNote must recompute the totals from the line items (resolving the
 * tax group's rate on the discounted base) and post the GL from the server value.
 *
 * Items: 2 × 100 = 200 base, tax group tg1 = 9% + 9% = 18% → 36 tax → grand 236.
 * The bogus client totals (subTotal 1 / totalTax 0 / totalDiscount 5 / grand 1)
 * must all be ignored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const m = vi.hoisted(() => ({
  currencyFindFirst: vi.fn(),
  contactFindFirst: vi.fn(),
  invoiceFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  taxGroupFindMany: vi.fn(),
  cnFindFirst: vi.fn(),
  cnCreate: vi.fn(),
  cnUpdate: vi.fn(),
  cnFindMany: vi.fn(),
  invoiceUpdate: vi.fn(),
  invoicePaymentAggregate: vi.fn(),
  productFindUnique: vi.fn(),
  inventoryFindFirst: vi.fn(),
  applyStockAdjustment: vi.fn(),
  postCreditNoteIssued: vi.fn(),
  postReturnCogs: vi.fn(),
  voidDocument: vi.fn(),
  reverseDocument: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const db: Record<string, unknown> = {
    currency: { findFirst: m.currencyFindFirst },
    contact: { findFirst: m.contactFindFirst },
    invoice: { findFirst: m.invoiceFindFirst, update: m.invoiceUpdate },
    invoicePayment: { aggregate: m.invoicePaymentAggregate },
    user: { findUnique: m.userFindUnique },
    taxGroup: { findMany: m.taxGroupFindMany },
    creditNote: { findFirst: m.cnFindFirst, create: m.cnCreate, update: m.cnUpdate, findMany: m.cnFindMany },
    product: { findUnique: m.productFindUnique },
    inventory: { findFirst: m.inventoryFindFirst },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { prisma: db };
});

vi.mock('../lib/inventory/stockAdjust', () => ({
  applyStockAdjustment: m.applyStockAdjustment,
  resolveRestockUnitCost: vi.fn().mockResolvedValue(0),
}));

vi.mock('../lib/ledger/ledgerPosting', () => ({
  postCreditNoteIssued: m.postCreditNoteIssued,
  postReturnCogs: m.postReturnCogs,
  voidDocument: m.voidDocument,
  reverseDocument: m.reverseDocument,
}));

vi.mock('../utils/mailer', () => ({ sendMail: vi.fn() }));

vi.mock('express-validator', () => ({
  validationResult: vi.fn(() => ({ isEmpty: () => true, array: () => [] })),
}));

import {
  createCreditNote,
  updateCreditNote,
} from '../controllers/Admin/Invoice/creditNoteController';

function makeReqRes(opts: { body?: Record<string, unknown>; params?: Record<string, string> } = {}) {
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
  m.currencyFindFirst.mockResolvedValue({ code: 'USD' });
  m.contactFindFirst.mockResolvedValue({ id: 'c1', defaultTaxTreatment: null });
  m.invoiceFindFirst.mockResolvedValue({ id: 'inv1', currencyCode: 'USD', TotalAmount: 236, status: 'UNPAID' });
  m.invoicePaymentAggregate.mockResolvedValue({ _sum: { amount: null } });
  m.cnFindMany.mockResolvedValue([]);
  m.invoiceUpdate.mockResolvedValue({ id: 'inv1', status: 'PAID' });
  m.userFindUnique.mockResolvedValue({ id: TENANT_ID });
  // tg1 → 9% + 9% = 18%
  m.taxGroupFindMany.mockResolvedValue([
    { id: 'tg1', tax_rates: [{ rate: 9, isActive: true, isDeleted: false }, { rate: 9, isActive: true, isDeleted: false }] },
  ]);
  m.cnFindFirst.mockResolvedValue(null);
  m.productFindUnique.mockResolvedValue(null);
  m.inventoryFindFirst.mockResolvedValue(null);
  m.cnCreate.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({ id: 'cn-new', ...arg.data }));
});

const bogusItems = [{ id: 'p1', qty: 2, rate: 100, tax_group_id: 'tg1' }];

describe('createCreditNote — server-authoritative totals override a bogus client grandTotal', () => {
  it('persists server-recomputed taxableAmount/vat/totalAmount and posts GL from the server total', async () => {
    const { req, res } = makeReqRes({
      body: {
        contactId: 'c1',
        invoiceId: 'inv1',
        billFrom: TENANT_ID,
        status: 'PENDING',
        items: bogusItems,
        // bogus client totals — all ignored
        subTotal: 1,
        totalTax: 0,
        totalDiscount: 5,
        grandTotal: 1,
      },
    });

    await createCreditNote(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const data = m.cnCreate.mock.calls[0][0].data;
    expect(Number(data.taxableAmount)).toBe(200);
    expect(Number(data.vat)).toBe(36);
    expect(Number(data.totalDiscount)).toBe(0);
    expect(Number(data.totalAmount)).toBe(236);
    // GL posted from the persisted server total, not the client's grandTotal=1.
    expect(m.postCreditNoteIssued).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ total: '236', tax: '36' }),
    );
  });
});

describe('updateCreditNote — server-authoritative totals on the LIVE void+re-post edit', () => {
  const existing = {
    id: 'cn-1',
    userId: TENANT_ID,
    contactId: 'c1',
    customerId: null,
    items: bogusItems,
    vat: 36,
    taxableAmount: 200,
    totalAmount: 236,
    totalDiscount: 0,
    taxTreatment: 'STANDARD',
    creditNoteDate: new Date('2026-01-01'),
    referenceNo: 'R1',
    description: '',
  };

  beforeEach(() => {
    m.cnFindFirst.mockResolvedValue(existing);
    m.cnUpdate.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({ ...existing, ...arg.data }));
  });

  it('recomputes totals from items and void+re-posts the GL from the server total, ignoring a bogus client grandTotal', async () => {
    const { req, res } = makeReqRes({
      params: { id: 'cn-1' },
      body: {
        items: bogusItems,
        // bogus client totals
        subTotal: 9999,
        totalTax: 9999,
        totalDiscount: 500,
        grandTotal: 9999,
      },
    });

    await updateCreditNote(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const data = m.cnUpdate.mock.calls[0][0].data;
    expect(Number(data.taxableAmount)).toBe(200);
    expect(Number(data.vat)).toBe(36);
    expect(Number(data.totalDiscount)).toBe(0);
    expect(Number(data.totalAmount)).toBe(236);
    // prior entry voided, then re-posted from the server total (not 9999).
    expect(m.voidDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceType: 'CreditNote', event: 'issued' }),
    );
    expect(m.postCreditNoteIssued).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ total: '236', tax: '36' }),
    );
  });
});
