/**
 * tests/companySettingsController.fkValidation.test.ts
 *
 * Regression coverage for the "saving Country/State 500s" bug:
 * CompanySettings.countryId/stateId are real Postgres foreign keys into the
 * Country/State tables. On a fresh self-hosted install (geo dataset never
 * imported) or with any stale/bogus id, the old code passed the id straight
 * into prisma.companySettings.upsert() with zero validation, so Postgres
 * threw an FK-violation that surfaced as a raw, generic 500.
 *
 * updateCompanySettings now validates countryId/stateId against the
 * Country/State tables BEFORE the upsert and returns a clean 400 with an
 * actionable message. As defense-in-depth, an unanticipated Prisma P2003
 * (foreign key constraint failed) is also caught in the outer catch block
 * and mapped to a 400 instead of a 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const {
  mockCompanySettingsFindUnique,
  mockCompanySettingsUpsert,
  mockCountryFindUnique,
  mockStateFindUnique,
} = vi.hoisted(() => ({
  mockCompanySettingsFindUnique: vi.fn(),
  mockCompanySettingsUpsert: vi.fn(),
  mockCountryFindUnique: vi.fn(),
  mockStateFindUnique: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    companySettings: {
      findUnique: mockCompanySettingsFindUnique,
      upsert: mockCompanySettingsUpsert,
    },
    country: { findUnique: mockCountryFindUnique },
    state: { findUnique: mockStateFindUnique },
    // updateCompanySettings calls autoInitLedgerForUser() after a successful
    // upsert; it starts with prisma.ledgerAccountMapping.count(), which is
    // deliberately left unmocked here. autoInitLedgerForUser wraps its body
    // in a non-fatal try/catch, so the resulting TypeError is swallowed and
    // logged as a warning — it does not affect the response under test.
  },
}));

const { updateCompanySettings } = await import('../controllers/CompanySettingsController');

const TENANT_ID = 'tenant-1';

function makeReqRes(body: Record<string, unknown>) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    body,
    files: undefined,
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
  mockCompanySettingsFindUnique.mockResolvedValue(null);
});

describe('updateCompanySettings — country/state FK validation', () => {
  it('returns 400 (not 500) when countryId does not exist', async () => {
    mockCountryFindUnique.mockResolvedValue(null);
    const { req, res, statusMock, jsonMock } = makeReqRes({ countryId: 'bogus-country-id' });

    await updateCompanySettings(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringMatching(/country.*not found/i) }),
    );
    expect(mockCompanySettingsUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 (not 500) when stateId does not exist', async () => {
    mockStateFindUnique.mockResolvedValue(null);
    const { req, res, statusMock, jsonMock } = makeReqRes({ stateId: 'bogus-state-id' });

    await updateCompanySettings(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringMatching(/state.*not found/i) }),
    );
    expect(mockCompanySettingsUpsert).not.toHaveBeenCalled();
  });

  it('succeeds when no country/state ids are provided', async () => {
    mockCompanySettingsUpsert.mockResolvedValue({
      userId: TENANT_ID,
      companyName: 'Acme',
      siteLogo: null,
      favicon: null,
      companyLogo: null,
      companyBanner: null,
    });
    const { req, res, statusMock, jsonMock } = makeReqRes({ companyName: 'Acme' });

    await updateCompanySettings(req, res);

    expect(mockCountryFindUnique).not.toHaveBeenCalled();
    expect(mockStateFindUnique).not.toHaveBeenCalled();
    expect(mockCompanySettingsUpsert).toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('succeeds when countryId and stateId both exist', async () => {
    mockCountryFindUnique.mockResolvedValue({ id: 'c-india', iso2: 'IN' });
    mockStateFindUnique.mockResolvedValue({ id: 's-tn', name: 'Tamil Nadu' });
    mockCompanySettingsUpsert.mockResolvedValue({
      userId: TENANT_ID,
      companyName: 'Acme',
      countryId: 'c-india',
      stateId: 's-tn',
      siteLogo: null,
      favicon: null,
      companyLogo: null,
      companyBanner: null,
    });
    const { req, res, statusMock, jsonMock } = makeReqRes({ countryId: 'c-india', stateId: 's-tn' });

    await updateCompanySettings(req, res);

    expect(mockCompanySettingsUpsert).toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('maps an unanticipated Prisma P2003 FK violation to a clean 400, not a 500', async () => {
    mockCountryFindUnique.mockResolvedValue({ id: 'c-india', iso2: 'IN' });
    const { Prisma } = await import('@prisma/client');
    const fkError = new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
      code: 'P2003',
      clientVersion: 'test',
    });
    mockCompanySettingsUpsert.mockRejectedValue(fkError);
    const { req, res, statusMock, jsonMock } = makeReqRes({ countryId: 'c-india' });

    await updateCompanySettings(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringMatching(/invalid/i) }),
    );
  });
});
