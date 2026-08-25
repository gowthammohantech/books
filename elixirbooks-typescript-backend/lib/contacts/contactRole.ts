export type ContactView =
  | 'all-active' | 'clients' | 'suppliers'
  | 'clients-open-invoices' | 'suppliers-open-bills' | 'hidden' | 'all';

export function deriveRole(flags: { hasClientTxn: boolean; hasSupplierTxn: boolean }): { isClient: boolean; isSupplier: boolean } {
  return { isClient: flags.hasClientTxn, isSupplier: flags.hasSupplierTxn };
}

// Invoice.status uses InvoiceStatus enum; 'PAID' is the paid value.
// Purchase.status uses PurchaseStatus enum; 'paid' is the paid value (lowercase).

const CLIENT_SOME = {
  OR: [
    { invoicesAsContact: { some: { isDeleted: false } } },
    { quotationsAsContact: { some: { isDeleted: false } } },
    { challansAsContact: { some: { isDeleted: false } } },
  ],
};

const SUPPLIER_SOME = {
  OR: [
    { purchasesAsContact: { some: { isDeleted: false } } },
    { purchaseOrdersAsContact: { some: { isDeleted: false } } },
    { debitNotesAsContact: { some: { isDeleted: false } } },
    { expensesAsContact: { some: { isDeleted: false } } },
  ],
};

export function contactViewWhere(userId: string, view: ContactView): Record<string, unknown> {
  const base = { userId, isDeleted: false };
  switch (view) {
    case 'all': return { userId };
    case 'all-active': return { ...base, status: 'ACTIVE' };
    case 'hidden': return { ...base, status: 'HIDDEN' };
    case 'clients': return { ...base, status: 'ACTIVE', ...CLIENT_SOME };
    case 'suppliers': return { ...base, status: 'ACTIVE', ...SUPPLIER_SOME };
    case 'clients-open-invoices':
      // Invoice.status (InvoiceStatus enum): not PAID means open
      return { ...base, status: 'ACTIVE', invoicesAsContact: { some: { isDeleted: false, status: { not: 'PAID' } } } };
    case 'suppliers-open-bills':
      // Purchase.status (PurchaseStatus enum): not 'paid' (lowercase) means open
      return { ...base, status: 'ACTIVE', purchasesAsContact: { some: { isDeleted: false, status: { not: 'paid' } } } };
  }
}
