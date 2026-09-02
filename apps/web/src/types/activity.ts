/**
 * One row of an entity's audit feed.
 *
 * `InvoiceActivityEntry` and `PurchaseActivityEntry` were declared separately —
 * in `types/invoice-payment.ts` and inside `hooks/usePurchaseActivity.ts` — with
 * the same eight fields in the same order. Both now alias this, so the shared
 * `<ActivityTimeline>` has one type to render and a third document type does not
 * need a fourth copy.
 */
export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  summary: string | null;
  userName: string | null;
  createdAt: string;
}
