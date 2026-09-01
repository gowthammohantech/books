/**
 * tests/permissionController.defaultRoute.test.ts
 *
 * RolePermissions.tsx (frontend) saves/loads a role's permissions through
 * POST /admin/permissions and GET /admin/permissions/:roleId, handled by
 * createOrUpdatePermissions / getPermissionsByRole in this file — NOT
 * roleController.ts's createRole/updateRole (those back a separate Roles
 * CRUD screen). This covers the `defaultRoute` field on that actual
 * save/load path so a role's configured landing page persists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockRoleFindUnique, mockRoleUpdate, mockRoleFindFirst, mockPermissionFindMany } = vi.hoisted(() => ({
  mockRoleFindUnique: vi.fn(),
  mockRoleUpdate: vi.fn(),
  mockRoleFindFirst: vi.fn(),
  mockPermissionFindMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    role: {
      findUnique: mockRoleFindUnique,
      update: mockRoleUpdate,
      findFirst: mockRoleFindFirst,
    },
    permission: {
      findFirst: vi.fn(),
      findMany: mockPermissionFindMany,
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        permission: {
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create: vi.fn().mockResolvedValue({ id: 'perm-1' }),
        },
      }),
    ),
  },
}));

const { createOrUpdatePermissions, getPermissionsByRole } = await import(
  '../controllers/permissionController'
);

const ROLE_ID = 'role-1';

const TENANT_ID = 'tenant-1';

function makeReqRes(body: Record<string, unknown> = {}, params: Record<string, unknown> = {}) {
  // tenantId is what authMiddleware.protect sets; the role lookup is scoped to
  // it so one tenant cannot re-permission another tenant's role.
  const req = { body, params, tenantId: TENANT_ID } as unknown as Request;
  const statusMock = vi.fn().mockReturnThis();
  const jsonMock = vi.fn().mockReturnThis();
  const res = { status: statusMock, json: jsonMock } as unknown as Response;
  return { req, res, statusMock, jsonMock };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createOrUpdatePermissions — defaultRoute', () => {
  it('persists defaultRoute on the role when provided', async () => {
    mockRoleFindFirst.mockResolvedValue({ id: ROLE_ID, tenantId: TENANT_ID, defaultRoute: 'dashboard' });
    mockRoleUpdate.mockResolvedValue({ id: ROLE_ID, defaultRoute: 'invoices' });

    const { req, res, statusMock, jsonMock } = makeReqRes({
      roleId: ROLE_ID,
      permissions: [{ moduleId: 'mod-1', view: true }],
      defaultRoute: 'invoices',
    });

    await createOrUpdatePermissions(req, res);

    expect(mockRoleUpdate).toHaveBeenCalledWith({
      where: { id: ROLE_ID },
      data: { defaultRoute: 'invoices' },
    });
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, defaultRoute: 'invoices' }),
    );
  });

  it('rejects a blank defaultRoute without touching the role', async () => {
    mockRoleFindFirst.mockResolvedValue({ id: ROLE_ID, tenantId: TENANT_ID, defaultRoute: 'dashboard' });

    const { req, res, statusMock } = makeReqRes({
      roleId: ROLE_ID,
      permissions: [{ moduleId: 'mod-1', view: true }],
      defaultRoute: '   ',
    });

    await createOrUpdatePermissions(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(mockRoleUpdate).not.toHaveBeenCalled();
  });

  it('leaves defaultRoute untouched when omitted from the payload', async () => {
    mockRoleFindFirst.mockResolvedValue({ id: ROLE_ID, tenantId: TENANT_ID, defaultRoute: 'dashboard' });

    const { req, res, jsonMock } = makeReqRes({
      roleId: ROLE_ID,
      permissions: [{ moduleId: 'mod-1', view: true }],
    });

    await createOrUpdatePermissions(req, res);

    expect(mockRoleUpdate).not.toHaveBeenCalled();
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, defaultRoute: 'dashboard' }),
    );
  });

  it('scopes the role lookup to the caller tenant', () => {
    // Regression guard: this used to be findUnique({ where: { id } }), which
    // let any tenant re-permission another tenant's role by guessing its uuid.
    mockRoleFindFirst.mockResolvedValue({ id: ROLE_ID, tenantId: TENANT_ID, defaultRoute: 'dashboard' });

    const { req, res } = makeReqRes({
      roleId: ROLE_ID,
      permissions: [{ moduleId: 'mod-1', view: true }],
    });

    return createOrUpdatePermissions(req, res).then(() => {
      expect(mockRoleFindUnique).not.toHaveBeenCalled();
      expect(mockRoleFindFirst).toHaveBeenCalledWith({
        where: { id: ROLE_ID, tenantId: TENANT_ID },
      });
    });
  });

  it('404s on a role belonging to another tenant', async () => {
    // The tenant-scoped lookup finds nothing, so the role reads as missing
    // rather than leaking its existence.
    mockRoleFindFirst.mockResolvedValue(null);

    const { req, res, statusMock } = makeReqRes({
      roleId: 'role-owned-by-another-tenant',
      permissions: [{ moduleId: 'mod-1', view: true }],
    });

    await createOrUpdatePermissions(req, res);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(mockRoleUpdate).not.toHaveBeenCalled();
  });
});

describe('getPermissionsByRole — defaultRoute', () => {
  it('includes the role defaultRoute in the response data', async () => {
    mockRoleFindFirst.mockResolvedValue({ id: ROLE_ID, roleName: 'Sales', defaultRoute: 'contacts' });
    mockPermissionFindMany.mockResolvedValue([]);

    const { req, res, jsonMock } = makeReqRes({}, { roleId: ROLE_ID });

    await getPermissionsByRole(req, res);

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ roleId: ROLE_ID, defaultRoute: 'contacts' }),
      }),
    );
  });
});
