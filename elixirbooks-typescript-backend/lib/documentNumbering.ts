// lib/documentNumbering.ts
//
// Shared tenant-aware document numbering for series whose number column is a
// GLOBAL `@unique` constraint (see the `// TODO 0.1c` comments in
// prisma/schema.prisma — CreditNote.creditNoteNumber, DebitNote.debitNoteId,
// Purchase.purchaseId, SupplierPayment.paymentId, ...). Numbering is counted
// per-tenant (each tenant's first document is ...-000001) but the column is
// unique across the whole install, so a young tenant's candidate can collide
// with another tenant's already-issued number.
//
// nextDocumentNumber() algorithm:
//   1. tenant-scoped candidate = (highest number THIS tenant already has) + 1
//   2. if that number is free install-wide, use it
//   3. else fall back to (install-wide highest number) + 1 — a number no
//      other tenant can already hold, under the same numbers-only-grow
//      assumption the old single global sequence relied on
//
// This was previously duplicated byte-for-byte in 5 places (creditNote,
// debitNote, purchase, supplierPayment controllers + applyBillPayment.ts).
// This module is the single source of truth; all 5 now call it.
//
// RACE HARDENING: steps 1-3 above are plain reads — two concurrent creators
// can compute the *same* fallback number, and only one `create()` wins under
// the DB unique constraint. withDocumentNumberRetry() wraps the whole OWNING
// `$transaction` (not just the `create`) in a bounded retry on a P2002 for the
// number field. Retrying just the `create` in place is unsafe: once one
// statement in an interactive transaction fails, Postgres poisons the rest of
// that transaction and any further query on the same `tx` client also errors.
// Re-running the entire transaction gets a fresh connection that recomputes
// the number against the now-committed state — each loser's next attempt sees
// one more committed row, so the collision cannot repeat forever. This
// mirrors the retry-on-P2002 recovery in lib/ledger/postingEngine.ts's
// post() and the retry-with-offset numbering in
// lib/recurring/runner.ts's createInvoiceWithNumber().
//
// Callers that do NOT own their transaction (lib/ledger/applyBillPayment.ts,
// invoked from inside lib/moneyFlow/explainPosting.ts's single
// prisma.$transaction) cannot safely retry at all — retrying would need to
// re-run the whole outer transaction, which is a decision for that
// transaction's owner, not this helper. For that site a same-field P2002
// simply propagates: it aborts the owning $transaction (nothing was
// committed) and the existing generic Prisma-error mapping
// (middleware/prismaError.ts's toHttpError / sendPrismaError, already wired
// into both callers of explainAndPost) turns it into a clean 409 instead of a
// raw 500 — no extra code needed there.

import type { Response } from 'express';

export const MAX_NUMBER_RETRIES = 3;

/**
 * Structural shape shared by every Prisma model delegate this helper touches
 * (a real `Prisma.TransactionClient`'s `tx.creditNote`, `tx.debitNote`,
 * `tx.purchase`, `tx.supplierPayment` all satisfy it structurally — pass with
 * an `as unknown as NumberingModel` cast, the same pattern already used
 * throughout this codebase for narrowed tx-client interfaces).
 */
export interface NumberingModel {
  findFirst(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, 'asc' | 'desc'>;
    select?: Record<string, boolean>;
  }): Promise<Record<string, unknown> | null>;
}

export interface NextDocumentNumberOptions {
  /** The model delegate (or tx-scoped delegate) to query. */
  model: NumberingModel;
  /** The globally-@unique number column, e.g. 'debitNoteId', 'paymentId'. */
  field: string;
  /** Numeric-suffix prefix, e.g. 'DN-', 'PAY-'. */
  prefix: string;
  /** Zero-pad width for the numeric suffix. Defaults to 6. */
  width?: number;
  /**
   * Tenant filter merged into the "last row for this tenant" lookup. Pass
   * `{ userId }` for models with a direct column, or a relation filter like
   * `{ purchase: { userId } }` when the model has none (SupplierPayment).
   */
  tenantWhere: Record<string, unknown>;
}

function extractTrailingNumber(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const match = value.match(/\d+$/);
  return match ? parseInt(match[0], 10) : 0;
}

/**
 * Compute the next tenant-scoped document number, falling back to the
 * install-wide max + 1 on a global clash. See file header for the algorithm.
 */
export async function nextDocumentNumber(options: NextDocumentNumberOptions): Promise<string> {
  const { model, field, prefix, width = 6, tenantWhere } = options;

  const last = await model.findFirst({
    where: { [field]: { not: null }, ...tenantWhere },
    orderBy: { createdAt: 'desc' },
    select: { [field]: true },
  });
  const candidate = `${prefix}${String(extractTrailingNumber(last?.[field]) + 1).padStart(width, '0')}`;

  // <field> is @unique across the whole install but the tenant-scoped lookup
  // above only sees this tenant's rows, so the candidate may already be held
  // by another tenant. On clash, fall back to the install-wide highest + 1.
  const clash = await model.findFirst({
    where: { [field]: candidate },
    select: { id: true },
  });
  if (!clash) return candidate;

  const globalLast = await model.findFirst({
    where: { [field]: { not: null } },
    orderBy: { [field]: 'desc' },
    select: { [field]: true },
  });
  const globalNumber = extractTrailingNumber(globalLast?.[field]);
  return `${prefix}${String(globalNumber + 1).padStart(width, '0')}`;
}

/**
 * True if `err` is a Prisma P2002 unique-violation naming `field` — or one
 * whose target we can't inspect, conservatively treated as a match since this
 * helper is only ever wrapped around number-generating creates/transactions.
 */
export function isNumberFieldConflict(err: unknown, field: string): boolean {
  if (!err || typeof err !== 'object' || (err as { code?: string }).code !== 'P2002') return false;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) {
    return target.some((t) => typeof t === 'string' && t.toLowerCase().includes(field.toLowerCase()));
  }
  if (typeof target === 'string') return target.toLowerCase().includes(field.toLowerCase());
  return true;
}

/**
 * Run `attempt` — an entire OWNING `$transaction` call, not just the
 * `create` inside it — up to `maxAttempts` times, retrying only on a P2002
 * collision on `field`. See file header for why the retry must wrap the
 * whole transaction rather than just the create.
 */
export async function withDocumentNumberRetry<T>(
  field: string,
  attempt: () => Promise<T>,
  maxAttempts = MAX_NUMBER_RETRIES,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      if (!isNumberFieldConflict(err, field) || i === maxAttempts - 1) throw err;
    }
  }
  // Unreachable: the loop above always either returns or throws.
  throw lastErr;
}

/**
 * Handler-level fallback: if every retry attempt still collided, map the
 * P2002 to a clean 409 instead of letting it fall through to a raw 500.
 * Returns true if it handled (and sent) the response.
 */
export function handleNumberConflict(res: Response, err: unknown, field: string): boolean {
  if (isNumberFieldConflict(err, field)) {
    res.status(409).json({
      success: false,
      message: 'Could not allocate a unique document number — please retry.',
    });
    return true;
  }
  return false;
}
