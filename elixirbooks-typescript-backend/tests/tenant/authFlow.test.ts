/**
 * tests/tenant/authFlow.test.ts
 *
 * The session lifecycle P5 introduced: log in, see every workspace you belong
 * to, switch between them, and read the session back.
 *
 * These are the paths where a mistake is a cross-tenant breach rather than a
 * bug — switch-tenant exists purely to change which workspace a session acts
 * on, so it is exactly where a forged tenant id would be aimed — and the paths
 * where a mistake locks real users out, which is why the "no workspace" and
 * bootstrap-account cases are pinned too.
 *
 * register/protect are covered by tests/roles/usersController.test.ts and
 * tests/authMiddleware.actor.test.ts respectively.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const m = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  tenantFindUnique: vi.fn(),
  membershipFindMany: vi.fn(),
  loginActivityCreate: vi.fn(),
  companySettingsFindFirst: vi.fn(),
  comparePassword: vi.fn(),
  generateToken: vi.fn(() => 'minted-token'),
}));

vi.mock('../../lib/prisma', () => {
  const client = {
    user: { findUnique: m.userFindUnique, update: m.userUpdate },
    tenant: { findUnique: m.tenantFindUnique, count: vi.fn(async () => 0) },
    tenantMembership: { findMany: m.membershipFindMany },
    loginActivity: { create: m.loginActivityCreate },
    companySettings: { findFirst: m.companySettingsFindFirst },
  };
  return { prisma: client, prismaUnscoped: client };
});

vi.mock('../../utils/password', () => ({
  hashPassword: vi.fn(async () => 'hashed'),
  comparePassword: m.comparePassword,
}));

vi.mock('../../utils/generateToken', () => ({ generateToken: m.generateToken }));

vi.mock('express-validator', () => ({
  validationResult: () => ({ isEmpty: () => true, array: () => [] }),
}));

import { login, switchTenant, session } from '../../controllers/authController';

const ACME = 'tenant-acme';
const GLOBEX = 'tenant-globex';

function makeRes(): Response {
  const res = {} as Record<string, unknown>;
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as unknown as Response;
}

function makeReq(over: Record<string, unknown> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    protocol: 'http',
    get: () => 'localhost',
    ...over,
  } as unknown as Request;
}

/** Raw TenantMembership rows as loadMemberships selects them. */
function membershipRows(tenantIds: string[]) {
  return tenantIds.map((id, i) => ({
    id: `mem-${i + 1}`,
    tenantId: id,
    isOwner: i === 0,
    tenant: { name: id === ACME ? 'Acme Ltd' : 'Globex Inc', slug: id === ACME ? 'acme' : 'globex' },
    role: { roleName: i === 0 ? 'Owner' : 'Staff' },
  }));
}

const USER = {
  id: 'u1',
  email: 'sam@acme.test',
  password: 'hash',
  isDeleted: false,
  user_type: 1,
  lastTenantId: null as string | null,
  profileImage: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.comparePassword.mockResolvedValue(true);
  m.generateToken.mockReturnValue('minted-token');
  m.loginActivityCreate.mockResolvedValue({});
  m.userUpdate.mockResolvedValue({});
  m.membershipFindMany.mockResolvedValue(membershipRows([ACME]));
  m.userFindUnique.mockResolvedValue({ ...USER });
});

describe('login', () => {
  it('returns the active workspace and every membership', async () => {
    m.membershipFindMany.mockResolvedValue(membershipRows([ACME, GLOBEX]));
    const res = makeRes();
    await login(makeReq({ body: { email: USER.email, password: 'pw' } }), res);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.memberships).toHaveLength(2);
    expect(body.tenant.id).toBe(ACME);
    // The switcher needs both, and the frontend has no other source for them.
    expect(body.memberships.map((x: { slug: string }) => x.slug)).toEqual(['acme', 'globex']);
  });

  it('resumes the workspace the user was last in', async () => {
    m.userFindUnique.mockResolvedValue({ ...USER, lastTenantId: GLOBEX });
    m.membershipFindMany.mockResolvedValue(membershipRows([ACME, GLOBEX]));
    const res = makeRes();
    await login(makeReq({ body: { email: USER.email, password: 'pw' } }), res);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.tenant.id).toBe(GLOBEX);
    expect(m.generateToken).toHaveBeenCalledWith('u1', GLOBEX, 'mem-2');
  });

  it('403s — not 401 — when the credentials are right but no workspace is usable', async () => {
    // Every membership revoked, or every tenant suspended. Distinguishing this
    // from a bad password is what lets the UI say something true.
    m.membershipFindMany.mockResolvedValue([]);
    const res = makeRes();
    await login(makeReq({ body: { email: USER.email, password: 'pw' } }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(m.generateToken).not.toHaveBeenCalled();
  });

  it('refuses the sys-bootstrap account', async () => {
    // prisma/seed.ts's user_type 999 row exists only as an FK target for
    // platform reference data. It has a real password hash and no membership,
    // so without this guard it would be a valid login into nothing.
    m.userFindUnique.mockResolvedValue({ ...USER, user_type: 999 });
    const res = makeRes();
    await login(makeReq({ body: { email: 'sys@bootstrap', password: 'pw' } }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(m.generateToken).not.toHaveBeenCalled();
  });

  it('refuses a soft-deleted user', async () => {
    m.userFindUnique.mockResolvedValue({ ...USER, isDeleted: true });
    const res = makeRes();
    await login(makeReq({ body: { email: USER.email, password: 'pw' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('survives a LoginActivity failure', async () => {
    m.loginActivityCreate.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await login(makeReq({ body: { email: USER.email, password: 'pw' } }), res);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.token).toBe('minted-token');
  });
});

describe('switch-tenant', () => {
  it('mints a token for another of the caller\'s workspaces', async () => {
    m.membershipFindMany.mockResolvedValue(membershipRows([ACME, GLOBEX]));
    const res = makeRes();
    await switchTenant(makeReq({ user: 'u1', body: { tenantId: GLOBEX } }), res);

    expect(m.generateToken).toHaveBeenCalledWith('u1', GLOBEX, 'mem-2');
    expect(m.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { lastTenantId: GLOBEX } }),
    );
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.tenant.slug).toBe('globex');
  });

  it('refuses a workspace the caller is not a member of', async () => {
    // The membership list is re-read from the database here rather than taken
    // from the request; a forged tenantId simply is not in it.
    m.membershipFindMany.mockResolvedValue(membershipRows([ACME]));
    const res = makeRes();
    await switchTenant(makeReq({ user: 'u1', body: { tenantId: 'someone-elses-tenant' } }), res);

    // 403, not 404: a 404 would also confirm whether that tenant exists.
    expect(res.status).toHaveBeenCalledWith(403);
    expect(m.generateToken).not.toHaveBeenCalled();
    expect(m.userUpdate).not.toHaveBeenCalled();
  });

  it('requires a tenantId', async () => {
    const res = makeRes();
    await switchTenant(makeReq({ user: 'u1', body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('401s when unauthenticated', async () => {
    const res = makeRes();
    await switchTenant(makeReq({ body: { tenantId: ACME } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('GET /auth/session', () => {
  const actor = {
    userId: 'u1',
    tenantId: ACME,
    membershipId: 'mem-1',
    roleId: 'r1',
    roleName: 'Owner',
    isOwner: true,
    perms: new Map([['invoices', { view: true, create: true, edit: false, delete: false, allowAll: false }]]),
  };

  it('reports the per-tenant setup state that replaced the install-wide flag', async () => {
    m.userFindUnique.mockResolvedValue({ id: 'u1', firstName: 'Sam', email: USER.email, profileImage: null });
    m.tenantFindUnique.mockResolvedValue({ id: ACME, name: 'Acme Ltd', slug: 'acme', plan: 'free', status: 'ACTIVE' });
    m.companySettingsFindFirst.mockResolvedValue({ id: 'cs1', companyName: 'Acme Ltd', countryId: 'gb' });

    const res = makeRes();
    await session(makeReq({ user: 'u1', tenantId: ACME, actor }), res);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.data.setup.companySettingsComplete).toBe(true);
    expect(body.data.tenant.isOwner).toBe(true);
    // CompanySettings is read for THIS workspace, not counted install-wide the
    // way /app-version used to.
    expect(m.companySettingsFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: ACME } }),
    );
  });

  it('reports an unfinished setup for a brand-new workspace', async () => {
    m.userFindUnique.mockResolvedValue({ id: 'u1', firstName: 'Sam', email: USER.email, profileImage: null });
    m.tenantFindUnique.mockResolvedValue({ id: ACME, name: 'Acme Ltd', slug: 'acme', plan: 'free', status: 'ACTIVE' });
    m.companySettingsFindFirst.mockResolvedValue(null);

    const res = makeRes();
    await session(makeReq({ user: 'u1', tenantId: ACME, actor }), res);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.data.setup.companySettingsComplete).toBe(false);
  });

  it('serialises the permission map as a plain object', async () => {
    // A Map survives no JSON round-trip; the frontend permission helper reads
    // an object keyed by module slug.
    m.userFindUnique.mockResolvedValue({ id: 'u1', firstName: 'Sam', email: USER.email, profileImage: null });
    m.tenantFindUnique.mockResolvedValue({ id: ACME, name: 'Acme Ltd', slug: 'acme', plan: 'free', status: 'ACTIVE' });
    m.companySettingsFindFirst.mockResolvedValue(null);

    const res = makeRes();
    await session(makeReq({ user: 'u1', tenantId: ACME, actor }), res);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.data.permissions.invoices).toMatchObject({ view: true, create: true });
  });

  it('401s without a resolved session', async () => {
    const res = makeRes();
    await session(makeReq({}), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
