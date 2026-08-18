import { resolveDocumentTax, suppressesTax, type TaxTreatment } from './taxTreatment';

/** Apply a document's tax treatment: STANDARD (or null) is a passthrough;
 *  any suppressing treatment forces document tax to 0 AND returns a COPY of
 *  the items with every per-line tax field zeroed. Pure — does not mutate input. */
export function applyDocumentTreatment<T extends { tax?: number; totalTax?: number; taxes?: { amount?: number }[] | null }>(
  treatment: TaxTreatment | null | undefined,
  suppliedTax: number,
  items: T[],
): { tax: number; items: T[] } {
  const tax = resolveDocumentTax(treatment, suppliedTax);
  if (!suppressesTax(treatment)) return { tax, items };
  const zeroed = items.map((it) => ({
    ...it,
    // Zero every per-line tax field, whichever naming a doc type uses.
    ...(it.tax !== undefined ? { tax: 0 } : {}),
    ...(it.totalTax !== undefined ? { totalTax: 0 } : {}),
    ...(it.taxes !== undefined ? { taxes: (it.taxes ?? []).map((t) => ({ ...t, amount: 0 })) } : {}),
  }));
  return { tax, items: zeroed };
}
