// tests/userController.lastOwner.test.ts
//
// "The last owner" became a per-WORKSPACE question in P5. It used to be
// answered by counting `User.roleId === <the Owner role>` across the whole
// install, which was wrong twice over once a second company existed: it counted
// other companies' owners, and it keyed on a role name any workspace may
// rename. TenantMembership.isOwner is the answer now, counted within one tenant.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    role: { findFirst: vi.fn() },
    tenantMembership: {
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));
vi.mock('../lib/tenantScope', () => ({
  requireTenantId: () => 'tenant1',
  requireActingUserId: () => 'tenant1',
  UnauthorizedError: class extends Error {},
}));

import { prisma } from '../lib/prisma';
import { deleteStaffUser, updateStaffUser } from '../controllers/userController';

function mkRes() {
  const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res;
}

/** Both handlers run their writes inside $transaction; hand the callback a tx. */
function passThroughTransaction() {
  (prisma.$transaction as any).mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
}

/** The membership row that binds the target user to this workspace. */
function membership(isOwner: boolean) {
  return { id: 'mem1', roleId: isOwner ? 'owner-role' : 'staff-role', isOwner, status: 'ACTIVE' };
}

beforeEach(() => {
  vi.clearAllMocks();
  passThroughTransaction();
});

describe('deleteStaffUser last-owner protection', () => {
  it('blocks deleting this workspace\'s last owner', async () => {
    (prisma.tenantMembership.findUnique as any).mockResolvedValue(membership(true));
    (prisma.tenantMembership.count as any).mockResolvedValue(1); // only one owner here
    const res = mkRes();
    await deleteStaffUser({ params: { id: 'o1' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(prisma.tenantMembership.delete).not.toHaveBeenCalled();
  });

  it('allows deleting an owner when the workspace has another', async () => {
    (prisma.tenantMembership.findUnique as any).mockResolvedValue(membership(true));
    (prisma.tenantMembership.count as any)
      .mockResolvedValueOnce(2) // isLastOwner: two owners
      .mockResolvedValueOnce(0); // no remaining memberships after removal
    (prisma.user.delete as any).mockResolvedValue({ id: 'o1' });
    const res = mkRes();
    await deleteStaffUser({ params: { id: 'o1' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.user.delete).toHaveBeenCalled();
  });

  it('404s for a user who is not a member of this workspace', async () => {
    // The old implementation loaded the target with an unscoped findUnique, so
    // an admin in one company could delete a user in another by id.
    (prisma.tenantMembership.findUnique as any).mockResolvedValue(null);
    const res = mkRes();
    await deleteStaffUser({ params: { id: 'someone-elses-user' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('removes only the membership when the user belongs to another workspace too', async () => {
    (prisma.tenantMembership.findUnique as any).mockResolvedValue(membership(false));
    (prisma.tenantMembership.count as any)
      .mockResolvedValueOnce(2) // isLastOwner is short-circuited by isOwner:false, but be explicit
      .mockResolvedValueOnce(1); // one membership remains elsewhere
    const res = mkRes();
    await deleteStaffUser({ params: { id: 'u9' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.tenantMembership.delete).toHaveBeenCalled();
    // The person still exists — they are simply no longer in this company.
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect((res.json as any).mock.calls[0][0].message).toBe('Staff user removed from this workspace');
  });
});

describe('updateStaffUser last-owner protection', () => {
  it('blocks demotion of the last owner', async () => {
    (prisma.tenantMembership.findUnique as any).mockResolvedValue(membership(true));
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'o1', roleId: 'owner-role', email: 'o@x.com', user_type: 1 });
    (prisma.role.findFirst as any).mockResolvedValue({ id: 'owner-role' });
    (prisma.tenantMembership.count as any).mockResolvedValue(1);

    const res = mkRes();
    await updateStaffUser({ params: { id: 'o1' }, body: { roleId: 'staff-role' }, file: undefined } as any, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.json as any).mock.calls[0][0].message).toBe('Cannot remove the Owner role from the last owner');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows demotion when another owner exists, and follows it on the membership', async () => {
    (prisma.tenantMembership.findUnique as any).mockResolvedValue(membership(true));
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'o1', roleId: 'owner-role', email: 'o@x.com', user_type: 1 });
    (prisma.role.findFirst as any)
      .mockResolvedValueOnce({ id: 'owner-role' })          // the guard's Owner-role lookup
      .mockResolvedValueOnce({ id: 'staff-role', roleName: 'Staff' }); // role validity
    (prisma.tenantMembership.count as any).mockResolvedValue(2);
    (prisma.user.update as any).mockResolvedValue({ id: 'o1' });

    const res = mkRes();
    await updateStaffUser({ params: { id: 'o1' }, body: { roleId: 'staff-role' }, file: undefined } as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.user.update).toHaveBeenCalled();
    // isOwner has to follow the role, or protect() and isLastOwner would keep
    // treating a demoted user as an owner.
    expect(prisma.tenantMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mem1' },
        data: expect.objectContaining({ roleId: 'staff-role', isOwner: false }),
      }),
    );
  });

  it('allows an update with no roleId even for the last owner', async () => {
    (prisma.tenantMembership.findUnique as any).mockResolvedValue(membership(true));
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'o1', roleId: 'owner-role', email: 'o@x.com', user_type: 1 });
    (prisma.role.findFirst as any).mockResolvedValue({ id: 'owner-role' });
    (prisma.user.update as any).mockResolvedValue({ id: 'o1' });

    const res = mkRes();
    await updateStaffUser({ params: { id: 'o1' }, body: { firstName: 'Alice' }, file: undefined } as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // The guard must not fire without a role change.
    expect(prisma.tenantMembership.count).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
    expect(prisma.tenantMembership.update).not.toHaveBeenCalled();
  });

  it('404s for a user in another workspace', async () => {
    (prisma.tenantMembership.findUnique as any).mockResolvedValue(null);
    const res = mkRes();
    await updateStaffUser({ params: { id: 'foreign' }, body: { firstName: 'X' }, file: undefined } as any, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
