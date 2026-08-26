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
 * Mocking note: `../../../utils/mailer` is pulled in via a top-level CJS
 * `require()` in invoiceController.ts (not an ESM `import`), and this
 * project's require() calls are NOT intercepted by `vi.mock` (verified:
 * ts-node/register's global require hook — see tests/setup-tsnode.ts —
 * resolves real modules regardless of vi.mock; only ESM `import`/dynamic
 * `import()` specifiers are mockable here). So instead of `vi.mock`, we grab
 * the SAME singleton module object via `require()` in this file (Node's
 * module cache guarantees identity with the controller's own require) and
 * `vi.spyOn` its `sendMail` export. `fs` IS accessed via dynamic
 * `import('fs')` in the (mirrored) guard implementation, so that one mocks
 * normally via `vi.mock('fs', ...)`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { mockInvoiceFindFirst, mockInvoiceUpdate, mockExistsSync } = vi.hoisted(() => ({
  mockInvoiceFindFirst: vi.fn(),
  mockInvoiceUpdate: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: { invoice: { findFirst: mockInvoiceFindFirst, update: mockInvoiceUpdate } },
}));
vi.mock('fs', () => ({ existsSync: mockExistsSync, default: { existsSync: mockExistsSync } }));

// See mocking note above: `utils/mailer` is require()'d by the controller,
// which vi.mock cannot intercept in this project. Grab the real singleton
// and spy on it instead.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mailerModule = require('../utils/mailer');

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
  vi.spyOn(mailerModule, 'sendMail').mockResolvedValue(undefined);
  mockExistsSync.mockReturnValue(false);
});

describe('sendInvoiceEmail — status guard', () => {
  it('does NOT reset an OVERDUE invoice back to SENT (payment reminder)', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ id: 'inv-1', userId: TENANT_ID, status: 'OVERDUE' });
    mockInvoiceUpdate.mockResolvedValue({ id: 'inv-1', status: 'OVERDUE' });

    const { req, res } = makeReqRes({
      invoiceId: 'inv-1',
      to: 'customer@example.com',
      subject: 'Payment reminder',
      htmlContent: '<p>reminder</p>',
    });
    await sendInvoiceEmail(req, res);

    expect(mailerModule.sendMail).toHaveBeenCalled();
    expect(mockInvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'OVERDUE' } }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does NOT reset a PARTIALLY_PAID invoice back to SENT', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ id: 'inv-2', userId: TENANT_ID, status: 'PARTIALLY_PAID' });
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
    mockInvoiceFindFirst.mockResolvedValue({ id: 'inv-3', userId: TENANT_ID, status: 'DRAFT' });
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
    mockInvoiceFindFirst.mockResolvedValue({ id: 'inv-4', userId: TENANT_ID, status: 'DRAFT' });
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

    expect(mailerModule.sendMail).toHaveBeenCalledTimes(1);
    const sentOptions = (mailerModule.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(sentOptions.attachments).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  it('attaches the PDF when it does exist', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ id: 'inv-5', userId: TENANT_ID, status: 'DRAFT' });
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

    const sentOptions = (mailerModule.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(sentOptions.attachments).toEqual([
      expect.objectContaining({ filename: 'Invoice-inv-5.pdf' }),
    ]);
  });
});
