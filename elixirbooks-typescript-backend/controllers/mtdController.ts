// controllers/mtdController.ts
//
// HMRC Making Tax Digital (MTD) VAT endpoints — connect / obligations / submit /
// liabilities. BYOK + off-by-default + MOCK MODE (CodeCanyon distribution model):
// with no HMRC credentials the feature reports `mode:'mock'`, returns deterministic
// mock data, and NEVER makes an outbound call (the lib enforces this via isLive()).
//
// ── Secret contract ──────────────────────────────────────────────────────────
//   clientSecret / accessToken / refreshToken are encrypted at rest behind the
//   `enc::` marker (lib/emailSecret) and are NEVER returned cleartext — the read
//   endpoint masks them to has* flags. They are decrypted ONLY at point-of-use
//   when building the `cfg` object passed to lib/hmrcMtd. When the lib's authed
//   call refreshes the token (401 → refresh, in-memory only), this controller
//   re-encrypts and persists the new tokens (see withTokenPersistence).
//
// All handlers are protect + tenant-scoped (requireUserId = ownerId ?? id) and
// gated in the route by requirePermission('accounting-reports','edit'); mutations
// (config save / connect) additionally require the Owner role (req.actor.isOwner).
//
// The UK 9-box submitted to HMRC is pulled from the SAME tax-returns computation
// used by the on-screen UK VAT return (loadTaxFigures + buildUkVatBoxes) — the
// boxes are NOT recomputed here.

import type { Request, Response } from 'express';
import { randomBytes } from 'crypto';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { encryptSecret, decryptSecret } from '../lib/emailSecret';
import {
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  getObligations,
  submitVatReturn,
  getLiabilities,
  type MtdConfigLike,
  type FraudContext,
  type NineBox,
  type TokenResult,
} from '../lib/hmrcMtd';
import { loadTaxFigures } from '../lib/reports/taxReturns';
import { buildUkVatBoxes } from './taxReturnController';

// ── Error helpers ─────────────────────────────────────────────────────────────

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

class BadRequestError extends Error {}

function handleError(res: Response, err: unknown, what: string): void {
  if (err instanceof BadRequestError) {
    res.status(400).json({ success: false, message: err.message });
    return;
  }
  if (handleUnauthorized(res, err)) return;
  console.error(`MTD ${what} error:`, err);
  res.status(500).json({
    success: false,
    message: `Failed to ${what}`,
    error: err instanceof Error ? err.message : String(err),
  });
}

// ── Date parsing (mirrors taxReturnController) ──────────────────────────────────

function parseDateParam(value: unknown, kind: 'from' | 'to'): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestError(`Query param "${kind}" is required as YYYY-MM-DD`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const ms =
    kind === 'from'
      ? Date.UTC(y, m - 1, d, 0, 0, 0, 0)
      : Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  const date = new Date(ms);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new BadRequestError(`Query param "${kind}" is not a valid YYYY-MM-DD date`);
  }
  return date;
}

/** Parse the `from`/`to` range from either query or body. Returns date-only
 *  strings (for the lib) plus Date objects (for the GL computation). */
function parseRange(source: Record<string, unknown>): {
  fromStr: string;
  toStr: string;
  fromDate: Date;
  toDate: Date;
} {
  const fromDate = parseDateParam(source.from, 'from');
  const toDate = parseDateParam(source.to, 'to');
  if (fromDate.getTime() > toDate.getTime()) {
    throw new BadRequestError('Query param "from" must not be after "to"');
  }
  return {
    fromStr: fromDate.toISOString().slice(0, 10),
    toStr: toDate.toISOString().slice(0, 10),
    fromDate,
    toDate,
  };
}

// ── cfg load / decrypt + token persistence ──────────────────────────────────────

type MtdRow = {
  id: string;
  userId: string;
  enabled: boolean;
  clientId: string | null;
  clientSecret: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  vrn: string | null;
  useSandbox: boolean;
};

/**
 * Load the tenant's MtdConfig and build a DECRYPTED MtdConfigLike for the lib.
 * Returns null when no row exists (treated as fully-disabled / mock).
 */
async function loadDecryptedCfg(userId: string): Promise<{ row: MtdRow; cfg: MtdConfigLike } | null> {
  const row = (await prisma.mtdConfig.findUnique({ where: { userId } })) as MtdRow | null;
  if (!row) return null;
  const cfg: MtdConfigLike = {
    enabled: row.enabled,
    clientId: row.clientId,
    clientSecret: decryptSecret(row.clientSecret),
    accessToken: decryptSecret(row.accessToken),
    refreshToken: decryptSecret(row.refreshToken),
    tokenExpiresAt: row.tokenExpiresAt,
    vrn: row.vrn,
    useSandbox: row.useSandbox,
  };
  return { row, cfg };
}

/** Re-encrypt + persist a fresh access/refresh token pair (+ new expiry). */
async function persistTokens(userId: string, tokens: TokenResult): Promise<void> {
  await prisma.mtdConfig.update({
    where: { userId },
    data: {
      accessToken: encryptSecret(tokens.accessToken),
      refreshToken: encryptSecret(tokens.refreshToken),
      tokenExpiresAt: tokens.expiresAt,
    },
  });
}

/**
 * Ensure the cfg passed to a lib call carries valid (and PERSISTED) tokens.
 *
 * The lib refreshes tokens IN-MEMORY only on a 401 and never writes them back —
 * so its internal refresh would be lost. To honour "401 → refresh → persist" we
 * pre-empt it: when the stored access token is missing or within the skew window
 * of expiry, we refresh via the lib HERE, persist the re-encrypted tokens, and
 * hand the lib a cfg with the fresh tokens. The upcoming call then succeeds with
 * a valid token AND the new tokens are durably stored. Mock/disabled cfgs and
 * cfgs without a refresh token are passed through untouched (no network).
 */
async function withFreshTokens(
  userId: string,
  loaded: { row: MtdRow; cfg: MtdConfigLike },
): Promise<MtdConfigLike> {
  const { row, cfg } = loaded;
  // Only relevant in live mode with a refresh token + a known expiry.
  const isLive = Boolean(cfg.enabled && cfg.clientId);
  if (!isLive || !cfg.refreshToken) return cfg;
  const expiry = row.tokenExpiresAt ? row.tokenExpiresAt.getTime() : 0;
  const skewMs = 60_000; // refresh a minute early
  if (expiry && expiry - skewMs > Date.now()) return cfg; // still valid

  // Token missing/expired → refresh now and persist, so the upcoming call uses
  // valid tokens AND the new tokens are saved (the lib's own 401-refresh would
  // not be persisted, so we pre-empt it here).
  const refreshed = await refreshAccessToken(cfg);
  await persistTokens(userId, refreshed);
  cfg.accessToken = refreshed.accessToken;
  cfg.refreshToken = refreshed.refreshToken;
  cfg.tokenExpiresAt = refreshed.expiresAt;
  return cfg;
}

/** Build the HMRC fraud-prevention context from the request + tenant. */
function fraudCtx(req: Request, userId: string): FraudContext {
  const fwd = req.headers['x-forwarded-for'];
  const publicIp =
    (typeof fwd === 'string' ? fwd.split(',')[0]?.trim() : Array.isArray(fwd) ? fwd[0] : undefined) ||
    req.socket?.remoteAddress ||
    undefined;
  const ua = req.headers['user-agent'];
  return {
    userId,
    connectionMethod: 'OTHER_DIRECT',
    publicIp,
    userAgent: typeof ua === 'string' ? ua : undefined,
  };
}

// ── 9-box: reuse the tax-returns computation ────────────────────────────────────

/**
 * Build the HMRC NineBox payload for [from, to] from the SAME GL computation the
 * on-screen UK VAT return uses (loadTaxFigures → buildUkVatBoxes). The boxes are
 * NOT recomputed here — we map the box1..box9 string values from buildUkVatBoxes
 * to the numeric NineBox shape the MTD API expects.
 */
export async function computeNineBox(userId: string, from: Date, to: Date): Promise<NineBox> {
  const figures = await loadTaxFigures(userId, from, to);
  const b = buildUkVatBoxes(figures);
  return {
    vatDueSales: Number(b.box1),
    vatDueAcquisitions: Number(b.box2),
    totalVatDue: Number(b.box3),
    vatReclaimedCurrPeriod: Number(b.box4),
    netVatDue: Number(b.box5),
    totalValueSalesExVAT: Number(b.box6),
    totalValuePurchasesExVAT: Number(b.box7),
    totalValueGoodsSuppliedExVAT: Number(b.box8),
    totalAcquisitionsExVAT: Number(b.box9),
  };
}

// ── Handlers ────────────────────────────────────────────────────────────────────

// GET /mtd/config — masked view (never returns secrets).
export async function getConfig(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const row = (await prisma.mtdConfig.findUnique({ where: { userId } })) as MtdRow | null;
    res.json({
      success: true,
      data: {
        enabled: row?.enabled ?? false,
        useSandbox: row?.useSandbox ?? true,
        vrn: row?.vrn ?? null,
        hasClientId: Boolean(row?.clientId),
        hasClientSecret: Boolean(row?.clientSecret),
        connected: Boolean(row?.accessToken),
      },
    });
  } catch (err) {
    handleError(res, err, 'load MTD config');
  }
}

// PUT /mtd/config — upsert BYOK creds (clientSecret encrypted, blank-keeps-current).
export async function putConfig(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as {
      enabled?: boolean;
      useSandbox?: boolean;
      vrn?: string | null;
      clientId?: string | null;
      clientSecret?: string | null;
    };

    const existing = (await prisma.mtdConfig.findUnique({ where: { userId } })) as MtdRow | null;

    // clientSecret: only overwrite when a non-blank value is supplied; otherwise
    // keep the previously stored (encrypted) value — "blank-keeps-current".
    const incomingSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
    const clientSecret =
      incomingSecret !== '' ? encryptSecret(incomingSecret) : existing?.clientSecret ?? null;

    const data = {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : existing?.enabled ?? false,
      useSandbox:
        typeof body.useSandbox === 'boolean' ? body.useSandbox : existing?.useSandbox ?? true,
      vrn: body.vrn !== undefined ? body.vrn : existing?.vrn ?? null,
      clientId: body.clientId !== undefined ? body.clientId : existing?.clientId ?? null,
      clientSecret,
    };

    await prisma.mtdConfig.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });

    res.json({
      success: true,
      message: 'MTD config saved',
      data: {
        enabled: data.enabled,
        useSandbox: data.useSandbox,
        vrn: data.vrn,
        hasClientId: Boolean(data.clientId),
        hasClientSecret: Boolean(data.clientSecret),
        connected: Boolean(existing?.accessToken),
      },
    });
  } catch (err) {
    handleError(res, err, 'save MTD config');
  }
}

// GET /mtd/auth-url?redirectUri= — OAuth authorize URL (or a mock note).
export async function getAuthUrl(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const redirectUri = typeof req.query.redirectUri === 'string' ? req.query.redirectUri : '';
    if (!redirectUri) {
      throw new BadRequestError('Query param "redirectUri" is required');
    }
    const loaded = await loadDecryptedCfg(userId);
    const cfg = loaded?.cfg;

    // Not configured → mock note (no URL to hit, demo/self-host works as-is).
    if (!cfg || !cfg.clientId) {
      res.json({
        success: true,
        data: {
          mode: 'mock',
          authUrl: null,
          note: 'HMRC credentials not configured — running in demo/mock mode. Set a client id to connect for real.',
        },
      });
      return;
    }

    const state = randomBytes(16).toString('hex');
    const authUrl = buildAuthUrl(cfg, state, redirectUri);
    res.json({ success: true, data: { mode: 'live', authUrl, state } });
  } catch (err) {
    handleError(res, err, 'build MTD auth URL');
  }
}

// GET|POST /mtd/callback?code=&state= — exchange code, persist tokens (encrypted).
export async function callback(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const code =
      (typeof req.query.code === 'string' && req.query.code) ||
      (typeof (req.body as { code?: string })?.code === 'string' && (req.body as { code: string }).code) ||
      '';
    const redirectUri =
      (typeof req.query.redirectUri === 'string' && req.query.redirectUri) ||
      (typeof (req.body as { redirectUri?: string })?.redirectUri === 'string' &&
        (req.body as { redirectUri: string }).redirectUri) ||
      '';

    const loaded = await loadDecryptedCfg(userId);
    const cfg = loaded?.cfg;

    // Mock mode: no real exchange — mark connected with deterministic mock tokens.
    if (!cfg || !cfg.enabled || !cfg.clientId) {
      const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
      await prisma.mtdConfig.upsert({
        where: { userId },
        update: {
          accessToken: encryptSecret('mock-access-token'),
          refreshToken: encryptSecret('mock-refresh-token'),
          tokenExpiresAt: expiresAt,
        },
        create: {
          userId,
          accessToken: encryptSecret('mock-access-token'),
          refreshToken: encryptSecret('mock-refresh-token'),
          tokenExpiresAt: expiresAt,
        },
      });
      res.json({ success: true, mode: 'mock', message: 'Connected (mock mode)', data: { connected: true } });
      return;
    }

    if (!code) {
      throw new BadRequestError('Authorization code required');
    }

    const tokens = await exchangeCode(cfg, code, redirectUri);
    await persistTokens(userId, tokens);
    res.json({ success: true, mode: 'live', message: 'Connected to HMRC', data: { connected: true } });
  } catch (err) {
    handleError(res, err, 'complete MTD OAuth');
  }
}

// GET /mtd/obligations?from=&to=[&status=]
export async function obligations(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { fromStr, toStr } = parseRange(req.query as Record<string, unknown>);
    const statusRaw = req.query.status;
    const status =
      statusRaw === 'O' || statusRaw === 'F' ? (statusRaw as 'O' | 'F') : undefined;

    const loaded = await loadDecryptedCfg(userId);
    // No row → fully-disabled mock cfg.
    const cfg = loaded
      ? await withFreshTokens(userId, loaded)
      : ({ enabled: false } as MtdConfigLike);

    const result = await getObligations(cfg, { from: fromStr, to: toStr, status }, fraudCtx(req, userId));
    res.json({ success: true, data: result });
  } catch (err) {
    handleError(res, err, 'fetch MTD obligations');
  }
}

// POST /mtd/submit { periodKey, from, to }
export async function submit(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as { periodKey?: string; from?: string; to?: string };
    const periodKey = typeof body.periodKey === 'string' ? body.periodKey.trim() : '';
    if (!periodKey) {
      throw new BadRequestError('Field "periodKey" is required');
    }
    const { fromStr, toStr, fromDate, toDate } = parseRange(body as Record<string, unknown>);

    const loaded = await loadDecryptedCfg(userId);
    const cfg = loaded
      ? await withFreshTokens(userId, loaded)
      : ({ enabled: false } as MtdConfigLike);

    // Live submission requires a VRN; refuse with 400 rather than calling HMRC
    // with an empty VRN. Mock mode doesn't need one.
    const isLive = Boolean(cfg.enabled && cfg.clientId);
    if (isLive && !cfg.vrn) {
      throw new BadRequestError('A VAT registration number (VRN) is required to file for real');
    }

    // Pull the 9-box from the SAME GL computation the on-screen UK VAT return uses.
    const nineBox = await computeNineBox(userId, fromDate, toDate);

    const receipt = await submitVatReturn(cfg, periodKey, nineBox, fraudCtx(req, userId));
    res.json({ success: true, data: { receipt, nineBox, period: { from: fromStr, to: toStr } } });
  } catch (err) {
    handleError(res, err, 'submit MTD VAT return');
  }
}

// GET /mtd/liabilities?from=&to=
export async function liabilities(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { fromStr, toStr } = parseRange(req.query as Record<string, unknown>);

    const loaded = await loadDecryptedCfg(userId);
    const cfg = loaded
      ? await withFreshTokens(userId, loaded)
      : ({ enabled: false } as MtdConfigLike);

    const result = await getLiabilities(cfg, { from: fromStr, to: toStr }, fraudCtx(req, userId));
    res.json({ success: true, data: result });
  } catch (err) {
    handleError(res, err, 'fetch MTD liabilities');
  }
}

const handlers = {
  getConfig,
  putConfig,
  getAuthUrl,
  callback,
  obligations,
  submit,
  liabilities,
  computeNineBox,
};
module.exports = handlers;
module.exports.default = handlers;
