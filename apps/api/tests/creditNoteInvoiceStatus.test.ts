/**
 * A credit note must refresh the linked invoice's stored status.
 *
 * createCreditNote / updateCreditNote / deleteCreditNote all call
 * `recomputeInvoiceStatus` inside their transaction, but nothing asserted the
 * OUTCOME — the existing credit-note suites mock the invoice surface and only
 * check that the reads happen. So the behaviour was load-bearing and untested:
 * if a refactor dropped one of those calls, a fully credit-noted invoice would
 * silently keep an UNPAID status.
 *
 * That matters beyond the badge. lib/invoiceOutstanding's own header explains
 * why: "a fully credit-noted invoice can stay UNPAID and accept a payment that
 * drives the GL AR control negative". The payment path nets credit notes
 * separately, so this is defence in depth rather than the only guard — but the
 * invoice list, the AR aging report and the exports all read the stored status,
 * and they must agree with each other.
 */
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT_ID = 'tenant-alpha';

const m = vi.hoisted(() => ({
  currencyFindFirst: vi.fn(),
  contactFindFirst: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceUpdate: vi.fn(),
  invoicePaymentAggregate: vi.fn(),
  userFindUnique: vi.fn(),
  taxGroupFindMany: vi.fn(),
  cnFindFirst: vi.fn(),
  cnCreate: vi.fn(),
  cnDelete: vi.fn(),
  cnFindMany: vi.fn(),
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
    creditNote: {
      findFirst: m.cnFindFirst,
      create: m.cnCreate,
      update: vi.fn(),
      delete: m.cnDelete,
      findMany: m.cnFindMany,
    },
    product: { findFirst: m.productFindUnique },
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

import { createCreditNote, deleteCreditNote } from '../controllers/Admin/Invoice/creditNoteController';

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

/** The status the controller actually persisted on the invoice, if any. */
function persistedInvoiceStatus(): string | undefined {
  const call = m.invoiceUpdate.mock.calls.at(-1);
  return call?.[0]?.data?.status as string | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.currencyFindFirst.mockResolvedValue({ code: 'USD' });
  m.contactFindFirst.mockResolvedValue({ id: 'c1', defaultTaxTreatment: null });
  m.invoicePaymentAggregate.mockResolvedValue({ _sum: { amount: null } });
  m.invoiceUpdate.mockResolvedValue({ id: 'inv1' });
  m.userFindUnique.mockResolvedValue({ id: TENANT_ID });
  m.taxGroupFindMany.mockResolvedValue([]);
  m.cnFindFirst.mockResolvedValue(null);
  m.productFindUnique.mockResolvedValue(null);
  m.inventoryFindFirst.mockResolvedValue(null);
  m.cnCreate.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({
    id: 'cn-new',
    ...arg.data,
  }));
  m.cnDelete.mockResolvedValue({ id: 'cn-1' });
});

describe('createCreditNote refreshes the linked invoice status', () => {
  it('marks a FULLY credit-noted invoice PAID even with no payment against it', async () => {
    // 100-value invoice, nothing paid, and this CN covers the whole 100.
    m.invoiceFindFirst.mockResolvedValue({
      id: 'inv1',
      currencyCode: 'USD',
      TotalAmount: 100,
      status: 'UNPAID',
    });
    // getInvoiceSettlement re-reads the CNs after the create; the new one counts.
    m.cnFindMany.mockResolvedValue([{ invoiceId: 'inv1', totalAmount: 100 }]);

    const { req, res } = makeReqRes({
      body: {
        contactId: 'c1',
        invoiceId: 'inv1',
        billFrom: TENANT_ID,
        status: 'PENDING',
        items: [{ id: 'p1', qty: 1, rate: 100 }],
      },
    });

    await createCreditNote(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(persistedInvoiceStatus()).toBe('PAID');
  });

  it('marks a PARTIALLY credit-noted invoice PARTIALLY_PAID, not PAID', async () => {
    m.invoiceFindFirst.mockResolvedValue({
      id: 'inv1',
      currencyCode: 'USD',
      TotalAmount: 100,
      status: 'UNPAID',
    });
    m.cnFindMany.mockResolvedValue([{ invoiceId: 'inv1', totalAmount: 40 }]);

    const { req, res } = makeReqRes({
      body: {
        contactId: 'c1',
        invoiceId: 'inv1',
        billFrom: TENANT_ID,
        status: 'PENDING',
        items: [{ id: 'p1', qty: 1, rate: 40 }],
      },
    });

    await createCreditNote(req, res);

    expect(persistedInvoiceStatus()).toBe('PARTIALLY_PAID');
  });

  it('leaves a CANCELLED invoice alone', async () => {
    m.invoiceFindFirst.mockResolvedValue({
      id: 'inv1',
      currencyCode: 'USD',
      TotalAmount: 100,
      status: 'CANCELLED',
    });
    m.cnFindMany.mockResolvedValue([{ invoiceId: 'inv1', totalAmount: 100 }]);

    const { req, res } = makeReqRes({
      body: {
        contactId: 'c1',
        invoiceId: 'inv1',
        billFrom: TENANT_ID,
        status: 'PENDING',
        items: [{ id: 'p1', qty: 1, rate: 100 }],
      },
    });

    await createCreditNote(req, res);

    expect(persistedInvoiceStatus()).toBeUndefined();
  });
});

describe('deleteCreditNote refreshes the linked invoice status', () => {
  it('returns an invoice to UNPAID once the credit note no longer nets against it', async () => {
    m.cnFindFirst.mockResolvedValue({
      id: 'cn-1',
      tenantId: TENANT_ID,
      invoiceId: 'inv1',
      status: 'PENDING',
      items: [],
      totalAmount: 100,
      isDeleted: false,
    });
    m.invoiceFindFirst.mockResolvedValue({
      id: 'inv1',
      currencyCode: 'USD',
      TotalAmount: 100,
      status: 'PAID',
    });
    // Hard-deleted, so the settlement read no longer sees it.
    m.cnFindMany.mockResolvedValue([]);

    const { req, res } = makeReqRes({ params: { id: 'cn-1' } });

    await deleteCreditNote(req, res);

    expect(persistedInvoiceStatus()).toBe('UNPAID');
  });
});
