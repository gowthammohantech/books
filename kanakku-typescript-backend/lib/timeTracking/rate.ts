/**
 * lib/timeTracking/rate.ts
 *
 * Pure rate-resolution helper for time entries.
 *
 * Precedence: a member-specific billing rate wins over the project default,
 * which wins over 0. `null`/`undefined` mean "no rate set" (fall through); an
 * explicit `0` is a real value (free) and is kept — it is NOT treated as
 * absence, because `??` only coalesces null/undefined.
 */

export interface ResolveEntryRateInput {
  /** The member's per-project billing rate, if one was set. */
  memberRate?: number | null;
  /** The project's default billing rate, if one was set. */
  projectRate?: number | null;
}

/**
 * Resolve the effective billing rate for a time entry:
 * `memberRate ?? projectRate ?? 0`.
 */
export function resolveEntryRate({ memberRate, projectRate }: ResolveEntryRateInput): number {
  return memberRate ?? projectRate ?? 0;
}
