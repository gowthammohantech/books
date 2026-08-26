/**
 * lib/timeTracking/balance.ts
 *
 * Pure leave-balance aggregation. No prisma, no DB.
 *
 * remaining = allocated + carriedOver − used, where `used` is the sum of
 * `portionDays` over APPROVED leave days of that leave type for the given year.
 */

export interface LeaveAllocationInput {
  leaveTypeId: string;
  allocatedDays: number;
  carriedOverDays: number;
}

export interface ApprovedDayRow {
  leaveTypeId: string;
  portionDays: number;
  year: number;
}

export interface LeaveBalance {
  leaveTypeId: string;
  allocated: number;
  carriedOver: number;
  used: number;
  remaining: number;
}

/**
 * Compute one balance row per allocation. Approved rows are summed per leave
 * type but only when `row.year === year`; rows for a type with no allocation
 * are ignored.
 */
export function computeLeaveBalances(
  allocations: LeaveAllocationInput[],
  approvedDays: ApprovedDayRow[],
  year: number,
): LeaveBalance[] {
  const usedByType = new Map<string, number>();
  for (const row of approvedDays) {
    if (row.year !== year) continue;
    usedByType.set(row.leaveTypeId, (usedByType.get(row.leaveTypeId) ?? 0) + row.portionDays);
  }

  return allocations.map((a) => {
    const used = usedByType.get(a.leaveTypeId) ?? 0;
    return {
      leaveTypeId: a.leaveTypeId,
      allocated: a.allocatedDays,
      carriedOver: a.carriedOverDays,
      used,
      remaining: a.allocatedDays + a.carriedOverDays - used,
    };
  });
}
