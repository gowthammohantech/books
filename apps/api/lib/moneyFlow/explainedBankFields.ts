/**
 * explainedBankFields — pure helper that produces the "auto-explained" field set
 * to spread into a `bankTransaction.create` for payment-born (non-MANUAL) bank
 * transactions.
 *
 * Payment-born bank lines (invoice payment, supplier payment, expense, purchase
 * inline payment, petty-cash transfer) are already linked to a posted document,
 * so they should skip the unexplained queue: they are EXPLAINED at create, and
 * reconciled iff a journal entry actually posted. The isPaymentBorn flag marks
 * these rows as read-only in the banking module: they cannot be re-explained or
 * unmarked.
 *
 * Pure — no I/O, no Date.now(). The caller passes the acting timestamp in.
 */
export function explainedBankFields(params: {
  postedSourceType?: string | null;
  postedSourceId?: string | null;
  posted: boolean;
  approvedById?: string | null;
  approvedAt?: Date | null;
}): {
  explainStatus: 'EXPLAINED';
  isPaymentBorn: true;
  isReconciled: boolean;
  postedSourceType: string | null;
  postedSourceId: string | null;
  approvedById: string | null;
  approvedAt: Date | null;
} {
  return {
    explainStatus: 'EXPLAINED',
    isPaymentBorn: true,
    isReconciled: params.posted,
    postedSourceType: params.postedSourceType ?? null,
    postedSourceId: params.postedSourceId ?? null,
    approvedById: params.approvedById ?? null,
    approvedAt: params.approvedAt ?? null,
  };
}
