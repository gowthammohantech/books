/**
 * One error hierarchy for HTTP-shaped failures.
 *
 * WHY: sixteen error classes exist across `lib/` and four controllers, ten of
 * them carrying a `status`, and two of them named `BadRequestError` in different
 * files with different bodies. Each one is translated by a hand-written
 * `handleXxx(res, err): boolean` next to where it is thrown — `handleLedgerError`
 * (26 call sites), `sendPrismaError` (14), and 165 open-coded
 * `instanceof UnauthorizedError` checks. The translation is duplicated because
 * there is no single thing to translate.
 *
 * This is that thing. `middleware/prismaError.ts` now honours any error carrying
 * a numeric `status`, so a throw reaches the client as the right code without a
 * per-file handler.
 *
 * DELIBERATELY NOT DONE HERE: the sixteen existing classes are not re-pointed at
 * this base, and their call sites are untouched. They already carry `status`
 * where it matters, so they are honoured by the same handler change; migrating
 * them is module-by-module work for the service extraction, not a flag day.
 * `AppError` exists for code written from here on.
 *
 * SHAPE: mirrors `UnauthorizedError` in `lib/tenantScope.ts` — a `status` field
 * and `this.name` set in the constructor — because that is the convention two
 * controllers already say they are copying (`purchaseController.ts:97`,
 * `supplierPaymentController.ts:56`).
 */

/**
 * Base for every error that knows its own HTTP status.
 *
 * `details` carries a field-level map for validation-style failures, matching
 * the `errors` key that `middleware/handleValidationResult.ts` already emits and
 * the SPA already parses.
 */
export abstract class AppError extends Error {
  abstract readonly status: number;

  constructor(
    message: string,
    readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
    // Restores the prototype chain under `target: es2015`+ with a class
    // extending a built-in, so `instanceof` works on subclasses.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The request was malformed or failed validation. */
export class BadRequestError extends AppError {
  readonly status = 400;
}

/** No usable credential. The SPA logs out on this, so do not use it for "wrong tenant". */
export class UnauthorizedError extends AppError {
  readonly status = 401;
}

/** Authenticated, but not allowed. */
export class ForbiddenError extends AppError {
  readonly status = 403;
}

/** The addressed row does not exist, or does not belong to this tenant. */
export class NotFoundError extends AppError {
  readonly status = 404;
}

/** The write would violate a uniqueness or state invariant. */
export class ConflictError extends AppError {
  readonly status = 409;
}

/** Well-formed, but rejected on business rules. */
export class UnprocessableEntityError extends AppError {
  readonly status = 422;
}

/** The accounting period is closed. Mirrors `PeriodLockedError` in lib/ledger. */
export class PeriodLockedError extends AppError {
  readonly status = 423;
}

/**
 * Does this error know its own HTTP status?
 *
 * Structural rather than `instanceof AppError`, so the ten pre-existing classes
 * that already carry a numeric `status` — `UnauthorizedError`, `ForbiddenError`,
 * `ExplainError`, `TenantMismatchError`, `ForeignTenantRowError`,
 * `TenantContextMissingError`, `AiDisabledError`, `PendingApprovalError`,
 * `OverpaymentError` — are honoured too, without being re-pointed at this base.
 *
 * The range check matters: a stray `status` property that is not a real HTTP
 * code must not become one.
 */
export function hasHttpStatus(err: unknown): err is { status: number; message: string } {
  if (typeof err !== 'object' || err === null) return false;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599;
}

/** Field-level details, when the error carries them. */
export function errorDetails(err: unknown): Record<string, string> | undefined {
  if (err instanceof AppError) return err.details;
  return undefined;
}
