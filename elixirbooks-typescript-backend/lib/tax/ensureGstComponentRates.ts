/**
 * Lazy per-tenant provisioning of synthesized GST component rates
 * (spec 2026-07-12 §4B). Component `taxes[]` entries need REAL taxRateIds so
 * GSTR-style reporting by taxKind keeps working: for each synthesized
 * component we reuse an existing (userId, GST_INDIA, taxKind, rate) row —
 * e.g. a demo-seeded "CGST 9%" — or create one flagged `isSystemComponent`
 * (hidden from the user-facing Taxes list). Idempotent by construction.
 *
 * Accepts a Prisma-like slice so it runs on the shared client, a
 * `$transaction` tx, or a test double.
 */

import type { GstComponentSpec } from '../taxEngine';

export interface ComponentRateDb {
  taxRate: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: { data: unknown }) => Promise<{ id: string }>;
  };
}

export interface ProvisionedComponent extends GstComponentSpec {
  taxRateId: string;
}

export async function ensureGstComponentRates(
  db: ComponentRateDb,
  userId: string,
  specs: GstComponentSpec[],
  countryId?: string | null,
): Promise<ProvisionedComponent[]> {
  const out: ProvisionedComponent[] = [];
  for (const spec of specs) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await db.taxRate.findFirst({
      where: { userId, regime: 'GST_INDIA', taxKind: spec.kind, rate: spec.percent, isDeleted: false },
      select: { id: true },
    });
    if (existing) {
      out.push({ ...spec, taxRateId: existing.id });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const created = await db.taxRate.create({
      data: {
        userId,
        regime: 'GST_INDIA',
        taxKind: spec.kind,
        name: spec.name,
        rate: String(spec.percent),
        countryId: countryId ?? null,
        isActive: true,
        isSystemComponent: true,
      },
    });
    out.push({ ...spec, taxRateId: created.id });
  }
  return out;
}
