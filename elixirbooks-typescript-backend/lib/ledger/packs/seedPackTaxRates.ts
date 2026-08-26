/**
 * Pack → tenant tax-rate bridge.
 *
 * When a country pack is applied (see `applyPack`), this seeds the tenant's
 * default tax rate(s) into the `TaxRate` table so the invoice tax-rate dropdown
 * is populated with the correct rates for that regime:
 *
 *   - UK (VAT_UK): 20% Standard, 5% Reduced, 0% Zero
 *   - AU (GST_AU): 10% GST
 *   - NZ (GST_NZ): 15% GST
 *   - EU (VAT_EU): the member-state standard rate + a 0% (reverse-charge/exempt)
 *   - IN (GST_INDIA): kind-less GST 5/12/18/28 slabs (engine splits at resolve time)
 *   - US (US_SALES_TAX): no rate seeded (state sales tax handled separately)
 *
 * Every regime also keeps a "No Tax 0%" NONE row so exempt lines are selectable.
 *
 * Idempotent: rates are upserted by (userId, name) — re-applying a pack never
 * duplicates rows. Tenant-scoped to `userId`.
 */

import type { TaxRegime as PrismaTaxRegime, TaxKind } from '@prisma/client';
import type { TaxRegime as PackTaxRegime } from './types';
import { euStandardRate } from '../../euVat';

/** Minimal Prisma-like surface this helper needs (a subset of the `$transaction` tx). */
export interface SeedTaxRatesTx {
  taxGroup: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: { data: unknown }) => Promise<{ id: string }>;
  };
  taxRate: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: { data: unknown }) => Promise<{ id: string }>;
  };
}

const DEFAULT_TAX_GROUP_NAME = 'No Tax';
const NO_TAX_RATE_NAME = 'No Tax 0%';

/** A single tenant tax-rate row to seed. */
interface RateSpec {
  name: string;
  rate: string;
  regime: PrismaTaxRegime;
  taxKind?: TaxKind;
}

/** Map the pack's regime literal to the Prisma `TaxRegime` enum value. */
export function packRegimeToPrisma(regime: PackTaxRegime): PrismaTaxRegime {
  switch (regime) {
    case 'GST_INDIA':
      return 'GST_INDIA';
    case 'VAT_UK':
      return 'VAT_UK';
    case 'VAT_EU':
      return 'VAT_EU';
    case 'GST_AU':
      return 'GST_AU';
    case 'GST_NZ':
      return 'GST_NZ';
    case 'SALES_TAX_US':
      return 'US_SALES_TAX';
    default:
      return 'NONE';
  }
}

/**
 * Default standard VAT rate to use for the generic `EU` pack (no specific member
 * country). 21% is the EU-wide average and a sensible neutral default; a tenant
 * picks their actual member rate in tax settings. When a real member code is
 * supplied (e.g. `DE`), its `euStandardRate` is used instead.
 */
const EU_GENERIC_STANDARD_RATE = 21;

/**
 * Build the list of tax-rate rows to seed for a given pack country + regime.
 * Always includes a "No Tax 0%" NONE row.
 */
function ratesForPack(countryCode: string, prismaRegime: PrismaTaxRegime): RateSpec[] {
  const noTax: RateSpec = { name: NO_TAX_RATE_NAME, rate: '0', regime: 'NONE' };

  switch (prismaRegime) {
    case 'VAT_UK':
      return [
        { name: 'VAT Standard 20%', rate: '20', regime: 'VAT_UK', taxKind: 'VAT' },
        { name: 'VAT Reduced 5%', rate: '5', regime: 'VAT_UK', taxKind: 'VAT' },
        { name: 'VAT Zero 0%', rate: '0', regime: 'VAT_UK', taxKind: 'VAT' },
        noTax,
      ];
    case 'GST_AU':
      return [
        { name: 'GST 10%', rate: '10', regime: 'GST_AU', taxKind: 'VAT' },
        noTax,
      ];
    case 'GST_NZ':
      return [
        { name: 'GST 15%', rate: '15', regime: 'GST_NZ', taxKind: 'VAT' },
        noTax,
      ];
    case 'VAT_EU': {
      // Use the supplied member's standard rate when the pack code is a real EU
      // member; otherwise fall back to the generic EU default.
      const rate = euStandardRate(countryCode) ?? EU_GENERIC_STANDARD_RATE;
      return [
        { name: `VAT ${rate}%`, rate: String(rate), regime: 'VAT_EU', taxKind: 'VAT' },
        { name: 'VAT 0% (Reverse charge / Exempt)', rate: '0', regime: 'VAT_EU', taxKind: 'VAT' },
        noTax,
      ];
    }
    case 'GST_INDIA':
      // Unified tax (spec 2026-07-12 §4B): single kind-less GST slabs — the
      // engine synthesizes CGST/SGST vs IGST at resolve time, so no per-kind
      // rows are seeded here.
      return [
        { name: 'GST 5%', rate: '5', regime: 'GST_INDIA' },
        { name: 'GST 12%', rate: '12', regime: 'GST_INDIA' },
        { name: 'GST 18%', rate: '18', regime: 'GST_INDIA' },
        { name: 'GST 28%', rate: '28', regime: 'GST_INDIA' },
        noTax,
      ];
    // US: state sales tax handled separately. Only ensure the No-Tax row exists.
    default:
      return [noTax];
  }
}

/**
 * Seed the tenant's default tax rates for an applied country pack.
 *
 * Idempotent + tenant-scoped: each rate is created only if no row with the same
 * (userId, name, isDeleted=false) already exists. The global "No Tax" TaxGroup
 * is reused (created once if absent) and every seeded rate is linked to it so
 * the rates are usable for Products immediately.
 */
export async function seedPackTaxRates(
  tx: SeedTaxRatesTx,
  userId: string,
  countryCode: string,
  packRegime: PackTaxRegime,
): Promise<void> {
  const prismaRegime = packRegimeToPrisma(packRegime);
  const specs = ratesForPack(countryCode, prismaRegime);

  // Reuse the global "No Tax" TaxGroup (idempotent by name); create if missing.
  let group = await tx.taxGroup.findFirst({ where: { tax_name: DEFAULT_TAX_GROUP_NAME } });
  if (!group) {
    group = await tx.taxGroup.create({ data: { tax_name: DEFAULT_TAX_GROUP_NAME, status: true } });
  }

  for (const spec of specs) {
    const existing = await tx.taxRate.findFirst({
      where: { userId, name: spec.name, isDeleted: false },
    });
    if (existing) continue; // idempotent — never duplicate by name

    await tx.taxRate.create({
      data: {
        userId,
        regime: spec.regime,
        ...(spec.taxKind ? { taxKind: spec.taxKind } : {}),
        name: spec.name,
        rate: spec.rate,
        isActive: true,
        tax_groups: { connect: { id: group.id } },
      },
    });
  }
}
