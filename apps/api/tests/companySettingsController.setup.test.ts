/**
 * tests/companySettingsController.setup.test.ts
 *
 * Regression coverage for "the second workspace can never finish setup".
 *
 * updateCompanySetup used to resolve the acting user with
 * `prisma.user.findUnique({ where: { id: tenantId } })` and 404 on a miss.
 * That only holds for the FIRST workspace, where provisionTenant deliberately
 * reuses the owner's user id as the tenant id. POST /api/auth/tenants mints an
 * ordinary uuid instead — so for workspace #2 the lookup missed, the handler
 * 404'd, and because a freshly provisioned tenant has no CompanySettings row
 * the setup gate kept redirecting there. Permanently unfinishable.
 *
 * The row is consulted only for fallback email/phone on the create branch, so
 * the fix is to look the user up by `requireActingUserId(req)` and treat a miss
 * as non-fatal rather than as a 404.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const {
  mockUserFindUnique,
  mockCompanySettingsFindUnique,
  mockCountryFindUnique,
  mockCurrencyFindFirst,
  mockTransaction,
  mockTxCompanySettingsCreate,
  mockTxCompanySettingsUpdate,
  mockTxLocalizationFindFirst,
  mockTxTimeFormatFindFirst,
  mockTxGeneralSettingUpsert,
  mockStateFindUnique,
} = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockCompanySettingsFindUnique: vi.fn(),
  mockCountryFindUnique: vi.fn(),
  mockCurrencyFindFirst: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxCompanySettingsCreate: vi.fn(),
  mockTxCompanySettingsUpdate: vi.fn(),
  mockTxLocalizationFindFirst: vi.fn(),
  mockTxTimeFormatFindFirst: vi.fn(),
  mockTxGeneralSettingUpsert: vi.fn(),
  mockStateFindUnique: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    companySettings: { findUnique: mockCompanySettingsFindUnique },
    country: { findUnique: mockCountryFindUnique },
    state: { findUnique: mockStateFindUnique },
    currency: { findFirst: mockCurrencyFindFirst },
    timezone: { findUnique: vi.fn() },
    dateFormat: { findUnique: vi.fn() },
    $transaction: mockTransaction,
    // autoInitLedgerForUser() runs after the commit and starts with
    // prisma.ledgerAccountMapping.count(). Left unmocked on purpose: the
    // function wraps its body in a non-fatal try/catch, so the TypeError is
    // swallowed and logged. Same approach as the fkValidation suite.
  },
}));

const { updateCompanySetup } = await import('../controllers/CompanySettingsController');

/**
 * The shape that used to break: a workspace whose id is NOT the owner's user
 * id, which is every workspace created through the workspace picker.
 */
const TENANT_ID = 'tenant-uuid-not-a-user-id';
const ACTING_USER_ID = 'user-1';

const VALID_BODY = {
  companyName: 'Acme Pvt Ltd',
  country: 'country-1',
  state: 'Tamil Nadu',
  city: 'Chennai',
};

function makeReqRes(body: Record<string, unknown>, actingUserId: string = ACTING_USER_ID) {
  const req = {
    tenantId: TENANT_ID,
    user: actingUserId,
    body,
    file: undefined,
    protocol: 'http',
    get: vi.fn((header: string) => (header === 'host' ? 'localhost:3001' : undefined)),
  } as unknown as Request;
  const statusMock = vi.fn().mockReturnThis();
  const jsonMock = vi.fn().mockReturnThis();
  const res = { status: statusMock, json: jsonMock } as unknown as Response;
  return { req, res, statusMock, jsonMock };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockCountryFindUnique.mockResolvedValue({ id: 'country-1', name: 'India', iso2: 'IN' });
  mockCurrencyFindFirst.mockResolvedValue(null);
  mockStateFindUnique.mockResolvedValue({ id: 'state-1', name: 'Tamil Nadu' });
  // No existing row: exercises the create branch, which is the one that reads
  // the user's email/phone.
  mockCompanySettingsFindUnique.mockResolvedValue(null);
  mockTxLocalizationFindFirst.mockResolvedValue(null);
  mockTxTimeFormatFindFirst.mockResolvedValue(null);
  mockTxCompanySettingsCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'cs-1', companyLogo: null, ...data }),
  );
  mockTxCompanySettingsUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'cs-1', companyLogo: null, ...data }),
  );

  mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb({
      companySettings: {
        create: mockTxCompanySettingsCreate,
        update: mockTxCompanySettingsUpdate,
      },
      generalSetting: { upsert: mockTxGeneralSettingUpsert },
      localization: {
        findFirst: mockTxLocalizationFindFirst,
        update: vi.fn(),
        create: vi.fn(),
      },
      timeFormat: { findFirst: mockTxTimeFormatFindFirst },
      currency: { updateMany: vi.fn(), update: vi.fn() },
    }),
  );
});

describe('updateCompanySetup — acting user vs tenant id', () => {
  it('completes setup for a workspace whose id is not a user id', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: ACTING_USER_ID,
      email: 'owner@example.com',
      phone: '9000000000',
    });
    const { req, res, statusMock } = makeReqRes(VALID_BODY);

    await updateCompanySetup(req, res);

    // The lookup must use the JWT subject, never the workspace id.
    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { id: ACTING_USER_ID } });
    expect(mockUserFindUnique).not.toHaveBeenCalledWith({ where: { id: TENANT_ID } });
    expect(statusMock).toHaveBeenCalledWith(200);
  });

  it('carries the acting user email/phone onto the new CompanySettings row', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: ACTING_USER_ID,
      email: 'owner@example.com',
      phone: '9000000000',
    });
    const { req, res } = makeReqRes(VALID_BODY);

    await updateCompanySetup(req, res);

    expect(mockTxCompanySettingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          email: 'owner@example.com',
          phone: '9000000000',
        }),
      }),
    );
  });

  it('does not 404 when the user row is missing — it is only a fallback source', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const { req, res, statusMock } = makeReqRes(VALID_BODY);

    await updateCompanySetup(req, res);

    expect(statusMock).not.toHaveBeenCalledWith(404);
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(mockTxCompanySettingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'info@example.com',
          phone: '9876543212',
        }),
      }),
    );
  });

  it('still rejects a payload with no company name', async () => {
    mockUserFindUnique.mockResolvedValue({ id: ACTING_USER_ID, email: null, phone: null });
    const { req, res, statusMock } = makeReqRes({ ...VALID_BODY, companyName: '' });

    await updateCompanySetup(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe('updateCompanySetup — what the wizard adds', () => {
  beforeEach(() => {
    mockUserFindUnique.mockResolvedValue({
      id: ACTING_USER_ID,
      email: 'owner@example.com',
      phone: '9000000000',
    });
  });

  it('records the business type', async () => {
    const { req, res, statusMock } = makeReqRes({ ...VALID_BODY, businessType: 'SERVICES' });

    await updateCompanySetup(req, res);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(mockTxCompanySettingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ businessType: 'SERVICES' }) }),
    );
  });

  it('rejects a business type that is not one of the three', async () => {
    const { req, res, statusMock } = makeReqRes({ ...VALID_BODY, businessType: 'RETAIL' });

    await updateCompanySetup(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('stores the module selection as a GeneralSetting, not a company column', async () => {
    const { req, res } = makeReqRes({
      ...VALID_BODY,
      enabledModules: ['accounts', 'taxation', 'sales'],
    });

    await updateCompanySetup(req, res);

    expect(mockTxGeneralSettingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_key: { tenantId: TENANT_ID, key: 'enabledModules' } },
        create: expect.objectContaining({
          groupSlug: 'onboarding',
          value: ['accounts', 'taxation', 'sales'],
        }),
        update: { value: ['accounts', 'taxation', 'sales'] },
      }),
    );
  });

  it('writes no preference row at all when the wizard sends no selection', async () => {
    // An absent row is what "never chose" looks like, and it must stay absent
    // rather than being written as an empty list.
    const { req, res, statusMock } = makeReqRes(VALID_BODY);

    await updateCompanySetup(req, res);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(mockTxGeneralSettingUpsert).not.toHaveBeenCalled();
  });

  it('rejects a module list containing keys this build does not know', async () => {
    const { req, res, statusMock } = makeReqRes({ ...VALID_BODY, enabledModules: ['crm'] });

    await updateCompanySetup(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('stores the tax id in the column its country implies', async () => {
    const { req, res } = makeReqRes({ ...VALID_BODY, gstin: '33AAECE1234F1Z5' });

    await updateCompanySetup(req, res);

    expect(mockTxCompanySettingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gstin: '33AAECE1234F1Z5' }),
      }),
    );
  });

  it('rejects a malformed ABN with a 400, not a 500', async () => {
    const { req, res, statusMock } = makeReqRes({ ...VALID_BODY, abn: '123' });

    await updateCompanySetup(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('accepts a GSTIN of any shape — a company mid-registration must still finish setup', async () => {
    const { req, res, statusMock } = makeReqRes({ ...VALID_BODY, gstin: 'not-a-real-gstin' });

    await updateCompanySetup(req, res);

    expect(statusMock).toHaveBeenCalledWith(200);
  });

  it('persists stateId alongside the free-text state', async () => {
    const { req, res } = makeReqRes({ ...VALID_BODY, stateId: 'state-1' });

    await updateCompanySetup(req, res);

    expect(mockTxCompanySettingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'Tamil Nadu', stateId: 'state-1' }),
      }),
    );
  });

  it('returns 400, not 500, for a stateId that does not exist', async () => {
    mockStateFindUnique.mockResolvedValue(null);
    const { req, res, statusMock } = makeReqRes({ ...VALID_BODY, stateId: 'bogus' });

    await updateCompanySetup(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('no longer demands a city — the wizard does not ask for one', async () => {
    const { companyName, country, state } = VALID_BODY;
    const { req, res, statusMock } = makeReqRes({ companyName, country, state });

    await updateCompanySetup(req, res);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(mockTxCompanySettingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ city: '' }) }),
    );
  });

  it('still demands a state — it decides GST place of supply', async () => {
    const { companyName, country } = VALID_BODY;
    const { req, res, statusMock } = makeReqRes({ companyName, country });

    await updateCompanySetup(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
  });
});
