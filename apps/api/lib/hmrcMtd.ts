/**
 * HMRC Making Tax Digital (MTD) VAT client.
 *
 * BYOK + off-by-default + MOCK MODE (CodeCanyon distribution model): when the
 * tenant has not configured & enabled HMRC credentials, EVERY client function
 * returns deterministic mock data tagged `{ mode: 'mock' }` and makes NO network
 * call. Real ("live") mode only happens when `cfg.enabled && cfg.clientId`.
 *
 * ── Secret contract (for the Task 3 controller) ───────────────────────────────
 *   This lib NEVER encrypts or decrypts. It consumes the values it is given.
 *   `clientSecret`, `accessToken`, `refreshToken` must already be PLAINTEXT when
 *   passed in. The controller is responsible for:
 *     - encrypting on write (lib/configSecret `encryptConfigSecrets` / `enc::`),
 *     - decrypting at point-of-use (decryptSecret) BEFORE calling these fns,
 *     - masking on read (never returning the ciphertext/plaintext to clients).
 *   When `refreshAccessToken` / `exchangeCode` return new tokens, the controller
 *   re-encrypts and persists them (and updates `tokenExpiresAt`).
 *
 * No real network is ever hit in tests or by default; live calls use a mocked
 * global `fetch` in tests. AbortController enforces a per-call timeout.
 */

// HMRC API base URLs. Sandbox is the safe default for self-host/demo.
export const SANDBOX_BASE_URL = 'https://test-api.service.hmrc.gov.uk';
export const PROD_BASE_URL = 'https://api.service.hmrc.gov.uk';

// MTD VAT API requires this versioned Accept header.
const ACCEPT_HEADER = 'application/vnd.hmrc.1.0+json';
const OAUTH_SCOPE = 'read:vat write:vat';
const DEFAULT_TIMEOUT_MS = 10_000;

// Vendor identity used in fraud-prevention + (informally) elsewhere.
const VENDOR_PRODUCT_NAME = 'Elixir Books';
const VENDOR_VERSION = `${VENDOR_PRODUCT_NAME}=2.0.1`;

/**
 * The subset of the persisted MtdConfig the client needs. Secrets are the
 * DECRYPTED plaintext values (the controller decrypts before calling).
 */
export interface MtdConfigLike {
  enabled?: boolean;
  clientId?: string | null;
  clientSecret?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | string | null;
  vrn?: string | null;
  useSandbox?: boolean;
}

/** Context used to build HMRC fraud-prevention headers (per-request + server). */
export interface FraudContext {
  /** Stable per-device identifier (UUID) — Gov-Client-Device-ID. */
  deviceId?: string;
  /** The originating end-user id within Elixir Books — Gov-Client-User-IDs. */
  userId?: string;
  /** Public IP of the originating device, if known — Gov-Client-Public-IP. */
  publicIp?: string;
  /** IANA/UTC offset of the originating device — Gov-Client-Timezone. */
  timezone?: string;
  /** User-agent of the originating device — Gov-Client-User-Agent. */
  userAgent?: string;
  /**
   * Connection method. `OTHER_DIRECT` = interactive call originated by the
   * end-user via our server; `BATCH_PROCESS_DIRECT` = unattended/scheduled.
   */
  connectionMethod?: 'OTHER_DIRECT' | 'BATCH_PROCESS_DIRECT';
}

/** The UK VAT 9-box figures (reused from the tax-returns computation). */
export interface NineBox {
  vatDueSales: number; // Box 1
  vatDueAcquisitions: number; // Box 2
  totalVatDue: number; // Box 3 = 1 + 2
  vatReclaimedCurrPeriod: number; // Box 4
  netVatDue: number; // Box 5 = |3 - 4|
  totalValueSalesExVAT: number; // Box 6
  totalValuePurchasesExVAT: number; // Box 7
  totalValueGoodsSuppliedExVAT: number; // Box 8
  totalAcquisitionsExVAT: number; // Box 9
}

export interface Obligation {
  periodKey: string;
  start: string;
  end: string;
  due: string;
  status: string; // 'O' = open, 'F' = fulfilled
  received?: string;
}

export interface ObligationsResult {
  mode: 'mock' | 'live';
  obligations: Obligation[];
}

export interface SubmitResult {
  mode: 'mock' | 'live';
  formBundleNumber: string;
  processingDate: string;
  chargeRefNumber?: string;
  paymentIndicator?: string;
}

export interface Liability {
  type: string;
  originalAmount: number;
  outstandingAmount?: number;
  due?: string;
  taxPeriod?: { from: string; to: string };
}

export interface LiabilitiesResult {
  mode: 'mock' | 'live';
  liabilities: Liability[];
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface CallOptions {
  timeoutMs?: number;
}

// ── Mode helpers ──────────────────────────────────────────────────────────────

/** Live mode requires the tenant to have both enabled the feature AND set a clientId. */
function isLive(cfg: MtdConfigLike): boolean {
  return Boolean(cfg.enabled && cfg.clientId);
}

function baseUrl(cfg: MtdConfigLike): string {
  // Default to sandbox unless explicitly opted into production.
  return cfg.useSandbox === false ? PROD_BASE_URL : SANDBOX_BASE_URL;
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

/** Build the HMRC OAuth2 authorize URL (scope `read:vat write:vat`). */
export function buildAuthUrl(cfg: MtdConfigLike, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId ?? '',
    scope: OAUTH_SCOPE,
    state,
    redirect_uri: redirectUri,
  });
  return `${baseUrl(cfg)}/oauth/authorize?${params.toString()}`;
}

async function postToken(cfg: MtdConfigLike, body: URLSearchParams, opts?: CallOptions): Promise<TokenResult> {
  const json = await fetchJson(
    `${baseUrl(cfg)}/oauth/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    },
    opts,
  );
  const data = json as { access_token: string; refresh_token: string; expires_in?: number };
  const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 14_400;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + expiresInSec * 1000),
  };
}

/** Exchange an authorization code for access + refresh tokens. */
export function exchangeCode(
  cfg: MtdConfigLike,
  code: string,
  redirectUri: string,
  opts?: CallOptions,
): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.clientId ?? '',
    client_secret: cfg.clientSecret ?? '',
    redirect_uri: redirectUri,
    code,
  });
  return postToken(cfg, body, opts);
}

/** Use the stored refresh token to obtain a fresh access token. */
export function refreshAccessToken(cfg: MtdConfigLike, opts?: CallOptions): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cfg.clientId ?? '',
    client_secret: cfg.clientSecret ?? '',
    refresh_token: cfg.refreshToken ?? '',
  });
  return postToken(cfg, body, opts);
}

// ── Fraud-prevention headers ──────────────────────────────────────────────────

/**
 * Build the HMRC fraud-prevention headers required on every MTD VAT API call.
 * See https://developer.service.hmrc.gov.uk/guides/fraud-prevention/.
 *
 *  - Gov-Client-Connection-Method: how the call reached HMRC. `OTHER_DIRECT`
 *      for interactive end-user-originated calls via our server (default);
 *      `BATCH_PROCESS_DIRECT` for unattended/scheduled submissions.
 *  - Gov-Client-Device-ID:        stable per-device UUID for the end-user device.
 *  - Gov-Client-User-IDs:         id(s) of the originating user, key=value list
 *                                 (here `elixirbooks=<userId>`).
 *  - Gov-Client-Timezone:         the end-user device's UTC offset (e.g. UTC+01:00).
 *  - Gov-Client-Public-IP:        public IP of the originating device (if known).
 *  - Gov-Client-User-Agent:       the originating device's user-agent (if known).
 *  - Gov-Vendor-Version:          our software's name=version.
 *  - Gov-Vendor-Product-Name:     our product name.
 */
export function fraudHeaders(ctx: FraudContext): Record<string, string> {
  const headers: Record<string, string> = {
    'Gov-Client-Connection-Method': ctx.connectionMethod ?? 'OTHER_DIRECT',
    'Gov-Vendor-Version': VENDOR_VERSION,
    'Gov-Vendor-Product-Name': VENDOR_PRODUCT_NAME,
  };
  if (ctx.deviceId) headers['Gov-Client-Device-ID'] = ctx.deviceId;
  if (ctx.userId) headers['Gov-Client-User-IDs'] = `elixirbooks=${encodeURIComponent(ctx.userId)}`;
  if (ctx.timezone) headers['Gov-Client-Timezone'] = ctx.timezone;
  if (ctx.publicIp) headers['Gov-Client-Public-IP'] = ctx.publicIp;
  if (ctx.userAgent) headers['Gov-Client-User-Agent'] = ctx.userAgent;
  return headers;
}

// ── Low-level fetch with timeout ──────────────────────────────────────────────

async function fetchJson(url: string, init: RequestInit, opts?: CallOptions): Promise<unknown> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return await readResponse(res, url);
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))) {
      throw new Error(`HMRC request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function readResponse(res: Response, url: string): Promise<unknown> {
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    const error = new Error(`HMRC API ${res.status} for ${url}: ${detail}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

/**
 * Authenticated GET/POST to the MTD VAT API with Bearer auth + Accept +
 * fraud headers. On a 401 it refreshes the token (using cfg.refreshToken) and
 * retries the request ONCE with the new access token.
 */
async function authedCall(
  cfg: MtdConfigLike,
  path: string,
  ctx: FraudContext,
  init: { method: 'GET' | 'POST'; body?: unknown },
  opts?: CallOptions,
): Promise<unknown> {
  const url = `${baseUrl(cfg)}${path}`;
  let accessToken = cfg.accessToken ?? '';

  const doRequest = (token: string): Promise<unknown> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT_HEADER,
      ...fraudHeaders(ctx),
    };
    const requestInit: RequestInit = { method: init.method, headers };
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestInit.body = JSON.stringify(init.body);
    }
    return fetchJson(url, requestInit, opts);
  };

  try {
    return await doRequest(accessToken);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 && cfg.refreshToken) {
      const refreshed = await refreshAccessToken(cfg, opts);
      accessToken = refreshed.accessToken;
      // NOTE: the controller persists the refreshed tokens; here we just retry.
      return doRequest(accessToken);
    }
    throw err;
  }
}

// ── MTD VAT API ───────────────────────────────────────────────────────────────

/** Fetch VAT obligations for a date range. Mock mode → one open period. */
export async function getObligations(
  cfg: MtdConfigLike,
  range: { from: string; to: string; status?: 'O' | 'F' },
  ctx: FraudContext,
  opts?: CallOptions,
): Promise<ObligationsResult> {
  if (!isLive(cfg)) {
    return {
      mode: 'mock',
      obligations: [
        {
          periodKey: '#001',
          start: range.from,
          end: range.to,
          due: range.to,
          status: 'O',
        },
      ],
    };
  }
  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (range.status) params.set('status', range.status);
  const json = (await authedCall(
    cfg,
    `/organisations/vat/${cfg.vrn}/obligations?${params.toString()}`,
    ctx,
    { method: 'GET' },
    opts,
  )) as { obligations?: Obligation[] };
  return { mode: 'live', obligations: json.obligations ?? [] };
}

/** Submit the 9-box VAT return for a period. Mock mode → a MOCK receipt. */
export async function submitVatReturn(
  cfg: MtdConfigLike,
  periodKey: string,
  nineBox: NineBox,
  ctx: FraudContext,
  opts?: CallOptions,
): Promise<SubmitResult> {
  if (!isLive(cfg)) {
    return {
      mode: 'mock',
      formBundleNumber: `MOCK-${Date.now()}`,
      processingDate: new Date().toISOString(),
    };
  }
  const body = { periodKey, ...nineBox, finalised: true };
  const json = (await authedCall(
    cfg,
    `/organisations/vat/${cfg.vrn}/returns`,
    ctx,
    { method: 'POST', body },
    opts,
  )) as { formBundleNumber: string; processingDate: string; chargeRefNumber?: string; paymentIndicator?: string };
  return {
    mode: 'live',
    formBundleNumber: json.formBundleNumber,
    processingDate: json.processingDate,
    chargeRefNumber: json.chargeRefNumber,
    paymentIndicator: json.paymentIndicator,
  };
}

/** Fetch VAT liabilities for a date range. Mock mode → one mock liability. */
export async function getLiabilities(
  cfg: MtdConfigLike,
  range: { from: string; to: string },
  ctx: FraudContext,
  opts?: CallOptions,
): Promise<LiabilitiesResult> {
  if (!isLive(cfg)) {
    return {
      mode: 'mock',
      liabilities: [
        {
          type: 'VAT',
          originalAmount: 0,
          outstandingAmount: 0,
          taxPeriod: { from: range.from, to: range.to },
        },
      ],
    };
  }
  const params = new URLSearchParams({ from: range.from, to: range.to });
  const json = (await authedCall(
    cfg,
    `/organisations/vat/${cfg.vrn}/liabilities?${params.toString()}`,
    ctx,
    { method: 'GET' },
    opts,
  )) as { liabilities?: Liability[] };
  return { mode: 'live', liabilities: json.liabilities ?? [] };
}
