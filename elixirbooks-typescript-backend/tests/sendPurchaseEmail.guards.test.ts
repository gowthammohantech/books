/**
 * tests/sendPurchaseEmail.guards.test.ts
 *
 * Wave-1 Task 2: sendPurchaseEmail always attached
 * `uploads/purchases/<id>.pdf` when `sendAttachment` was truthy, even though
 * nothing generates that file — a real send 500s because nodemailer can't
 * read a missing path. Mirrors quotationController's fs.existsSync guard
 * (quotationController.ts:1165-1179): skip the attachment gracefully when
 * the PDF hasn't been generated yet.
 *
 * Mocking note: see tests/sendInvoiceEmail.guards.test.ts — `utils/mailer`
 * is require()'d by the controller, which vi.mock cannot intercept here, so
 * we spy on the real singleton module instead. `fs` is accessed via dynamic
 * `import('fs')`, which vi.mock DOES intercept normally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { mockPurchaseFindFirst, mockExistsSync } = vi.hoisted(() => ({
  mockPurchaseFindFirst: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: { purchase: { findFirst: mockPurchaseFindFirst } },
}));
vi.mock('fs', () => ({ existsSync: mockExistsSync, default: { existsSync: mockExistsSync } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mailerModule = require('../utils/mailer');

import { sendPurchaseEmail } from '../controllers/Admin/Purchases/purchaseController';

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
  mockPurchaseFindFirst.mockResolvedValue({ id: 'pur-1', userId: TENANT_ID });
});

describe('sendPurchaseEmail — phantom PDF attachment guard', () => {
  it('sends without an attachment when the PDF has not been generated (no throw, no 500)', async () => {
    const { req, res } = makeReqRes({
      purchaseId: 'pur-1',
      to: 'supplier@example.com',
      subject: 'Purchase order',
      htmlContent: '<p>purchase</p>',
      sendAttachment: true,
    });
    await sendPurchaseEmail(req, res);

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
    mockExistsSync.mockReturnValue(true);

    const { req, res } = makeReqRes({
      purchaseId: 'pur-1',
      to: 'supplier@example.com',
      subject: 'Purchase order',
      htmlContent: '<p>purchase</p>',
      sendAttachment: true,
    });
    await sendPurchaseEmail(req, res);

    const sentOptions = (mailerModule.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(sentOptions.attachments).toEqual([
      expect.objectContaining({ filename: 'Purchase-pur-1.pdf' }),
    ]);
  });
});
