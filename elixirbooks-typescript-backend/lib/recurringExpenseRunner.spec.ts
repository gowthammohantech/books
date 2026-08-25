import { describe, it, expect } from 'vitest';

import { getNextRecurringDate } from './recurringInvoiceRunner';

describe('recurringExpenseRunner', () => {
  it('uses shared getNextRecurringDate for monthly cadence', () => {
    const base = new Date('2026-01-15T00:00:00Z');
    const next = getNextRecurringDate(base, { repeatEvery: 'month', customIntervalNumber: null, customIntervalType: null });
    expect(next.toISOString().slice(0, 10)).toBe('2026-02-15');
  });
});
