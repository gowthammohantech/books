/**
 * tests/tenant/quotationScope.test.ts
 *
 * Regression tripwire for a horizontal privilege escalation that shipped in
 * `quotationController`.
 *
 * Five handlers resolved a quotation with `where: { id }` — no `tenantId`. The
 * golden capture, driven with tenant A's token against tenant B's quotation id,
 * got 200 from every one of them:
 *
 *     GET    /api/admin/quotations/:id            read a foreign document whole
 *     PUT    /api/admin/quotations/:id            overwrote its notes
 *     PATCH  /api/admin/quotations-status/:id     accepted/declined it
 *     DELETE /api/admin/quotations/:id            soft-deleted it
 *     POST   /api/admin/quotations/mail           mailed it to any address
 *
 * `GET /api/admin/customers-all` — which the quotation form calls on load —
 * filtered on `isDeleted` alone and returned every tenant's customer list.
 *
 * `tenantGuard` ships in `warn` mode (`lib/tenantGuard.ts:139`), so it logged
 * each one and let it through. Nothing failed.
 *
 * Shape follows `catalogScope.test.ts`: mock the `lib/prisma` MODULE, call the
 * handlers, and assert on the ARGUMENTS the delegates received. Asserting on
 * the response would prove nothing — a handler returns nothing because the mock
 * returned nothing, scoped or not. A handler that ASKED for `tenantId` did.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-a';
const FOREIGN_ID = 'quotation-owned-by-tenant-b';

type Args = { where?: Record<string, unknown> };

const m = vi.hoisted(() => {
  const mk = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  });
  return { quotation: mk(), customer: mk(), contact: mk(), user: mk() };
});

vi.mock('../../lib/prisma', () => ({
  prisma: {
    ...m,
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(m)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  },
}));

// The mailer is not the subject; stub it so the email handler reaches its query.
vi.mock('../../utils/mailer', () => ({
  sendMail: vi.fn(async () => undefined),
  isEmailConfigured: vi.fn(async () => false),
}));

import {
  deleteQuotation,
  getAllCustomers,
  getQuotationById,
  listQuotations,
  sendQuotationEmailAndUpdateStatus,
  updateQuotationStatus,
} from '../../controllers/Admin/Invoice/quotationController';

function makeReqRes(overrides: Partial<Request> = {}) {
  const req = {
    tenantId: TENANT_ID,
    user: 'user-1',
    query: {},
    params: {},
    body: {},
    protocol: 'http',
    get: () => 'localhost',
    ...overrides,
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

/** Every `where` this delegate was asked for must name our tenant. */
function expectAllScoped(delegate: Record<string, ReturnType<typeof vi.fn>>, name: string) {
  const seen: Args[] = [];
  for (const fn of Object.values(delegate)) {
    for (const call of fn.mock.calls) {
      if (call[0] && typeof call[0] === 'object' && 'where' in call[0]) seen.push(call[0] as Args);
    }
  }
  expect(seen.length, `${name}: expected at least one query`).toBeGreaterThan(0);
  for (const args of seen) {
    expect(args.where, `${name}: a query went out with no tenant filter`).toMatchObject({
      tenantId: TENANT_ID,
    });
  }
}

beforeEach(() => {
  for (const delegate of Object.values(m)) {
    for (const fn of Object.values(delegate)) {
      fn.mockReset();
      fn.mockResolvedValue(null);
    }
    delegate.findMany.mockResolvedValue([]);
    delegate.count.mockResolvedValue(0);
    delegate.updateMany.mockResolvedValue({ count: 0 });
  }
});

describe('quotation reads are tenant-scoped', () => {
  it('getQuotationById asks for the tenant, not just the id', async () => {
    const { req, res } = makeReqRes({ params: { id: FOREIGN_ID } as Request['params'] });
    await getQuotationById(req, res);
    expectAllScoped(m.quotation, 'getQuotationById');
  });

  it('getQuotationById 404s when no row in this tenant matches', async () => {
    const { req, res } = makeReqRes({ params: { id: FOREIGN_ID } as Request['params'] });
    await getQuotationById(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('listQuotations scopes both the count and the page', async () => {
    const { req, res } = makeReqRes();
    await listQuotations(req, res);
    expectAllScoped(m.quotation, 'listQuotations');
  });

  it('getAllCustomers scopes the customer list', async () => {
    const { req, res } = makeReqRes();
    await getAllCustomers(req, res);
    expectAllScoped(m.customer, 'getAllCustomers');
  });
});

describe('quotation writes are tenant-scoped', () => {
  it('updateQuotationStatus scopes the write and 404s on a foreign id', async () => {
    const { req, res } = makeReqRes({
      params: { id: FOREIGN_ID } as Request['params'],
      body: { status: 'accepted' },
    });
    await updateQuotationStatus(req, res);
    expectAllScoped(m.quotation, 'updateQuotationStatus');
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('deleteQuotation scopes the soft delete and 404s on a foreign id', async () => {
    const { req, res } = makeReqRes({ params: { id: FOREIGN_ID } as Request['params'] });
    await deleteQuotation(req, res);
    expectAllScoped(m.quotation, 'deleteQuotation');
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('the email handler scopes its lookup before it can mail anything', async () => {
    const { req, res } = makeReqRes({
      body: {
        quotationId: FOREIGN_ID,
        to: 'attacker@example.test',
        subject: 's',
        htmlContent: '<p>x</p>',
        status: 'sent',
      },
    });
    await sendQuotationEmailAndUpdateStatus(req, res);
    expectAllScoped(m.quotation, 'sendQuotationEmailAndUpdateStatus');
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('the repository refuses an unscoped by-id write', () => {
  it('update uses updateMany so tenantId can sit in the where', async () => {
    const { QuotationRepository } = await import('../../modules/quotation/quotation.repository');
    // `update` takes a UNIQUE where, which cannot carry a non-unique tenantId.
    // Using it would force either an unscoped write or a check-then-write TOCTOU
    // gap, so the repository writes through updateMany. This pins that choice.
    const repo = new QuotationRepository();
    await repo.update('q1', TENANT_ID, { notes: 'x' });
    expect(m.quotation.update).not.toHaveBeenCalled();
    expect(m.quotation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'q1', tenantId: TENANT_ID } }),
    );
  });
});
