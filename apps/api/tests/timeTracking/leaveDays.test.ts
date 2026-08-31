/**
 * tests/timeTracking/leaveDays.test.ts
 *
 * Unit tests for buildLeaveDays / portionToDays — pure date-counting helpers
 * (no prisma, no DB). Dates are parsed date-only/local to avoid UTC drift.
 */

import { describe, it, expect } from 'vitest';
import { buildLeaveDays, portionToDays } from '../../lib/timeTracking/leaveDays';

describe('portionToDays', () => {
  it('maps FULL to 1 and AM/PM to 0.5', () => {
    expect(portionToDays('FULL')).toBe(1);
    expect(portionToDays('AM')).toBe(0.5);
    expect(portionToDays('PM')).toBe(0.5);
  });
});

describe('buildLeaveDays', () => {
  it('enumerates a Mon–Fri range as 5 full days, totalDays 5', () => {
    // 2026-06-22 is a Monday, 2026-06-26 a Friday.
    const res = buildLeaveDays('2026-06-22', '2026-06-26', { holidays: [] });
    expect(res.days).toHaveLength(5);
    expect(res.days.map((d) => d.date)).toEqual([
      '2026-06-22',
      '2026-06-23',
      '2026-06-24',
      '2026-06-25',
      '2026-06-26',
    ]);
    expect(res.days.every((d) => d.portion === 'FULL' && d.portionDays === 1)).toBe(true);
    expect(res.totalDays).toBe(5);
  });

  it('excludes Saturday and Sunday from a range spanning a weekend', () => {
    // 2026-06-26 Fri .. 2026-06-29 Mon: Sat 27 + Sun 28 dropped.
    const res = buildLeaveDays('2026-06-26', '2026-06-29', { holidays: [] });
    expect(res.days.map((d) => d.date)).toEqual(['2026-06-26', '2026-06-29']);
    expect(res.totalDays).toBe(2);
  });

  it('excludes a holiday that falls within the range', () => {
    const res = buildLeaveDays('2026-06-22', '2026-06-26', {
      holidays: ['2026-06-24'],
    });
    expect(res.days.map((d) => d.date)).toEqual([
      '2026-06-22',
      '2026-06-23',
      '2026-06-25',
      '2026-06-26',
    ]);
    expect(res.totalDays).toBe(4);
  });

  it('applies a per-day AM portion as 0.5', () => {
    const res = buildLeaveDays('2026-06-22', '2026-06-23', {
      holidays: [],
      perDay: { '2026-06-23': 'AM' },
    });
    expect(res.days).toEqual([
      { date: '2026-06-22', portion: 'FULL', portionDays: 1 },
      { date: '2026-06-23', portion: 'AM', portionDays: 0.5 },
    ]);
    expect(res.totalDays).toBe(1.5);
  });

  it('honours a non-FULL defaultPortion for every day', () => {
    const res = buildLeaveDays('2026-06-22', '2026-06-23', {
      holidays: [],
      defaultPortion: 'PM',
    });
    expect(res.days.every((d) => d.portion === 'PM' && d.portionDays === 0.5)).toBe(true);
    expect(res.totalDays).toBe(1);
  });

  it('returns no days and totalDays 0 for an all-weekend range', () => {
    // 2026-06-27 Sat .. 2026-06-28 Sun.
    const res = buildLeaveDays('2026-06-27', '2026-06-28', { holidays: [] });
    expect(res.days).toEqual([]);
    expect(res.totalDays).toBe(0);
  });

  it('parses ISO datetime strings date-only (no UTC drift)', () => {
    const res = buildLeaveDays('2026-06-22T00:00:00.000Z', '2026-06-22T23:59:59.000Z', {
      holidays: ['2026-06-22T00:00:00.000Z'],
    });
    // the single weekday is also the holiday -> excluded
    expect(res.days).toEqual([]);
    expect(res.totalDays).toBe(0);
  });
});
