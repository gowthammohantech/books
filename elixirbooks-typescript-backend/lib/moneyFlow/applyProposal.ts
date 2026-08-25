// lib/moneyFlow/applyProposal.ts
//
// Banking Phase B / B3 — the auto-analyse applier.
//
// Runs the B2 matcher (autoMatch) on an UNEXPLAINED MANUAL bank transaction and,
// when the best match is high-confidence (AUTO), persists the proposal snapshot
// onto the txn and flips its explainStatus to FOR_APPROVAL — filling the approval
// queue. A SUGGEST-or-none result leaves the txn UNEXPLAINED (suggestions remain
// available on demand via the analyse endpoint / suggestMatches).
//
// Guard: only ever touches relatedType === 'MANUAL' (or null) AND
// explainStatus === 'UNEXPLAINED'. Payment-born and already-explained txns are
// never modified. The applier never throws on a no-match; the caller decides
// whether to wrap matcher errors (create/import wrap; the endpoints surface them).

import { autoMatch, type AutoMatchResult, type AutoMatchBankTxn, type AutoMatchDb } from './autoMatch';

// Structural slice of the BankTransaction row this applier reads its guards from.
export interface ApplyBankTxn extends AutoMatchBankTxn {
  relatedType?: string | null;
  explainStatus?: string | null;
}

// Structural slice of the Prisma (tx) client: autoMatch's fetchers + the update.
export interface ApplyProposalDb extends AutoMatchDb {
  bankTransaction: {
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
}

export interface ApplyAutoMatchResult extends AutoMatchResult {
  /** The resulting explainStatus after the applier ran. */
  status: string;
  /**
   * True when the durable result is a FOR_APPROVAL AUTO match that ALSO clears the
   * stricter auto-post bar (see ProposedExplanation.autoPostEligible). The applier
   * itself NEVER posts — it always writes the durable FOR_APPROVAL queue row so the
   * match is never lost. This signal lets the caller run a SEPARATE, post-commit,
   * best-effort auto-post pass (explainAndPost in its own transaction) when the
   * tenant's bankAutoPostEnabled toggle is on. A post failure simply leaves the row
   * safely in FOR_APPROVAL.
   */
  autoPostEligible: boolean;
}

/**
 * Run autoMatch on a MANUAL UNEXPLAINED bank txn; if the best candidate is AUTO,
 * persist the proposal snapshot + flip to FOR_APPROVAL. Returns the candidates +
 * best regardless of whether anything was written.
 */
export async function applyAutoMatch(
  tx: ApplyProposalDb,
  bankTxn: ApplyBankTxn,
  userId: string,
): Promise<ApplyAutoMatchResult> {
  const relatedType = bankTxn.relatedType ?? 'MANUAL';
  const explainStatus = bankTxn.explainStatus ?? 'UNEXPLAINED';

  // GUARD: never touch payment-born or already-explained txns.
  if (relatedType !== 'MANUAL' || explainStatus !== 'UNEXPLAINED') {
    return { candidates: [], best: undefined, status: explainStatus, autoPostEligible: false };
  }

  const result = await autoMatch(tx, bankTxn, userId);
  const best = result.best;

  if (best && best.confidence === 'AUTO') {
    await tx.bankTransaction.update({
      where: { id: bankTxn.id },
      data: {
        // Proposal snapshot (read back by the approve endpoint — Task 4).
        proposedTransactionTypeKey: best.transactionTypeKey,
        proposedCategoryId: best.categoryId ?? null,
        proposedRelatedType: best.relatedType ?? null,
        proposedRelatedId: best.relatedId ?? null,
        matchConfidence: 'AUTO',
        matchScore: best.score,
        // Explain-input mirrors so the explain/approve path can read them
        // straight off the txn without re-deriving the proposal.
        transactionTypeKey: best.transactionTypeKey,
        categoryId: best.categoryId ?? null,
        payToUserId: best.payToUserId ?? null,
        explainStatus: 'FOR_APPROVAL',
      },
    });
    // Durable FOR_APPROVAL row written. Surface the stricter auto-post signal so a
    // post-commit best-effort pass can auto-post it when the tenant opted in.
    return { ...result, status: 'FOR_APPROVAL', autoPostEligible: best.autoPostEligible === true };
  }

  // No AUTO best → leave UNEXPLAINED, write nothing.
  return { ...result, status: 'UNEXPLAINED', autoPostEligible: false };
}

// CommonJS interop for any legacy JS consumers.
module.exports = { applyAutoMatch };
module.exports.applyAutoMatch = applyAutoMatch;
