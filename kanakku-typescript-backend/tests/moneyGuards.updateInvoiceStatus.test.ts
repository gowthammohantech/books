/**
 * tests/moneyGuards.updateInvoiceStatus.test.ts
 *
 * P2 bug 3: the generic POST /invoices/update-status endpoint set ANY status with
 * no financial side effects — a manual "PAID" left a full remaining balance, a
 * "CANCELLED" stranded the GL + stock. It is now constrained to display-only
 * transitions; PAID/PARTIALLY_PAID (derived) and CANCELLED (needs reversal) are
 * rejected 409.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { mockInvoiceFindFirst, mockInvoiceUpdate } = vi.hoisted(() => ({
  mockInvoiceFindFirst: vi.fn(),
  mockInvoiceUpdate: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: { invoice: { findFirst: mockInvoiceFindFirst, update: mockInvoiceUpdate } },
}));
vi.mock('../utils/mailer', () => ({ sendMail: vi.fn() }));

import { updateInvoiceStatus } from '../controllers/Admin/Invoice/invoiceController';

function makeReqRes(body: Record<string, unknown>) {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, params: {}, query: {}, body } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoiceFindFirst.mockResolvedValue({ id: 'inv-1', userId: TENANT_ID, status: 'UNPAID' });
  mockInvoiceUpdate.mockResolvedValue({ id: 'inv-1', status: 'SENT' });
});

describe('updateInvoiceStatus — safe-transition matrix', () => {
  for (const bad of ['PAID', 'PARTIALLY_PAID']) {
    it(`rejects a direct ${bad} jump with 409 and never writes`, async () => {
      const { req, res } = makeReqRes({ invoiceId: 'inv-1', status: bad });
      await updateInvoiceStatus(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockInvoiceUpdate).not.toHaveBeenCalled();
    });
  }

  it('rejects a direct CANCELLED jump with 409 (no GL/stock reversal here)', async () => {
    const { req, res } = makeReqRes({ invoiceId: 'inv-1', status: 'CANCELLED' });
    await updateInvoiceStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });

  for (const ok of ['DRAFT', 'SENT', 'OVERDUE', 'UNPAID']) {
    it(`allows display-only status ${ok} (200 + persists)`, async () => {
      const { req, res } = makeReqRes({ invoiceId: 'inv-1', status: ok });
      await updateInvoiceStatus(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockInvoiceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: ok } }),
      );
    });
  }

  it('still rejects a genuinely invalid status with 400', async () => {
    const { req, res } = makeReqRes({ invoiceId: 'inv-1', status: 'BOGUS' });
    await updateInvoiceStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });
});
