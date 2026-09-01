export type BankTransactionType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'PAYMENT'
  | 'RECEIPT';

export type BankTransactionRelatedType =
  | 'INVOICE_PAYMENT'
  | 'SUPPLIER_PAYMENT'
  | 'PETTYCASH'
  | 'EXPENSE'
  | 'MANUAL';

// Human-readable labels for `relatedType`, shared by the list page (row badge)
// and the inline explain form (linked/read-only panel).
export const BANK_TXN_RELATED_TYPE_LABEL: Record<BankTransactionRelatedType, string> = {
  MANUAL: 'Manual',
  INVOICE_PAYMENT: 'Invoice payment',
  SUPPLIER_PAYMENT: 'Supplier payment',
  PETTYCASH: 'Petty cash',
  EXPENSE: 'Expense',
};

// A row is "payment-born" when it was CREATED by a module payment flow —
// the backend stamps BankTransaction.isPaymentBorn at create
// (lib/moneyFlow/explainedBankFields.ts). Payment-born rows are read-only in
// banking (edited at their source document); everything else is always
// editable in the inline explain form.
export const isBankTxnPaymentBorn = (
  tx: Pick<BankTransactionRow, 'isPaymentBorn'>,
): boolean => tx.isPaymentBorn === true;

// Explain/Analyse are offered only for rows still awaiting an explanation.
// (Explained rows are edited by expanding the row — the form is always
// editable — so the list-level action only targets the unexplained queue.)
export const canOfferExplain = (
  tx: Pick<BankTransactionRow, 'explainStatus' | 'isPaymentBorn'>,
): boolean => tx.explainStatus === 'UNEXPLAINED' && !tx.isPaymentBorn;

// Explanation/proposal labels returned by the backend list/getById endpoints
// (mirrors ExplanationLabel/ProposalLabel in bankTransactionController.ts).
export interface BankTransactionExplanation {
  kind: string;
  label: string;
  documentNo?: string | null;
  partyName?: string | null;
  link?: string | null;
  // GL account this txn posts to (added by backend; e.g. "6201" / "Office Costs")
  accountCode?: string | null;
  accountName?: string | null;
  // Linked source document — mirrors the row's relatedType/relatedId, plus the
  // picker-friendly id + label used to prefill the SmartDropdown on re-edit.
  relatedType?: BankTransactionRelatedType | null;
  relatedId?: string | null;
  // Backend has always sent `entityId`, not `id`, for the linked source
  // document's id; `id` stays for back-compat with older payloads.
  entityId?: string | null;
  id?: string | null;
}

export interface BankTransactionProposal extends BankTransactionExplanation {
  confidence: string | null;
  score: number | null;
  // AI proposal fields (all branches carry transactionTypeKey/categoryId;
  // invoice/purchase branches also carry entityId — mirrors
  // BankTransactionExplanation.entityId for the linked source document).
  transactionTypeKey?: string | null;
  categoryId?: string | null;
  entityId?: string | null;
}

export interface BankTransactionRow {
  id: string;
  bankAccountId: string;
  bankAccount: {
    id: string;
    bankName: string;
    accountNumber: string;
    accountHoldername?: string;
  } | null;
  transactionDate: string;
  type: BankTransactionType;
  amount: string | number;
  balanceBefore: string | number;
  balanceAfter: string | number;
  paymentMode: { id: string; name: string; slug?: string } | null;
  referenceNo: string;
  remarks: string;
  relatedType: BankTransactionRelatedType | null;
  relatedId: string | null;
  isReconciled: boolean;
  reconciledBy: string | null;
  reconciliationDate: string | null;
  // Money In / Money Out explain fields
  explainStatus: 'UNEXPLAINED' | 'FOR_APPROVAL' | 'EXPLAINED';
  // True when this EXPLAINED row was posted automatically by the auto-post tier
  // (bankAutoPostEnabled) rather than via manual approval. Set by the backend
  // list endpoint (bankTransactionController). Used to render the "Auto-posted"
  // badge and surface a prominent "Undo" action.
  autoPosted: boolean;
  // True when this row was CREATED by a module payment flow (invoice
  // receipt, supplier payment, petty cash, expense) — stamped by the
  // backend at create (lib/moneyFlow/explainedBankFields.ts). Payment-born
  // rows are read-only in banking; drives isBankTxnPaymentBorn/canOfferExplain.
  isPaymentBorn: boolean;
  direction: 'money_in' | 'money_out';
  currencyCode: string | null;
  category?: { id: string; name: string } | null;
  transactionTypeKey?: string | null;
  // Saved tax treatment from the prior explain (e.g. 'AUTO' | 'ZERO' | ...).
  taxTreatment?: string | null;
  // Saved note from the prior explain, retained on unexplain for prefill.
  explainedDescription?: string | null;
  // What this txn is explained as (EXPLAINED) or proposed as (FOR_APPROVAL).
  explanation?: BankTransactionExplanation | null;
  proposal?: BankTransactionProposal | null;
}

export interface BankTransactionPreviewRow {
  date: string;
  description: string;
  amount: number;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  // Parsed reference/cheque number column (backend: extractReference in
  // bankTransactionController.ts). Always a string ('' when no matching
  // column/value found), forwarded verbatim to importConfirm as `reference`.
  reference: string;
  error?: string;
}
