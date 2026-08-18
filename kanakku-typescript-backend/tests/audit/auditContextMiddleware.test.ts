import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { prisma } from '../../lib/prisma';
import { auditContextMiddleware } from '../../middleware/auditContext';
import { getAuditContext } from '../../lib/auditContext';

function fakeReqRes(user?: string) {
  const req: any = { user, ip: '9.9.9.9', headers: { 'user-agent': 'vitest' } };
  const res: any = {};
  return { req, res };
}

describe('auditContextMiddleware', () => {
  it('loads userName once and exposes context to downstream handlers', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ firstName: 'Asha', lastName: 'R', email: 'a@x.com' });
    const { req, res } = fakeReqRes('u1');
    let seen: any;
    await new Promise<void>((resolve) => {
      auditContextMiddleware(req, res, () => { seen = getAuditContext(); resolve(); });
    });
    expect(seen).toMatchObject({ userId: 'u1', userName: 'Asha R', ipAddress: '9.9.9.9', userAgent: 'vitest' });
  });

  it('falls back to system when unauthenticated', async () => {
    const { req, res } = fakeReqRes(undefined);
    let seen: any;
    await new Promise<void>((resolve) => {
      auditContextMiddleware(req, res, () => { seen = getAuditContext(); resolve(); });
    });
    expect(seen).toMatchObject({ userId: null, userName: 'system' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
