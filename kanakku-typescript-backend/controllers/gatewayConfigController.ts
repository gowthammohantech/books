import type { Request, Response } from 'express';
import type { GatewayKind, Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { gatewaySecretKeys, maskConfig, mergeAndEncryptConfig } from '../lib/configSecret';

const KINDS = ['RAZORPAY', 'STRIPE', 'OFFLINE'] as const;
type Kind = typeof KINDS[number];

function isKind(s: string | undefined): s is Kind {
  return !!s && (KINDS as readonly string[]).includes(s);
}

/**
 * Build a client-safe view of a gateway config: public keys (keyId,
 * publishableKey, URLs) pass through; secret keys are replaced by has* boolean
 * flags. Secrets are NEVER returned to the client — there is no reveal path.
 */
function safeConfig(kind: string, config: unknown): unknown {
  return maskConfig(config, gatewaySecretKeys(kind));
}

export async function list(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const rows = await prisma.gatewayConfig.findMany({ where: { userId } });
    res.json({
      success: true,
      data: {
        gatewayConfigs: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          enabled: r.enabled,
          livemode: r.livemode,
          config: safeConfig(r.kind, r.config),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('gatewayConfig list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list gateway configs' });
  }
}

export async function get(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { kind } = req.params as { kind: string };
    if (!isKind(kind)) {
      res.status(400).json({ success: false, message: 'Invalid kind' });
      return;
    }
    const row = await prisma.gatewayConfig.findUnique({ where: { userId_kind: { userId, kind: kind as GatewayKind } } });
    if (!row) {
      res.status(404).json({ success: false, message: 'Gateway not configured' });
      return;
    }
    res.json({
      success: true,
      data: {
        gatewayConfig: {
          id: row.id,
          kind: row.kind,
          enabled: row.enabled,
          livemode: row.livemode,
          config: safeConfig(row.kind, row.config),
        },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('gatewayConfig get error:', err);
    res.status(500).json({ success: false, message: 'Failed to get gateway config' });
  }
}

export async function upsert(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { kind } = req.params as { kind: string };
    if (!isKind(kind)) {
      res.status(400).json({ success: false, message: 'Invalid kind' });
      return;
    }
    const body = req.body as { enabled?: boolean; livemode?: boolean; config?: Prisma.JsonValue };

    // Merge with the stored config so a blank/omitted secret keeps the
    // previously stored (encrypted) value, and encrypt secrets at rest. Never
    // persist plaintext secret keys.
    const existing = await prisma.gatewayConfig.findUnique({
      where: { userId_kind: { userId, kind: kind as GatewayKind } },
    });
    const encryptedConfig = mergeAndEncryptConfig(
      body.config ?? {},
      existing?.config,
      gatewaySecretKeys(kind),
    );
    const data = {
      enabled: body.enabled === true,
      livemode: body.livemode === true,
      config: encryptedConfig as Prisma.InputJsonValue,
    };
    const updated = await prisma.gatewayConfig.upsert({
      where: { userId_kind: { userId, kind: kind as GatewayKind } },
      update: data,
      create: { userId, kind: kind as GatewayKind, ...data },
    });
    res.json({
      success: true,
      message: 'Gateway config saved',
      data: { gatewayConfig: { id: updated.id, kind: updated.kind, enabled: updated.enabled, livemode: updated.livemode } },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('gatewayConfig upsert error:', err);
    res.status(500).json({ success: false, message: 'Failed to save gateway config' });
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { kind } = req.params as { kind: string };
    if (!isKind(kind)) {
      res.status(400).json({ success: false, message: 'Invalid kind' });
      return;
    }
    await prisma.gatewayConfig.deleteMany({ where: { userId, kind: kind as GatewayKind } });
    res.json({ success: true, message: 'Gateway config removed' });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('gatewayConfig remove error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove gateway config' });
  }
}

const handlers = { list, get, upsert, remove };
module.exports = handlers;
module.exports.default = handlers;
