import { PrismaClient } from '@prisma/client';

import { auditExtension } from './auditExtension';

// Hot-reload safety: in nodemon / ts-node-dev the module is re-required on
// each change; a fresh PrismaClient per reload exhausts Postgres connections.
// Caching on globalThis avoids that. We cache both the base (un-extended) and
// the extended client so the extension is only applied once per process.
declare global {
  // eslint-disable-next-line no-var
  var __elixirBooksPrismaBase: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __elixirBooksPrisma: PrismaClient | undefined;
}

function buildBase(): PrismaClient {
  return new PrismaClient({
    log: process.env.PRISMA_LOG === 'true' ? ['query', 'error', 'warn'] : ['error'],
  });
}

const base: PrismaClient = globalThis.__elixirBooksPrismaBase ?? buildBase();
// Cached unconditionally (not just in dev) so `prisma` and `prismaUnscoped`
// are guaranteed to share one connection pool.
globalThis.__elixirBooksPrismaBase = base;

function buildClient(): PrismaClient {
  // The extension is a query-only interceptor; cast the extended client back to
  // PrismaClient so existing call sites (and $transaction callbacks typed as
  // Prisma.TransactionClient) keep type-checking. Runtime interception is
  // unaffected — the underlying object is still the extended client.
  return base.$extends(auditExtension(base)) as unknown as PrismaClient;
}

/**
 * The application client. Audits every write and — once lib/tenantGuard.ts is
 * wired in — scopes every query to the tenant on the request context. Use this
 * everywhere by default.
 */
export const prisma = globalThis.__elixirBooksPrisma ?? buildClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__elixirBooksPrisma = prisma;
}

/**
 * The raw, un-extended client: NO tenant filtering and NO audit logging.
 *
 * This is the deliberate cross-tenant escape hatch, and it is deliberately
 * grep-able — `grep -rn prismaUnscoped` is the complete audit surface for
 * queries that can see every tenant's data. Legitimate users are the ones that
 * cannot have a tenant by nature:
 *   - authentication (finding a user by email before we know their tenant)
 *   - public token links (resolving an invoice by its publicViewToken)
 *   - crons selecting due work across all tenants before fanning out
 *   - platform seeds, backfills and migrations
 *
 * Anything else should use `prisma` and, if it runs outside a request, declare
 * its scope with runAsTenant()/runAsSystem() from lib/tenantContext.
 */
export const prismaUnscoped: PrismaClient = base;
