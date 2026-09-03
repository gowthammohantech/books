import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';

import { errorDetails, hasHttpStatus } from '../core/errors/appError';

/**
 * Map Prisma (and Prisma-validation) errors to a user-facing HTTP status + message.
 *
 * Controllers historically funnelled every failure into a generic 500
 * ("Error saving X") that hid the real cause from the user. This translates the
 * common Prisma failure modes into actionable responses:
 *   - P2002 unique violation        -> 409 "<field> already exists"
 *   - P2003 foreign-key violation   -> 400 "Related <field> does not exist"
 *   - P2025 record not found        -> 404
 *   - PrismaClientValidationError   -> 400 (bad type/shape, e.g. number into a String column)
 *
 * It also honours any error carrying a numeric HTTP `status` — every AppError,
 * and the ten pre-existing classes that already declare one. Before that branch
 * existed nothing translated them globally, so an UnauthorizedError escaping a
 * controller became a 500 "Not authorized" rather than a 401, and
 * ForeignTenantRowError — which sets `code = 'P2025'` precisely so not-found
 * handling keeps working — became a 500 rather than a 404, because it is not a
 * `Prisma.PrismaClientKnownRequestError` and the check above misses it.
 *
 * Anything else is a 500 whose message is NOT echoed to the client: an
 * unrecognised error is by definition one nobody wrote a message for, and its
 * text is as likely to be a stack-adjacent internal detail as anything a caller
 * should read. It is logged instead.
 */
export interface HttpError {
  status: number;
  message: string;
  details?: Record<string, string>;
}

export function toHttpError(err: unknown): HttpError {
  // Errors that know their own status win: they were thrown deliberately, by
  // code that decided what the caller should see.
  if (hasHttpStatus(err)) {
    return { status: err.status, message: err.message, details: errorDetails(err) };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        const target = err.meta?.target;
        const fields = Array.isArray(target) ? target.join(', ') : String(target ?? 'value');
        return { status: 409, message: `A record with this ${fields} already exists` };
      }
      case 'P2003': {
        const field = (err.meta?.field_name as string) ?? 'reference';
        return { status: 400, message: `Related ${field} does not exist` };
      }
      case 'P2025':
        return { status: 404, message: (err.meta?.cause as string) ?? 'Record not found' };
      default:
        return { status: 400, message: `Database error (${err.code})` };
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    // The full message is multi-line and noisy; surface the final "Argument ..."
    // / "Invalid value" line which names the offending field and expected type.
    const lines = err.message.trim().split('\n');
    const detail = lines.reverse().find((l) => /Argument|Invalid|Expected/i.test(l))?.trim();
    return { status: 400, message: detail ?? 'Invalid data submitted' };
  }

  return { status: 500, message: 'Internal server error' };
}

/**
 * Send a Prisma/validation error as a JSON response from a controller catch block.
 * Returns true when it handled the error so callers can `if (sendPrismaError(...)) return;`.
 */
export function sendPrismaError(res: Response, err: unknown): boolean {
  const { status, message, details } = toHttpError(err);
  res.status(status).json({ success: false, message, ...(details ? { errors: details } : {}) });
  return true;
}

/**
 * Express error-handling middleware (4-arg). Catches anything thrown or passed to
 * next(err) that the controller did not handle itself, so unvalidated paths return
 * a real message instead of crashing or returning an opaque 500.
 */
export function prismaErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const { status, message, details } = toHttpError(err);
  if (status >= 500) {
    // The only place the real message survives, now that it is not returned.
    console.error('Unhandled error:', err);
  }
  res.status(status).json({ success: false, message, ...(details ? { errors: details } : {}) });
}
