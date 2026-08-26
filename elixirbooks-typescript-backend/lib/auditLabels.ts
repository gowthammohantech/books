type LabelFn = (r: Record<string, unknown>) => unknown;

// Best-effort human-readable label per model. Extend as needed.
const REGISTRY: Record<string, LabelFn> = {
  Invoice: (r) => r.invoiceNumber,
  Quotation: (r) => r.quotationNumber,
  CreditNote: (r) => r.creditNoteNumber,
  DebitNote: (r) => r.debitNoteNumber,
  Purchase: (r) => r.purchaseNumber,
  PurchaseOrder: (r) => r.orderNumber,
  Customer: (r) => r.name,
  Supplier: (r) => r.name,
  Product: (r) => r.productName ?? r.name,
  Expense: (r) => r.title ?? r.reference,
  User: (r) => r.email,
  BankDetail: (r) => r.bankName ?? r.accountHoldername ?? r.accountNumber,
  TaxRate: (r) => r.name,
  Currency: (r) => r.code ?? r.name,
  Brand: (r) => r.name,
  Category: (r) => r.name,
  Unit: (r) => r.name,
  ExpenseCategory: (r) => r.title ?? r.name,
  DeliveryChallan: (r) => r.challanNumber,
  Reminder: (r) => r.title,
};

export function resolveEntityLabel(
  model: string,
  record: Record<string, unknown> | null | undefined,
): string | null {
  if (!record) return null;
  const fn = REGISTRY[model];
  const value = fn ? fn(record) : undefined;
  if (value != null && value !== '') return String(value);
  return record.id != null ? String(record.id) : null;
}

module.exports = { resolveEntityLabel };
module.exports.resolveEntityLabel = resolveEntityLabel;
