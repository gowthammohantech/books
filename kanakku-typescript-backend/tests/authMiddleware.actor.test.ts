// tests/authMiddleware.actor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    permission: { findMany: vi.fn() },
    role: { findUnique: vi.fn() },
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

describe('protect actor resolution', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches req.actor with a perms map keyed by moduleSlug', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'u1', ownerId: null, roleId: 'r1' });
    (prisma.role.findUnique as any).mockResolvedValue({ id: 'r1', roleName: 'Staff' });
    (prisma.permission.findMany as any).mockResolvedValue([
      { roleId: 'r1', create: false, edit: false, delete: false, view: true, allowAll: false, module: { moduleSlug: 'invoices' } },
    ]);
    const token = jwt.sign({ id: 'u1', tenantId: 'u1' }, SECRET);
    const req = mkReq(token);
    const res = mkRes();
    const next = vi.fn();

    await protect(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.actor.userId).toBe('u1');
    expect(req.actor.roleName).toBe('Staff');
    expect(req.actor.isOwner).toBe(false);
    expect(req.actor.perms.get('invoices')).toMatchObject({ view: true, create: false, allowAll: false });
  });

  it('sets isOwner true for the Owner role and yields empty perms on permission-load failure', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'u2', ownerId: null, roleId: 'r2' });
    (prisma.role.findUnique as any).mockResolvedValue({ id: 'r2', roleName: 'Owner' });
    (prisma.permission.findMany as any).mockRejectedValue(new Error('db down'));
    const token = jwt.sign({ id: 'u2', tenantId: 'u2' }, SECRET);
    const req = mkReq(token);
    const res = mkRes();
    const next = vi.fn();

    await protect(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.actor.isOwner).toBe(true);
    expect(req.actor.perms.size).toBe(0); // deny-by-default on load failure
  });
});
