// lib/tenantApiKey.ts
//
// Shared helpers for the per-tenant server-to-server credential, and for the
// one question the external integration cannot avoid asking: WHICH WORKSPACE
// is this request for?
//
// That question is the reason this file exists. Before P5 the external API had
// a single install-wide key and resolved the target by finding "the sole
// admin" — an answer that is silently wrong the moment a second company signs
// up, and wrong in the worst possible way, because it writes one company's
// contacts into another's.

import { createHash, randomBytes, timingSafeEqual } from 'crypto';

import { prismaUnscoped } from './prisma';

/** Keys are shown once and matched by hash; the plaintext is never stored. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** `eb_` + 48 hex chars. The prefix is what a human sees in the key list. */
export function generateApiKey(): { key: string; prefix: string; keyHash: string } {
  const key = `eb_${randomBytes(24).toString('hex')}`;
  return { key, prefix: key.slice(0, 11), keyHash: hashApiKey(key) };
}

/** Constant-time string compare that tolerates differing lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type TenantResolution =
  | { ok: true; tenantId: string; via: 'api-key' | 'claim' | 'env' | 'sole-tenant' }
  | { ok: false; status: number; message: string };

/**
 * Resolve the workspace an EXTERNAL request is acting on, in strict priority
 * order, and refuse rather than guess.
 *
 * 1. An explicit hint — a `tenant` claim (SSO) or an env-configured id/slug.
 *    Accepts either a Tenant.id or a Tenant.slug, because the external system
 *    is likely to have been configured with whichever was to hand.
 * 2. The sole tenant, IF AND ONLY IF the install has exactly one.
 *
 * Step 2 is not "default to the first tenant" — the thing the plan rightly
 * forbids. With exactly one workspace there is no other candidate, so the
 * answer is unique rather than arbitrary, and this is what keeps every existing
 * single-company install working after the upgrade with no configuration
 * change. As soon as a second workspace exists it stops applying and the
 * caller gets a 503 telling them to configure the mapping — a loud failure in
 * place of a silent cross-tenant write.
 */
export async function resolveExternalTenant(hint?: string | null): Promise<TenantResolution> {
  const wanted = (hint ?? process.env.WHATSAPPCRM_TENANT_ID ?? '').trim();

  if (wanted) {
    const tenant = await prismaUnscoped.tenant.findFirst({
      where: {
        OR: [{ id: wanted }, { slug: wanted }],
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!tenant) {
      return {
        ok: false,
        status: 404,
        message: `No active workspace matches "${wanted}".`,
      };
    }
    return { ok: true, tenantId: tenant.id, via: hint ? 'claim' : 'env' };
  }

  const tenants = await prismaUnscoped.tenant.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: { id: true },
    take: 2,
  });
  if (tenants.length === 1) {
    return { ok: true, tenantId: tenants[0].id, via: 'sole-tenant' };
  }
  if (tenants.length === 0) {
    return {
      ok: false,
      status: 503,
      message: 'No workspace exists on this Elixir Books instance yet.',
    };
  }
  return {
    ok: false,
    status: 503,
    message:
      'This instance hosts multiple workspaces, so the request must name one. ' +
      'Set WHATSAPPCRM_TENANT_ID, issue a per-workspace API key, or include a `tenant` claim.',
  };
}
