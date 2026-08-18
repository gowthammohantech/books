// lib/moneyFlow/aiCategorySuggest.ts
//
// Ship 2 — AI category suggestion for an UNEXPLAINED bank transaction.
//
// Called from the analyse path AFTER the local applyAutoMatch found no
// document/category match. It fetches the tenant's candidate transaction
// categories, asks the Dreams Agents gateway to classify the transaction, and
// — on a confident match — writes the SAME proposal snapshot applyAutoMatch
// writes (proposedCategoryId + transactionTypeKey + FOR_APPROVAL) so the
// existing proposal badge and one-click Approve endpoint work unchanged.
//
// Scope: only plain MONEY_IN / MONEY_OUT categories (which pair with the
// generic category-based transaction types). MONEY_IN_USER / MONEY_OUT_USER
// (owner/user payments needing a person + reason) are intentionally excluded —
// a classifier can't infer those, and their posting doesn't take a category.
//
// FAIL-SOFT: any error returns { applied: false } so analyse never fails.

import { prisma } from '../prisma';
import { explainBankTransaction, type ExplainDirection } from '../agentsGatewayClient';

// BankTransactionType → money-flow direction.
const MONEY_IN_TYPES = new Set(['DEPOSIT', 'RECEIPT', 'TRANSFER_IN']);

// The generic, category-based transaction type to post under, per direction.
// payment          → generic_category (debit the category's expense account)
// other_money_in   → income_generic   (credit the category's income account)
const TYPE_KEY_BY_DIRECTION: Record<ExplainDirection, string> = {
  MONEY_OUT: 'payment',
  MONEY_IN: 'other_money_in',
};

// Amounts have no per-row currency on BankTransaction; Kanakku posts in the
// company base currency. The gateway uses currency only as context (no math).
const DEFAULT_CURRENCY = 'INR';

export interface SuggestBankTxn {
  id: string;
  type: string;
  amount: unknown; // Prisma.Decimal | number | string
  remarks: string | null;
  referenceNo: string | null;
  relatedType: string | null;
  explainStatus: string;
}

export interface SuggestResult {
  applied: boolean;
  status: string;
}

export async function suggestBankTxnCategory(
  txn: SuggestBankTxn,
  userId: string,
): Promise<SuggestResult> {
  try {
    // Guard: never touch payment-born or already-handled rows.
    if ((txn.relatedType ?? 'MANUAL') !== 'MANUAL' || txn.explainStatus !== 'UNEXPLAINED') {
      return { applied: false, status: txn.explainStatus };
    }

    const direction: ExplainDirection = MONEY_IN_TYPES.has(txn.type)
      ? 'MONEY_IN'
      : 'MONEY_OUT';
    const appliesTo = direction === 'MONEY_IN' ? 'MONEY_IN' : 'MONEY_OUT';

    const cats = await prisma.transactionCategory.findMany({
      where: {
        userId,
        isDeleted: false,
        status: true,
        appliesTo: appliesTo as never,
      },
      select: {
        id: true,
        code: true,
        name: true,
        group: true,
        account: { select: { code: true } },
      },
    });
    if (cats.length === 0) return { applied: false, status: 'UNEXPLAINED' };

    const byCode = new Map(cats.map((c) => [c.code, c]));
    const description =
      [txn.remarks, txn.referenceNo].filter(Boolean).join(' — ').trim() ||
      'Bank transaction';

    const result = await explainBankTransaction({
      txnId: txn.id,
      transaction: {
        description,
        amount: String(txn.amount),
        currency: DEFAULT_CURRENCY,
        direction,
      },
      candidates: cats.map((c) => ({
        code: c.code,
        name: c.name,
        group: c.group,
        accountCode: c.account?.code,
      })),
    });

    // Only queue a confident, valid match. for-approval / null / gateway-down
    // all leave the row UNEXPLAINED (no noise in the queue).
    if (!result || !result.match || result.decision !== 'auto-explain') {
      return { applied: false, status: 'UNEXPLAINED' };
    }
    const chosen = byCode.get(result.match.categoryCode);
    if (!chosen) return { applied: false, status: 'UNEXPLAINED' };

    await prisma.bankTransaction.update({
      where: { id: txn.id },
      data: {
        // Proposal snapshot read by the approve endpoint (mirrors applyAutoMatch).
        proposedTransactionTypeKey: TYPE_KEY_BY_DIRECTION[direction],
        proposedCategoryId: chosen.id,
        proposedRelatedType: null,
        proposedRelatedId: null,
        matchConfidence: 'AI',
        matchScore: Math.round(result.confidence * 100),
        // Explain-input mirrors so the approve/post path reads them directly.
        transactionTypeKey: TYPE_KEY_BY_DIRECTION[direction],
        categoryId: chosen.id,
        payToUserId: null,
        explainStatus: 'FOR_APPROVAL',
      },
    });

    return { applied: true, status: 'FOR_APPROVAL' };
  } catch (err) {
    console.error('aiCategorySuggest error (non-fatal):', err);
    return { applied: false, status: txn.explainStatus };
  }
}
