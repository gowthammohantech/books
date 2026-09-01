/**
 * Aging bucket classification, shared by the backend aging reports and the
 * frontend drill-down links.
 *
 * The frontend copy (apps/web/src/utils/agingBuckets.ts) carried the comment
 * "Mirrors the backend bucket math in lib/reports/aging.ts" and then restated
 * the boundaries by hand. Both sides now use these.
 *
 * The DB-backed parts of the backend's aging module — `creditNoteTotalsByInvoice`
 * and the GL-derived aging queries — stay in apps/api: they issue Prisma queries
 * and cannot be shared with a browser bundle.
 */
export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus';

export const AGING_BUCKETS = [
  'current',
  'd1_30',
  'd31_60',
  'd61_90',
  'd90plus',
] as const satisfies readonly AgingBucket[];

/**
 * daysOverdue -> bucket. `days <= 0` is current (not yet due); the rest are
 * inclusive 30-day windows with everything past 90 collapsing into d90plus.
 */
export function classifyDays(days: number): AgingBucket {
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90plus';
}

/** Whole days between a due date and the report's as-of date. */
export function daysOverdue(asOf: Date | string, dueDate: Date | string): number {
  const a = asOf instanceof Date ? asOf : new Date(asOf);
  const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
  return Math.floor((a.getTime() - d.getTime()) / 86_400_000);
}

export interface DueWindow {
  dueStartDate?: string;
  dueEndDate?: string;
}

/** `asOf` shifted back `days` days, as a YYYY-MM-DD string. */
function shiftDays(asOf: string, days: number): string {
  const d = new Date(`${asOf}T00:00:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * The dueDate window a bucket corresponds to, so clicking a bucket drills to
 * exactly the invoices/purchases whose due date falls in that range. The
 * inverse of `classifyDays`.
 */
export function bucketDueWindow(asOf: string, bucket: AgingBucket): DueWindow {
  switch (bucket) {
    case 'current':
      return { dueStartDate: asOf };
    case 'd1_30':
      return { dueStartDate: shiftDays(asOf, 30), dueEndDate: shiftDays(asOf, 1) };
    case 'd31_60':
      return { dueStartDate: shiftDays(asOf, 60), dueEndDate: shiftDays(asOf, 31) };
    case 'd61_90':
      return { dueStartDate: shiftDays(asOf, 90), dueEndDate: shiftDays(asOf, 61) };
    case 'd90plus':
      return { dueEndDate: shiftDays(asOf, 91) };
  }
}
