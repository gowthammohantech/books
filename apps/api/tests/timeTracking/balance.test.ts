/**
 * tests/timeTracking/balance.test.ts
 *
 * Unit tests for computeLeaveBalances — pure aggregation (no prisma, no DB).
 * remaining = allocated + carriedOver − used; used = Σ portionDays of approved
 * rows of that leaveType for the given year.
 */

import { describe, it, expect } from 'vitest';
import { computeLeaveBalances } from '../../lib/timeTracking/balance';

describe('computeLeaveBalances', () => {
  it('computes remaining as allocated + carriedOver − used', () => {
    const rows = computeLeaveBalances(
      [{ leaveTypeId: 'annual', allocatedDays: 20, carriedOverDays: 2 }],
      [
        // 4 full + 2 half = 5 days used
        { leaveTypeId: 'annual', portionDays: 1, year: 2026 },
        { leaveTypeId: 'annual', portionDays: 1, year: 2026 },
        { leaveTypeId: 'annual', portionDays: 1, year: 2026 },
        { leaveTypeId: 'annual', portionDays: 1, year: 2026 },
        { leaveTypeId: 'annual', portionDays: 0.5, year: 2026 },
        { leaveTypeId: 'annual', portionDays: 0.5, year: 2026 },
      ],
      2026,
    );
    expect(rows).toEqual([
      { leaveTypeId: 'annual', allocated: 20, carriedOver: 2, used: 5, remaining: 17 },
    ]);
  });

  it('produces one row per allocation across multiple leave types', () => {
    const rows = computeLeaveBalances(
      [
        { leaveTypeId: 'annual', allocatedDays: 20, carriedOverDays: 0 },
        { leaveTypeId: 'sick', allocatedDays: 10, carriedOverDays: 0 },
      ],
      [
        { leaveTypeId: 'annual', portionDays: 2, year: 2026 },
        { leaveTypeId: 'sick', portionDays: 1.5, year: 2026 },
      ],
      2026,
    );
    expect(rows).toEqual([
      { leaveTypeId: 'annual', allocated: 20, carriedOver: 0, used: 2, remaining: 18 },
      { leaveTypeId: 'sick', allocated: 10, carriedOver: 0, used: 1.5, remaining: 8.5 },
    ]);
  });

  it('ignores approved rows from a different year', () => {
    const rows = computeLeaveBalances(
      [{ leaveTypeId: 'annual', allocatedDays: 20, carriedOverDays: 0 }],
      [
        { leaveTypeId: 'annual', portionDays: 3, year: 2025 },
        { leaveTypeId: 'annual', portionDays: 4, year: 2026 },
      ],
      2026,
    );
    expect(rows).toEqual([
      { leaveTypeId: 'annual', allocated: 20, carriedOver: 0, used: 4, remaining: 16 },
    ]);
  });

  it('ignores approved rows for a leave type that has no allocation', () => {
    const rows = computeLeaveBalances(
      [{ leaveTypeId: 'annual', allocatedDays: 20, carriedOverDays: 0 }],
      [{ leaveTypeId: 'sick', portionDays: 5, year: 2026 }],
      2026,
    );
    expect(rows).toEqual([
      { leaveTypeId: 'annual', allocated: 20, carriedOver: 0, used: 0, remaining: 20 },
    ]);
  });
});
