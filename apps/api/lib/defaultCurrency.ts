// lib/defaultCurrency.ts
//
// "Which currency does this company price things in?" — asked from 15 separate
// places, each of which had its own byte-identical private copy of the query:
//
//   prisma.currency.findFirst({ where: { isDefault: true, isDeleted: false } })
//
// That was harmless while Currency was an install-global table, because there
// was exactly one default row in the whole database. P4 made Currency
// tenant-scoped, so the same query now has to name a tenant — and fifteen
// copies of a query that must not be got wrong is fourteen too many. They are
// all replaced by this one function.
//
// Currency is a tenant table, not a shared catalog: users create, rename and
// soft-delete their own rows through currencyController, including editing
// `name`, `code` and `symbol`. A shared catalog with a per-tenant enable list
// could not support that without one tenant's edit rewriting another's
// currency, so each tenant owns its own rows and prisma/seedTenant.ts stocks
// them at signup.

import { prisma } from './prisma';

/**
 * The narrow slice of a Prisma client this helper needs, so it can be called
 * with `prisma`, a `$transaction` client, or a test double.
 */
export interface CurrencyReader {
  currency: {
    findFirst(args: {
      where: Record<string, unknown>;
      select?: Record<string, boolean>;
    }): Promise<{ code: string } | null>;
  };
}

/**
 * The tenant's default currency code (ISO 4217, e.g. 'GBP'), or null when the
 * tenant has not marked one — callers treat null as "no explicit currency" and
 * fall back to their own default, exactly as they did before.
 */
export async function resolveDefaultCurrencyCode(
  tenantId: string,
  db: CurrencyReader = prisma as unknown as CurrencyReader,
): Promise<string | null> {
  const row = await db.currency.findFirst({
    where: { tenantId, isDefault: true, isDeleted: false },
    select: { code: true },
  });
  return row?.code ?? null;
}
