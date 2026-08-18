// tests/userController.lastOwner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), count: vi.fn(), update: vi.fn(), delete: vi.fn() },
    role: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock('../lib/tenantScope', () => ({
  requireUserId: () => 'tenant1',
  requireActingUserId: () => 'tenant1',
  UnauthorizedError: class extends Error {},
}));

import { prisma } from '../lib/prisma';
import { deleteStaffUser, updateStaffUser } from '../controllers/userController';

function mkRes() {
  const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res;
}

describe('deleteStaffUser last-owner protection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks deleting the last Owner', async () => {
    (prisma.role.findFirst as any).mockResolvedValue({ id: 'owner-role' });
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'o1', roleId: 'owner-role', user_type: 1 });
    (prisma.user.count as any).mockResolvedValue(1); // only one Owner
    const req: any = { params: { id: 'o1' } };
    const res = mkRes();
    await deleteStaffUser(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('allows deleting an Owner when another Owner exists', async () => {
    (prisma.role.findFirst as any).mockResolvedValue({ id: 'owner-role' });
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'o1', roleId: 'owner-role', user_type: 1 });
    (prisma.user.count as any).mockResolvedValue(2);
    (prisma.user.delete as any).mockResolvedValue({ id: 'o1' });
    const req: any = { params: { id: 'o1' } };
    const res = mkRes();
    await deleteStaffUser(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('updateStaffUser last-owner protection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks demotion of the last Owner', async () => {
    // user exists and holds the Owner role
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'o1', roleId: 'owner-role', email: 'o@x.com', user_type: 1 });
    // owner role lookup in the guard
    (prisma.role.findFirst as any).mockResolvedValue({ id: 'owner-role' });
    // only one Owner exists → isLastOwner returns true
    (prisma.user.count as any).mockResolvedValue(1);

    const req: any = { params: { id: 'o1' }, body: { roleId: 'staff-role' }, file: undefined };
    const res = mkRes();
    await updateStaffUser(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(jsonArg.message).toBe('Cannot remove the Owner role from the last owner');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows demotion when another Owner exists', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'o1', roleId: 'owner-role', email: 'o@x.com', user_type: 1 });
    (prisma.role.findFirst as any).mockResolvedValue({ id: 'owner-role' });
    // two Owners exist → isLastOwner returns false → guard passes
    (prisma.user.count as any).mockResolvedValue(2);
    // role validity check for the new roleId
    (prisma.role.findUnique as any).mockResolvedValue({ id: 'staff-role', roleName: 'Staff' });
    (prisma.user.update as any).mockResolvedValue({ id: 'o1' });

    const req: any = { params: { id: 'o1' }, body: { roleId: 'staff-role' }, file: undefined };
    const res = mkRes();
    await updateStaffUser(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('allows update without roleId even if last Owner', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'o1', roleId: 'owner-role', email: 'o@x.com', user_type: 1 });
    (prisma.role.findFirst as any).mockResolvedValue({ id: 'owner-role' });
    // guard must NOT fire when roleId is absent
    (prisma.user.update as any).mockResolvedValue({ id: 'o1' });

    const req: any = { params: { id: 'o1' }, body: { firstName: 'Alice' }, file: undefined };
    const res = mkRes();
    await updateStaffUser(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // count should never have been called — guard was skipped
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
  });
});
