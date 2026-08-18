import { PrismaClient } from '@prisma/client';
import { auditExtension } from './auditExtension';

// Hot-reload safety: in nodemon / ts-node-dev the module is re-required on
// each change; a fresh PrismaClient per reload exhausts Postgres connections.
// Caching on globalThis avoids that. We cache both the base (un-extended) and
// the extended client so the extension is only applied once per process.
declare global {
  // eslint-disable-next-line no-var
  var __kanakkuPrismaBase: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __kanakkuPrisma: PrismaClient | undefined;
}

function buildBase(): PrismaClient {
  return new PrismaClient({
    log: process.env.PRISMA_LOG === 'true' ? ['query', 'error', 'warn'] : ['error'],
  });
}

function buildClient(): PrismaClient {
  const base = globalThis.__kanakkuPrismaBase ?? buildBase();
  if (process.env.NODE_ENV !== 'production') globalThis.__kanakkuPrismaBase = base;
  // The extension is a query-only interceptor; cast the extended client back to
  // PrismaClient so existing call sites (and $transaction callbacks typed as
  // Prisma.TransactionClient) keep type-checking. Runtime interception is
  // unaffected — the underlying object is still the extended client.
  return base.$extends(auditExtension(base)) as unknown as PrismaClient;
}

export const prisma = globalThis.__kanakkuPrisma ?? buildClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__kanakkuPrisma = prisma;
}
