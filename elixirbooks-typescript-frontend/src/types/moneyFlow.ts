/** Direction of a transaction type relative to the bank account. */
export type MoneyFlow = 'MONEY_IN' | 'MONEY_OUT' | 'MONEY_IN_USER' | 'MONEY_OUT_USER';

/** How the ledger engine posts the transaction. */
export type PostingBehaviour =
  | 'invoice_link'
  | 'bill_link'
  | 'credit_note_link'
  | 'income_generic'
  | 'generic_category'
  | 'capital_asset'
  | 'asset_disposal'
  | 'owner_funds'
  | 'user_payment';

/** UI field tokens that drive which form fields are rendered. */
export type FieldKey =
  | 'category'
  | 'tax'
  | 'person'
  | 'invoiceLink'
  | 'billLink'
  | 'creditNoteLink'
  | 'assetFields'
  | 'disposedAssetLink'
  | 'reason';

/** Which document types a transaction category can be applied to. */
export type CategoryAppliesTo = 'MONEY_IN' | 'MONEY_OUT' | 'MONEY_IN_USER' | 'MONEY_OUT_USER';

/** One entry from GET /admin/transaction-types */
export interface TransactionTypeDef {
  key: string;
  label: string;
  flow: MoneyFlow;
  postingBehaviour: PostingBehaviour;
  fields: FieldKey[];
  taxApplicable: boolean;
  hidden?: boolean;
}

export interface UserPaymentReasonDef {
  key: string;
  label: string;
  accountCode: string;
}

export interface UserPaymentReasons {
  money_received_from_user: UserPaymentReasonDef[];
  money_paid_to_user: UserPaymentReasonDef[];
}

/** One entry from GET /admin/transaction-categories */
export interface TransactionCategory {
  id: string;
  code: string;
  name: string;
  group: string;
  appliesTo: CategoryAppliesTo;
  accountId: string;
  account?: { id: string; code: string; name: string } | null;
  defaultTaxRateId: string | null;
  defaultTaxRate?: { id: string; name: string; rate: number } | null;
  taxApplicable: boolean;
  status: boolean;
}
