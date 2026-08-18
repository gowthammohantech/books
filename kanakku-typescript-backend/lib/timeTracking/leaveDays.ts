/**
 * lib/timeTracking/leaveDays.ts
 *
 * Pure day-counting helpers for leave requests. No prisma, no DB.
 *
 * Dates are treated as date-only and parsed as LOCAL midnight via a first-10-char
 * slice (mirrors the frontend `parseISODate` in MyTimesheet.tsx) so an ISO
 * datetime like `2026-06-22T00:00:00.000Z` never drifts a day under UTC.
 */

export type LeavePortion = 'FULL' | 'AM' | 'PM';

export interface BuildLeaveDaysOptions {
  /** `yyyy-MM-dd` (or ISO datetime) strings to exclude (company holidays). */
  holidays: string[];
  /** Per-date portion override, keyed by `yyyy-MM-dd`. */
  perDay?: Record<string, LeavePortion>;
  /** Portion to use when a date has no `perDay` entry. Defaults to FULL. */
  defaultPortion?: LeavePortion;
}

export interface LeaveDay {
  /** `yyyy-MM-dd`. */
  date: string;
  portion: LeavePortion;
  /** 1.0 for FULL, 0.5 for AM|PM. */
  portionDays: number;
}

export interface BuildLeaveDaysResult {
  days: LeaveDay[];
  /** Sum of `portionDays` across `days`. */
  totalDays: number;
}

/** Map a leave portion to the fractional number of days it represents. */
export function portionToDays(p: LeavePortion): number {
  return p === 'FULL' ? 1 : 0.5;
}

/** Take the `yyyy-MM-dd` prefix of a date-only or ISO datetime string. */
function dateKey(s: string): string {
  return s.slice(0, 10);
}

/** Parse a `yyyy-MM-dd` (or ISO datetime) string to a LOCAL Date at midnight. */
function parseLocalDate(s: string): Date {
  const [y, m, d] = dateKey(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** True for Saturday (6) and Sunday (0) in local time. */
function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Format a Date as `yyyy-MM-dd` in local time. */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Enumerate working days in `[startISO, endISO]` inclusive, dropping weekends
 * and holidays, applying a per-date or default portion to each remaining day.
 */
export function buildLeaveDays(
  startISO: string,
  endISO: string,
  opts: BuildLeaveDaysOptions,
): BuildLeaveDaysResult {
  const defaultPortion: LeavePortion = opts.defaultPortion ?? 'FULL';
  const perDay = opts.perDay ?? {};
  const holidaySet = new Set(opts.holidays.map(dateKey));

  const start = parseLocalDate(startISO);
  const end = parseLocalDate(endISO);

  const days: LeaveDay[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    if (isWeekend(cursor)) continue;
    const iso = toISODate(cursor);
    if (holidaySet.has(iso)) continue;
    const portion = perDay[iso] ?? defaultPortion;
    days.push({ date: iso, portion, portionDays: portionToDays(portion) });
  }

  const totalDays = days.reduce((sum, d) => sum + d.portionDays, 0);
  return { days, totalDays };
}
