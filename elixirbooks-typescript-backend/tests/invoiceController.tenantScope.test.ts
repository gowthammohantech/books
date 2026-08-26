/**
 * tests/invoiceController.tenantScope.test.ts
 *
 * P0-2b regression tripwire: several by-id handlers in
 * controllers/Admin/Invoice/invoiceController.ts loaded Invoice/Quotation
 * rows with no `userId` filter at all (`findUnique({ where: { id } })`),
 * letting any authenticated tenant read/mutate another tenant's invoices by
 * guessing/observing an id. `markInvoiceSent` didn't even require
 * authentication. `approveInvoice`/`rejectInvoice` (maker-checker) and
 * `convertQuotationToInvoice` had the same unscoped-lookup gap.
 *
 * These tests mock prisma and assert every fixed handler's lookup carries
 * `userId` (the authenticated tenant) and 404s when the mocked lookup
 * returns null (simulating a foreign-tenant id).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const {
  mockInvoiceFindFirst,
  mockInvoiceFindUnique,
  mockInvoiceUpdate,
  mockInvoicePaymentAggregate,
  mockQuotationFindFirst,
} = vi.hoisted(() => ({
  mockInvoiceFindFirst: vi.fn(),
  mockInvoiceFindUnique: vi.fn(),
  mockInvoiceUpdate: vi.fn(),
  mockInvoicePaymentAggregate: vi.fn(),
  mockQuotationFindFirst: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const tx = {
    invoice: { findFirst: mockInvoiceFindFirst, update: mockInvoiceUpdate },
    invoicePayment: { aggregate: mockInvoicePaymentAggregate },
    quotation: { findFirst: mockQuotationFindFirst },
  };
  return {
    prisma: {
      invoice: {
        findFirst: mockInvoiceFindFirst,
        findUnique: mockInvoiceFindUnique,
        update: mockInvoiceUpdate,
      },
      invoicePayment: { aggregate: mockInvoicePaymentAggregate },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
});

// utils/mailer is required (not imported) by the controller; stub it so the
// module loads without touching a real transport.
vi.mock('../utils/mailer', () => ({ sendMail: vi.fn() }));

import {
  updateInvoiceStatus,
  sendInvoiceEmail,
  deleteInvoice,
  recordInvoicePayment,
  markInvoiceSent,
  approveInvoice,
  rejectInvoice,
  convertQuotationToInvoice,
} from '../controllers/Admin/Invoice/invoiceController';

function makeReqRes(opts: {
  params?: Record<string, string>;
  body?: Record<string, unknown>;
} = {}) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    params: opts.params ?? {},
    query: {},
    body: opts.body ?? {},
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
  mockInvoiceFindFirst.mockResolvedValue(null);
  mockInvoiceFindUnique.mockResolvedValue(null);
  mockQuotationFindFirst.mockResolvedValue(null);
});

describe('invoiceController — tenant scoping (404 on foreign-tenant id)', () => {
  it('updateInvoiceStatus scopes the Invoice lookup by tenant and 404s on a foreign id', async () => {
    const { req, res } = makeReqRes({ body: { invoiceId: 'inv-1', status: 'SENT' } });
    await updateInvoiceStatus(req, res);

    expect(mockInvoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-1', userId: TENANT_ID } }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('sendInvoiceEmail scopes the Invoice lookup by tenant and 404s before sending mail', async () => {
    const { req, res } = makeReqRes({
      body: { invoiceId: 'inv-1', to: 'a@b.com', subject: 'x', htmlContent: '<p>x</p>' },
    });
    await sendInvoiceEmail(req, res);

    expect(mockInvoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-1', userId: TENANT_ID } }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('deleteInvoice scopes the Invoice lookup by tenant and 404s on a foreign id', async () => {
    const { req, res } = makeReqRes({ params: { id: 'inv-1' } });
    await deleteInvoice(req, res);

    expect(mockInvoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-1', userId: TENANT_ID } }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('recordInvoicePayment scopes the Invoice lookup by tenant and 404s on a foreign id', async () => {
    const { req, res } = makeReqRes({ body: { invoiceId: 'inv-1', amount: 100 } });
    await recordInvoicePayment(req, res);

    expect(mockInvoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-1', userId: TENANT_ID } }),
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('markInvoiceSent requires auth, scopes the Invoice lookup by tenant, and 404s on a foreign id', async () => {
    const { req, res } = makeReqRes({ params: { id: 'inv-1' } });
    await markInvoiceSent(req, res);

    expect(mockInvoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-1', userId: TENANT_ID } }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('approveInvoice scopes the Invoice lookup by tenant and 404s on a foreign id (sibling gap fix)', async () => {
    const { req, res } = makeReqRes({ params: { id: 'inv-1' } });
    await approveInvoice(req, res);

    expect(mockInvoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'inv-1', userId: TENANT_ID }) }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rejectInvoice scopes the Invoice lookup by tenant and 404s on a foreign id (sibling gap fix)', async () => {
    const { req, res } = makeReqRes({ params: { id: 'inv-1' }, body: { reason: 'no' } });
    await rejectInvoice(req, res);

    expect(mockInvoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'inv-1', userId: TENANT_ID }) }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('convertQuotationToInvoice scopes the Quotation lookup by tenant and 404s on a foreign id (sibling gap fix)', async () => {
    const { req, res } = makeReqRes({ params: { quotationId: 'quo-1' } });
    await convertQuotationToInvoice(req, res);

    expect(mockQuotationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'quo-1', userId: TENANT_ID } }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
