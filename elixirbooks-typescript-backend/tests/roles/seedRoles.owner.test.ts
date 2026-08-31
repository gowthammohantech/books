// tests/roles/seedRoles.owner.test.ts
//
// The Owner role must always end up with allowAll on EVERY module, per tenant.
// This is what makes it safe to delete the legacy `user_type === 1` UI bypass:
// an owner is fully privileged because their role says so, not because of a
// magic user_type.
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Role { id: string; tenantId: string; roleName: string; deletedAt: null }
interface Perm {
  roleId: string; tenantId: string; moduleId: string;
  create: boolean; edit: boolean; delete: boolean; view: boolean; allowAll: boolean;
}
interface Membership { userId: string; tenantId: string; roleId: string | null; isOwner: boolean }
interface User { id: string; user_type: number; roleId: string | null }

const db = {
  roles: [] as Role[],
  modules: [{ id: 'm1' }, { id: 'm2' }],
  perms: [] as Perm[],
  memberships: [] as Membership[],
  users: [] as User[],
};

vi.mock('@prisma/client', () => {
  const userOf = (m: Membership) => db.users.find((u) => u.id === m.userId);

  class PrismaClient {
    tenant = {
      findMany: vi.fn(async () => [{ id: 't1' }]),
    };
    role = {
      findFirst: vi.fn(async ({ where }: any) =>
        db.roles.find(
          (r) => r.roleName.toLowerCase() === where.roleName.equals.toLowerCase()
            && r.tenantId === where.tenantId,
        ) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const r = { deletedAt: null as null, id: `role-${data.tenantId}-${data.roleName}`, ...data };
        db.roles.push(r);
        return r;
      }),
    };
    module = { findMany: vi.fn(async () => db.modules) };
    permission = {
      count: vi.fn(async ({ where }: any) => db.perms.filter((p) => p.roleId === where.roleId).length),
      findMany: vi.fn(async ({ where }: any) => db.perms.filter((p) => p.roleId === where.roleId)),
      createMany: vi.fn(async ({ data }: any) => { db.perms.push(...data); return { count: data.length }; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let c = 0;
        for (const p of db.perms) {
          if (p.roleId !== where.roleId) continue;
          Object.assign(p, data);
          c += 1;
        }
        return { count: c };
      }),
    };
    tenantMembership = {
      updateMany: vi.fn(async ({ where, data }: any) => {
        let c = 0;
        for (const m of db.memberships) {
          if (m.tenantId !== where.tenantId) continue;
          if (where.roleId === null && m.roleId !== null) continue;
          if (where.isOwner !== undefined && m.isOwner !== where.isOwner) continue;
          if (where.user?.user_type !== undefined && userOf(m)?.user_type !== where.user.user_type) continue;
          if (where.NOT?.roleId !== undefined && m.roleId === where.NOT.roleId) continue;
          Object.assign(m, data);
          c += 1;
        }
        return { count: c };
      }),
      findMany: vi.fn(async ({ where }: any) =>
        db.memberships
          .filter((m) => m.tenantId === where.tenantId
            && (where.isOwner === undefined || m.isOwner === where.isOwner))
          .map((m) => ({ userId: m.userId }))),
    };
    user = {
      updateMany: vi.fn(async ({ where, data }: any) => {
        let c = 0;
        for (const u of db.users) {
          if (where.id?.in && !where.id.in.includes(u.id)) continue;
          if (where.NOT?.roleId !== undefined && u.roleId === where.NOT.roleId) continue;
          Object.assign(u, data);
          c += 1;
        }
        return { count: c };
      }),
    };
    $disconnect = vi.fn();
  }
  return { PrismaClient };
});

// Also mock lib/prisma to avoid a real DB connection from the lib/defaultRoles import
vi.mock('../../lib/prisma', () => ({
  prisma: {
    role: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: `shared-${data.roleName}`, ...data })),
    },
  },
}));

import { seedRoles, seedRolesForTenant } from '../../prisma/seedRoles';

beforeEach(() => {
  db.roles = [];
  db.perms = [];
  db.modules = [{ id: 'm1' }, { id: 'm2' }];
  db.users = [{ id: 'admin1', user_type: 1, roleId: null }];
  db.memberships = [{ userId: 'admin1', tenantId: 't1', roleId: null, isOwner: true }];
});

describe('seedRoles Owner handling', () => {
  it('creates the Owner role with full perms on every module and assigns it to the owner membership', async () => {
    const r = await seedRoles();

    const owner = db.roles.find((x) => x.roleName === 'Owner');
    expect(owner).toBeDefined();

    const ownerPerms = db.perms.filter((p) => p.roleId === owner!.id);
    expect(ownerPerms).toHaveLength(db.modules.length);
    expect(ownerPerms.every((p) => p.allowAll === true)).toBe(true);
    expect(ownerPerms.every((p) => p.tenantId === 't1')).toBe(true);

    expect(db.memberships[0].roleId).toBe(owner!.id);
    expect(r.ownerAssigned).toBeGreaterThanOrEqual(1);
  });

  it('re-grants full perms on a module added after the tenant was provisioned', async () => {
    await seedRolesForTenant('t1');
    db.modules.push({ id: 'm3' });
    await seedRolesForTenant('t1');

    const owner = db.roles.find((x) => x.roleName === 'Owner')!;
    const ownerPerms = db.perms.filter((p) => p.roleId === owner.id);
    expect(ownerPerms.map((p) => p.moduleId).sort()).toEqual(['m1', 'm2', 'm3']);
    expect(ownerPerms.every((p) => p.allowAll === true)).toBe(true);
  });

  it('forces a restricted Owner permission row back to full (Owner means Owner)', async () => {
    await seedRolesForTenant('t1');
    const owner = db.roles.find((x) => x.roleName === 'Owner')!;
    // Simulate someone stripping the Owner role's access to a module.
    const target = db.perms.find((p) => p.roleId === owner.id)!;
    target.allowAll = false;
    target.delete = false;

    await seedRolesForTenant('t1');

    expect(db.perms.filter((p) => p.roleId === owner.id).every((p) => p.allowAll && p.delete)).toBe(true);
  });
});
