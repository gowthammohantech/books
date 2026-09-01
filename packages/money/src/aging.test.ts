import { describe, expect, it } from 'vitest';

import { bucketDueWindow, classifyDays, daysOverdue } from './aging.js';

describe('classifyDays', () => {
  it.each([
    [-5, 'current'],
    [0, 'current'],
    [1, 'd1_30'],
    [30, 'd1_30'],
    [31, 'd31_60'],
    [60, 'd31_60'],
    [61, 'd61_90'],
    [90, 'd61_90'],
    [91, 'd90plus'],
    [365, 'd90plus'],
  ])('%i days overdue -> %s', (days, bucket) => {
    expect(classifyDays(days)).toBe(bucket);
  });
});

describe('daysOverdue', () => {
  it('is whole days between due date and as-of', () => {
    expect(daysOverdue('2026-02-01', '2026-01-01')).toBe(31);
    expect(daysOverdue('2026-01-01', '2026-01-01')).toBe(0);
    expect(daysOverdue('2026-01-01', '2026-02-01')).toBe(-31);
  });
});

describe('bucketDueWindow', () => {
  const asOf = '2026-03-01';

  it('current is everything not yet due', () => {
    expect(bucketDueWindow(asOf, 'current')).toEqual({ dueStartDate: asOf });
  });

  it('d90plus is open-ended at the old end', () => {
    expect(bucketDueWindow(asOf, 'd90plus')).toEqual({ dueEndDate: '2025-11-30' });
  });

  it('is the inverse of classifyDays at every boundary', () => {
    // A window's endpoints must classify back into the bucket that produced it,
    // or a drill-down link shows a different set than the number it came from.
    for (const bucket of ['d1_30', 'd31_60', 'd61_90'] as const) {
      const w = bucketDueWindow(asOf, bucket);
      expect(classifyDays(daysOverdue(asOf, w.dueStartDate!))).toBe(bucket);
      expect(classifyDays(daysOverdue(asOf, w.dueEndDate!))).toBe(bucket);
    }
  });

  it('windows are contiguous — no due date falls between two buckets', () => {
    const d1 = bucketDueWindow(asOf, 'd1_30');
    const d31 = bucketDueWindow(asOf, 'd31_60');
    const dayAfter = new Date(`${d31.dueEndDate}T00:00:00`);
    dayAfter.setDate(dayAfter.getDate() + 1);
    expect(dayAfter.toISOString().slice(0, 10)).toBe(d1.dueStartDate);
  });
});
