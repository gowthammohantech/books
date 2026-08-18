export type MoneyFlow = 'MONEY_IN'|'MONEY_OUT'|'MONEY_IN_USER'|'MONEY_OUT_USER';
export type PostingBehaviour = 'invoice_link'|'bill_link'|'capital_asset'|'generic_category'|'income_generic'|'owner_funds'|'user_payment'|'asset_disposal'|'credit_note_link';
export type FieldKey = 'category'|'tax'|'person'|'invoiceLink'|'billLink'|'assetFields'|'disposedAssetLink'|'reason'|'creditNoteLink';
export interface TransactionTypeDef { key: string; label: string; flow: MoneyFlow; postingBehaviour: PostingBehaviour; fields: FieldKey[]; taxApplicable: boolean; hidden?: boolean }

export interface UserPaymentReasonDef { key: string; label: string; accountCode: string }

export const USER_PAYMENT_REASONS: {
  money_received_from_user: UserPaymentReasonDef[];
  money_paid_to_user: UserPaymentReasonDef[];
} = {
  money_received_from_user: [
    { key: 'director_loan', label: 'Director Loan Account', accountCode: '9200' },
    { key: 'unpaid_shares', label: 'Unpaid Shares', accountCode: '9210' },
    { key: 'share_capital_introduced', label: 'Share Capital Introduced', accountCode: '9210' },
  ],
  money_paid_to_user: [
    { key: 'director_loan_repayment', label: 'Director Loan Repayment', accountCode: '9200' },
    { key: 'net_salary', label: 'Net Salary', accountCode: '9230' },
    { key: 'dividend', label: 'Dividend', accountCode: '9220' },
    { key: 'benefit_in_kind', label: 'Benefit in Kind', accountCode: '9230' },
    { key: 'expense_payment', label: 'Expense Payment', accountCode: '9250' },
    { key: 'payroll_settlement', label: 'Salary — settles payroll run', accountCode: '9260' },
  ],
};

export const TRANSACTION_TYPES: TransactionTypeDef[] = [
  // MONEY_IN
  { key: 'invoice_receipt', label: 'Invoice Receipt', flow: 'MONEY_IN', postingBehaviour: 'invoice_link', fields: ['invoiceLink'], taxApplicable: false },
  { key: 'sales', label: 'Sales', flow: 'MONEY_IN', postingBehaviour: 'income_generic', fields: ['category','tax'], taxApplicable: true },
  { key: 'refund', label: 'Refund', flow: 'MONEY_IN', postingBehaviour: 'income_generic', fields: ['category','tax'], taxApplicable: true },
  { key: 'bill_refund', label: 'Bill Refund', flow: 'MONEY_IN', postingBehaviour: 'income_generic', fields: ['category','tax'], taxApplicable: true },
  { key: 'other_money_in', label: 'Other Money In', flow: 'MONEY_IN', postingBehaviour: 'income_generic', fields: ['category','tax'], taxApplicable: true },
  { key: 'capital_asset_disposal', label: 'Disposal of Capital Asset', flow: 'MONEY_IN', postingBehaviour: 'asset_disposal', fields: ['disposedAssetLink','tax'], taxApplicable: true },
  // MONEY_OUT
  { key: 'bill_payment', label: 'Bill Payment', flow: 'MONEY_OUT', postingBehaviour: 'bill_link', fields: ['billLink'], taxApplicable: false },
  { key: 'capital_asset', label: 'Purchase of Capital Asset', flow: 'MONEY_OUT', postingBehaviour: 'capital_asset', fields: ['category','tax','assetFields'], taxApplicable: true },
  { key: 'payment', label: 'Payment', flow: 'MONEY_OUT', postingBehaviour: 'generic_category', fields: ['category','tax'], taxApplicable: true },
  // sales_refund stays generic_category: it's a catch-all outflow for returns not tied to a specific
  // credit note. The user picks the appropriate account (Sales Returns, etc.). No sub-ledger document
  // is created — it's a plain category-based cash outflow. GAP 3 note: if you need to refund a
  // specific credit note, use credit_note_refund (credit_note_link behaviour) instead.
  { key: 'sales_refund', label: 'Sales Refund', flow: 'MONEY_OUT', postingBehaviour: 'generic_category', fields: ['category','tax'], taxApplicable: true },
  { key: 'credit_note_refund', label: 'Credit Note Refund', flow: 'MONEY_OUT', postingBehaviour: 'credit_note_link', fields: ['creditNoteLink'], taxApplicable: false },
  { key: 'other_money_out', label: 'Other Money Out', flow: 'MONEY_OUT', postingBehaviour: 'generic_category', fields: ['category','tax'], taxApplicable: true },
  { key: 'hp_payment', label: 'Payment of HP Agreement', flow: 'MONEY_OUT', postingBehaviour: 'generic_category', fields: ['category','tax'], taxApplicable: true },
  // MONEY_IN_USER — new collapsed type (visible)
  { key: 'money_received_from_user', label: 'Money Received from User', flow: 'MONEY_IN_USER', postingBehaviour: 'owner_funds', fields: ['person','reason'], taxApplicable: false },
  // MONEY_IN_USER — legacy types (hidden for back-compat)
  { key: 'owner_loan_in', label: 'Owner Loan Account', flow: 'MONEY_IN_USER', postingBehaviour: 'owner_funds', fields: ['category'], taxApplicable: false, hidden: true },
  { key: 'unpaid_shares', label: 'Payment for Unpaid Shares', flow: 'MONEY_IN_USER', postingBehaviour: 'owner_funds', fields: ['category'], taxApplicable: false, hidden: true },
  { key: 'share_capital', label: 'Share Capital Introduced', flow: 'MONEY_IN_USER', postingBehaviour: 'owner_funds', fields: ['category'], taxApplicable: false, hidden: true },
  // MONEY_OUT_USER — new collapsed type (visible)
  { key: 'money_paid_to_user', label: 'Money Paid to User', flow: 'MONEY_OUT_USER', postingBehaviour: 'user_payment', fields: ['person','reason'], taxApplicable: false },
  // MONEY_OUT_USER — legacy types (hidden for back-compat)
  { key: 'net_salary', label: 'Net Salary and Bonuses', flow: 'MONEY_OUT_USER', postingBehaviour: 'user_payment', fields: ['person','category'], taxApplicable: false, hidden: true },
  { key: 'benefit_in_kind', label: 'Benefit in Kind', flow: 'MONEY_OUT_USER', postingBehaviour: 'user_payment', fields: ['person','category'], taxApplicable: false, hidden: true },
  { key: 'expense_payment', label: 'Expense Payment', flow: 'MONEY_OUT_USER', postingBehaviour: 'user_payment', fields: ['person','category'], taxApplicable: false, hidden: true },
  { key: 'dividend', label: 'Dividend', flow: 'MONEY_OUT_USER', postingBehaviour: 'user_payment', fields: ['person','category'], taxApplicable: false, hidden: true },
  { key: 'owner_loan_out', label: 'Owner Loan Repayment', flow: 'MONEY_OUT_USER', postingBehaviour: 'user_payment', fields: ['person','category'], taxApplicable: false, hidden: true },
];

export function getTransactionType(key: string): TransactionTypeDef | undefined {
  return TRANSACTION_TYPES.find(t => t.key === key);
}

module.exports = { TRANSACTION_TYPES, getTransactionType, USER_PAYMENT_REASONS };
module.exports.TRANSACTION_TYPES = TRANSACTION_TYPES;
module.exports.getTransactionType = getTransactionType;
module.exports.USER_PAYMENT_REASONS = USER_PAYMENT_REASONS;
