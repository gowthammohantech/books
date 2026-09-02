/**
 * tests/authController.sessionGate.test.ts
 *
 * The /setup gate is `session().setup.companySettingsComplete`, and it used to
 * be `!!companySettings` — pure row existence.
 *
 * That is not the same question. `applyPack` (lib/ledger/applyPack.ts) upserts
 * a PLACEHOLDER CompanySettings with `companyName: ''` so that seeding a
 * country pack for a brand-new tenant does not trip Prisma's P2025, and
 * autoInitLedgerForUser reaches it from the settings page as well as from
 * setup. So a row could exist for a workspace that had never been through
 * /setup — the gate lifted, and the user landed in an app whose company had no
 * name.
 *
 * The gate now keys on the NAME. Every tenant that genuinely completed setup
 * has one (updateCompanySetup 400s without it), so no real workspace changes
 * state; only placeholder rows are re-classified as incomplete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockUserFindUnique, mockTenantFindUnique, mockMembershipFindMany, mockCompanySettingsFindFirst } =
  vi.hoisted(() => ({
    mockUserFindUnique: vi.fn(),
    mockTenantFindUnique: vi.fn(),
    mockMembershipFindMany: vi.fn(),
    mockCompanySettingsFindFirst: vi.fn(),
  }));

vi.mock('../lib/prisma', () => ({
  prisma: {
    companySettings: { findFirst: mockCompanySettingsFindFirst },
  },
  prismaUnscoped: {
    user: { findUnique: mockUserFindUnique },
    tenant: { findUnique: mockTenantFindUnique },
    tenantMembership: { findMany: mockMembershipFindMany },
  },
}));

const { session } = await import('../controllers/authController');

const USER_ID = 'user-1';
const TENANT_ID = 'tenant-1';

function makeReqRes() {
  const req = {
    user: USER_ID,
    tenantId: TENANT_ID,
    actor: { perms: new Map(), roleName: 'Owner', isOwner: true },
    protocol: 'http',
    get: vi.fn((header: string) => (header === 'host' ? 'localhost:3001' : undefined)),
  } as unknown as Request;
  const statusMock = vi.fn().mockReturnThis();
  const jsonMock = vi.fn().mockReturnThis();
  const res = { status: statusMock, json: jsonMock } as unknown as Response;
  return { req, res, jsonMock };
}

/** The `setup` block of whatever session() answered with. */
function setupBlockFrom(jsonMock: ReturnType<typeof vi.fn>) {
  return jsonMock.mock.calls[0]?.[0]?.data?.setup;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserFindUnique.mockResolvedValue({
    id: USER_ID,
    firstName: 'A',
    lastName: 'B',
    email: 'a@example.com',
    phone: null,
    profileImage: null,
    user_type: 1,
  });
  mockTenantFindUnique.mockResolvedValue({
    id: TENANT_ID,
    name: 'Acme',
    slug: 'acme',
    plan: 'free',
    status: 'ACTIVE',
  });
  mockMembershipFindMany.mockResolvedValue([]);
});

describe('session() — companySettingsComplete', () => {
  it('is false when no CompanySettings row exists at all', async () => {
    mockCompanySettingsFindFirst.mockResolvedValue(null);
    const { req, res, jsonMock } = makeReqRes();

    await session(req, res);

    expect(setupBlockFrom(jsonMock)).toEqual({ companySettingsComplete: false });
  });

  it('is false for an applyPack placeholder row whose companyName is empty', async () => {
    mockCompanySettingsFindFirst.mockResolvedValue({
      id: 'cs-1',
      companyName: '',
      countryId: 'country-1',
    });
    const { req, res, jsonMock } = makeReqRes();

    await session(req, res);

    expect(setupBlockFrom(jsonMock)).toEqual({ companySettingsComplete: false });
  });

  it('is false for a whitespace-only company name', async () => {
    mockCompanySettingsFindFirst.mockResolvedValue({
      id: 'cs-1',
      companyName: '   ',
      countryId: null,
    });
    const { req, res, jsonMock } = makeReqRes();

    await session(req, res);

    expect(setupBlockFrom(jsonMock)).toEqual({ companySettingsComplete: false });
  });

  it('is true once the workspace has a real company name', async () => {
    mockCompanySettingsFindFirst.mockResolvedValue({
      id: 'cs-1',
      companyName: 'Acme Pvt Ltd',
      countryId: 'country-1',
    });
    const { req, res, jsonMock } = makeReqRes();

    await session(req, res);

    expect(setupBlockFrom(jsonMock)).toEqual({ companySettingsComplete: true });
  });
});
