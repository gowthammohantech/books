// tests/roles/seedRoles.owner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = {
  roles: [] as any[],
  modules: [{ id: 'm1' }, { id: 'm2' }],
  perms: [] as any[],
  users: [{ id: 'admin1', user_type: 1, roleId: null }],
};

vi.mock('@prisma/client', () => {
  class PrismaClient {
    role = {
      findFirst: vi.fn(async ({ where }: any) =>
        db.roles.find(r => r.roleName.toLowerCase() === where.roleName.equals.toLowerCase()) ?? null),
      create: vi.fn(async ({ data }: any) => { const r = { id: 'role-' + data.roleName, ...data }; db.roles.push(r); return r; }),
    };
    module = { findMany: vi.fn(async () => db.modules) };
    permission = {
      count: vi.fn(async ({ where }: any) => db.perms.filter(p => p.roleId === where.roleId).length),
      findMany: vi.fn(async ({ where }: any) => db.perms.filter(p => p.roleId === where.roleId)),
      createMany: vi.fn(async ({ data }: any) => { db.perms.push(...data); return { count: data.length }; }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    };
    user = {
      updateMany: vi.fn(async ({ where, data }: any) => {
        let c = 0;
        for (const u of db.users) {
          const matchType = where.user_type === undefined || u.user_type === where.user_type;
          const matchNull = !where.roleId || where.roleId === null ? u.roleId === null : true;
          if (matchType && (where.roleId === null ? u.roleId === null : true)) { Object.assign(u, data); c++; }
        }
        return { count: c };
      }),
      findMany: vi.fn(async ({ where }: any) => db.users.filter(u => u.user_type === where?.user_type)),
      update: vi.fn(async ({ where, data }: any) => { const u = db.users.find(x => x.id === where.id); Object.assign(u, data); return u; }),
    };
    $disconnect = vi.fn();
  }
  return { PrismaClient };
});

// Also mock lib/prisma to avoid real DB connection from lib/defaultRoles import
vi.mock('../../lib/prisma', () => ({
  prisma: {
    role: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: 'shared-' + data.roleName, ...data })),
    },
  },
}));

import { seedRoles } from '../../prisma/seedRoles';

describe('seedRoles Owner handling', () => {
  beforeEach(() => { db.roles = []; db.perms = []; db.users = [{ id: 'admin1', user_type: 1, roleId: null }]; });

  it('creates Owner role with full perms on every module and assigns it to user_type 1 users', async () => {
    const r = await seedRoles();
    const owner = db.roles.find(x => x.roleName === 'Owner');
    expect(owner).toBeTruthy();
    const ownerPerms = db.perms.filter(p => p.roleId === owner.id);
    expect(ownerPerms.length).toBe(db.modules.length);
    expect(ownerPerms.every(p => p.allowAll === true)).toBe(true);
    expect(db.users.find(u => u.id === 'admin1').roleId).toBe(owner.id);
    expect(r.ownerAssigned).toBeGreaterThanOrEqual(1);
  });
});
