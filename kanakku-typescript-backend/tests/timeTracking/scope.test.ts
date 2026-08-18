/**
 * tests/timeTracking/scope.test.ts
 *
 * Unit tests for assertActorCanManageEmployee — the project-manager scope guard
 * used by submit-for-others / approve / reject.
 *
 * Strategy: pass a hand-rolled prisma stub whose `projectMember.findMany`
 * returns the rows we want. No real DB. The actor matches the Express `Actor`
 * shape resolved by authMiddleware (isOwner / userId / tenantId).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  assertActorCanManageEmployee,
  ForbiddenError,
  type ScopeActor,
  type ScopePrisma,
} from '../../lib/timeTracking/scope';

// --- helpers ---------------------------------------------------------------

function makeActor(over: Partial<ScopeActor> = {}): ScopeActor {
  return {
    userId: 'actor-1',
    tenantId: 'tenant-1',
    isOwner: false,
    ...over,
  };
}

/**
 * Build a prisma stub. `rows` is the full set of ProjectMember rows the
 * findMany should be able to return; the stub applies the `where` filter the
 * helper passes (projectId in / employeeUserId / role / isActive) so the test
 * exercises the real query semantics.
 */
interface Row {
  projectId: string;
  employeeUserId: string;
  role: 'MEMBER' | 'MANAGER';
  isActive: boolean;
}
function makePrisma(rows: Row[]): { prisma: ScopePrisma; findMany: ReturnType<typeof vi.fn> } {
  const findMany = vi.fn(async ({ where }: any) => {
    return rows.filter((r) => {
      if (where.isActive !== undefined && r.isActive !== where.isActive) return false;
      if (where.role !== undefined && r.role !== where.role) return false;
      if (where.employeeUserId !== undefined && r.employeeUserId !== where.employeeUserId) return false;
      if (where.projectId?.in && !where.projectId.in.includes(r.projectId)) return false;
      if (typeof where.projectId === 'string' && r.projectId !== where.projectId) return false;
      return true;
    });
  });
  return { prisma: { projectMember: { findMany } } as unknown as ScopePrisma, findMany };
}

// --- tests -----------------------------------------------------------------

describe('assertActorCanManageEmployee', () => {
  it('passes for an admin/owner without touching prisma', async () => {
    const { prisma, findMany } = makePrisma([]);
    await expect(
      assertActorCanManageEmployee(prisma, makeActor({ isOwner: true }), 'emp-1', ['proj-A']),
    ).resolves.toBeUndefined();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('passes for a MANAGER of the project when the employee is a member of it', async () => {
    const { prisma } = makePrisma([
      { projectId: 'proj-A', employeeUserId: 'actor-1', role: 'MANAGER', isActive: true },
      { projectId: 'proj-A', employeeUserId: 'emp-1', role: 'MEMBER', isActive: true },
    ]);
    await expect(
      assertActorCanManageEmployee(prisma, makeActor(), 'emp-1', ['proj-A']),
    ).resolves.toBeUndefined();
  });

  it('throws ForbiddenError when the actor is not a manager of the project', async () => {
    const { prisma } = makePrisma([
      // actor is only a plain MEMBER of proj-A
      { projectId: 'proj-A', employeeUserId: 'actor-1', role: 'MEMBER', isActive: true },
      { projectId: 'proj-A', employeeUserId: 'emp-1', role: 'MEMBER', isActive: true },
    ]);
    await expect(
      assertActorCanManageEmployee(prisma, makeActor(), 'emp-1', ['proj-A']),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws when the manager of project A is asked about project B', async () => {
    const { prisma } = makePrisma([
      // actor manages A only; the request is about B
      { projectId: 'proj-A', employeeUserId: 'actor-1', role: 'MANAGER', isActive: true },
      { projectId: 'proj-B', employeeUserId: 'emp-1', role: 'MEMBER', isActive: true },
    ]);
    await expect(
      assertActorCanManageEmployee(prisma, makeActor(), 'emp-1', ['proj-B']),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws when the employee is not a member of the managed project', async () => {
    const { prisma } = makePrisma([
      // actor manages A, but emp-1 is not on A
      { projectId: 'proj-A', employeeUserId: 'actor-1', role: 'MANAGER', isActive: true },
    ]);
    await expect(
      assertActorCanManageEmployee(prisma, makeActor(), 'emp-1', ['proj-A']),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('requires manager rights on EVERY project when multiple are given', async () => {
    const { prisma } = makePrisma([
      { projectId: 'proj-A', employeeUserId: 'actor-1', role: 'MANAGER', isActive: true },
      { projectId: 'proj-A', employeeUserId: 'emp-1', role: 'MEMBER', isActive: true },
      // actor is NOT a manager of proj-B
      { projectId: 'proj-B', employeeUserId: 'emp-1', role: 'MEMBER', isActive: true },
    ]);
    await expect(
      assertActorCanManageEmployee(prisma, makeActor(), 'emp-1', ['proj-A', 'proj-B']),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws a non-admin actor with no projectIds (nothing to authorize)', async () => {
    const { prisma } = makePrisma([]);
    await expect(
      assertActorCanManageEmployee(prisma, makeActor(), 'emp-1', []),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
