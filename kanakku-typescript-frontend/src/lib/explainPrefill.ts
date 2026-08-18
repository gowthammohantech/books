import type { BankTransactionRow, BankTransactionRelatedType } from '@models/bankTransaction';

export interface ExplainPrefill {
  transactionTypeKey: string;
  categoryId: string;
  taxTreatment: string;
  description: string;
  linkedDoc: { id: string; name: string } | null;
  linkedRelatedType: BankTransactionRelatedType | null;
}

// Prefill precedence: persisted selection (explained / retained-after-unexplain)
// → AI proposal (FOR_APPROVAL) → empty.
export function deriveExplainPrefill(txn: BankTransactionRow): ExplainPrefill {
  const proposal = txn.explainStatus === 'FOR_APPROVAL' ? (txn.proposal ?? null) : null;

  const transactionTypeKey = txn.transactionTypeKey ?? proposal?.transactionTypeKey ?? '';
  const categoryId = txn.category?.id ?? proposal?.categoryId ?? '';
  const taxTreatment = txn.taxTreatment ?? 'AUTO';
  const description = txn.explainedDescription ?? txn.remarks ?? '';

  const exp = txn.explanation;
  // The picker (and the explain payload built from it) needs the linked parent
  // DOCUMENT id. `explanation.entityId` is that document id (invoice/purchase);
  // `explanation.relatedId` mirrors the row's relatedId, which for banking-
  // explained invoice/bill rows is the created payment's id — submitting it as
  // invoiceId/purchaseId fails the backend lookup, so it is only a last resort.
  const savedId = exp?.entityId ?? exp?.id ?? exp?.relatedId
    ?? (txn.relatedType !== 'MANUAL' ? txn.relatedId : null);

  let linkedDoc: ExplainPrefill['linkedDoc'] = null;
  let linkedRelatedType: BankTransactionRelatedType | null =
    (exp?.relatedType as BankTransactionRelatedType | undefined) ?? txn.relatedType;

  if (savedId) {
    linkedDoc = { id: String(savedId), name: exp?.documentNo ?? exp?.label ?? String(savedId) };
  } else if (proposal?.entityId) {
    linkedDoc = { id: String(proposal.entityId), name: proposal.documentNo ?? proposal.label };
    linkedRelatedType = (proposal.relatedType as BankTransactionRelatedType | undefined) ?? null;
  }

  return { transactionTypeKey, categoryId, taxTreatment, description, linkedDoc, linkedRelatedType };
}
