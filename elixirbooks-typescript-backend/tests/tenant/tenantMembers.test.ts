/**
 * tests/tenant/tenantMembers.test.ts
 *
 * `User` is the one model the tenant guard cannot protect — a person belongs to
 * N workspaces, so there is no `User.tenantId` to filter on — which makes
 * lib/tenantMembers.ts the single hand-written tenant boundary in the codebase.
 * Nine controllers now depend on it to answer "is this person in my workspace?"
 * before letting them be paid an expense, given a payroll profile, added to a
 * project or filed on a timesheet.
 *
 * The predicate it replaced was `OR: [{ id: tenantId }, { ownerId: tenantId }]`,
 * which was not merely legacy: in any workspace created through
 * POST /api/auth/tenants the owner matched NEITHER branch, so the owner of
 * their own second company was invisible to every one of those features.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: { user: { findFirst: m.findFirst, findMany: m.findMany } },
  prismaUnscoped: { user: { findFirst: m.findFirst, findMany: m.findMany } },
}));

import {
  activeTenantMemberWhere,
  isTenantMember,
  listTenantMemberIds,
  tenantMemberWhere,
} from '../../lib/tenantMembers';

const TENANT = 'tenant-a';

beforeEach(() => {
  m.findFirst.mockReset();
  m.findMany.mockReset();
  m.findFirst.mockResolvedValue(null);
  m.findMany.mockResolvedValue([]);
});

describe('tenantMemberWhere', () => {
  it('filters on a membership of the named workspace', () => {
    expect(tenantMemberWhere(TENANT)).toEqual({
      NOT: { user_type: 999 },
      memberships: { some: { tenantId: TENANT } },
    });
  });

  it('never mentions ownerId, the column P9 dropped', () => {
    expect(JSON.stringify(tenantMemberWhere(TENANT))).not.toContain('ownerId');
  });

  it('does not match a user merely because their id equals the tenant id', () => {
    // The old predicate's first branch. It happened to work only because
    // tenant #1 reused its owner's User.id — an accident of the migration, not
    // a rule, and false for every workspace created since.
    const where = JSON.stringify(tenantMemberWhere(TENANT));
    expect(where).not.toContain('"id"');
  });

  it('excludes the sys-bootstrap account, which is an FK target not a person', () => {
    expect(tenantMemberWhere(TENANT).NOT).toEqual({ user_type: 999 });
  });
});

describe('activeTenantMemberWhere', () => {
  it('additionally requires the membership to be ACTIVE', () => {
    expect(activeTenantMemberWhere(TENANT)).toEqual({
      NOT: { user_type: 999 },
      memberships: { some: { tenantId: TENANT, status: 'ACTIVE' } },
    });
  });

  it('is strictly narrower than the default predicate', () => {
    // The default deliberately does NOT filter status, so it agrees with
    // listStaffUsers — the query that populates the pickers these validators
    // receive values from. Someone offered in a dropdown must be acceptable on
    // submit; that consistency is worth more than rejecting a suspended member.
    const loose = tenantMemberWhere(TENANT).memberships as { some: Record<string, unknown> };
    const strict = activeTenantMemberWhere(TENANT).memberships as { some: Record<string, unknown> };
    expect(Object.keys(strict.some).length).toBeGreaterThan(Object.keys(loose.some).length);
  });
});

describe('isTenantMember', () => {
  it('asks for the user AND the membership together', async () => {
    await isTenantMember('user-1', TENANT);
    expect(m.findFirst).toHaveBeenCalledTimes(1);
    const { where } = m.findFirst.mock.calls[0][0];
    expect(where).toMatchObject({
      id: 'user-1',
      isDeleted: false,
      memberships: { some: { tenantId: TENANT } },
    });
  });

  it('is true when the query finds a row, false when it does not', async () => {
    m.findFirst.mockResolvedValueOnce({ id: 'user-1' });
    await expect(isTenantMember('user-1', TENANT)).resolves.toBe(true);
    m.findFirst.mockResolvedValueOnce(null);
    await expect(isTenantMember('user-1', TENANT)).resolves.toBe(false);
  });

  it('excludes soft-deleted users by default', async () => {
    await isTenantMember('user-1', TENANT);
    expect(m.findFirst.mock.calls[0][0].where.isDeleted).toBe(false);
  });

  it('includes them when explicitly asked', async () => {
    await isTenantMember('user-1', TENANT, { includeDeleted: true });
    expect(m.findFirst.mock.calls[0][0].where).not.toHaveProperty('isDeleted');
  });

  it('can require an ACTIVE membership', async () => {
    await isTenantMember('user-1', TENANT, { activeOnly: true });
    const { where } = m.findFirst.mock.calls[0][0];
    expect(where.memberships).toEqual({ some: { tenantId: TENANT, status: 'ACTIVE' } });
  });

  it('follows the tenant it is given, not a hard-coded one', async () => {
    await isTenantMember('user-1', 'tenant-b');
    expect(JSON.stringify(m.findFirst.mock.calls[0][0].where)).toContain('tenant-b');
    expect(JSON.stringify(m.findFirst.mock.calls[0][0].where)).not.toContain(TENANT);
  });
});

describe('listTenantMemberIds', () => {
  it('scopes to the workspace and returns bare ids', async () => {
    m.findMany.mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }]);
    await expect(listTenantMemberIds(TENANT)).resolves.toEqual(['u1', 'u2']);
    expect(m.findMany.mock.calls[0][0].where).toEqual(tenantMemberWhere(TENANT));
  });
});
