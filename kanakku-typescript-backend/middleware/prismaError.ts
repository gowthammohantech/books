import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';

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
 * Anything else falls through to a 500 so the caller can decide.
 */
export interface HttpError {
  status: number;
  message: string;
}

export function toHttpError(err: unknown): HttpError {
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

  return { status: 500, message: err instanceof Error ? err.message : String(err) };
}

/**
 * Send a Prisma/validation error as a JSON response from a controller catch block.
 * Returns true when it handled the error so callers can `if (sendPrismaError(...)) return;`.
 */
export function sendPrismaError(res: Response, err: unknown): boolean {
  const { status, message } = toHttpError(err);
  res.status(status).json({ success: false, message });
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
  const { status, message } = toHttpError(err);
  if (status >= 500) {
    console.error('Unhandled error:', err);
  }
  res.status(status).json({ success: false, message });
}

// CommonJS interop for legacy JS route/server files.
module.exports = { toHttpError, sendPrismaError, prismaErrorHandler };
module.exports.toHttpError = toHttpError;
module.exports.sendPrismaError = sendPrismaError;
module.exports.prismaErrorHandler = prismaErrorHandler;
