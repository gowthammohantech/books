// tests/authMiddleware.actor.test.ts
//
// protect() resolves the caller's workspace from a TenantMembership as of P5.
// The membership IS the authorization: the token's tenant claim only selects
// WHICH of the caller's workspaces to load, and a claim naming one they do not
// belong to resolves nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    tenantMembership: { findFirst: vi.fn() },
  },
}));

import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { protect } from '../middleware/authMiddleware';

const SECRET = 'test-secret';
process.env.JWT_SECRET = SECRET;

function mkReq(token?: string) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} } as any;
}
function mkRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

function membership(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    tenantId: 't1',
    isOwner: false,
    roleId: 'r1',
    role: {
      id: 'r1',
      roleName: 'Staff',
      permissions: [
        {
          view: true,
          create: false,
          edit: false,
          delete: false,
          allowAll: false,
          module: { moduleSlug: 'invoices' },
        },
      ],
    },
    ...over,
  };
}

describe('protect actor resolution', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches req.actor with a perms map keyed by moduleSlug', async () => {
    (prisma.tenantMembership.findFirst as any).mockResolvedValue(membership());
    const token = jwt.sign({ id: 'u1', tenantId: 't1', v: 2 }, SECRET);
    const req = mkReq(token);
    const res = mkRes();
    const next = vi.fn();

    await protect(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.actor.userId).toBe('u1');
    expect(req.actor.tenantId).toBe('t1');
    expect(req.actor.membershipId).toBe('m1');
    expect(req.actor.roleName).toBe('Staff');
    expect(req.actor.isOwner).toBe(false);
    expect(req.actor.perms.get('invoices')).toMatchObject({ view: true, create: false, allowAll: false });
  });

  it('takes isOwner from the membership flag, not from the role name', async () => {
    // A workspace is free to rename its Owner role; the flag is what protect,
    // isLastOwner and the switcher all read.
    (prisma.tenantMembership.findFirst as any).mockResolvedValue(
      membership({ isOwner: true, role: { id: 'r9', roleName: 'Proprietor', permissions: [] } }),
    );
    const token = jwt.sign({ id: 'u2', tenantId: 't1', v: 2 }, SECRET);
    const req = mkReq(token);
    const res = mkRes();
    const next = vi.fn();

    await protect(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.actor.isOwner).toBe(true);
    expect(req.actor.roleName).toBe('Proprietor');
    expect(req.actor.perms.size).toBe(0); // deny-by-default with no permissions
  });

  it('scopes the membership lookup to the tenant named by the token', async () => {
    (prisma.tenantMembership.findFirst as any).mockResolvedValue(membership({ tenantId: 't7' }));
    const token = jwt.sign({ id: 'u1', tenantId: 't7', v: 2 }, SECRET);
    await protect(mkReq(token), mkRes(), vi.fn());

    expect(prisma.tenantMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          tenantId: 't7',
          status: 'ACTIVE',
          tenant: { status: 'ACTIVE', deletedAt: null },
          user: { isDeleted: false },
        }),
      }),
    );
  });

  it('401s when no membership matches — revoked, suspended, or a foreign tenant claim', async () => {
    (prisma.tenantMembership.findFirst as any).mockResolvedValue(null);
    const token = jwt.sign({ id: 'u1', tenantId: 'someone-elses-tenant', v: 2 }, SECRET);
    const req = mkReq(token);
    const res = mkRes();
    const next = vi.fn();

    await protect(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // 401 rather than 403 on purpose: the frontend interceptor turns it into a
    // clean logout, which is the right UX for a revoked seat.
    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.tenantId).toBeUndefined();
  });

  it('503s — not 401 — when the lookup itself fails', async () => {
    // A transient DB fault must not log every signed-in user out install-wide.
    (prisma.tenantMembership.findFirst as any).mockRejectedValue(new Error('db down'));
    const res = mkRes();
    const next = vi.fn();

    await protect(mkReq(jwt.sign({ id: 'u1', tenantId: 't1', v: 2 }, SECRET)), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('accepts a v1 token with no tenant claim by falling back to the oldest membership', async () => {
    (prisma.tenantMembership.findFirst as any).mockResolvedValue(membership());
    const token = jwt.sign({ id: 'u1' }, SECRET);
    const req = mkReq(token);
    const next = vi.fn();

    await protect(req, mkRes(), next);

    expect(next).toHaveBeenCalled();
    expect(req.tenantId).toBe('t1');
    const args = (prisma.tenantMembership.findFirst as any).mock.calls[0][0];
    expect(args.where).not.toHaveProperty('tenantId');
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }]);
  });
});
