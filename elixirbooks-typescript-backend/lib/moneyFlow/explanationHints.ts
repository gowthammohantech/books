// lib/moneyFlow/explanationHints.ts
//
// Learning store helpers for the ExplanationHint model (Banking Phase B2).
//
// Every successful explain/approve upserts a hint: payee → transactionTypeKey +
// categoryId + payToUserId.  On the next bank import/auto-analyse pass the
// matcher consults lookupHint first so repeating payees pre-fill without user
// input.
//
// Both recordHint and lookupHint accept a Prisma tx client so they compose
// inside a caller's $transaction without creating a nested transaction.

import type { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

export interface HintResult {
  transactionTypeKey: string;
  categoryId: string | null;
  payToUserId: string | null;
}

interface RecordHintOptions {
  tenantId: string;
  payee: string | null | undefined;
  transactionTypeKey: string;
  categoryId?: string | null;
  payToUserId?: string | null;
}

// ---------------------------------------------------------------------------
// normalisePayeeKey
// ---------------------------------------------------------------------------

/**
 * Normalises a raw payee string into a stable lookup key.
 *
 * Rules:
 *   1. null / undefined / blank → ''
 *   2. Lowercase
 *   3. Strip all non-alphanumeric, non-space characters (punctuation removed, not spaced)
 *   4. Collapse runs of whitespace to a single space
 *   5. Trim leading/trailing whitespace
 */
export function normalisePayeeKey(s: string | null | undefined): string {
  if (s == null) return '';
  // Strip punctuation (everything that is not a letter, digit, or whitespace)
  // Note: punctuation is removed without replacement so 'Amazon.com' → 'amazoncom'
  const stripped = s.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  return collapsed;
}

// ---------------------------------------------------------------------------
// recordHint
// ---------------------------------------------------------------------------

/**
 * Upsert an ExplanationHint row.
 *
 * On insert: stores the type/category/payTo + hitCount=1 + lastUsedAt=now.
 * On conflict (tenantId, payeeKey): updates the type/category/payTo to the
 *   latest value, increments hitCount, and bumps lastUsedAt.
 *
 * No-ops (does nothing) when payee normalises to an empty string.
 */
export async function recordHint(
  tx: Tx,
  { tenantId, payee, transactionTypeKey, categoryId, payToUserId }: RecordHintOptions,
): Promise<void> {
  const payeeKey = normalisePayeeKey(payee);
  if (!payeeKey) return;

  const now = new Date();
  const resolvedCategoryId = categoryId ?? null;
  const resolvedPayToUserId = payToUserId ?? null;

  await tx.explanationHint.upsert({
    where: { tenantId_payeeKey: { tenantId, payeeKey } },
    create: {
      tenantId,
      payeeKey,
      transactionTypeKey,
      categoryId: resolvedCategoryId,
      payToUserId: resolvedPayToUserId,
      hitCount: 1,
      lastUsedAt: now,
    },
    update: {
      transactionTypeKey,
      categoryId: resolvedCategoryId,
      payToUserId: resolvedPayToUserId,
      hitCount: { increment: 1 },
      lastUsedAt: now,
    },
  });
}

// ---------------------------------------------------------------------------
// lookupHint
// ---------------------------------------------------------------------------

/**
 * Look up a stored ExplanationHint by (tenantId, payee).
 *
 * Returns the mapping { transactionTypeKey, categoryId, payToUserId } if a
 * hint exists, or null if the payee is empty / unknown.
 */
export async function lookupHint(
  tx: Tx,
  tenantId: string,
  payee: string | null | undefined,
): Promise<HintResult | null> {
  const payeeKey = normalisePayeeKey(payee);
  if (!payeeKey) return null;

  const row = await tx.explanationHint.findUnique({
    where: { tenantId_payeeKey: { tenantId, payeeKey } },
  });

  if (!row) return null;

  return {
    transactionTypeKey: row.transactionTypeKey,
    categoryId: row.categoryId,
    payToUserId: row.payToUserId,
  };
}
