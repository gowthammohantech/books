/**
 * Tests for externalController.js (Mongoose→Prisma migration)
 *
 * The controller is plain CJS JS and calls require('../lib/prisma') and
 * require('../utils/generateToken'). Since vitest uses Vite's module runner
 * (ESM-based) for TS files but Node's native CJS resolver for .js files,
 * we pre-populate Node's require.cache with lightweight stubs BEFORE
 * requiring the controller so its require() calls hit the stubs.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import path from 'path';

// ---------------------------------------------------------------------------
// Stub factories — recreated before each test via beforeEach
// ---------------------------------------------------------------------------
const mockFindFirstUser = vi.fn();
const mockCreateUser = vi.fn();
const mockUpsertCustomer = vi.fn();
const mockFindFirstAdmin = vi.fn();
const mockGenerateToken = vi.fn().mockReturnValue('mock-jwt-token');
// hashPassword stub returns a realistic bcrypt-prefixed hash so tests can
// assert the stored password is never a raw hex string.
const mockHashPassword = vi.fn().mockResolvedValue('$2b$10$mockedHashedPasswordValue');

// ensureRole stub — controllable per-test
const mockEnsureRole = vi.fn().mockResolvedValue('mock-role-id');
// Control flag: when true, ensureRole rejects to test resilience path
let ensureRoleShouldThrow = false;

const DEFAULT_ROLE_BY_USER_TYPE_STUB: Record<number, string> = {
  1: 'Admin',
  2: 'Vendor',
  3: 'Staff',
  4: 'Maintainer',
  5: 'Supplier',
};

const ROOT = path.resolve(__dirname, '..');

// We need to inject stubs into Node's require.cache before the controller
// module is loaded. Vitest's beforeAll runs before module evaluation when
// using dynamic require inside the test — so we set up stubs here and then
// require the controller lazily.

function makeStubs() {
  return {
    prismaStub: {
      prisma: {
        user: {
          findFirst: (opts: any) => {
            // Distinguish admin lookup (user_type: 1) from email lookup
            if (opts?.where?.user_type === 1) return mockFindFirstAdmin(opts);
            return mockFindFirstUser(opts);
          },
          create: mockCreateUser,
        },
        customer: {
          upsert: mockUpsertCustomer,
        },
      },
    },
    generateTokenStub: { generateToken: mockGenerateToken },
    defaultRolesStub: {
      DEFAULT_ROLE_BY_USER_TYPE: DEFAULT_ROLE_BY_USER_TYPE_STUB,
      ensureRole: async (roleName: string) => {
        if (ensureRoleShouldThrow) throw new Error('DB error (simulated)');
        return mockEnsureRole(roleName);
      },
    },
  };
}

// Inject stubs into require.cache so that require('../lib/prisma'),
// require('../utils/generateToken'), require('../utils/password'), and
// require('../lib/defaultRoles') in the JS controller get our mocks.
function installStubs() {
  const { prismaStub, generateTokenStub, defaultRolesStub } = makeStubs();

  // Use absolute paths WITH .ts extension — vitest's module runner registers
  // TS modules under their full path including extension.
  const prismaPath = path.join(ROOT, 'lib/prisma.ts');
  const tokenPath = path.join(ROOT, 'utils/generateToken.ts');
  const passwordPath = path.join(ROOT, 'utils/password.ts');
  const defaultRolesPath = path.join(ROOT, 'lib/defaultRoles.ts');

  // Inject a minimal Module-shaped object into the cache
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Module = require('module');

  function makeModuleStub(exports: object, filename: string) {
    const m = new Module(filename);
    m.exports = exports;
    m.loaded = true;
    m.filename = filename;
    return m;
  }

  require.cache[prismaPath] = makeModuleStub(prismaStub, prismaPath) as any;
  require.cache[tokenPath] = makeModuleStub(generateTokenStub, tokenPath) as any;
  require.cache[passwordPath] = makeModuleStub({ hashPassword: mockHashPassword }, passwordPath) as any;
  require.cache[defaultRolesPath] = makeModuleStub(defaultRolesStub, defaultRolesPath) as any;
}

// ---------------------------------------------------------------------------
// Lazy-load controller AFTER stubs are in cache
// ---------------------------------------------------------------------------
let ssoExchange: (req: any, res: any) => Promise<void>;
let upsertCustomer: (req: any, res: any) => Promise<void>;

beforeAll(() => {
  installStubs();
  // Purge any cached copy of the controller itself so it gets re-required
  // with our stubs in place.
  const controllerPath = require.resolve(path.join(ROOT, 'controllers/externalController'));
  delete require.cache[controllerPath];

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const controller = require(path.join(ROOT, 'controllers/externalController'));
  ssoExchange = controller.ssoExchange;
  upsertCustomer = controller.upsertCustomer;
});

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

/**
 * Build a minimal HS256 HMAC JWT that verifyWhatsappcrmJwt will accept.
 */
const MOCK_SECRET = 'test-secret-key';
function buildTestToken(claims: Record<string, unknown>, secret = MOCK_SECRET): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300, ...claims })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

describe('externalController — ssoExchange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureRoleShouldThrow = false;
    mockEnsureRole.mockResolvedValue('mock-role-id');
    process.env.WHATSAPPCRM_SSO_SECRET = MOCK_SECRET;
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  it('returns 503 when WHATSAPPCRM_SSO_SECRET is not configured', async () => {
    delete process.env.WHATSAPPCRM_SSO_SECRET;
    const req: any = { body: { token: 'anything' }, query: {} };
    const res = mockRes();
    await ssoExchange(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it('returns 400 when no token in request', async () => {
    const req: any = { body: {}, query: {} };
    const res = mockRes();
    await ssoExchange(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it('happy path — existing user found: returns token and user with id + _id', async () => {
    const existingUser = {
      id: 'user-uuid-123',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
      user_type: 2,
    };
    mockFindFirstUser.mockResolvedValue(existingUser);

    const token = buildTestToken({ email: 'alice@example.com' });
    const req: any = { body: { token }, query: {} };
    const res = mockRes();
    await ssoExchange(req, res);

    // Should NOT have created a new user
    expect(mockCreateUser).not.toHaveBeenCalled();

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.token).toBe('mock-jwt-token');
    // Both id and _id must be present for CRM backward-compat
    expect(body.user.id).toBe('user-uuid-123');
    expect(body.user._id).toBe('user-uuid-123');
    expect(body.user.email).toBe('alice@example.com');

    // Prisma lookup used isDeleted: { not: true } (mirrors Mongoose $ne: true)
    const whereArg = mockFindFirstUser.mock.calls[0][0].where;
    expect(whereArg.isDeleted).toEqual({ not: true });
    expect(whereArg.email).toBe('alice@example.com');

    // generateToken called with Prisma string id (not _id), plus the tenant
    // (company-owner) id for shared-workspace scoping. This user has no
    // ownerId, so the tenant falls back to its own id.
    expect(mockGenerateToken).toHaveBeenCalledWith('user-uuid-123', 'user-uuid-123');
  });

  it('new user path — provisions user when not found', async () => {
    const newUser = {
      id: 'new-user-uuid',
      firstName: 'Bob',
      lastName: 'Jones',
      email: 'bob@example.com',
      user_type: 2,
    };
    mockFindFirstUser.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue(newUser);

    const token = buildTestToken({ email: 'bob@example.com', name: 'Bob Jones' });
    const req: any = { body: { token }, query: {} };
    const res = mockRes();
    await ssoExchange(req, res);

    expect(mockCreateUser).toHaveBeenCalledOnce();
    const createData = mockCreateUser.mock.calls[0][0].data;
    expect(createData.firstName).toBe('Bob');
    expect(createData.lastName).toBe('Jones');
    expect(createData.email).toBe('bob@example.com');

    // Password must be hashed before storage — never a raw 64-char hex string.
    // The bcrypt stub returns a $2b$… prefix; verify it is NOT the raw hex form.
    expect(createData.password).toMatch(/^\$2[ab]\$/);
    expect(createData.password).not.toMatch(/^[0-9a-f]{64}$/);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.user.id).toBe('new-user-uuid');
    expect(body.user._id).toBe('new-user-uuid');
  });

  it('admin-lookup path — resolveOwnerUserId uses user_type:1 + isDeleted:not:true', async () => {
    // This is tested indirectly via upsertCustomer — see below. But we can
    // verify the admin query WHERE clause here by triggering a path that calls
    // resolveOwnerUserId.
    mockFindFirstAdmin.mockResolvedValue(null); // No admin → 409
    const req: any = { body: { external_id: 'x', name: 'y' } };
    const res = mockRes();
    await upsertCustomer(req, res);
    const adminWhere = mockFindFirstAdmin.mock.calls[0][0].where;
    expect(adminWhere.user_type).toBe(1);
    expect(adminWhere.isDeleted).toEqual({ not: true });
  });
});

describe('externalController — upsertCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  it('returns 400 when external_id is missing', async () => {
    const req: any = { body: { name: 'Test' } };
    const res = mockRes();
    await upsertCustomer(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/external_id/);
  });

  it('returns 400 when name is missing', async () => {
    const req: any = { body: { external_id: 'ext-1' } };
    const res = mockRes();
    await upsertCustomer(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/name/);
  });

  it('returns 409 when no admin user exists', async () => {
    mockFindFirstAdmin.mockResolvedValue(null);
    const req: any = { body: { external_id: 'ext-1', name: 'Test Contact' } };
    const res = mockRes();
    await upsertCustomer(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toMatch(/admin/i);
  });

  it('create path — upserts new customer with correct unique key and returns id + _id', async () => {
    const adminUser = { id: 'admin-uuid', user_type: 1 };
    const createdCustomer = {
      id: 'cust-uuid-1',
      name: 'Test Contact',
      email: 'test@example.com',
      externalSource: 'whatsappcrm',
      externalRef: 'ext-42',
    };
    mockFindFirstAdmin.mockResolvedValue(adminUser);
    mockUpsertCustomer.mockResolvedValue(createdCustomer);

    const req: any = {
      body: { external_id: 'ext-42', name: 'Test Contact', email: 'test@example.com', phone: '123' },
    };
    const res = mockRes();
    await upsertCustomer(req, res);

    // Verify the upsert where clause uses the named unique index
    const upsertCall = mockUpsertCustomer.mock.calls[0][0];
    expect(upsertCall.where.customer_external_upsert_idx).toEqual({
      externalSource: 'whatsappcrm',
      externalRef: 'ext-42',
      userId: 'admin-uuid',
    });

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('cust-uuid-1');
    // _id alias must be present for CRM backward-compat
    expect(body.data._id).toBe('cust-uuid-1');
    expect(body.data.externalSource).toBe('whatsappcrm');
    expect(body.data.externalRef).toBe('ext-42');
  });

  it('update path — upsert called with same where key; update payload carries new name', async () => {
    const adminUser = { id: 'admin-uuid', user_type: 1 };
    const updatedCustomer = {
      id: 'cust-uuid-existing',
      name: 'Updated Name',
      email: 'existing@example.com',
      externalSource: 'whatsappcrm',
      externalRef: 'ext-99',
    };
    mockFindFirstAdmin.mockResolvedValue(adminUser);
    mockUpsertCustomer.mockResolvedValue(updatedCustomer);

    const req: any = {
      body: { external_id: 'ext-99', name: 'Updated Name', email: 'existing@example.com' },
    };
    const res = mockRes();
    await upsertCustomer(req, res);

    const upsertCall = mockUpsertCustomer.mock.calls[0][0];
    expect(upsertCall.where.customer_external_upsert_idx.externalRef).toBe('ext-99');
    expect(upsertCall.update.name).toBe('Updated Name');

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data._id).toBe('cust-uuid-existing');
  });

  it('returns 409 on P2002 (duplicate email) instead of 500', async () => {
    const adminUser = { id: 'admin-uuid', user_type: 1 };
    mockFindFirstAdmin.mockResolvedValue(adminUser);
    const p2002Err = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['email'] },
    });
    mockUpsertCustomer.mockRejectedValue(p2002Err);

    const req: any = { body: { external_id: 'ext-1', name: 'Dup', email: 'dup@example.com' } };
    const res = mockRes();
    await upsertCustomer(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/email/i);
    // Both fields must be present: `meta` (Prisma name) and `keyValue` (legacy
    // alias kept for backward-compat with whatsappcrm consumers that still read
    // the old Mongoose 11000 duplicate-key field name).
    expect(body.meta).toEqual({ target: ['email'] });
    expect(body.keyValue).toEqual({ target: ['email'] });
  });

  it('synthesizes placeholder email when email is missing', async () => {
    const adminUser = { id: 'admin-uuid', user_type: 1 };
    const customer = {
      id: 'c1',
      name: 'Phone Only',
      email: 'external-phone-only-55@whatsappcrm.local',
      externalSource: 'whatsappcrm',
      externalRef: 'phone-only-55',
    };
    mockFindFirstAdmin.mockResolvedValue(adminUser);
    mockUpsertCustomer.mockResolvedValue(customer);

    const req: any = { body: { external_id: 'phone-only-55', name: 'Phone Only', phone: '+1234567890' } };
    const res = mockRes();
    await upsertCustomer(req, res);

    const upsertCall = mockUpsertCustomer.mock.calls[0][0];
    expect(upsertCall.create.email).toMatch(/external-phone-only-55@whatsappcrm\.local/);
  });
});

describe('externalController — ssoExchange SSO role assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureRoleShouldThrow = false;
    mockEnsureRole.mockResolvedValue('mock-role-id');
    process.env.WHATSAPPCRM_SSO_SECRET = MOCK_SECRET;
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  it('new user (user_type 2) — creates user with Vendor roleId from ensureRole', async () => {
    const newUser = {
      id: 'new-vendor-uuid',
      firstName: 'Carol',
      lastName: 'White',
      email: 'carol@example.com',
      user_type: 2,
    };
    mockFindFirstUser.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue(newUser);

    const token = buildTestToken({ email: 'carol@example.com', name: 'Carol White', user_type: 2 });
    const req: any = { body: { token }, query: {} };
    const res = mockRes();
    await ssoExchange(req, res);

    expect(mockCreateUser).toHaveBeenCalledOnce();
    const createData = mockCreateUser.mock.calls[0][0].data;
    expect(createData.user_type).toBe(2);
    // ensureRole should have been called with 'Vendor'
    expect(mockEnsureRole).toHaveBeenCalledWith('Vendor');
    // roleId should be set on the created user
    expect(createData.roleId).toBe('mock-role-id');

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
  });

  it('new user — ensureRole failure is non-fatal (SSO must not 500)', async () => {
    ensureRoleShouldThrow = true;
    const newUser = {
      id: 'new-user-no-role',
      firstName: 'Dave',
      lastName: 'Brown',
      email: 'dave@example.com',
      user_type: 2,
    };
    mockFindFirstUser.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue(newUser);

    const token = buildTestToken({ email: 'dave@example.com', name: 'Dave Brown' });
    const req: any = { body: { token }, query: {} };
    const res = mockRes();
    await ssoExchange(req, res);

    // SSO exchange must still succeed
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(mockCreateUser).toHaveBeenCalledOnce();
    // roleId must be absent/null from the create payload when ensureRole threw
    const createData = mockCreateUser.mock.calls[0][0].data;
    expect(createData.roleId).toBeUndefined();
  });
});
