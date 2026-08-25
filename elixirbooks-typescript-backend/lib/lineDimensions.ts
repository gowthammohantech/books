// lib/lineDimensions.ts
//
// Profit-centre tagging for document line items.
//
// Line items are stored denormalised in a JSON column (`Invoice.items`,
// `Purchase.items`, ...), so there is NO foreign key protecting the centre id
// on a line. A typo'd or cross-tenant id would silently poison the departmental
// P&L with no way to trace it back — hence assertCostCentresExist below, which
// every write path must call before persisting.
//
// Sits alongside lib/lineCustomFields.ts, which solves the same
// "a key that lives inside the items JSON" problem for custom fields.

/** Explicit "leave this line untagged" marker.
 *
 *  A blank value cannot mean this: the forms post multipart/form-data, where an
 *  untouched select arrives as '' — and '' has to keep meaning "inherit the
 *  header", which is the overwhelmingly common case. So clearing a line's
 *  centre needs a sentinel of its own. */
export const LINE_CENTRE_NONE = '__none__';

/**
 * Resolve one line's profit centre against the document header.
 *
 * - `undefined` / `null` / `''`  → inherit the header centre
 * - `'__none__'`                 → explicitly untagged (null)
 * - anything else                → that centre id
 */
export function resolveLineCostCenterId(
  raw: unknown,
  headerCostCenterId: string | null,
): string | null {
  if (raw === undefined || raw === null) return headerCostCenterId;
  const value = String(raw).trim();
  if (value === '') return headerCostCenterId;
  if (value === LINE_CENTRE_NONE) return null;
  return value;
}

/** Every distinct non-null centre id referenced by a document, header included. */
export function collectCostCentreIds(
  headerCostCenterId: string | null | undefined,
  items: Array<{ costCenterId?: string | null }>,
): string[] {
  const ids = new Set<string>();
  if (headerCostCenterId) ids.add(headerCostCenterId);
  for (const item of items) {
    if (item.costCenterId) ids.add(item.costCenterId);
  }
  return [...ids];
}

/** Thrown when a document references a centre the tenant does not own. */
export class UnknownCostCentreError extends Error {
  readonly ids: string[];
  constructor(ids: string[]) {
    super(
      ids.length === 1
        ? `Profit center ${ids[0]} does not exist`
        : `Profit centers ${ids.join(', ')} do not exist`,
    );
    this.name = 'UnknownCostCentreError';
    this.ids = ids;
  }
}

/** Minimal slice of a Prisma client/tx this module needs. */
export interface CostCentreLookupTx {
  costCenter: {
    findMany(args: {
      where: Record<string, unknown>;
      select?: Record<string, boolean>;
    }): Promise<Array<{ id: string }>>;
  };
}

/**
 * Assert every referenced centre exists, belongs to this tenant and is live.
 *
 * One query regardless of line count. Throws `UnknownCostCentreError` naming the
 * offending ids so the caller can map it to a 400 the user can act on.
 */
export async function assertCostCentresExist(
  tx: CostCentreLookupTx,
  userId: string,
  ids: string[],
): Promise<void> {
  if (!ids.length) return;

  const found = await tx.costCenter.findMany({
    where: { id: { in: ids }, userId, isDeleted: false },
    select: { id: true },
  });

  const foundIds = new Set(found.map((c) => c.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  if (missing.length) throw new UnknownCostCentreError(missing);
}
