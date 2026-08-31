/**
 * tests/sendInvoiceEmail.guards.test.ts
 *
 * Wave-1 Task 2: sendInvoiceEmail had two correctness bugs.
 *
 * (a) It unconditionally flipped the invoice status to SENT on every send —
 *     a payment reminder fired against an OVERDUE / PARTIALLY_PAID invoice
 *     silently reset it back to SENT, losing the payment-status signal.
 *     Mirrors quotationController's sendQuotationEmailAndUpdateStatus
 *     draft-only promote (quotationController.ts:1154-1156): only a DRAFT
 *     invoice is promoted to SENT; every other status is left untouched.
 *
 * (b) When `sendAttachment` was truthy it always attached
 *     `uploads/invoices/<id>.pdf`, even though nothing generates that file —
 *     a real send 500s because nodemailer can't read a missing path.
 *     Mirrors quotationController's fs.existsSync guard
 *     (quotationController.ts:1165-1179): skip the attachment gracefully
 *     when the PDF hasn't been generated yet.
 *
 * Mocking note: `utils/mailer` used to be JavaScript, pulled in by a top-level
 * CJS `require()` that `vi.mock` could not intercept, so this file grabbed the
 * real singleton and spied on it. Now that mailer is TypeScript and the
 * controller imports `sendMail` normally, `vi.mock` works — the same pattern
 * the rest of the suite already uses. `fs` is accessed via dynamic
 * `import('fs')` and mocks normally too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { mockInvoiceFindFirst, mockInvoiceUpdate, mockExistsSync, mockSendMail } = vi.hoisted(() => ({
  mockInvoiceFindFirst: vi.fn(),
  mockInvoiceUpdate: vi.fn(),
  mockExistsSync: vi.fn(),
  mockSendMail: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: { invoice: { findFirst: mockInvoiceFindFirst, update: mockInvoiceUpdate } },
}));
vi.mock('fs', () => ({ existsSync: mockExistsSync, default: { existsSync: mockExistsSync } }));

vi.mock('../utils/mailer', () => ({ sendMail: mockSendMail }));

import { sendInvoiceEmail } from '../controllers/Admin/Invoice/invoiceController';


function makeReqRes(body: Record<string, unknown>) {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, params: {}, query: {}, body } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mockSendMail.mockResolvedValue(undefined);
  mockExistsSync.mockReturnValue(false);
});

describe('sendInvoiceEmail — status guard', () => {
  it('does NOT reset an OVERDUE invoice back to SENT (payment reminder)', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ id: 'inv-1', tenantId: TENANT_ID, status: 'OVERDUE' });
    mockInvoiceUpdate.mockResolvedValue({ id: 'inv-1', status: 'OVERDUE' });

    const { req, res } = makeReqRes({
      invoiceId: 'inv-1',
      to: 'customer@example.com',
      subject: 'Payment reminder',
      htmlContent: '<p>reminder</p>',
    });
    await sendInvoiceEmail(req, res);

    expect(mockSendMail).toHaveBeenCalled();
    expect(mockInvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'OVERDUE' } }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does NOT reset a PARTIALLY_PAID invoice back to SENT', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ id: 'inv-2', tenantId: TENANT_ID, status: 'PARTIALLY_PAID' });
    mockInvoiceUpdate.mockResolvedValue({ id: 'inv-2', status: 'PARTIALLY_PAID' });

    const { req, res } = makeReqRes({
      invoiceId: 'inv-2',
      to: 'customer@example.com',
      subject: 'Payment reminder',
      htmlContent: '<p>reminder</p>',
    });
    await sendInvoiceEmail(req, res);

    expect(mockInvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PARTIALLY_PAID' } }),
    );
  });

  it('promotes a DRAFT invoice to SENT on first send', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ id: 'inv-3', tenantId: TENANT_ID, status: 'DRAFT' });
    mockInvoiceUpdate.mockResolvedValue({ id: 'inv-3', status: 'SENT' });

    const { req, res } = makeReqRes({
      invoiceId: 'inv-3',
      to: 'customer@example.com',
      subject: 'Invoice',
      htmlContent: '<p>invoice</p>',
    });
    await sendInvoiceEmail(req, res);

    expect(mockInvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SENT' } }),
    );
  });
});

describe('sendInvoiceEmail — phantom PDF attachment guard', () => {
  it('sends without an attachment when the PDF has not been generated (no throw, no 500)', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ id: 'inv-4', tenantId: TENANT_ID, status: 'DRAFT' });
    mockInvoiceUpdate.mockResolvedValue({ id: 'inv-4', status: 'SENT' });
    mockExistsSync.mockReturnValue(false);

    const { req, res } = makeReqRes({
      invoiceId: 'inv-4',
      to: 'customer@example.com',
      subject: 'Invoice',
      htmlContent: '<p>invoice</p>',
      sendAttachment: true,
    });
    await sendInvoiceEmail(req, res);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const sentOptions = mockSendMail.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(sentOptions.attachments).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  it('attaches the PDF when it does exist', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ id: 'inv-5', tenantId: TENANT_ID, status: 'DRAFT' });
    mockInvoiceUpdate.mockResolvedValue({ id: 'inv-5', status: 'SENT' });
    mockExistsSync.mockReturnValue(true);

    const { req, res } = makeReqRes({
      invoiceId: 'inv-5',
      to: 'customer@example.com',
      subject: 'Invoice',
      htmlContent: '<p>invoice</p>',
      sendAttachment: true,
    });
    await sendInvoiceEmail(req, res);

    const sentOptions = mockSendMail.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(sentOptions.attachments).toEqual([
      expect.objectContaining({ filename: 'Invoice-inv-5.pdf' }),
    ]);
  });
});
