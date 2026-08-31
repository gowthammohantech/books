/**
 * tests/roleController.defaultRoute.test.ts
 *
 * Regression coverage for the "users without dashboard:view permission get
 * stuck on an Unauthorized dead-end page after login" bug. The Role model
 * now carries a configurable `defaultRoute` (added via prisma migration
 * 20260705230000_add_role_default_route) so each role can point at an
 * accessible landing page. createRole/updateRole must accept and persist an
 * optional `defaultRoute` string field, mirroring the existing `roleName`
 * validation/persistence pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const {
  mockRoleCreate,
  mockRoleUpdate,
  mockRoleFindFirst,
  mockRoleFindUnique,
  mockUserFindUnique,
} = vi.hoisted(() => ({
  mockRoleCreate: vi.fn(),
  mockRoleUpdate: vi.fn(),
  mockRoleFindFirst: vi.fn(),
  mockRoleFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    role: {
      create: mockRoleCreate,
      update: mockRoleUpdate,
      findFirst: mockRoleFindFirst,
      findUnique: mockRoleFindUnique,
    },
    user: {
      findUnique: mockUserFindUnique,
    },
  },
}));

const { createRole, updateRole } = await import('../controllers/roleController');

const USER_ID = 'user-1';
const ROLE_ID = 'role-1';

function makeReqRes(body: Record<string, unknown>, params: Record<string, unknown> = {}) {
  const req = {
    tenantId: USER_ID,
    user: USER_ID,
    body,
    params,
  } as unknown as Request;
  const statusMock = vi.fn().mockReturnThis();
  const jsonMock = vi.fn().mockReturnThis();
  const res = { status: statusMock, json: jsonMock } as unknown as Response;
  return { req, res, statusMock, jsonMock };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createRole — defaultRoute', () => {
  it('persists defaultRoute when provided', async () => {
    mockUserFindUnique.mockResolvedValue({ id: USER_ID });
    mockRoleFindFirst.mockResolvedValue(null);
    mockRoleCreate.mockResolvedValue({
      id: ROLE_ID,
      roleName: 'Sales',
      status: true,
      defaultRoute: 'invoices',
      createdBy: USER_ID,
      createdAt: new Date(),
    });

    const { req, res, statusMock, jsonMock } = makeReqRes({
      roleName: 'Sales',
      defaultRoute: 'invoices',
    });

    await createRole(req, res);

    expect(mockRoleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ defaultRoute: 'invoices' }),
      }),
    );
    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ defaultRoute: 'invoices' }),
      }),
    );
  });

  it('rejects a blank defaultRoute', async () => {
    mockUserFindUnique.mockResolvedValue({ id: USER_ID });
    mockRoleFindFirst.mockResolvedValue(null);

    const { req, res, statusMock, jsonMock } = makeReqRes({
      roleName: 'Sales',
      defaultRoute: '   ',
    });

    await createRole(req, res);

    expect(statusMock).toHaveBeenCalledWith(422);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.objectContaining({ defaultRoute: expect.any(String) }) }),
    );
    expect(mockRoleCreate).not.toHaveBeenCalled();
  });
});

describe('updateRole — defaultRoute', () => {
  it('persists defaultRoute when provided', async () => {
    mockRoleFindUnique.mockResolvedValue({
      id: ROLE_ID,
      roleName: 'Sales',
      status: true,
      deletedAt: null,
    });
    mockRoleUpdate.mockResolvedValue({
      id: ROLE_ID,
      roleName: 'Sales',
      status: true,
      defaultRoute: 'contacts',
      createdBy: USER_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { req, res, statusMock, jsonMock } = makeReqRes(
      { defaultRoute: 'contacts' },
      { id: ROLE_ID },
    );

    await updateRole(req, res);

    expect(mockRoleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ROLE_ID },
        data: expect.objectContaining({ defaultRoute: 'contacts' }),
      }),
    );
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ defaultRoute: 'contacts' }),
      }),
    );
  });

  it('rejects a blank defaultRoute', async () => {
    mockRoleFindUnique.mockResolvedValue({
      id: ROLE_ID,
      roleName: 'Sales',
      status: true,
      deletedAt: null,
    });

    const { req, res, statusMock, jsonMock } = makeReqRes(
      { defaultRoute: '' },
      { id: ROLE_ID },
    );

    await updateRole(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(mockRoleUpdate).not.toHaveBeenCalled();
  });
});
