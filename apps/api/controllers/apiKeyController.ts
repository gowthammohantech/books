// controllers/apiKeyController.ts
//
// Management for the per-workspace server-to-server credentials introduced in
// P5. Without a way to mint one, middleware/apiKeyAuth.js would only ever see
// the legacy install-wide env key and the integration would stay stuck on a
// single workspace.
//
// The plaintext key is returned EXACTLY ONCE, from create. Only its SHA-256 is
// stored, so it cannot be shown again and a database leak does not hand over
// working credentials — the same reason passwords are hashed.

import type { Request, Response } from 'express';

import { prisma } from '../lib/prisma';
import { requireTenantId, requireActingUserId, UnauthorizedError } from '../lib/tenantScope';
import { generateApiKey } from '../lib/tenantApiKey';

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

export async function listApiKeys(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const keys = await prisma.tenantApiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      // keyHash is deliberately absent: it is a password-equivalent and there
      // is no reason for it to leave the database.
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    res.json({ success: true, data: keys });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('listApiKeys error:', err);
    res.status(500).json({ success: false, message: 'Error fetching API keys' });
  }
}

export async function createApiKey(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { name } = req.body as { name?: string };
    if (!name || !name.trim()) {
      res.status(400).json({ success: false, message: 'name is required' });
      return;
    }

    const { key, prefix, keyHash } = generateApiKey();
    const row = await prisma.tenantApiKey.create({
      data: {
        tenantId,
        name: name.trim(),
        prefix,
        keyHash,
        // An ACTOR column: who minted the credential, not which workspace owns it.
        createdBy: requireActingUserId(req),
      },
      select: { id: true, name: true, prefix: true, createdAt: true },
    });

    res.status(201).json({
      success: true,
      message: 'API key created. Copy it now — it cannot be shown again.',
      data: { ...row, key },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('createApiKey error:', err);
    res.status(500).json({ success: false, message: 'Error creating API key' });
  }
}

/**
 * Revoke rather than delete: the row stays as an audit trail of a credential
 * that once existed and when it was last used. apiKeyAuth only matches keys
 * with `revokedAt: null`, so revocation takes effect on the very next request.
 */
export async function revokeApiKey(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.tenantApiKey.findFirst({
      where: { id, tenantId },
      select: { id: true, revokedAt: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'API key not found' });
      return;
    }
    if (existing.revokedAt) {
      res.json({ success: true, message: 'API key already revoked' });
      return;
    }

    await prisma.tenantApiKey.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    res.json({ success: true, message: 'API key revoked' });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('revokeApiKey error:', err);
    res.status(500).json({ success: false, message: 'Error revoking API key' });
  }
}
