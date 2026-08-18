/**
 * Tests for:
 *  - seedRoles idempotency (run twice → 5 roles, no duplicates)
 *  - backfill assigns correct role by user_type
 *  - DEFAULT_ROLE_BY_USER_TYPE map completeness
 *  - ensureRole from lib/defaultRoles (shared client)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared in-memory store – always read by reference from closures.
// ---------------------------------------------------------------------------
const db = {
  roles: [] as Array<{ id: string; roleName: string; status: boolean; createdBy: string; deletedAt: null }>,
  users: [] as Array<{ id: string; user_type: number; roleId: string | null }>,
};

// ---------------------------------------------------------------------------
// Mock lib/prisma so lib/defaultRoles (which imports sharedPrisma) doesn't
// try to build a real PrismaClient. The shared client is only used as the
// default parameter for ensureRole; inside seedRoles it is always overridden
// by the seeder's own client (passed explicitly).
// ---------------------------------------------------------------------------
vi.mock('../../lib/prisma', () => ({
  prisma: {
    role: {
      findFirst: vi.fn(async (args: { where: { roleName?: { equals?: string }; deletedAt?: null } }) => {
        const name = args.where.roleName?.equals?.toLowerCase();
        return db.roles.find((r) => r.roleName.toLowerCase() === name && r.deletedAt === null) ?? null;
      }),
      create: vi.fn(async (args: { data: { roleName: string; status: boolean; createdBy: string } }) => {
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
  // `db` is declared in the outer module scope. Vitest hoists vi.mock() calls
  // but the factory runs lazily on first import — at that point `db` is already
  // initialised. We capture it here via closure.
  const store = {
    roles: [] as Array<{ id: string; roleName: string; status: boolean; createdBy: string; deletedAt: null }>,
    users: [] as Array<{ id: string; user_type: number; roleId: string | null }>,
  };

  // Expose store as a module export so tests can reset it.
  const PrismaClient = vi.fn(() => ({
    role: {
      findFirst: vi.fn(async (args: { where: { roleName?: { equals?: string }; deletedAt?: null } }) => {
        const name = args.where.roleName?.equals?.toLowerCase();
        return store.roles.find((r) => r.roleName.toLowerCase() === name && r.deletedAt === null) ?? null;
      }),
      create: vi.fn(async (args: { data: { roleName: string; status: boolean; createdBy: string } }) => {
        const role = { id: `role-${store.roles.length + 1}`, deletedAt: null as null, ...args.data };
        store.roles.push(role);
        return role;
      }),
    },
    module: {
      findMany: vi.fn(async () => []),
    },
    permission: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      createMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    user: {
      updateMany: vi.fn(async (args: { where: { user_type?: number; roleId?: null; NOT?: { roleId?: string } }; data: { roleId: string } }) => {
        let count = 0;
        for (const u of store.users) {
          if (args.where.user_type !== undefined && u.user_type !== args.where.user_type) continue;
          if (args.where.roleId === null && u.roleId !== null) continue;
          if (args.where.NOT?.roleId !== undefined && u.roleId === args.where.NOT.roleId) continue;
          u.roleId = args.data.roleId;
          count++;
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
import { seedRoles, ensureRole } from '../../prisma/seedRoles';

// Helper to get the internal store from the @prisma/client mock module
async function getStore() {
  const mod = await import('@prisma/client') as unknown as { __store: typeof db };
  return mod.__store;
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

describe('seedRoles', () => {
  beforeEach(async () => {
    const store = await getStore();
    store.roles = [];
    store.users = [];
  });

  it('creates exactly 6 roles on first run (5 defaults + Owner)', async () => {
    const result = await seedRoles();
    const store = await getStore();
    expect(result.created).toBe(5);
    expect(store.roles).toHaveLength(6);
    const names = store.roles.map((r) => r.roleName);
    expect(names).toContain('Admin');
    expect(names).toContain('Vendor');
    expect(names).toContain('Staff');
    expect(names).toContain('Maintainer');
    expect(names).toContain('Supplier');
    expect(names).toContain('Owner');
  });

  it('is idempotent — second run creates 0 new roles', async () => {
    await seedRoles(); // first run
    const second = await seedRoles(); // second run
    const store = await getStore();
    expect(second.created).toBe(0);
    expect(store.roles).toHaveLength(6);
  });

  it('backfills users with no roleId by user_type', async () => {
    const store = await getStore();
    store.users.push({ id: 'u-admin', user_type: 1, roleId: null });
    store.users.push({ id: 'u-staff', user_type: 3, roleId: null });
    store.users.push({ id: 'u-already', user_type: 3, roleId: 'existing-role' });

    const result = await seedRoles();

    expect(result.backfilled).toBe(2);
    expect(store.users.find((u) => u.id === 'u-admin')!.roleId).not.toBeNull();
    expect(store.users.find((u) => u.id === 'u-staff')!.roleId).not.toBeNull();
    expect(store.users.find((u) => u.id === 'u-already')!.roleId).toBe('existing-role');
  });

  it('assigns correct role id for each user_type', async () => {
    const store = await getStore();
    store.users.push({ id: 'u1', user_type: 1, roleId: null });
    store.users.push({ id: 'u2', user_type: 2, roleId: null });

    const result = await seedRoles();

    // user_type:1 gets Admin first (per-type backfill), then Owner (Owner-backfill overrides).
    // Final state is the Owner role id.
    const ownerRole = store.roles.find((r) => r.roleName === 'Owner');
    expect(ownerRole).toBeDefined();
    expect(store.users.find((u) => u.id === 'u1')!.roleId).toBe(ownerRole!.id);
    // user_type:2 keeps its default Vendor role id
    expect(store.users.find((u) => u.id === 'u2')!.roleId).toBe(result.roleIds[2]);
  });

  it('does not backfill sys-bootstrap (user_type 999 not in map)', async () => {
    const store = await getStore();
    store.users.push({ id: 'sys-bootstrap', user_type: 999, roleId: null });
    const result = await seedRoles();
    expect(store.users.find((u) => u.id === 'sys-bootstrap')!.roleId).toBeNull();
    expect(result.roleIds[999]).toBeUndefined();
  });
});

describe('ensureRole (re-exported from lib/defaultRoles via prisma/seedRoles)', () => {
  beforeEach(async () => {
    const store = await getStore();
    store.roles = [];
    // Also reset the lib/prisma mock's db state
    db.roles = [];
  });

  it('creates the role on first call using default shared client', async () => {
    // When called with no client arg, ensureRole uses lib/prisma (mocked above)
    const id = await ensureRole('Admin');
    expect(id).toBeTruthy();
    // The role should now be in db (the lib/prisma mock store)
    expect(db.roles).toHaveLength(1);
    expect(db.roles[0].roleName).toBe('Admin');
  });

  it('returns existing id without creating a duplicate on second call', async () => {
    const id1 = await ensureRole('Admin');
    const id2 = await ensureRole('Admin');
    expect(id1).toBe(id2);
    expect(db.roles).toHaveLength(1);
  });

  it('is case-insensitive: "admin" finds existing "Admin"', async () => {
    const id1 = await ensureRole('Admin');
    const id2 = await ensureRole('admin');
    expect(id1).toBe(id2);
    expect(db.roles).toHaveLength(1);
  });
});
