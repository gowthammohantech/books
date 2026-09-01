import { describe, expect, it } from 'vitest';

import {
  AP_UNPAID_STATUSES,
  AP_UNPAID_STATUSES_CSV,
  AR_UNPAID_STATUSES,
  AR_UNPAID_STATUSES_CSV,
} from './statusFilters';

describe('unpaid status filters', () => {
  // These CSVs go straight into a `status` query param. If they change, every
  // aging / collections / balance-sheet drill-down silently filters differently.
  it('produce byte-identical CSVs to the literals they replaced', () => {
    expect(AR_UNPAID_STATUSES_CSV).toBe('UNPAID,PARTIALLY_PAID,OVERDUE,SENT');
    expect(AP_UNPAID_STATUSES_CSV).toBe('new,pending,partially_paid');
  });

  it('exclude the settled and non-owing statuses', () => {
    expect(AR_UNPAID_STATUSES).not.toContain('PAID');
    expect(AR_UNPAID_STATUSES).not.toContain('DRAFT');
    expect(AR_UNPAID_STATUSES).not.toContain('CANCELLED');
    expect(AP_UNPAID_STATUSES).not.toContain('paid');
    expect(AP_UNPAID_STATUSES).not.toContain('cancelled');
  });
});
