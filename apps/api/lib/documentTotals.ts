/**
 * Server-authoritative document totals — the backend's view of them.
 *
 * The arithmetic now lives in @elixirbooks/money so the frontend's invoice
 * preview and this, the figure actually persisted, are the same code rather
 * than two implementations kept in step by comment. What stays here is the part
 * that cannot be shared: `resolveItemTaxRates` issues Prisma queries, and
 * `warnOnTotalsDivergence` is a server-side log.
 *
 * Re-exported rather than repointed at every call site: the six document
 * controllers, serverAuthoritativeTax and the tests all import from this module,
 * and none of them need to know the maths moved.
 *
 * SCOPE (unchanged): shared by invoice / quotation / purchase / purchase order /
 * debit note (create AND update). It intentionally does NOT know about country
 * tax regimes — VAT_UK/VAT_EU/GST_AU/GST_NZ invoices additionally run through
 * `serverAuthoritativeTax`, which wins for the tax figure; the subTotal/discount
 * here still stand.
 */
export {
  computeDocumentTotals,
  lineDiscount,
  lineGross,
  lineTax,
  lineTaxableBase,
} from '@elixirbooks/money';
export type {
  DocumentTotals,
  LineDiscountFields,
  PerLineTotal,
  TotalsItem,
  TotalsItemTax,
} from '@elixirbooks/money';

import { toNum } from '@elixirbooks/money';
import type { TotalsItem } from '@elixirbooks/money';

/**
 * Compare a client-sent grand total against the server value and warn (but
 * never throw) when they diverge by more than 0.05. The server value is ALWAYS
 * the one persisted; this only surfaces mis-behaving / stale clients in the log.
 */
export function warnOnTotalsDivergence(
  docType: string,
  docId: string,
  clientGrandTotal: number | null | undefined,
  serverGrandTotal: number,
): void {
  if (clientGrandTotal === null || clientGrandTotal === undefined || Number.isNaN(clientGrandTotal)) {
    return;
  }
  if (Math.abs(clientGrandTotal - serverGrandTotal) > 0.05) {
     
    console.warn(
      `[documentTotals] ${docType} ${docId}: client grandTotal ${clientGrandTotal} diverges from ` +
        `server ${serverGrandTotal}; persisting server value.`,
    );
  }
}

/** Read surface needed to look up a tax group's summed rate / a direct rate. */
export interface TaxGroupLookupDb {
  taxGroup: {
    findMany: (args: {
      where: { tenantId: string; id: { in: string[] } };
      select: { id: true; tax_rates: { select: { rate: true; isActive: true; isDeleted: true } } };
    }) => Promise<Array<{ id: string; tax_rates: Array<{ rate: unknown; isActive?: boolean; isDeleted?: boolean }> }>>;
  };
  /** Optional so legacy narrow test doubles keep working; the real prisma client has it. */
  taxRate?: {
    findMany: (args: {
      where: { tenantId: string; id: { in: string[] } };
      select: { id: true; rate: true; isActive: true; isDeleted: true };
    }) => Promise<Array<{ id: string; rate: unknown; isActive?: boolean; isDeleted?: boolean }>>;
  };
}

/**
 * For lines that carry a `tax_rate_id` (unified tax) or a legacy `tax_group_id`
 * but no per-component `taxes[]` (quotation / PO / debit note shape), resolve
 * the rate percent (direct rate, or Σ of the group's active tax_rates) and
 * attach it as `taxRate` so `computeDocumentTotals` can recompute tax on the
 * discounted base. `tax_rate_id` wins when both are present. Lines with
 * taxes[] or no linkage are returned as-is.
 *
 * Batched queries; a no-op (no query) when nothing needs resolving.
 */
export async function resolveItemTaxRates<T extends TotalsItem>(
  db: TaxGroupLookupDb,
  items: T[],
  tenantId: string,
): Promise<T[]> {
  const groupIds = new Set<string>();
  const rateIds = new Set<string>();
  for (const item of items ?? []) {
    const hasComponents = Array.isArray(item.taxes) && item.taxes.length > 0;
    if (hasComponents) continue;
    if (item.tax_rate_id) rateIds.add(item.tax_rate_id);
    else if (item.tax_group_id) groupIds.add(item.tax_group_id);
  }
  if (groupIds.size === 0 && rateIds.size === 0) return items;

  const [groups, rates] = await Promise.all([
    groupIds.size > 0
      ? db.taxGroup.findMany({
          where: { tenantId, id: { in: [...groupIds] } },
          select: { id: true, tax_rates: { select: { rate: true, isActive: true, isDeleted: true } } },
        })
      : Promise.resolve([]),
    rateIds.size > 0 && db.taxRate
      ? db.taxRate.findMany({
          where: { tenantId, id: { in: [...rateIds] } },
          select: { id: true, rate: true, isActive: true, isDeleted: true },
        })
      : Promise.resolve([]),
  ]);

  const rateByGroup = new Map<string, number>();
  for (const g of groups) {
    const total = g.tax_rates
      .filter((r) => r.isActive !== false && r.isDeleted !== true)
      .reduce((sum, r) => sum + toNum(r.rate), 0);
    rateByGroup.set(g.id, total);
  }
  const rateById = new Map<string, number>();
  for (const r of rates) {
    if (r.isActive !== false && r.isDeleted !== true) rateById.set(r.id, toNum(r.rate));
  }

  return items.map((item) => {
    const hasComponents = Array.isArray(item.taxes) && item.taxes.length > 0;
    if (hasComponents) return item;
    if (item.tax_rate_id) {
      return rateById.has(item.tax_rate_id)
        ? { ...item, taxRate: rateById.get(item.tax_rate_id) }
        : item;
    }
    if (item.tax_group_id && rateByGroup.has(item.tax_group_id)) {
      return { ...item, taxRate: rateByGroup.get(item.tax_group_id) };
    }
    return item;
  });
}
