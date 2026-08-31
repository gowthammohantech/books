// tests/mtdController.test.ts
//
// Unit tests for the HMRC MTD VAT endpoints (Task 3). Strategy: mock the lib
// (lib/hmrcMtd) so NO network is touched, mock the prisma slice the controller
// uses (mtdConfig), and mock loadTaxFigures so submit's 9-box comes from a known
// GL figure set. We assert:
//   - GET /mtd/config masks secrets (has* flags, never ciphertext/plaintext).
//   - PUT /mtd/config encrypts clientSecret and "blank keeps current".
//   - obligations/liabilities/submit call the lib and return its result.
//   - submit pulls the 9-box via loadTaxFigures + buildUkVatBoxes (not recomputed).
//   - a near-expired live token is refreshed AND the new tokens are PERSISTED
//     (encrypted) before the lib call.
//   - live submit without a VRN is rejected 400.

// Encryption key for the real emailSecret/aiCrypto round-trips (derived from JWT_SECRET).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { TaxFigures } from '../lib/reports/taxReturns';

// ---------------------------------------------------------------------------
// Hoisted mocks.
// ---------------------------------------------------------------------------
const {
  mockFindUnique,
  mockUpsert,
  mockUpdate,
  mockLoadTaxFigures,
  mockGetObligations,
  mockSubmitVatReturn,
  mockGetLiabilities,
  mockExchangeCode,
  mockRefreshAccessToken,
  mockBuildAuthUrl,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockLoadTaxFigures: vi.fn(),
  mockGetObligations: vi.fn(),
  mockSubmitVatReturn: vi.fn(),
  mockGetLiabilities: vi.fn(),
  mockExchangeCode: vi.fn(),
  mockRefreshAccessToken: vi.fn(),
  mockBuildAuthUrl: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    mtdConfig: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
      update: mockUpdate,
    },
  },
}));

vi.mock('../lib/reports/taxReturns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/reports/taxReturns')>();
  return { ...actual, loadTaxFigures: mockLoadTaxFigures };
});

vi.mock('../lib/hmrcMtd', () => ({
  buildAuthUrl: mockBuildAuthUrl,
  exchangeCode: mockExchangeCode,
  refreshAccessToken: mockRefreshAccessToken,
  getObligations: mockGetObligations,
  submitVatReturn: mockSubmitVatReturn,
  getLiabilities: mockGetLiabilities,
}));

// Use the REAL emailSecret so encrypt/decrypt round-trips (enc:: marker).
import { isEncrypted, decryptSecret, encryptSecret } from '../lib/emailSecret';
const enc = (s: string) => encryptSecret(s);

import {
  getConfig,
  putConfig,
  obligations,
  submit,
  liabilities,
  callback,
} from '../controllers/mtdController';

const D = (v: number | string) => new Prisma.Decimal(v);

const FIG: TaxFigures = {
  outputTax: D('1000.00'),
  inputTax: D('250.00'),
  salesExTax: D('5000.50'),
  purchasesExTax: D('1250.75'),
  salesInclTax: D('6000.50'),
  purchasesInclTax: D('1500.75'),
};

// ---------------------------------------------------------------------------
// req/res helpers.
// ---------------------------------------------------------------------------
interface MockRes {
  statusCode: number;
  body: any;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
}
function makeRes(): any {
  const res: Partial<MockRes> = {
    statusCode: 200,
    status(c: number) {
      res.statusCode = c;
      return res as MockRes;
    },
    json(b: unknown) {
      res.body = b;
      return res as MockRes;
    },
  };
  return res as MockRes;
}
function makeReq(opts: { query?: any; body?: any } = {}): any {
  return {
    query: opts.query ?? {},
    body: opts.body ?? {},
    headers: {},
    socket: {},
    tenantId: 'tenant-1',
    user: 'tenant-1',
  };
}

beforeEach(() => {
  for (const m of [
    mockFindUnique,
    mockUpsert,
    mockUpdate,
    mockLoadTaxFigures,
    mockGetObligations,
    mockSubmitVatReturn,
    mockGetLiabilities,
    mockExchangeCode,
    mockRefreshAccessToken,
    mockBuildAuthUrl,
  ]) {
    m.mockReset();
  }
  mockLoadTaxFigures.mockResolvedValue(FIG);
});

// ===========================================================================
// GET /mtd/config — masking
// ===========================================================================
describe('getConfig (masking)', () => {
  it('returns has* flags + connected, never the secrets themselves', async () => {
    mockFindUnique.mockResolvedValue({
      enabled: true,
      useSandbox: false,
      vrn: '123456789',
      clientId: 'cid',
      clientSecret: 'enc::ciphertext',
      accessToken: 'enc::tok',
      refreshToken: 'enc::ref',
      tokenExpiresAt: new Date(),
    });
    const res = makeRes();
    await getConfig(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      enabled: true,
      useSandbox: false,
      vrn: '123456789',
      hasClientId: true,
      hasClientSecret: true,
      connected: true,
    });
    // No secret material leaks anywhere in the body.
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain('ciphertext');
    expect(blob).not.toContain('enc::');
  });

  it('defaults to disabled/mock when no row exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = makeRes();
    await getConfig(makeReq(), res);
    expect(res.body.data).toEqual({
      enabled: false,
      useSandbox: true,
      vrn: null,
      hasClientId: false,
      hasClientSecret: false,
      connected: false,
    });
  });
});

// ===========================================================================
// PUT /mtd/config — encrypt + blank-keeps-current
// ===========================================================================
describe('putConfig (encrypt + blank-keeps-current)', () => {
  it('encrypts a supplied clientSecret at rest', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({});
    const res = makeRes();
    await putConfig(
      makeReq({ body: { enabled: true, vrn: '999', clientId: 'cid', clientSecret: 'plainSecret' } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    const data = mockUpsert.mock.calls[0][0].create;
    expect(isEncrypted(data.clientSecret)).toBe(true);
    expect(decryptSecret(data.clientSecret)).toBe('plainSecret');
    // masked response, no cleartext
    expect(res.body.data.hasClientSecret).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('plainSecret');
  });

  it('keeps the stored clientSecret when a blank one is supplied', async () => {
    mockFindUnique.mockResolvedValue({
      enabled: false,
      useSandbox: true,
      vrn: '111',
      clientId: 'cid',
      clientSecret: 'enc::storedCipher',
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
    });
    mockUpsert.mockResolvedValue({});
    const res = makeRes();
    await putConfig(makeReq({ body: { enabled: true, clientSecret: '   ' } }), res);
    const data = mockUpsert.mock.calls[0][0].update;
    expect(data.clientSecret).toBe('enc::storedCipher'); // unchanged
  });
});

// ===========================================================================
// obligations / liabilities — mock mode (no row → no network, lib decides)
// ===========================================================================
describe('obligations + liabilities', () => {
  it('calls the lib and returns its result (mock cfg when no row)', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockGetObligations.mockResolvedValue({ mode: 'mock', obligations: [{ periodKey: '#001' }] });
    const res = makeRes();
    await obligations(makeReq({ query: { from: '2026-01-01', to: '2026-03-31' } }), res);
    expect(mockGetObligations).toHaveBeenCalledOnce();
    expect(res.body.data.mode).toBe('mock');
    // never refreshes when there is no live cfg
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a missing period with 400', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = makeRes();
    await liabilities(makeReq({ query: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(mockGetLiabilities).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Token persistence on refresh (near-expiry live cfg)
// ===========================================================================
describe('withFreshTokens (token persistence)', () => {
  it('refreshes + persists encrypted tokens when the access token is near expiry, then calls the lib', async () => {
    mockFindUnique.mockResolvedValue({
      enabled: true,
      useSandbox: true,
      vrn: '123',
      clientId: 'cid',
      clientSecret: enc('secret'),
      accessToken: enc('oldAccess'),
      refreshToken: enc('oldRefresh'),
      tokenExpiresAt: new Date(Date.now() - 1000), // already expired
    });
    const newExpiry = new Date(Date.now() + 4 * 3600 * 1000);
    mockRefreshAccessToken.mockResolvedValue({
      accessToken: 'freshAccess',
      refreshToken: 'freshRefresh',
      expiresAt: newExpiry,
    });
    mockUpdate.mockResolvedValue({});
    mockGetLiabilities.mockResolvedValue({ mode: 'live', liabilities: [] });

    const res = makeRes();
    await liabilities(makeReq({ query: { from: '2026-01-01', to: '2026-03-31' } }), res);

    // refreshed once
    expect(mockRefreshAccessToken).toHaveBeenCalledOnce();
    // persisted, encrypted
    const data = mockUpdate.mock.calls[0][0].data;
    expect(isEncrypted(data.accessToken)).toBe(true);
    expect(decryptSecret(data.accessToken)).toBe('freshAccess');
    expect(decryptSecret(data.refreshToken)).toBe('freshRefresh');
    expect(data.tokenExpiresAt).toEqual(newExpiry);
    // lib received the fresh (decrypted) token
    const cfgArg = mockGetLiabilities.mock.calls[0][0];
    expect(cfgArg.accessToken).toBe('freshAccess');
    expect(res.statusCode).toBe(200);
  });

  it('does NOT refresh when the stored token is still valid', async () => {
    mockFindUnique.mockResolvedValue({
      enabled: true,
      clientId: 'cid',
      clientSecret: enc('x'),
      accessToken: enc('ok'),
      refreshToken: enc('ref'),
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      vrn: '123',
      useSandbox: true,
    });
    mockGetObligations.mockResolvedValue({ mode: 'live', obligations: [] });
    const res = makeRes();
    await obligations(makeReq({ query: { from: '2026-01-01', to: '2026-03-31' } }), res);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// POST /mtd/submit — pulls the 9-box via the tax-returns computation
// ===========================================================================
describe('submit (9-box reuse)', () => {
  it('computes the 9-box from loadTaxFigures and passes it to submitVatReturn', async () => {
    mockFindUnique.mockResolvedValue(null); // mock mode (no creds)
    mockSubmitVatReturn.mockResolvedValue({
      mode: 'mock',
      formBundleNumber: 'MOCK-1',
      processingDate: '2026-04-01T00:00:00.000Z',
    });
    const res = makeRes();
    await submit(
      makeReq({ body: { periodKey: '#001', from: '2026-01-01', to: '2026-03-31' } }),
      res,
    );

    expect(mockLoadTaxFigures).toHaveBeenCalledOnce();
    expect(mockSubmitVatReturn).toHaveBeenCalledOnce();
    const [, periodKeyArg, nineBoxArg] = mockSubmitVatReturn.mock.calls[0];
    expect(periodKeyArg).toBe('#001');
    // Boxes match buildUkVatBoxes(FIG): box1=outputTax 2dp, box4=inputTax 2dp,
    // box5=|box3-box4|, box6/7 floored.
    expect(nineBoxArg.vatDueSales).toBe(1000);
    expect(nineBoxArg.vatReclaimedCurrPeriod).toBe(250);
    expect(nineBoxArg.netVatDue).toBe(750);
    expect(nineBoxArg.totalValueSalesExVAT).toBe(5000); // floored
    expect(nineBoxArg.totalValuePurchasesExVAT).toBe(1250); // floored
    expect(res.body.data.receipt.mode).toBe('mock');
    expect(res.body.data.nineBox.vatDueSales).toBe(1000);
  });

  it('rejects a missing periodKey with 400', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = makeRes();
    await submit(makeReq({ body: { from: '2026-01-01', to: '2026-03-31' } }), res);
    expect(res.statusCode).toBe(400);
    expect(mockSubmitVatReturn).not.toHaveBeenCalled();
  });

  it('rejects a live submit with no VRN (400) and never calls HMRC', async () => {
    mockFindUnique.mockResolvedValue({
      enabled: true,
      clientId: 'cid',
      clientSecret: enc('x'),
      accessToken: enc('ok'),
      refreshToken: enc('ref'),
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      vrn: null, // missing
      useSandbox: true,
    });
    const res = makeRes();
    await submit(
      makeReq({ body: { periodKey: '#001', from: '2026-01-01', to: '2026-03-31' } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(mockSubmitVatReturn).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// callback (connect) — mock mode persists mock tokens; live exchanges + persists
// ===========================================================================
describe('callback (connect)', () => {
  it('mock mode marks connected with encrypted mock tokens (no exchange)', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({});
    const res = makeRes();
    await callback(makeReq({ query: {} }), res);
    expect(mockExchangeCode).not.toHaveBeenCalled();
    expect(res.body.mode).toBe('mock');
    const data = mockUpsert.mock.calls[0][0].create;
    expect(isEncrypted(data.accessToken)).toBe(true);
    expect(decryptSecret(data.accessToken)).toBe('mock-access-token');
  });

  it('live mode exchanges the code and persists encrypted tokens', async () => {
    mockFindUnique.mockResolvedValue({
      enabled: true,
      clientId: 'cid',
      clientSecret: enc('secret'),
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      vrn: '123',
      useSandbox: true,
    });
    const expiresAt = new Date(Date.now() + 4 * 3600 * 1000);
    mockExchangeCode.mockResolvedValue({
      accessToken: 'realAccess',
      refreshToken: 'realRefresh',
      expiresAt,
    });
    mockUpdate.mockResolvedValue({});
    const res = makeRes();
    await callback(makeReq({ query: { code: 'authcode', redirectUri: 'https://app/cb' } }), res);
    expect(mockExchangeCode).toHaveBeenCalledOnce();
    expect(res.body.mode).toBe('live');
    const data = mockUpdate.mock.calls[0][0].data;
    expect(decryptSecret(data.accessToken)).toBe('realAccess');
    expect(decryptSecret(data.refreshToken)).toBe('realRefresh');
    expect(data.tokenExpiresAt).toEqual(expiresAt);
  });
});
