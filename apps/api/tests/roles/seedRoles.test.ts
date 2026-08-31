/**
 * Tests for:
 *  - seedRolesForTenant idempotency (run twice → 6 roles, no duplicates)
 *  - membership backfill assigns the correct role by user_type
 *  - seedRoles fans out over every tenant, keeping each tenant's roles separate
 *  - DEFAULT_ROLE_BY_USER_TYPE map completeness
 *  - ensureRole from lib/defaultRoles (shared client), which is tenant-scoped
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared in-memory store for the lib/prisma mock (used by ensureRole's default
// client). Always read by reference from closures.
// ---------------------------------------------------------------------------
const db = {
  roles: [] as Array<{ id: string; tenantId: string; roleName: string; deletedAt: null }>,
};

// ---------------------------------------------------------------------------
// Mock lib/prisma so lib/defaultRoles (which imports sharedPrisma) doesn't
// try to build a real PrismaClient. The shared client is only used as the
// default parameter for ensureRole; inside the seeder it is always overridden
// by the seeder's own client (passed explicitly).
// ---------------------------------------------------------------------------
vi.mock('../../lib/prisma', () => ({
  prisma: {
    role: {
      findFirst: vi.fn(async (args: { where: { tenantId?: string; roleName?: { equals?: string } } }) => {
        const name = args.where.roleName?.equals?.toLowerCase();
        return (
          db.roles.find(
            (r) =>
              r.roleName.toLowerCase() === name &&
              r.tenantId === args.where.tenantId &&
              r.deletedAt === null,
          ) ?? null
        );
      }),
      create: vi.fn(async (args: { data: { tenantId: string; roleName: string } }) => {
        const role = { id: `role-${db.roles.length + 1}`, deletedAt: null as null, ...args.data };
        db.roles.push(role);
        return role;
      }),
    },
  },
}));

// ---------------------------------------------------------------------------
// vi.mock factory for @prisma/client – provides the seeder's own PrismaClient.
// Must be fully self-contained (vitest hoists it).
// ---------------------------------------------------------------------------
vi.mock('@prisma/client', async () => {
  interface Role { id: string; tenantId: string; roleName: string; deletedAt: null }
  interface Perm { roleId: string; tenantId: string; moduleId: string; allowAll: boolean; deletedAt: null }
  interface Membership { userId: string; tenantId: string; roleId: string | null; isOwner: boolean }
  interface User { id: string; user_type: number; roleId: string | null }

  const store = {
    tenants: [] as Array<{ id: string }>,
    roles: [] as Role[],
    perms: [] as Perm[],
    memberships: [] as Membership[],
    users: [] as User[],
    modules: [] as Array<{ id: string }>,
  };

  const userOf = (m: Membership) => store.users.find((u) => u.id === m.userId);

  const PrismaClient = vi.fn(() => ({
    tenant: {
      findMany: vi.fn(async () => store.tenants.map((t) => ({ id: t.id }))),
    },
    role: {
      findFirst: vi.fn(async (args: { where: { tenantId?: string; roleName?: { equals?: string } } }) => {
        const name = args.where.roleName?.equals?.toLowerCase();
        return (
          store.roles.find(
            (r) =>
              r.roleName.toLowerCase() === name &&
              r.tenantId === args.where.tenantId &&
              r.deletedAt === null,
          ) ?? null
        );
      }),
      create: vi.fn(async (args: { data: { tenantId: string; roleName: string } }) => {
        const role = { id: `role-${store.roles.length + 1}`, deletedAt: null as null, ...args.data };
        store.roles.push(role);
        return role;
      }),
    },
    module: {
      findMany: vi.fn(async () => store.modules.map((m) => ({ id: m.id }))),
    },
    permission: {
      count: vi.fn(async (args: { where: { roleId: string } }) =>
        store.perms.filter((p) => p.roleId === args.where.roleId).length),
      findMany: vi.fn(async (args: { where: { roleId: string } }) =>
        store.perms.filter((p) => p.roleId === args.where.roleId)),
      createMany: vi.fn(async (args: { data: Perm[] }) => {
        store.perms.push(...args.data.map((d) => ({ ...d, deletedAt: null as null })));
        return { count: args.data.length };
      }),
      updateMany: vi.fn(async (args: { where: { roleId: string }; data: Record<string, unknown> }) => {
        let count = 0;
        for (const p of store.perms) {
          if (p.roleId !== args.where.roleId) continue;
          Object.assign(p, args.data);
          count += 1;
        }
        return { count };
      }),
    },
    tenantMembership: {
      updateMany: vi.fn(async (args: {
        where: {
          tenantId: string;
          roleId?: null;
          isOwner?: boolean;
          user?: { user_type?: number };
          NOT?: { roleId?: string };
        };
        data: { roleId: string };
      }) => {
        let count = 0;
        for (const m of store.memberships) {
          const w = args.where;
          if (m.tenantId !== w.tenantId) continue;
          if (w.roleId === null && m.roleId !== null) continue;
          if (w.isOwner !== undefined && m.isOwner !== w.isOwner) continue;
          if (w.user?.user_type !== undefined && userOf(m)?.user_type !== w.user.user_type) continue;
          if (w.NOT?.roleId !== undefined && m.roleId === w.NOT.roleId) continue;
          m.roleId = args.data.roleId;
          count += 1;
        }
        return { count };
      }),
      findMany: vi.fn(async (args: { where: { tenantId: string; isOwner?: boolean } }) =>
        store.memberships
          .filter((m) => m.tenantId === args.where.tenantId
            && (args.where.isOwner === undefined || m.isOwner === args.where.isOwner))
          .map((m) => ({ userId: m.userId }))),
    },
    user: {
      updateMany: vi.fn(async (args: {
        where: { id?: { in: string[] }; NOT?: { roleId?: string } };
        data: { roleId: string };
      }) => {
        let count = 0;
        for (const u of store.users) {
          if (args.where.id?.in && !args.where.id.in.includes(u.id)) continue;
          if (args.where.NOT?.roleId !== undefined && u.roleId === args.where.NOT.roleId) continue;
          u.roleId = args.data.roleId;
          count += 1;
        }
        return { count };
      }),
    },
    $disconnect: vi.fn(async () => {}),
  }));

  return { PrismaClient, __store: store };
});

// Import AFTER mock
import { DEFAULT_ROLE_BY_USER_TYPE } from '../../lib/defaultRoles';
import { seedRoles, seedRolesForTenant, ensureRole } from '../../prisma/seedRoles';

interface Store {
  tenants: Array<{ id: string }>;
  roles: Array<{ id: string; tenantId: string; roleName: string; deletedAt: null }>;
  perms: Array<{ roleId: string; tenantId: string; moduleId: string; allowAll: boolean }>;
  memberships: Array<{ userId: string; tenantId: string; roleId: string | null; isOwner: boolean }>;
  users: Array<{ id: string; user_type: number; roleId: string | null }>;
  modules: Array<{ id: string }>;
}

async function getStore(): Promise<Store> {
  const mod = (await import('@prisma/client')) as unknown as { __store: Store };
  return mod.__store;
}

async function reset(): Promise<Store> {
  const store = await getStore();
  store.tenants = [];
  store.roles = [];
  store.perms = [];
  store.memberships = [];
  store.users = [];
  store.modules = [];
  return store;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DEFAULT_ROLE_BY_USER_TYPE', () => {
  it('contains exactly the 5 expected roles', () => {
    expect(DEFAULT_ROLE_BY_USER_TYPE[1]).toBe('Admin');
    expect(DEFAULT_ROLE_BY_USER_TYPE[2]).toBe('Vendor');
    expect(DEFAULT_ROLE_BY_USER_TYPE[3]).toBe('Staff');
    expect(DEFAULT_ROLE_BY_USER_TYPE[4]).toBe('Maintainer');
    expect(DEFAULT_ROLE_BY_USER_TYPE[5]).toBe('Supplier');
    expect(Object.keys(DEFAULT_ROLE_BY_USER_TYPE)).toHaveLength(5);
  });
});

describe('seedRolesForTenant', () => {
  beforeEach(reset);

  it('creates exactly 6 roles on first run (5 defaults + Owner)', async () => {
    const store = await getStore();
    const result = await seedRolesForTenant('t1');
    expect(result.created).toBe(5);
    expect(store.roles).toHaveLength(6);
    const names = store.roles.map((r) => r.roleName);
    for (const n of ['Admin', 'Vendor', 'Staff', 'Maintainer', 'Supplier', 'Owner']) {
      expect(names).toContain(n);
    }
  });

  it('stamps every role it creates with the tenant', async () => {
    const store = await getStore();
    await seedRolesForTenant('t1');
    expect(store.roles.every((r) => r.tenantId === 't1')).toBe(true);
  });

  it('is idempotent — second run creates 0 new roles', async () => {
    const store = await getStore();
    await seedRolesForTenant('t1');
    const second = await seedRolesForTenant('t1');
    expect(second.created).toBe(0);
    expect(store.roles).toHaveLength(6);
  });

  it('backfills memberships that have no roleId, by user_type', async () => {
    const store = await reset();
    store.users.push({ id: 'u-admin', user_type: 1, roleId: null });
    store.users.push({ id: 'u-staff', user_type: 3, roleId: null });
    store.users.push({ id: 'u-already', user_type: 3, roleId: null });
    store.memberships.push({ userId: 'u-admin', tenantId: 't1', roleId: null, isOwner: false });
    store.memberships.push({ userId: 'u-staff', tenantId: 't1', roleId: null, isOwner: false });
    store.memberships.push({ userId: 'u-already', tenantId: 't1', roleId: 'existing-role', isOwner: false });

    const result = await seedRolesForTenant('t1');

    expect(result.backfilled).toBe(2);
    const byUser = (id: string) => store.memberships.find((m) => m.userId === id)!;
    expect(byUser('u-admin').roleId).not.toBeNull();
    expect(byUser('u-staff').roleId).not.toBeNull();
    expect(byUser('u-already').roleId).toBe('existing-role');
  });

  it('does not touch memberships belonging to another tenant', async () => {
    const store = await reset();
    store.users.push({ id: 'u-other', user_type: 3, roleId: null });
    store.memberships.push({ userId: 'u-other', tenantId: 't2', roleId: null, isOwner: false });

    const result = await seedRolesForTenant('t1');

    expect(result.backfilled).toBe(0);
    expect(store.memberships.find((m) => m.userId === 'u-other')!.roleId).toBeNull();
  });

  it('assigns the Owner role to the owner membership', async () => {
    const store = await reset();
    store.users.push({ id: 'u1', user_type: 1, roleId: null });
    store.memberships.push({ userId: 'u1', tenantId: 't1', roleId: null, isOwner: true });

    const result = await seedRolesForTenant('t1');

    const ownerRole = store.roles.find((r) => r.roleName === 'Owner');
    expect(ownerRole).toBeDefined();
    expect(store.memberships[0].roleId).toBe(ownerRole!.id);
    expect(result.ownerAssigned).toBeGreaterThanOrEqual(1);
    // The mirror onto User.roleId that used to be asserted here went with the
    // column (P9). The membership above is the whole assignment.
  });

  it('does not backfill sys-bootstrap (user_type 999 is not in the map)', async () => {
    const store = await reset();
    store.users.push({ id: 'sys-bootstrap', user_type: 999, roleId: null });
    store.memberships.push({ userId: 'sys-bootstrap', tenantId: 't1', roleId: null, isOwner: false });

    const result = await seedRolesForTenant('t1');

    expect(store.memberships[0].roleId).toBeNull();
    expect(result.roleIds[999]).toBeUndefined();
  });
});

describe('seedRoles (boot fan-out)', () => {
  beforeEach(reset);

  it('gives each tenant its own separate role set', async () => {
    const store = await reset();
    store.tenants.push({ id: 't1' }, { id: 't2' });

    const result = await seedRoles();

    expect(result.created).toBe(10); // 5 defaults x 2 tenants
    expect(store.roles).toHaveLength(12); // + Owner each
    expect(store.roles.filter((r) => r.tenantId === 't1')).toHaveLength(6);
    expect(store.roles.filter((r) => r.tenantId === 't2')).toHaveLength(6);
    // Same names, different rows — the whole point of per-tenant roles.
    const ownerRoles = store.roles.filter((r) => r.roleName === 'Owner');
    expect(ownerRoles).toHaveLength(2);
    expect(ownerRoles[0].id).not.toBe(ownerRoles[1].id);
  });

  it('is idempotent across a boot restart', async () => {
    const store = await reset();
    store.tenants.push({ id: 't1' }, { id: 't2' });
    await seedRoles();
    const second = await seedRoles();
    expect(second.created).toBe(0);
    expect(store.roles).toHaveLength(12);
  });

  it('grants every tenant Owner perms on a module added by a later release', async () => {
    // This is the regression the boot-time reconciliation exists to prevent:
    // without it, a release that adds a Module leaves every existing tenant's
    // Owner with no Permission row for it and requirePermission() 403s them.
    const store = await reset();
    store.tenants.push({ id: 't1' }, { id: 't2' });
    store.modules.push({ id: 'm-existing' });
    await seedRoles();

    store.modules.push({ id: 'm-new-in-this-release' });
    await seedRoles();

    for (const tenantId of ['t1', 't2']) {
      const owner = store.roles.find((r) => r.tenantId === tenantId && r.roleName === 'Owner')!;
      const perms = store.perms.filter((p) => p.roleId === owner.id);
      expect(perms.map((p) => p.moduleId).sort()).toEqual(['m-existing', 'm-new-in-this-release']);
      expect(perms.every((p) => p.allowAll === true)).toBe(true);
    }
  });

  it('does no work when there are no tenants', async () => {
    const store = await reset();
    const result = await seedRoles();
    expect(result.created).toBe(0);
    expect(store.roles).toHaveLength(0);
  });
});

describe('ensureRole (re-exported from lib/defaultRoles via prisma/seedRoles)', () => {
  beforeEach(() => {
    db.roles = [];
  });

  it('creates the role on first call using the default shared client', async () => {
    const id = await ensureRole('Admin', 't1');
    expect(id).toBeTruthy();
    expect(db.roles).toHaveLength(1);
    expect(db.roles[0].roleName).toBe('Admin');
    expect(db.roles[0].tenantId).toBe('t1');
  });

  it('returns the existing id without creating a duplicate on second call', async () => {
    const id1 = await ensureRole('Admin', 't1');
    const id2 = await ensureRole('Admin', 't1');
    expect(id1).toBe(id2);
    expect(db.roles).toHaveLength(1);
  });

  it('is case-insensitive: "admin" finds existing "Admin"', async () => {
    const id1 = await ensureRole('Admin', 't1');
    const id2 = await ensureRole('admin', 't1');
    expect(id1).toBe(id2);
    expect(db.roles).toHaveLength(1);
  });

  it('is tenant-scoped: the same role name in another tenant is a separate row', async () => {
    const id1 = await ensureRole('Admin', 't1');
    const id2 = await ensureRole('Admin', 't2');
    expect(id1).not.toBe(id2);
    expect(db.roles).toHaveLength(2);
  });

  it('refuses to create a role with no tenant rather than creating an orphan', async () => {
    await expect(ensureRole('Admin', '')).rejects.toThrow(/tenantId/);
    expect(db.roles).toHaveLength(0);
  });
});
