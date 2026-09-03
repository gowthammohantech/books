/**
 * React Query cache keys, in one place.
 *
 * WHY A FACTORY: a key written inline at the useQuery site has to be written
 * again, identically, at every invalidation site, and a mismatch fails silently
 * — the mutation succeeds and the list simply does not refresh. The nine files
 * already using React Query write their keys inline (`['moduleHierarchy']`,
 * `['customFields', id]`), which works only because nothing invalidates them yet.
 *
 * SHAPE: each resource exposes `all` (the invalidation root), `list(params)` and
 * `detail(id)`. Invalidating `all` catches every list and detail beneath it,
 * because React Query matches keys by prefix.
 */

/** Keys for one resource, derived from its name. */
function resource(name: string) {
  return {
    /** Invalidate this to refresh every list and detail for the resource. */
    all: [name] as const,
    list: (params?: Record<string, unknown>) => [name, 'list', params ?? {}] as const,
    detail: (id: string) => [name, 'detail', id] as const,
  };
}

export const qk = {
  products: resource('products'),
  invoices: resource('invoices'),
  quotations: resource('quotations'),
  purchases: resource('purchases'),
  purchaseOrders: resource('purchase-orders'),
  creditNotes: resource('credit-notes'),
  debitNotes: resource('debit-notes'),
  deliveryChallans: resource('delivery-challans'),
  contacts: resource('contacts'),
  expenses: resource('expenses'),

  /**
   * Reference data: small, changes rarely, read on nearly every screen. These
   * are the ones whose hand-rolled module-level caches React Query replaces.
   */
  currencies: resource('currencies'),
  costCenters: resource('cost-centers'),
  taxRates: resource('tax-rates'),
  units: resource('units'),
  brands: resource('brands'),
  categories: resource('categories'),
  paymentModes: resource('payment-modes'),
  transactionTypes: resource('transaction-types'),
  transactionCategories: resource('transaction-categories'),

  /** Per-document sub-resources. */
  invoicePayments: (invoiceId: string) => ['invoices', 'detail', invoiceId, 'payments'] as const,
  invoiceActivity: (invoiceId: string) => ['invoices', 'detail', invoiceId, 'activity'] as const,
  purchaseActivity: (purchaseId: string) => ['purchases', 'detail', purchaseId, 'activity'] as const,
  supplierPayments: (purchaseId: string) => ['purchases', 'detail', purchaseId, 'payments'] as const,

  /** Cross-cutting. */
  moduleHierarchy: ['module-hierarchy'] as const,
  customFields: (moduleId: string | null) => ['custom-fields', moduleId] as const,
  session: ['session'] as const,
  workQueues: ['work-queues'] as const,
} as const;
