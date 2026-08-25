/**
 * Unified product-tax read (spec 2026-07-12 §4B).
 *
 * Fallback chain for a product's tax:
 *   1. direct `taxRateId` link            → that rate
 *   2. legacy `taxGroupId`, 1 usable member → that member rate
 *   3. legacy group, N>1 members           → summed compound: group name,
 *      Σ member rates, taxRateId null (read-only legacy display; the
 *      migrateTaxesToRates script collapses these)
 *   4. nothing / empty group               → null
 *
 * Pure + structural: accepts raw Prisma rows (rate may be a Decimal, number
 * or string — Number() handles all three).
 */

export interface ResolvedProductTax {
  /** Direct TaxRate id; null when only a legacy multi-member group is linked. */
  taxRateId: string | null;
  name: string;
  /** Percent, e.g. 18 for 18%. */
  rate: number;
}

interface RateLike {
  id: string;
  name: string;
  rate: unknown;
  isActive?: boolean | null;
  isDeleted?: boolean | null;
  regime?: string | null;
}

interface GroupLike {
  id: string;
  tax_name: string;
  tax_rates: RateLike[];
}

export interface ProductTaxSource {
  taxRate?: RateLike | null;
  taxGroup?: GroupLike | null;
}

export function resolveProductTaxRate(source: ProductTaxSource): ResolvedProductTax | null {
  if (source.taxRate) {
    return {
      taxRateId: source.taxRate.id,
      name: source.taxRate.name,
      rate: Number(source.taxRate.rate),
    };
  }
  const group = source.taxGroup;
  if (!group) return null;
  const members = (group.tax_rates ?? []).filter(
    (r) => r.isActive !== false && r.isDeleted !== true,
  );
  if (members.length === 0) return null;
  if (members.length === 1) {
    return { taxRateId: members[0].id, name: members[0].name, rate: Number(members[0].rate) };
  }
  // The global "No Tax" group (no userId) holds EVERY tenant's pack-seeded
  // rates (ensureDefaultTaxGroup.ts + seedPackTaxRates.ts) — summing its
  // members produces nonsense like {name:'No Tax', rate:63}. Mirror the
  // migration script's guard (migrateTaxesToRates.ts planGroupResolution):
  // detect by name OR by a NONE-regime member present, resolve to that
  // member rather than summing.
  const noneMember = members.find((r) => r.regime === 'NONE');
  if (group.tax_name === 'No Tax' || noneMember) {
    if (noneMember) {
      return { taxRateId: noneMember.id, name: noneMember.name, rate: Number(noneMember.rate) };
    }
    return null;
  }
  const total = members.reduce((sum, r) => sum + Number(r.rate), 0);
  return { taxRateId: null, name: group.tax_name, rate: total };
}
