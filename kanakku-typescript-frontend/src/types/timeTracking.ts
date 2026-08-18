export type TimesheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export type ProjectMemberRole = 'MEMBER' | 'MANAGER';

export interface ProjectMember {
  id: string;
  employeeUserId: string;
  employee: {
    firstName: string;
    lastName: string;
    email: string;
  };
  role: ProjectMemberRole;
  billingRate: number | null;
  isActive: boolean;
}

export interface Timesheet {
  id: string;
  employeeUserId: string;
  weekStartDate: string; // ISO date string, UTC midnight
  status: TimesheetStatus;
  submittedAt: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  rejectionNote: string | null;
}

export interface TimeEntry {
  id: string;
  projectId: string;
  date: string; // ISO date string
  hours: number;
  billable: boolean;
  note: string | null;
}

/** Shape returned by GET /timesheets/week */
export interface TimesheetWeek {
  timesheet: Timesheet;
  entries: TimeEntry[];
  projects: Array<{
    id: string;
    code: string;
    name: string;
  }>;
  holidays?: Array<{ date: string; name: string }>;
  leaveDays?: Array<{ date: string; portion: string; leaveTypeName: string }>;
}

export interface TimeReportByProject {
  projectId: string;
  projectName: string;
  hours: number;
  billableHours: number;
  amount: number;
}

export interface TimeReportByEmployee {
  employeeUserId: string;
  employeeName: string;
  hours: number;
  billableHours: number;
  amount: number;
}

// ── Leave / Holiday types ───────────────────────────────────────────────────

export interface Holiday {
  id: string;
  name: string;
  date: string; // ISO date string (UTC midnight)
  recurringYearly: boolean;
}

export interface LeaveType {
  id: string;
  name: string;
  paid: boolean;
  defaultAllocationDays: number;
  isActive: boolean;
}

export interface LeaveAllocation {
  id: string;
  employeeUserId: string;
  leaveTypeId: string;
  year: number;
  allocatedDays: number;
  carriedOverDays: number;
}

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type LeavePortion = 'FULL' | 'AM' | 'PM';

export interface LeaveRequestDay {
  date: string; // ISO date string
  portion: LeavePortion;
  portionDays: number;
}

export interface LeaveRequest {
  id: string;
  employeeUserId: string;
  employee: {
    name: string;
    email: string;
  };
  leaveType: {
    name: string;
    paid: boolean;
  };
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  totalDays: number;
  reason: string | null;
  rejectionNote: string | null;
  days?: LeaveRequestDay[];
}

export interface LeaveBalance {
  leaveTypeId: string;
  leaveTypeName: string;
  paid: boolean;
  allocated: number;
  carriedOver: number;
  used: number;
  remaining: number;
}

export interface LeaveReportSummary {
  byType: Array<{
    leaveTypeId: string;
    leaveTypeName: string;
    days: number;
  }>;
  byEmployee: Array<{
    employeeUserId: string;
    employeeName: string;
    days: number;
  }>;
  totals: {
    days: number;
  };
}

// ── Time reports ─────────────────────────────────────────────────────────────

/** Shape returned by GET /time-reports/summary */
export interface TimeReportSummary {
  byProject: TimeReportByProject[];
  byEmployee: TimeReportByEmployee[];
  totals: {
    hours: number;
    billableHours: number;
    amount: number;
  };
}
