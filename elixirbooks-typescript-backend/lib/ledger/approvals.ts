// lib/ledger/approvals.ts
// Spec D — maker-checker approval gate helpers (pure functions, no DB access).

export type ApprovalDocType = 'invoice' | 'expense' | 'purchase';

/**
 * Returns the approvalStatus to stamp on a newly created document.
 * When approvals are enabled: PENDING (do NOT post to GL).
 * When approvals are disabled: NOT_REQUIRED (post immediately as before).
 */
export function initialApprovalStatus(
  approvalsEnabled: boolean,
): 'NOT_REQUIRED' | 'PENDING' {
  return approvalsEnabled ? 'PENDING' : 'NOT_REQUIRED';
}

/**
 * Returns whether the GL posting should happen at create-time.
 * True  → approvals off, post immediately (default behaviour, unchanged).
 * False → approvals on, defer posting until the approve endpoint fires.
 */
export function shouldPostOnCreate(approvalsEnabled: boolean): boolean {
  return !approvalsEnabled;
}
