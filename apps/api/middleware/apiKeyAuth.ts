// Bearer-token gate for server-to-server traffic (whatsappcrm).
//
// P5 made this TENANT-AWARE. It used to compare the presented token against a
// single install-wide WHATSAPPCRM_API_KEY and let the request through with no
// idea which company it was for — which is why externalController.upsertCustomer
// had to guess by looking up "the sole admin". A per-workspace key answers that
// question by construction: the key IS the tenant binding.
//
// Two credentials are accepted, in this order:
//
//   1. A TenantApiKey (`eb_...`). Matched by SHA-256 hash — the plaintext is
//      never stored — and it carries its own tenantId. This is the only form
//      that works on an install with more than one workspace.
//
//   2. The legacy WHATSAPPCRM_API_KEY env var, for installs upgrading from
//      before per-tenant keys existed. It has no tenant of its own, so the
//      tenant is resolved by lib/tenantApiKey.resolveExternalTenant: from
//      WHATSAPPCRM_TENANT_ID if set, else the sole workspace if there is
//      exactly one. On a multi-workspace install with no mapping configured it
//      FAILS with 503 rather than picking one — a silent cross-tenant write is
//      far worse than a loud outage on an integration endpoint.
//
// On success the resolved workspace is on `req.tenantId`, exactly as
// authMiddleware.protect sets it for human sessions, so downstream handlers
// scope their queries the same way regardless of how the caller authenticated.
import type { NextFunction, Request, Response } from 'express';

import { prismaUnscoped } from '../lib/prisma';
import { hashApiKey, resolveExternalTenant, safeEqual } from '../lib/tenantApiKey';
import { setVerifiedTenantId } from '../lib/tenantContext';

const apiKeyAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Bearer token required.' });
    return;
  }
  const provided = auth.slice(7).trim();
  if (!provided) {
    res.status(401).json({ success: false, message: 'Bearer token required.' });
    return;
  }

  try {
    // --- 1. Per-tenant key -------------------------------------------------
    // Looked up by hash, so this is a single indexed equality lookup and never
    // a scan; a wrong key costs the same as a right one.
    const record = await prismaUnscoped.tenantApiKey.findFirst({
      where: {
        keyHash: hashApiKey(provided),
        revokedAt: null,
        tenant: { status: 'ACTIVE', deletedAt: null },
      },
      select: { id: true, tenantId: true },
    });

    if (record) {
      req.tenantId = record.tenantId;
      req.apiKeyId = record.id;
      setVerifiedTenantId(record.tenantId);
      // Best-effort last-used stamp: useful for spotting keys nobody rotates,
      // never a reason to fail the request.
      prismaUnscoped.tenantApiKey
        .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
      next();
      return;
    }

    // --- 2. Legacy install-wide key ---------------------------------------
    const expected = process.env.WHATSAPPCRM_API_KEY;
    if (!expected) {
      // No per-tenant key matched and no legacy key configured: the caller has
      // no valid credential of either kind.
      res.status(401).json({ success: false, message: 'Invalid API key.' });
      return;
    }
    if (!safeEqual(provided, expected)) {
      res.status(401).json({ success: false, message: 'Invalid API key.' });
      return;
    }

    const resolved = await resolveExternalTenant(null);
    if (!resolved.ok) {
      res.status(resolved.status).json({ success: false, message: resolved.message });
      return;
    }

    req.tenantId = resolved.tenantId;
    setVerifiedTenantId(resolved.tenantId);
    next();
    return;
  } catch (err) {
    console.error('apiKeyAuth error:', err);
    res.status(503).json({ success: false, message: 'External API temporarily unavailable.' });
    return;
  }
};

export default apiKeyAuth;
