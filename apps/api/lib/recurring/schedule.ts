// lib/recurring/schedule.ts
//
// Pure schedule date + lifecycle helpers for RecurringInvoiceSchedule.
// No DB, no Prisma client — every function is a pure function over plain values
// so it can be unit-tested in isolation and reused by the runner/controller.
//
// computeNextRun re-implements (rather than imports) the date math from
// lib/recurringInvoiceRunner.ts::getNextRecurringDate. Decision: that module
// pulls in the Prisma client (`./prisma`) and Prisma enum types at import time,
// which would couple this pure lib to the DB. The math here is identical
// (same UTC accessors, same day/week/month/year/custom branches) but expressed
// against a plain Cadence shape, keeping this file DB-free per the task spec.

export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';

export interface Cadence {
  repeatEvery: RecurrenceUnit | 'custom';
  customIntervalNumber?: number | null;
  customIntervalType?: RecurrenceUnit | null;
}

export type RecurringScheduleStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'COMPLETED';

/**
 * Compute the next run strictly after `from`, per the cadence.
 *
 * Uses UTC accessors throughout (mirrors getNextRecurringDate): dates are stored
 * and compared in UTC, and local-time month/year arithmetic rolls a day early on
 * hosts behind UTC. UTC math is timezone-independent. Does not mutate `from`.
 */
export function computeNextRun(from: Date, cadence: Cadence): Date {
  const next = new Date(from.getTime());

  let interval = 1;
  let unit: RecurrenceUnit = 'month';

  if (cadence.repeatEvery === 'custom') {
    interval = cadence.customIntervalNumber ?? 1;
    unit = cadence.customIntervalType ?? 'month';
  } else {
    unit = cadence.repeatEvery ?? 'month';
  }

  switch (unit) {
    case 'day':
      next.setUTCDate(next.getUTCDate() + interval);
      break;
    case 'week':
      next.setUTCDate(next.getUTCDate() + 7 * interval);
      break;
    case 'month':
      next.setUTCMonth(next.getUTCMonth() + interval);
      break;
    case 'year':
      next.setUTCFullYear(next.getUTCFullYear() + interval);
      break;
    default:
      next.setUTCMonth(next.getUTCMonth() + interval);
  }

  return next;
}

/**
 * A schedule is due iff it is ACTIVE, has a nextRunDate, and that date is at or
 * before `today`.
 */
export function isDue(
  s: { status: string; nextRunDate: Date | null },
  today: Date,
): boolean {
  return (
    s.status === 'ACTIVE' &&
    s.nextRunDate != null &&
    s.nextRunDate.getTime() <= today.getTime()
  );
}

export interface AdvanceInput {
  startOn: Date;
  endsOn: Date | null;
  neverExpire: boolean;
  maxOccurrences: number | null;
  occurrencesCount: number;
  cadence: Cadence;
}

export interface AdvanceResult {
  nextRunDate: Date | null;
  occurrencesCount: number;
  status: 'ACTIVE' | 'COMPLETED';
}

/**
 * Apply the effect of one completed run: increment the occurrence count, compute
 * the candidate next run, then apply end conditions.
 *
 * The schedule COMPLETES (status COMPLETED, nextRunDate null) when either:
 *   - maxOccurrences is set and the new count has reached it, or
 *   - it is not neverExpire, endsOn is set, and the candidate next run would
 *     fall after endsOn.
 * Otherwise it stays ACTIVE with the candidate next run.
 */
export function advanceAfterRun(s: AdvanceInput, runDate: Date): AdvanceResult {
  const occurrencesCount = s.occurrencesCount + 1;
  const candidateNext = computeNextRun(runDate, s.cadence);

  const reachedMax = s.maxOccurrences != null && occurrencesCount >= s.maxOccurrences;
  const pastEnd =
    !s.neverExpire &&
    s.endsOn != null &&
    candidateNext.getTime() > s.endsOn.getTime();

  if (reachedMax || pastEnd) {
    return { nextRunDate: null, occurrencesCount, status: 'COMPLETED' };
  }

  return { nextRunDate: candidateNext, occurrencesCount, status: 'ACTIVE' };
}

/**
 * Re-anchor a schedule's next run when it resumes.
 *
 * If the stored nextRunDate is null or already in the past (< today), the
 * schedule has gone stale while paused; return the next valid run computed from
 * today so a resumed schedule doesn't backfire (immediately fire for every
 * missed period). If nextRunDate is today or in the future, keep it as-is.
 */
export function reanchorOnResume(
  s: { nextRunDate: Date | null; cadence: Cadence },
  today: Date,
): Date {
  if (s.nextRunDate == null || s.nextRunDate.getTime() < today.getTime()) {
    return computeNextRun(today, s.cadence);
  }
  return s.nextRunDate;
}
