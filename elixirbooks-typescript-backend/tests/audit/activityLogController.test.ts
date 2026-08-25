import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: { auditLog: { count: vi.fn(), findMany: vi.fn() } },
}));

import { prisma } from '../../lib/prisma';
import { listActivityLogs } from '../../controllers/activityLogController';

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('listActivityLogs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes by the requesting user and returns nested pagination with totalPages', async () => {
    (prisma.auditLog.count as any).mockResolvedValue(23);
    (prisma.auditLog.findMany as any).mockResolvedValue([{ id: 'a1' }]);
    const req: any = { user: 'u1', query: { page: '2', limit: '10' } };
    const res = mockRes();

    await listActivityLogs(req, res);

    const whereArg = (prisma.auditLog.findMany as any).mock.calls[0][0].where;
    expect(whereArg.userId).toBe('u1');
    const body = (res.json as any).mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.pagination).toEqual({ total: 23, page: 2, limit: 10, totalPages: 3 });
    expect(body.data.items).toEqual([{ id: 'a1' }]);
  });

  it('applies entityType/action/search/date filters', async () => {
    (prisma.auditLog.count as any).mockResolvedValue(0);
    (prisma.auditLog.findMany as any).mockResolvedValue([]);
    const req: any = {
      user: 'u1',
      query: { entityType: 'Invoice', action: 'UPDATE', search: 'INV', dateFrom: '2026-01-01', dateTo: '2026-02-01' },
    };
    const res = mockRes();

    await listActivityLogs(req, res);

    const where = (prisma.auditLog.findMany as any).mock.calls[0][0].where;
    expect(where.entityType).toBe('Invoice');
    expect(where.action).toBe('UPDATE');
    expect(where.createdAt).toMatchObject({ gte: expect.any(Date), lte: expect.any(Date) });
    expect(where.OR).toEqual([
      { summary: { contains: 'INV', mode: 'insensitive' } },
      { entityLabel: { contains: 'INV', mode: 'insensitive' } },
    ]);
  });

  it('401s when unauthenticated', async () => {
    const req: any = { query: {} };
    const res = mockRes();
    await listActivityLogs(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('falls back to defaults for non-numeric page/limit (no Prisma 500)', async () => {
    (prisma.auditLog.count as any).mockResolvedValue(0);
    (prisma.auditLog.findMany as any).mockResolvedValue([]);
    const req: any = { user: 'u1', query: { page: 'abc', limit: 'xyz' } };
    const res = mockRes();
    await listActivityLogs(req, res);
    const findArgs = (prisma.auditLog.findMany as any).mock.calls[0][0];
    expect(findArgs.skip).toBe(0);   // page defaults to 1 → skip 0
    expect(findArgs.take).toBe(10);  // limit defaults to 10
    const body = (res.json as any).mock.calls[0][0];
    expect(body.data.pagination).toEqual({ total: 0, page: 1, limit: 10, totalPages: 0 });
  });

  it('returns 400 for an invalid action value (does not hit Prisma)', async () => {
    const req: any = { user: 'u1', query: { action: 'FOO' } };
    const res = mockRes();
    await listActivityLogs(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});
