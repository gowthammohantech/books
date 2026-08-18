// lib/ledger/postingGate.ts
export interface LedgerSettings {
  ledgerInitialized: boolean;
  goLiveDate: Date | null;
}

/**
 * Truncate a Date to UTC midnight (floor to calendar day in UTC).
 * Used to compare dates without time-of-day bias: a bank transaction stored at
 * 00:00:00 UTC on the go-live day must not be blocked by a goLiveDate that
 * carries a daytime time component (e.g. 09:59:48).
 */
export function utcDateFloor(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Posts only when the tenant ledger is initialized and the document is dated
 *  on/after the cutover (go-live) date. Everything else is a no-op so existing
 *  installs are unaffected until they opt into the ledger (B.5/B.6).
 *
 *  Comparison is on DATE FLOOR (UTC midnight) so a bank transaction dated on
 *  the same calendar day as goLiveDate always passes, regardless of intra-day
 *  time components on either side. */
export function shouldPost(settings: LedgerSettings | null | undefined, date: Date): boolean {
  if (!settings || !settings.ledgerInitialized || !settings.goLiveDate) return false;
  return utcDateFloor(date) >= utcDateFloor(settings.goLiveDate);
}
