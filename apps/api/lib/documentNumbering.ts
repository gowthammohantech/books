// lib/documentNumbering.ts
//
// Shared per-tenant document numbering for the app-generated series
// (INV-000001, PUR-000001, CN-000001, DN-000001, PAY-000001, ...).
//
// nextDocumentNumber() is now simply "this tenant's highest number + 1".
//
// It used to be more than that. While the number columns were @unique ACROSS
// THE INSTALL but counted PER TENANT, a young tenant's candidate could collide
// with a number another tenant already held, so this module carried a
// three-step algorithm with an install-wide fallback that silently skipped the
// second tenant forward. P4 replaced those constraints with
// @@unique([tenantId, <number>]) and the whole contradiction disappeared:
// two tenants may now both hold INV-000001, which is what a user expects.
//
// This module is still the single source of truth for the five callers that
// used to duplicate the logic byte-for-byte (creditNote, debitNote, purchase,
// supplierPayment controllers + lib/ledger/applyBillPayment.ts).
//
// RACE HARDENING (unchanged, and still necessary). The lookup below is a plain
// read, so two concurrent creators INSIDE THE SAME TENANT can compute the same
// number and only one `create()` wins under the unique constraint.
// withDocumentNumberRetry() wraps the whole OWNING `$transaction` (not just the
// `create`) in a bounded retry on a P2002 for the number field. Retrying just
// the `create` in place is unsafe: once one statement in an interactive
// transaction fails, Postgres poisons the rest of that transaction and any
// further query on the same `tx` client also errors. Re-running the entire
// transaction gets a fresh connection that recomputes the number against the
// now-committed state — each loser's next attempt sees one more committed row,
// so the collision cannot repeat forever. This mirrors the retry-on-P2002
// recovery in lib/ledger/postingEngine.ts's post() and the retry-with-offset
// numbering in lib/recurring/runner.ts's createInvoiceWithNumber().
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
   * Tenant filter merged into the "last row for this tenant" lookup —
   * `{ tenantId }`. Kept explicit rather than read from the ALS context
   * because this runs inside `$transaction` and its correctness is
   * load-bearing: get it wrong and one tenant continues another's series.
   */
  tenantWhere: Record<string, unknown>;
}

function extractTrailingNumber(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const match = value.match(/\d+$/);
  return match ? parseInt(match[0], 10) : 0;
}

/**
 * Compute the next document number for this tenant: its highest issued number
 * plus one. Numbers are per tenant, so two companies both starting at
 * INV-000001 is correct and expected.
 */
export async function nextDocumentNumber(options: NextDocumentNumberOptions): Promise<string> {
  const { model, field, prefix, width = 6, tenantWhere } = options;

  const last = await model.findFirst({
    where: { [field]: { not: null }, ...tenantWhere },
    orderBy: { createdAt: 'desc' },
    select: { [field]: true },
  });
  return `${prefix}${String(extractTrailingNumber(last?.[field]) + 1).padStart(width, '0')}`;
}

/**
 * True if `err` is a Prisma P2002 unique-violation naming `field` — or one
 * whose target we can't inspect, conservatively treated as a match since this
 * helper is only ever wrapped around number-generating creates/transactions.
 *
 * After P4 the target is the COMPOSITE `["tenantId", "invoiceNumber"]`
 * rather than `["invoiceNumber"]`. The substring match below still finds
 * the field name in that array, which is why this kept working through the
 * constraint swap; documentNumbering.spec.ts asserts it explicitly.
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
