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
type RoleRow = { id: string; roleName: string; deletedAt: null; tenantId?: string };

type TenantRow = { id: string; name: string; slug: string };
type MembershipRow = {
  id?: string; userId: string; tenantId: string; roleId: string | null;
  isOwner: boolean; status?: string;
};

const db = {
  users: [] as UserRow[],
  roles: [] as RoleRow[],
  tenants: [] as TenantRow[],
  memberships: [] as MembershipRow[],
};

/** Mirrors the controller's tenant scope: membership decides who is "in" a workspace. */
function scopedUsers(where: {
  user_type?: number;
  AND?: Array<{ memberships?: { some?: { tenantId?: string } } }>;
}): UserRow[] {
  let result = db.users.filter((u) => u.user_type !== 999);
  const tenantId = where.AND?.[0]?.memberships?.some?.tenantId;
  if (tenantId !== undefined) {
    result = result.filter((u) => db.memberships.some((m) => m.userId === u.id && m.tenantId === tenantId));
  }
  if (where.user_type !== undefined) result = result.filter((u) => u.user_type === where.user_type);
  return result;
}

// Control flag to simulate role provisioning failing mid-transaction
let ensureRoleShouldThrow = false;

// ---------------------------------------------------------------------------
// Mock ../../lib/prisma (used by userController + authController)
// ---------------------------------------------------------------------------
vi.mock('../../lib/prisma', () => {
  const client: Record<string, unknown> = {
    // register wraps provisioning in one transaction. The fake runs the
    // callback against this same client and, on throw, rolls the in-memory
    // store back to the snapshot taken before the callback ran — which is what
    // lets the "no half-provisioned tenant" test below mean anything.
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = {
        users: [...db.users], roles: [...db.roles],
        tenants: [...db.tenants], memberships: [...db.memberships],
      };
      try {
        return await fn(client);
      } catch (err) {
        db.users = snapshot.users;
        db.roles = snapshot.roles;
        db.tenants = snapshot.tenants;
        db.memberships = snapshot.memberships;
        throw err;
      }
    }),
    tenant: {
      findUnique: vi.fn(async (args: { where: { slug?: string } }) =>
        db.tenants.find((t) => t.slug === args.where.slug) ?? null),
      create: vi.fn(async (args: { data: TenantRow }) => {
        db.tenants.push(args.data);
        return args.data;
      }),
      // register/createTenant consult this for the MAX_TENANTS ceiling.
      count: vi.fn(async () => db.tenants.length),
      findMany: vi.fn(async () => db.tenants),
    },
    tenantMembership: {
      create: vi.fn(async (args: { data: MembershipRow }) => {
        const row = { id: `mem-${db.memberships.length + 1}`, status: 'ACTIVE', ...args.data };
        db.memberships.push(row);
        return row;
      }),
      findUnique: vi.fn(async (args: { where: { userId_tenantId?: { userId: string; tenantId: string } } }) => {
        const k = args.where.userId_tenantId;
        if (!k) return null;
        return db.memberships.find((m) => m.userId === k.userId && m.tenantId === k.tenantId) ?? null;
      }),
      findFirst: vi.fn(async (args: { where: { userId?: string; tenantId?: string } }) =>
        db.memberships.find(
          (m) =>
            (args.where.userId === undefined || m.userId === args.where.userId) &&
            (args.where.tenantId === undefined || m.tenantId === args.where.tenantId),
        ) ?? null),
      findMany: vi.fn(async (args: { where: { userId?: string; tenantId?: string } }) =>
        db.memberships
          .filter(
            (m) =>
              (args.where?.userId === undefined || m.userId === args.where.userId) &&
              (args.where?.tenantId === undefined || m.tenantId === args.where.tenantId),
          )
          .map((m) => ({
            ...m,
            tenant: db.tenants.find((t) => t.id === m.tenantId) ?? { name: 'T', slug: 't' },
            role: db.roles.find((r) => r.id === m.roleId) ?? null,
          }))),
      count: vi.fn(async (args: { where: { tenantId?: string; userId?: string; isOwner?: boolean } }) =>
        db.memberships.filter(
          (m) =>
            (args.where.tenantId === undefined || m.tenantId === args.where.tenantId) &&
            (args.where.userId === undefined || m.userId === args.where.userId) &&
            (args.where.isOwner === undefined || m.isOwner === args.where.isOwner),
        ).length),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = db.memberships.find((m) => m.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row ?? {};
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const i = db.memberships.findIndex((m) => m.id === args.where.id);
        if (i !== -1) db.memberships.splice(i, 1);
        return {};
      }),
      upsert: vi.fn(async (args: { where: { userId_tenantId: { userId: string; tenantId: string } }; create: MembershipRow }) => {
        const k = args.where.userId_tenantId;
        const found = db.memberships.find((m) => m.userId === k.userId && m.tenantId === k.tenantId);
        if (found) return found;
        const row = { id: `mem-${db.memberships.length + 1}`, status: 'ACTIVE', ...args.create };
        db.memberships.push(row);
        return row;
      }),
    },
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
      findMany: vi.fn(async (args: { where: { NOT?: { user_type: number }; user_type?: number; AND?: Array<{ memberships?: { some?: { tenantId?: string } } }> }; skip?: number; take?: number }) => {
        const result = scopedUsers(args.where);
        const skip = args.skip ?? 0;
        const take = args.take ?? result.length;
        // The controller reads the role through the membership, not User.role.
        return result.slice(skip, skip + take).map((u) => ({
          ...u,
          memberships: db.memberships
            .filter((m) => m.userId === u.id)
            .map((m) => ({ role: db.roles.find((r) => r.id === m.roleId) ?? null })),
        }));
      }),
      count: vi.fn(async (args: { where: { NOT?: { user_type: number }; user_type?: number; AND?: Array<{ memberships?: { some?: { tenantId?: string } } }> } }) =>
        scopedUsers(args.where).length),
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
      findFirst: vi.fn(async (args: { where: { id?: string; roleName?: { equals?: string }; deletedAt?: null } }) => {
        if (args.where.id) {
          return db.roles.find((r) => r.id === args.where.id && r.deletedAt === null) ?? null;
        }
        const name = args.where.roleName?.equals?.toLowerCase();
        return db.roles.find((r) => r.roleName.toLowerCase() === name && r.deletedAt === null) ?? null;
      }),
      findUnique: vi.fn(async (args: { where: { id?: string } }) => {
        if (args.where.id) return db.roles.find((r) => r.id === args.where.id) ?? null;
        return null;
      }),
    },
  };
  // authController deliberately uses prismaUnscoped for the reads that cannot
  // have a tenant yet (find a user by email, list every workspace they belong
  // to). Pointing both names at the same fake keeps the store single-sourced.
  return { prisma: client, prismaUnscoped: client };
});

// register provisions the new tenant's role set through seedRolesForTenant.
vi.mock('../../prisma/seedRoles', () => ({
  seedRolesForTenant: vi.fn(async () => ({
    created: 0, backfilled: 0, adminPermsGranted: 0, ownerAssigned: 0, roleIds: {},
  })),
}));

// ...and stocks the workspace's Units/Currencies/EmailTemplates through
// seedTenantDefaults (P4). Both run inside the registration transaction, so
// a failure here would fail the whole signup — which is why they are mocked
// out rather than left to hit the fake client.
vi.mock('../../prisma/seedTenant', () => ({
  seedTenantDefaults: vi.fn(async () => ({ units: 0, currencies: 0, emailTemplates: 0 })),
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
  requireTenantId: vi.fn(() => 'test-tenant-id'),
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

/**
 * Put a user in the test workspace. Seeding db.users alone is no longer enough:
 * listStaffUsers scopes through TenantMembership, and update/delete resolve the
 * target through it, so a user without one correctly reads as "not in this
 * company".
 */
function join(userId: string, over: Partial<MembershipRow> = {}): void {
  db.memberships.push({
    id: `mem-${db.memberships.length + 1}`,
    userId,
    tenantId: 'test-tenant-id', // matches the requireTenantId mock
    roleId: null,
    isOwner: false,
    status: 'ACTIVE',
    ...over,
  });
}

// ---------------------------------------------------------------------------
// listStaffUsers
// ---------------------------------------------------------------------------
describe('listStaffUsers', () => {
  beforeEach(() => { db.users = []; db.roles = []; db.memberships = []; });

  it('includes type-1 (admin) and type-3 (staff) users', async () => {
    db.users.push(
      { id: 'u-admin', firstName: 'Leo', email: 'leo@t.com', user_type: 1, roleId: 'r1', role: { id: 'r1', roleName: 'Admin' }, createdAt: new Date() },
      { id: 'u-staff', firstName: 'Bob', email: 'bob@t.com', user_type: 3, roleId: 'r2', role: { id: 'r2', roleName: 'Staff' }, createdAt: new Date() },
    );
    join('u-admin', { roleId: 'r1' });
    join('u-staff', { roleId: 'r2' });
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
    join('sys');
    join('u-admin');
    const res = makeRes();
    await listStaffUsers(makeReq(), res);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const ids = body.data.users.map((u: { id: string }) => u.id);
    expect(ids).not.toContain('sys');
    expect(ids).toContain('u-admin');
  });

  it('returns user_type but no userTypeLabel (roles-only UI)', async () => {
    db.roles.push({ id: 'r1', roleName: 'Admin', deletedAt: null });
    db.users.push({ id: 'u-admin', firstName: 'Leo', email: 'leo@t.com', user_type: 1, roleId: 'r1', role: { id: 'r1', roleName: 'Admin' }, createdAt: new Date() });
    join('u-admin', { roleId: 'r1' });
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
      join(`u-${i}`);
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
  beforeEach(() => { db.users = []; db.memberships = []; });

  it('allows deleting user_type 1 when not holding the Owner role (user_type no longer guards)', async () => {
    // user_type 1 with no roleId → isLastOwner returns false → deletion proceeds
    db.users.push({ id: 'admin-id', firstName: 'Admin', email: 'a@t.com', user_type: 1, roleId: null, role: null, createdAt: new Date() });
    join('admin-id'); // a member, but not flagged isOwner
    const res = makeRes();
    await deleteStaffUser(makeReq({ params: { id: 'admin-id' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('allows deleting a non-admin user (type 3)', async () => {
    db.users.push({ id: 'staff-id', firstName: 'Staff', email: 's@t.com', user_type: 3, roleId: null, role: null, createdAt: new Date() });
    join('staff-id');
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
  beforeEach(() => { db.users = []; db.roles = []; db.memberships = []; });

  it('allows editing user_type 1 when not the last Owner (user_type no longer guards)', async () => {
    // user_type 1 with no roleId → not an Owner → update proceeds
    db.users.push({ id: 'admin-id', firstName: 'Admin', email: 'a@t.com', user_type: 1, roleId: null, role: null, createdAt: new Date() });
    join('admin-id');
    const res = makeRes();
    await updateStaffUser(makeReq({ params: { id: 'admin-id' }, body: { firstName: 'NewName' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('allows updating a non-admin user (type 3)', async () => {
    db.roles.push({ id: 'r-staff', roleName: 'Staff', deletedAt: null });
    db.users.push({ id: 'staff-id', firstName: 'Staff', email: 's@t.com', user_type: 3, roleId: 'r-staff', role: { id: 'r-staff', roleName: 'Staff' }, createdAt: new Date() });
    join('staff-id', { roleId: 'r-staff' });
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
    db.tenants = [];
    db.memberships = [];
    ensureRoleShouldThrow = false;
  });

  it('gives the signup owner the Owner role, on their membership', async () => {
    const res = makeRes();
    await register(makeReq({
      body: { firstName: 'Leo', lastName: 'P', email: 'leo@test.com', password: 'Password1!' },
    }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    // Owner role must have been created (register provisions the role set)
    const ownerRole = db.roles.find((r) => r.roleName === 'Owner');
    expect(ownerRole).toBeDefined();

    const created = db.users.find((u) => u.email === 'leo@test.com');
    expect(created?.user_type).toBe(1);

    // The role is carried by the MEMBERSHIP. P9 dropped User.roleId, because a
    // person holds a different role in each workspace they belong to.
    const membership = db.memberships.find((m) => m.userId === created?.id);
    expect(membership).toBeDefined();
    expect(membership?.roleId).toBe(ownerRole?.id);
    expect(membership?.isOwner).toBe(true);
  });

  it('provisions a workspace: tenant + owner membership, not just a user', async () => {
    const res = makeRes();
    await register(makeReq({
      body: {
        firstName: 'Leo', lastName: 'P', email: 'leo@test.com',
        password: 'Password1!', companyName: 'Acme Books',
      },
    }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(db.tenants).toHaveLength(1);
    expect(db.tenants[0].name).toBe('Acme Books');
    expect(db.tenants[0].slug).toBe('acme-books');

    const user = db.users.find((u) => u.email === 'leo@test.com')!;
    // INVARIANT (P1-P4): the tenant reuses its owner's user id, so the existing
    // `userId`-as-tenant columns and already-issued JWTs keep lining up.
    expect(db.tenants[0].id).toBe(user.id);

    expect(db.memberships).toHaveLength(1);
    expect(db.memberships[0]).toMatchObject({
      userId: user.id, tenantId: db.tenants[0].id, isOwner: true,
    });
    expect(db.memberships[0].roleId).toBeTruthy();
  });

  it('falls back to a default workspace name when none is supplied', async () => {
    const res = makeRes();
    await register(makeReq({
      body: { firstName: 'Leo', lastName: 'P', email: 'leo@test.com', password: 'Password1!' },
    }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(db.tenants[0].name).toBe('Default Workspace');
  });

  it('rolls the whole workspace back when role provisioning fails', async () => {
    // Provisioning is deliberately NOT best-effort any more: an owner with no
    // Owner role can see nothing, and no later backfill can invent the missing
    // membership. Better to fail the signup outright than to strand a user in a
    // half-built workspace they can never enter.
    ensureRoleShouldThrow = true;
    const res = makeRes();
    await register(makeReq({
      body: { firstName: 'Leo', lastName: 'P', email: 'broken@test.com', password: 'Password1!' },
    }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(db.users.find((u) => u.email === 'broken@test.com')).toBeUndefined();
    expect(db.tenants).toHaveLength(0);
    expect(db.memberships).toHaveLength(0);
  });

  it('lets a SECOND company sign up — the single-admin cap is gone', async () => {
    // This is the change the whole conversion exists for. The old guard
    // ("Admin account already exists. Only one admin is allowed.") is what made
    // an install permanently single-tenant.
    db.users.push({ id: 'existing-admin', firstName: 'Old', email: 'old@t.com', user_type: 1, roleId: null, role: null, createdAt: new Date() });
    db.tenants.push({ id: 'existing-tenant', name: 'Acme', slug: 'acme' });
    const res = makeRes();
    await register(makeReq({
      body: { firstName: 'Leo', lastName: 'P', email: 'leo@test.com', password: 'Password1!', companyName: 'Globex' },
    }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(db.tenants).toHaveLength(2);
    expect(db.tenants.map((t) => t.slug)).toEqual(['acme', 'globex']);
  });

  it('still refuses a duplicate email — one identity per person, platform-wide', async () => {
    db.users.push({ id: 'existing', firstName: 'Old', email: 'taken@t.com', user_type: 1, roleId: null, role: null, createdAt: new Date() });
    const res = makeRes();
    await register(makeReq({
      body: { firstName: 'Leo', lastName: 'P', email: 'taken@t.com', password: 'Password1!' },
    }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('honours SIGNUPS_ENABLED=false', async () => {
    process.env.SIGNUPS_ENABLED = 'false';
    try {
      const res = makeRes();
      await register(makeReq({
        body: { firstName: 'Leo', lastName: 'P', email: 'leo@test.com', password: 'Password1!' },
      }), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(db.tenants).toHaveLength(0);
    } finally {
      delete process.env.SIGNUPS_ENABLED;
    }
  });

  it('honours MAX_TENANTS as a hard ceiling', async () => {
    // The escape hatch for a self-hosted customer who wants the old
    // one-company behaviour without disabling the very first signup.
    db.tenants.push({ id: 't1', name: 'Acme', slug: 'acme' });
    process.env.MAX_TENANTS = '1';
    try {
      const res = makeRes();
      await register(makeReq({
        body: { firstName: 'Leo', lastName: 'P', email: 'leo@test.com', password: 'Password1!' },
      }), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(db.tenants).toHaveLength(1);
    } finally {
      delete process.env.MAX_TENANTS;
    }
  });
});
