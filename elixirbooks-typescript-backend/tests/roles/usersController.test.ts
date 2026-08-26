/**
 * Tests for:
 *  - listStaffUsers: includes type-1 admin, excludes type-999, includes role/type fields
 *  - listStaffUsers: optional ?user_type filter
 *  - listStaffUsers: NaN ?user_type param is ignored (no filter passed to Prisma)
 *  - deleteStaffUser: allows deleting user_type 1 if not last Owner (user_type is no longer a guard)
 *  - updateStaffUser: allows editing user_type 1 if not last Owner (user_type is no longer a guard)
 *  - register: assigns Admin role on user creation
 *  - register: ensureRole throwing still creates user with roleId null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// ---------------------------------------------------------------------------
// Shared in-memory store (closures always read from this object by reference)
// ---------------------------------------------------------------------------
type UserRow = {
  id: string; user_type: number; roleId: string | null;
  firstName: string; email: string; lastName?: string | null; phone?: null;
  gender?: null; dateOfBirth?: null; address?: null; profileImage?: null;
  createdAt: Date; role?: { id: string; roleName: string } | null;
};
type RoleRow = { id: string; roleName: string; deletedAt: null };

const db = {
  users: [] as UserRow[],
  roles: [] as RoleRow[],
};

// Control flag to simulate ensureRole throwing
let ensureRoleShouldThrow = false;

// ---------------------------------------------------------------------------
// Mock ../../lib/prisma (used by userController + authController)
// ---------------------------------------------------------------------------
vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async (args: { where: { user_type?: number } }) => {
        const ut = args.where.user_type;
        if (ut !== undefined) return db.users.find((u) => u.user_type === ut) ?? null;
        return null;
      }),
      findUnique: vi.fn(async (args: { where: { id?: string; email?: string } }) => {
        if (args.where.id) return db.users.find((u) => u.id === args.where.id) ?? null;
        if (args.where.email) return db.users.find((u) => u.email === args.where.email) ?? null;
        return null;
      }),
      findMany: vi.fn(async (args: { where: { NOT?: { user_type: number }; user_type?: number }; skip?: number; take?: number }) => {
        let result = db.users.filter((u) => u.user_type !== 999);
        if (args.where.user_type !== undefined) result = result.filter((u) => u.user_type === args.where.user_type);
        const skip = args.skip ?? 0;
        const take = args.take ?? result.length;
        return result.slice(skip, skip + take);
      }),
      count: vi.fn(async (args: { where: { NOT?: { user_type: number }; user_type?: number } }) => {
        let result = db.users.filter((u) => u.user_type !== 999);
        if (args.where.user_type !== undefined) result = result.filter((u) => u.user_type === args.where.user_type);
        return result.length;
      }),
      create: vi.fn(async (args: { data: { id?: string; firstName: string; user_type: number; roleId?: string; email: string; password: string; lastName?: string | null } }) => {
        const user = { id: 'new-user-id', createdAt: new Date(), phone: null, gender: null, dateOfBirth: null, address: null, profileImage: null, role: null, ...args.data };
        db.users.push(user as UserRow);
        return user;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const user = db.users.find((u) => u.id === args.where.id);
        if (!user) throw new Error('User not found');
        Object.assign(user, args.data);
        return user;
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const idx = db.users.findIndex((u) => u.id === args.where.id);
        if (idx !== -1) db.users.splice(idx, 1);
        return {};
      }),
    },
    role: {
      findFirst: vi.fn(async (args: { where: { roleName?: { equals?: string }; deletedAt?: null } }) => {
        const name = args.where.roleName?.equals?.toLowerCase();
        return db.roles.find((r) => r.roleName.toLowerCase() === name && r.deletedAt === null) ?? null;
      }),
      findUnique: vi.fn(async (args: { where: { id?: string } }) => {
        if (args.where.id) return db.roles.find((r) => r.id === args.where.id) ?? null;
        return null;
      }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock ../../lib/defaultRoles (ensureRole is called from authController)
// ---------------------------------------------------------------------------
vi.mock('../../lib/defaultRoles', () => ({
  DEFAULT_ROLE_BY_USER_TYPE: { 1: 'Admin', 2: 'Vendor', 3: 'Staff', 4: 'Maintainer', 5: 'Supplier' },
  OWNER_ROLE_NAME: 'Owner',
  ensureRole: vi.fn(async (roleName: string) => {
    if (ensureRoleShouldThrow) throw new Error('DB connection error (simulated)');
    const existing = db.roles.find((r) => r.roleName.toLowerCase() === roleName.toLowerCase());
    if (existing) return existing.id;
    const newRole = { id: `role-${db.roles.length + 1}`, roleName, deletedAt: null };
    db.roles.push(newRole);
    return newRole.id;
  }),
}));

vi.mock('../../lib/tenantScope', () => ({
  requireUserId: vi.fn(() => 'test-tenant-id'),
  requireActingUserId: vi.fn(() => 'test-user-id'),
}));

vi.mock('../../utils/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('$2b$10$hashed'),
  comparePassword: vi.fn(),
}));

vi.mock('../../utils/generateToken', () => ({
  generateToken: vi.fn().mockReturnValue('mock-jwt-token'),
}));

// Import AFTER mocks
import { listStaffUsers, deleteStaffUser, updateStaffUser } from '../../controllers/userController';
import { register } from '../../controllers/authController';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRes() {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return res as unknown as Response;
}

function makeReq(overrides: Partial<{ query: Record<string, string>; params: Record<string, string>; body: Record<string, string> }> = {}): Request {
  return {
    query: overrides.query ?? {},
    params: overrides.params ?? {},
    body: overrides.body ?? {},
    protocol: 'http',
    get: vi.fn().mockReturnValue('localhost:3000'),
    file: undefined,
  } as unknown as Request;
}

// ---------------------------------------------------------------------------
// listStaffUsers
// ---------------------------------------------------------------------------
describe('listStaffUsers', () => {
  beforeEach(() => { db.users = []; db.roles = []; });

  it('includes type-1 (admin) and type-3 (staff) users', async () => {
    db.users.push(
      { id: 'u-admin', firstName: 'Leo', email: 'leo@t.com', user_type: 1, roleId: 'r1', role: { id: 'r1', roleName: 'Admin' }, createdAt: new Date() },
      { id: 'u-staff', firstName: 'Bob', email: 'bob@t.com', user_type: 3, roleId: 'r2', role: { id: 'r2', roleName: 'Staff' }, createdAt: new Date() },
    );
    const res = makeRes();
    await listStaffUsers(makeReq(), res);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(res.status).toHaveBeenCalledWith(200);
    const ids = body.data.users.map((u: { id: string }) => u.id);
    expect(ids).toContain('u-admin');
    expect(ids).toContain('u-staff');
  });

  it('excludes type-999 sys-bootstrap', async () => {
    db.users.push(
      { id: 'sys', firstName: 'System', email: 'sys@t.com', user_type: 999, roleId: null, role: null, createdAt: new Date() },
      { id: 'u-admin', firstName: 'Leo', email: 'leo@t.com', user_type: 1, roleId: null, role: null, createdAt: new Date() },
    );
    const res = makeRes();
    await listStaffUsers(makeReq(), res);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const ids = body.data.users.map((u: { id: string }) => u.id);
    expect(ids).not.toContain('sys');
    expect(ids).toContain('u-admin');
  });

  it('returns user_type but no userTypeLabel (roles-only UI)', async () => {
    db.users.push({ id: 'u-admin', firstName: 'Leo', email: 'leo@t.com', user_type: 1, roleId: 'r1', role: { id: 'r1', roleName: 'Admin' }, createdAt: new Date() });
    const res = makeRes();
    await listStaffUsers(makeReq(), res);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const user = body.data.users[0];
    expect(user.user_type).toBe(1);
    expect(user.userTypeLabel).toBeUndefined();
    expect(user.roleName).toBe('Admin');
  });

  it('respects optional ?user_type=3 filter', async () => {
    const res = makeRes();
    await listStaffUsers(makeReq({ query: { user_type: '3' } }), res);
    const { prisma } = await import('../../lib/prisma');
    const countCall = (prisma.user.count as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(countCall?.where?.user_type).toBe(3);
    expect(countCall?.where?.NOT).toEqual({ user_type: 999 });
  });

  it('without user_type filter does NOT narrow to type 3', async () => {
    const res = makeRes();
    await listStaffUsers(makeReq({ query: {} }), res);
    const { prisma } = await import('../../lib/prisma');
    const countCall = (prisma.user.count as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(countCall?.where?.user_type).toBeUndefined();
  });

  it('returns pagination with totalPages', async () => {
    for (let i = 0; i < 25; i++) {
      db.users.push({ id: `u-${i}`, firstName: `User${i}`, email: `u${i}@t.com`, user_type: 3, roleId: null, role: null, createdAt: new Date() });
    }
    const res = makeRes();
    await listStaffUsers(makeReq({ query: { page: '1', limit: '10' } }), res);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.data.pagination.totalPages).toBe(3);
    expect(body.data.pagination.total).toBe(25);
  });

  it('ignores NaN ?user_type param (e.g. ?user_type=abc) and returns all non-999 users', async () => {
    db.users.push(
      { id: 'u-admin', firstName: 'Leo', email: 'leo@t.com', user_type: 1, roleId: null, role: null, createdAt: new Date() },
      { id: 'u-staff', firstName: 'Bob', email: 'bob@t.com', user_type: 3, roleId: null, role: null, createdAt: new Date() },
    );
    const res = makeRes();
    await listStaffUsers(makeReq({ query: { user_type: 'abc' } }), res);
    const { prisma } = await import('../../lib/prisma');
    const countCall = (prisma.user.count as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    // NaN filter must be dropped — user_type should be undefined in the where clause
    expect(countCall?.where?.user_type).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deleteStaffUser – admin guard
// ---------------------------------------------------------------------------
describe('deleteStaffUser', () => {
  beforeEach(() => { db.users = []; });

  it('allows deleting user_type 1 when not holding the Owner role (user_type no longer guards)', async () => {
    // user_type 1 with no roleId → isLastOwner returns false → deletion proceeds
    db.users.push({ id: 'admin-id', firstName: 'Admin', email: 'a@t.com', user_type: 1, roleId: null, role: null, createdAt: new Date() });
    const res = makeRes();
    await deleteStaffUser(makeReq({ params: { id: 'admin-id' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('allows deleting a non-admin user (type 3)', async () => {
    db.users.push({ id: 'staff-id', firstName: 'Staff', email: 's@t.com', user_type: 3, roleId: null, role: null, createdAt: new Date() });
    const res = makeRes();
    await deleteStaffUser(makeReq({ params: { id: 'staff-id' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when user not found', async () => {
    const res = makeRes();
    await deleteStaffUser(makeReq({ params: { id: 'ghost-id' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ---------------------------------------------------------------------------
// updateStaffUser – admin guard
// ---------------------------------------------------------------------------
describe('updateStaffUser', () => {
  beforeEach(() => { db.users = []; db.roles = []; });

  it('allows editing user_type 1 when not the last Owner (user_type no longer guards)', async () => {
    // user_type 1 with no roleId → not an Owner → update proceeds
    db.users.push({ id: 'admin-id', firstName: 'Admin', email: 'a@t.com', user_type: 1, roleId: null, role: null, createdAt: new Date() });
    const res = makeRes();
    await updateStaffUser(makeReq({ params: { id: 'admin-id' }, body: { firstName: 'NewName' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('allows updating a non-admin user (type 3)', async () => {
    db.roles.push({ id: 'r-staff', roleName: 'Staff', deletedAt: null });
    db.users.push({ id: 'staff-id', firstName: 'Staff', email: 's@t.com', user_type: 3, roleId: 'r-staff', role: { id: 'r-staff', roleName: 'Staff' }, createdAt: new Date() });
    const res = makeRes();
    await updateStaffUser(makeReq({ params: { id: 'staff-id' }, body: { firstName: 'Updated' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when user not found', async () => {
    const res = makeRes();
    await updateStaffUser(makeReq({ params: { id: 'ghost-id' }, body: { firstName: 'X' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ---------------------------------------------------------------------------
// register – assigns Admin role
// ---------------------------------------------------------------------------
describe('register', () => {
  beforeEach(() => {
    db.users = [];
    db.roles = [];
    ensureRoleShouldThrow = false;
  });

  it('creates user with Admin roleId when no admin exists', async () => {
    const res = makeRes();
    await register(makeReq({
      body: { firstName: 'Leo', lastName: 'P', email: 'leo@test.com', password: 'Password1!' },
    }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    // Owner role must have been created (register now assigns the Owner role)
    expect(db.roles.some((r) => r.roleName === 'Owner')).toBe(true);
    // The created user should have a roleId
    const created = db.users.find((u) => u.email === 'leo@test.com');
    expect(created?.roleId).toBeTruthy();
    expect(created?.user_type).toBe(1);
  });

  it('still creates user with roleId null when ensureRole throws (resilient)', async () => {
    ensureRoleShouldThrow = true;
    const res = makeRes();
    await register(makeReq({
      body: { firstName: 'Leo', lastName: 'P', email: 'resilient@test.com', password: 'Password1!' },
    }), res);

    // Registration must succeed even when role lookup fails
    expect(res.status).toHaveBeenCalledWith(201);
    const created = db.users.find((u) => u.email === 'resilient@test.com');
    expect(created).toBeDefined();
    expect(created?.user_type).toBe(1);
    // roleId should be null/undefined when ensureRole threw
    expect(created?.roleId ?? null).toBeNull();
  });

  it('returns 403 if admin already exists', async () => {
    db.users.push({ id: 'existing-admin', firstName: 'Old', email: 'old@t.com', user_type: 1, roleId: null, role: null, createdAt: new Date() });
    const res = makeRes();
    await register(makeReq({
      body: { firstName: 'Leo', lastName: 'P', email: 'leo@test.com', password: 'Password1!' },
    }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
