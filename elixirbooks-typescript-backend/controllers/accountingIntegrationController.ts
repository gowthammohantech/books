import type { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import type { IntegrationKind, Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { xeroProvider } from '../lib/accountingIntegrations/xeroProvider';
import { quickbooksProvider } from '../lib/accountingIntegrations/quickbooksProvider';
import { ACCOUNTING_SECRET_KEYS, decryptConfigSecrets, encryptConfigSecrets } from '../lib/configSecret';

const KINDS = ['XERO', 'QUICKBOOKS'] as const;
function isKind(s: string | undefined): s is 'XERO' | 'QUICKBOOKS' {
  return !!s && (KINDS as readonly string[]).includes(s);
}

function getProvider(kind: IntegrationKind) {
  return kind === 'XERO' ? xeroProvider : quickbooksProvider;
}

export async function list(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const rows = await prisma.accountingIntegration.findMany({ where: { userId } });
    res.json({
      success: true,
      data: {
        integrations: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          enabled: r.enabled,
          lastSyncedAt: r.lastSyncedAt,
          syncStatus: r.syncStatus,
          errorMessage: r.errorMessage,
        })),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('accountingIntegration list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list integrations' });
  }
}

export async function connect(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { kind } = req.params as { kind: string };
    if (!isKind(kind)) {
      res.status(400).json({ success: false, message: 'Invalid kind' });
      return;
    }
    const body = req.body as { clientId?: string; redirectUri?: string };
    const provider = getProvider(kind);
    const state = randomBytes(16).toString('hex');

    // Persist initial config (clientId may be stored to retrieve in callback)
    await prisma.accountingIntegration.upsert({
      where: { userId_kind: { userId, kind } },
      update: { config: { state, clientId: body.clientId ?? '', redirectUri: body.redirectUri ?? '' } as Prisma.InputJsonValue },
      create: {
        userId,
        kind,
        enabled: false,
        config: { state, clientId: body.clientId ?? '', redirectUri: body.redirectUri ?? '' } as Prisma.InputJsonValue,
      },
    });

    const oauthUrl = provider.buildOAuthUrl(state, { clientId: body.clientId, redirectUri: body.redirectUri });
    res.json({ success: true, data: { oauthUrl, state } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('accountingIntegration connect error:', err);
    res.status(500).json({ success: false, message: 'Failed to start OAuth' });
  }
}

export async function callback(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { kind } = req.params as { kind: string };
    if (!isKind(kind)) {
      res.status(400).json({ success: false, message: 'Invalid kind' });
      return;
    }
    const code = (req.query.code as string | undefined) ?? '';
    if (!code) {
      res.status(400).json({ success: false, message: 'Authorization code required' });
      return;
    }

    const existing = await prisma.accountingIntegration.findUnique({ where: { userId_kind: { userId, kind } } });
    const provider = getProvider(kind);
    const tokens = await provider.exchangeCode(code, existing?.config);

    // Encrypt OAuth tokens at rest; tenantId/connectedAt stay plaintext (public).
    const newConfig = encryptConfigSecrets(
      {
        ...((existing?.config as Record<string, unknown>) ?? {}),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tenantId: tokens.tenantId,
        connectedAt: new Date().toISOString(),
      },
      ACCOUNTING_SECRET_KEYS,
    );
    const updated = await prisma.accountingIntegration.update({
      where: { userId_kind: { userId, kind } },
      data: {
        enabled: true,
        config: newConfig as Prisma.InputJsonValue,
        syncStatus: 'CONNECTED',
        errorMessage: null,
      },
    });

    // mode: 'stub' — provider.exchangeCode is mocked in v1 (no real OAuth call yet).
    res.json({ success: true, message: 'OAuth complete', mode: 'stub', data: { integration: { id: updated.id, kind: updated.kind, enabled: updated.enabled } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('accountingIntegration callback error:', err);
    res.status(500).json({ success: false, message: 'OAuth callback failed' });
  }
}

export async function syncNow(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { kind } = req.params as { kind: string };
    if (!isKind(kind)) {
      res.status(400).json({ success: false, message: 'Invalid kind' });
      return;
    }
    const integration = await prisma.accountingIntegration.findUnique({ where: { userId_kind: { userId, kind } } });
    if (!integration || !integration.enabled) {
      res.status(400).json({ success: false, message: 'Integration not connected' });
      return;
    }

    const provider = getProvider(kind);
    try {
      // Decrypt OAuth tokens only here, at point-of-use, before calling the provider.
      const decryptedConfig = decryptConfigSecrets(integration.config, ACCOUNTING_SECRET_KEYS);
      const result = await provider.syncInvoices(decryptedConfig);
      await prisma.accountingIntegration.update({
        where: { userId_kind: { userId, kind } },
        data: { lastSyncedAt: new Date(), syncStatus: 'SUCCESS', errorMessage: null },
      });
      // mode: 'stub' — provider.syncInvoices is mocked in v1 (no real API sync yet).
      res.json({ success: true, message: `Synced: pushed=${result.pushed}, pulled=${result.pulled}`, mode: 'stub', data: result });
    } catch (e) {
      await prisma.accountingIntegration.update({
        where: { userId_kind: { userId, kind } },
        data: { syncStatus: 'ERROR', errorMessage: e instanceof Error ? e.message : String(e) },
      });
      res.status(500).json({ success: false, message: e instanceof Error ? e.message : 'Sync failed' });
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('accountingIntegration syncNow error:', err);
    res.status(500).json({ success: false, message: 'Failed to sync' });
  }
}

export async function disconnect(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { kind } = req.params as { kind: string };
    if (!isKind(kind)) {
      res.status(400).json({ success: false, message: 'Invalid kind' });
      return;
    }
    await prisma.accountingIntegration.deleteMany({ where: { userId, kind } });
    res.json({ success: true, message: 'Disconnected' });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('accountingIntegration disconnect error:', err);
    res.status(500).json({ success: false, message: 'Failed to disconnect' });
  }
}

const handlers = { list, connect, callback, syncNow, disconnect };
module.exports = handlers;
module.exports.default = handlers;
