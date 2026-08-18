import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  fraudHeaders,
  getObligations,
  submitVatReturn,
  getLiabilities,
  SANDBOX_BASE_URL,
  PROD_BASE_URL,
  type MtdConfigLike,
  type FraudContext,
  type NineBox,
} from './hmrcMtd';

// A fully-configured (live-mode) config: enabled + creds present. Secrets here
// are the DECRYPTED plaintext the controller passes in (the lib never decrypts).
const liveCfg: MtdConfigLike = {
  enabled: true,
  clientId: 'client-abc',
  clientSecret: 'secret-xyz',
  accessToken: 'access-token-1',
  refreshToken: 'refresh-token-1',
  tokenExpiresAt: new Date(Date.now() + 3600_000),
  vrn: '123456789',
  useSandbox: true,
};

const ctx: FraudContext = {
  deviceId: 'device-uuid-1',
  userId: 'user-1',
  publicIp: '203.0.113.7',
  timezone: 'UTC+00:00',
};

const nineBox: NineBox = {
  vatDueSales: 100.0,
  vatDueAcquisitions: 0.0,
  totalVatDue: 100.0,
  vatReclaimedCurrPeriod: 20.0,
  netVatDue: 80.0,
  totalValueSalesExVAT: 500,
  totalValuePurchasesExVAT: 100,
  totalValueGoodsSuppliedExVAT: 0,
  totalAcquisitionsExVAT: 0,
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildAuthUrl', () => {
  it('builds a sandbox OAuth2 authorize URL with read:vat write:vat scope', () => {
    const url = buildAuthUrl(liveCfg, 'state-123', 'https://app/callback');
    expect(url.startsWith(`${SANDBOX_BASE_URL}/oauth/authorize?`)).toBe(true);
    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=client-abc');
    // URLSearchParams encodes the space as '+' (valid application/x-www-form-urlencoded).
    expect(url).toContain('scope=read%3Avat+write%3Avat');
    expect(url).toContain('state=state-123');
    expect(url).toContain(`redirect_uri=${encodeURIComponent('https://app/callback')}`);
  });

  it('uses the production base URL when useSandbox is false', () => {
    const url = buildAuthUrl({ ...liveCfg, useSandbox: false }, 's', 'https://app/cb');
    expect(url.startsWith(`${PROD_BASE_URL}/oauth/authorize?`)).toBe(true);
  });
});

describe('exchangeCode', () => {
  it('POSTs the token endpoint and parses tokens', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: 'AT',
        refresh_token: 'RT',
        expires_in: 14400,
      }),
    );
    const out = await exchangeCode(liveCfg, 'auth-code', 'https://app/cb');
    expect(out.accessToken).toBe('AT');
    expect(out.refreshToken).toBe('RT');
    expect(out.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(`${SANDBOX_BASE_URL}/oauth/token`);
    expect((init as RequestInit).method).toBe('POST');
  });
});

describe('refreshAccessToken', () => {
  it('POSTs grant_type=refresh_token and parses new tokens', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 100 }),
    );
    const out = await refreshAccessToken(liveCfg);
    expect(out.accessToken).toBe('AT2');
    expect(out.refreshToken).toBe('RT2');
    const [, init] = fetchMock.mock.calls[0];
    expect(String((init as RequestInit).body)).toContain('grant_type=refresh_token');
  });
});

describe('fraudHeaders', () => {
  it('emits the required Gov-Client-*/Gov-Vendor-* fraud-prevention headers', () => {
    const h = fraudHeaders(ctx);
    expect(h['Gov-Client-Connection-Method']).toBeDefined();
    expect(h['Gov-Client-Device-ID']).toBe('device-uuid-1');
    expect(h['Gov-Client-User-IDs']).toContain('user-1');
    expect(h['Gov-Client-Timezone']).toBe('UTC+00:00');
    expect(h['Gov-Vendor-Product-Name']).toBeDefined();
    expect(h['Gov-Vendor-Version']).toBeDefined();
  });
});

describe('getObligations', () => {
  it('live mode: calls the MTD API with Bearer auth + fraud headers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        obligations: [{ periodKey: '18A1', start: '2024-01-01', end: '2024-03-31', due: '2024-05-07', status: 'O' }],
      }),
    );
    const out = await getObligations(liveCfg, { from: '2024-01-01', to: '2024-12-31' }, ctx);
    expect(out.mode).toBe('live');
    expect(out.obligations[0].periodKey).toBe('18A1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/organisations/vat/123456789/obligations');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-token-1');
    expect(headers.Accept).toBe('application/vnd.hmrc.1.0+json');
    expect(headers['Gov-Client-Device-ID']).toBe('device-uuid-1');
  });

  it('on 401 refreshes the token then retries ONCE', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 'INVALID_CREDENTIALS' })) // first obligations call
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'AT3', refresh_token: 'RT3', expires_in: 100 })) // refresh
      .mockResolvedValueOnce(jsonResponse(200, { obligations: [{ periodKey: 'X', start: 'a', end: 'b', due: 'c', status: 'O' }] })); // retry
    const out = await getObligations(liveCfg, { from: 'a', to: 'b' }, ctx);
    expect(out.mode).toBe('live');
    expect(out.obligations[0].periodKey).toBe('X');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // second retry uses the freshly refreshed token
    const retryHeaders = (fetchMock.mock.calls[2][1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer AT3');
  });
});

describe('submitVatReturn', () => {
  it('live mode: POSTs the 9-box and returns the receipt', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { formBundleNumber: '256660290587', processingDate: '2024-05-01T10:00:00.000Z' }),
    );
    const out = await submitVatReturn(liveCfg, '18A1', nineBox, ctx);
    expect(out.mode).toBe('live');
    expect(out.formBundleNumber).toBe('256660290587');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/organisations/vat/123456789/returns');
    expect((init as RequestInit).method).toBe('POST');
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.periodKey).toBe('18A1');
    expect(sent.vatDueSales).toBe(100.0);
    expect(sent.finalised).toBe(true);
  });
});

describe('getLiabilities', () => {
  it('live mode: fetches liabilities', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { liabilities: [{ type: 'VAT', originalAmount: 80 }] }));
    const out = await getLiabilities(liveCfg, { from: 'a', to: 'b' }, ctx);
    expect(out.mode).toBe('live');
    expect(out.liabilities[0].originalAmount).toBe(80);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/organisations/vat/123456789/liabilities');
  });
});

describe('mock mode (off by default / no creds)', () => {
  it('getObligations returns mock data WITHOUT calling fetch when disabled', async () => {
    const out = await getObligations({ enabled: false, clientId: 'x' }, { from: 'a', to: 'b' }, ctx);
    expect(out.mode).toBe('mock');
    expect(out.obligations[0].periodKey).toBe('#001');
    expect(out.obligations[0].status).toBe('O');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getObligations returns mock data WITHOUT calling fetch when clientId missing', async () => {
    const out = await getObligations({ enabled: true }, { from: 'a', to: 'b' }, ctx);
    expect(out.mode).toBe('mock');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submitVatReturn returns a mock receipt WITHOUT calling fetch', async () => {
    const out = await submitVatReturn({ enabled: false }, '#001', nineBox, ctx);
    expect(out.mode).toBe('mock');
    expect(out.formBundleNumber).toMatch(/^MOCK-/);
    expect(out.processingDate).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getLiabilities returns mock data WITHOUT calling fetch', async () => {
    const out = await getLiabilities({ enabled: true }, { from: 'a', to: 'b' }, ctx);
    expect(out.mode).toBe('mock');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('timeout / abort handling', () => {
  it('rejects with a timeout error when fetch aborts', async () => {
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        if (signal.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });
    await expect(
      getObligations(liveCfg, { from: 'a', to: 'b' }, ctx, { timeoutMs: 5 }),
    ).rejects.toThrow(/timed out|aborted/i);
  });
});
