// lib/httpErrors.ts
import type { Response } from 'express';
import { LedgerError, PeriodLockedError } from './ledger/buildLines';

/**
 * Returns true if it handled a ledger-domain error (and sent a response).
 * - PeriodLockedError → 423 Locked
 * - other LedgerError → 400 Bad Request
 * - anything else    → false (caller continues to its generic 500 handler)
 */
export function handleLedgerError(res: Response, err: unknown): boolean {
  if (err instanceof PeriodLockedError) {
    res.status(423).json({ success: false, message: err.message });
    return true;
  }
  if (err instanceof LedgerError) {
    res.status(400).json({ success: false, message: err.message });
    return true;
  }
  return false;
}
