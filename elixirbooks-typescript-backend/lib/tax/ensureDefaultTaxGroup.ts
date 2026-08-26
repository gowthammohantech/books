/**
 * Default TaxGroup / TaxRate bootstrap for a freshly-onboarded tenant.
 *
 * `Product.taxGroupId` is optional, but a fresh install seeds no TaxGroup or
 * TaxRate (only the demo seed does). Without one, a brand-new tenant has no
 * sensible default to assign to a Product. This ensures a minimal "No Tax"
 * 0% group exists so product creation has a default available immediately
 * after onboarding.
 *
 * Note on scoping: `TaxGroup` is GLOBAL (no userId column) while `TaxRate` is
 * user-scoped. We therefore:
 *   - upsert/find a global "No Tax" TaxGroup by name (idempotent), and
 *   - create a per-tenant 0% NONE TaxRate if the tenant has none in that group,
 *     linking it to the group.
 *
 * Fully idempotent — skips creation when the rate already exists for the
 * tenant. Never throws on the happy path; callers run it best-effort.
 *
 * Accepts an optional Prisma-like client so it can run inside a caller's
 * `$transaction`.
 */

import type { PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';

type DefaultTaxDb = Pick<PrismaClient, 'taxGroup' | 'taxRate'>;

const DEFAULT_TAX_GROUP_NAME = 'No Tax';
const DEFAULT_TAX_RATE_NAME = 'No Tax 0%';

export interface EnsureDefaultTaxGroupResult {
  taxGroupId: string;
  /** true if a TaxGroup and/or TaxRate row was created in this call */
  created: boolean;
}

export async function ensureDefaultTaxGroup(
  userId: string,
  db: DefaultTaxDb = prisma,
): Promise<EnsureDefaultTaxGroupResult> {
  // Short-circuit: if this tenant already has ANY TaxGroup it can use for a
  // Product (i.e. a non-deleted TaxRate they own that belongs to a group),
  // we don't need a default. Use the first such group.
  const existingRate = await db.taxRate.findFirst({
    where: { userId, isDeleted: false, tax_groups: { some: {} } },
    select: { tax_groups: { select: { id: true }, take: 1 } },
  });
  if (existingRate && existingRate.tax_groups.length > 0) {
    return { taxGroupId: existingRate.tax_groups[0].id, created: false };
  }

  let created = false;

  // Global "No Tax" group (idempotent by name).
  let group = await db.taxGroup.findFirst({ where: { tax_name: DEFAULT_TAX_GROUP_NAME } });
  if (!group) {
    group = await db.taxGroup.create({ data: { tax_name: DEFAULT_TAX_GROUP_NAME, status: true } });
    created = true;
  }

  // Per-tenant 0% rate inside that group (idempotent on (userId, name)).
  const rate = await db.taxRate.findFirst({
    where: { userId, name: DEFAULT_TAX_RATE_NAME, isDeleted: false },
  });
  if (!rate) {
    await db.taxRate.create({
      data: {
        userId,
        regime: 'NONE',
        name: DEFAULT_TAX_RATE_NAME,
        rate: '0',
        isActive: true,
        tax_groups: { connect: { id: group.id } },
      },
    });
    created = true;
  }

  return { taxGroupId: group.id, created };
}
