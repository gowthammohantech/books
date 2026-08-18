import { describe, it, expect } from 'vitest';

import { getNextRecurringDate } from './recurringInvoiceRunner';

describe('getNextRecurringDate', () => {
  const base = new Date('2026-01-01T00:00:00Z');

  it('day +1', () => {
    const out = getNextRecurringDate(base, {
      repeatEvery: 'day',
      customIntervalNumber: null,
      customIntervalType: null,
    });
    expect(out.toISOString().slice(0, 10)).toBe('2026-01-02');
  });

  it('week +1', () => {
    const out = getNextRecurringDate(base, {
      repeatEvery: 'week',
      customIntervalNumber: null,
      customIntervalType: null,
    });
    expect(out.toISOString().slice(0, 10)).toBe('2026-01-08');
  });

  it('month +1', () => {
    const out = getNextRecurringDate(base, {
      repeatEvery: 'month',
      customIntervalNumber: null,
      customIntervalType: null,
    });
    expect(out.toISOString().slice(0, 10)).toBe('2026-02-01');
  });

  it('year +1', () => {
    const out = getNextRecurringDate(base, {
      repeatEvery: 'year',
      customIntervalNumber: null,
      customIntervalType: null,
    });
    expect(out.toISOString().slice(0, 10)).toBe('2027-01-01');
  });

  it('custom every 3 weeks', () => {
    const out = getNextRecurringDate(base, {
      repeatEvery: 'custom',
      customIntervalNumber: 3,
      customIntervalType: 'week',
    });
    expect(out.toISOString().slice(0, 10)).toBe('2026-01-22');
  });

  it('custom every 6 months', () => {
    const out = getNextRecurringDate(base, {
      repeatEvery: 'custom',
      customIntervalNumber: 6,
      customIntervalType: 'month',
    });
    expect(out.toISOString().slice(0, 10)).toBe('2026-07-01');
  });

  it('falls back to month when repeatEvery is null', () => {
    const out = getNextRecurringDate(base, {
      repeatEvery: null,
      customIntervalNumber: null,
      customIntervalType: null,
    });
    expect(out.toISOString().slice(0, 10)).toBe('2026-02-01');
  });
});
