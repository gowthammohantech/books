// routes/timeTrackingRoutes.ts
// Time Tracking — Phase 1 (Task 4): project members + project billing settings.
// Mounted under /api/admin via routes/adminRoutes.js.

import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/requirePermission';
import { handleValidationResult } from '../middleware/handleValidationResult';
import {
  listProjectMembers,
  addProjectMember,
  updateProjectMember,
  deleteProjectMember,
  updateProjectSettings,
} from '../controllers/timeTracking/projectMemberController';
import {
  getOrCreateWeek,
  replaceEntries,
  submitTimesheet,
  approveTimesheet,
  rejectTimesheet,
  listTimesheets,
  listAvailableProjects,
  joinProject,
  leaveProject,
} from '../controllers/timeTracking/timesheetController';
import {
  createProjectMemberValidator,
  updateProjectMemberValidator,
  updateProjectSettingsValidator,
  replaceEntriesValidator,
  joinProjectValidator,
  rejectTimesheetValidator,
  createHolidayValidator,
  updateHolidayValidator,
  createLeaveTypeValidator,
  updateLeaveTypeValidator,
  upsertLeaveAllocationValidator,
  createLeaveRequestValidator,
  rejectLeaveRequestValidator,
} from '../validators/timeTrackingValidator';
import { getTimeSummaryReport } from '../controllers/timeTracking/timeReportController';
import { getLeaveSummaryReport } from '../controllers/timeTracking/leaveReportController';
import {
  listHolidays,
  createHoliday,
  updateHoliday,
  deleteHoliday,
} from '../controllers/timeTracking/holidayController';
import {
  listLeaveTypes,
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,
  listLeaveAllocations,
  createLeaveAllocation,
  updateLeaveAllocation,
} from '../controllers/timeTracking/leaveTypeController';
import {
  createLeaveRequest,
  listLeaveRequests,
  getLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
  getLeaveBalances,
} from '../controllers/timeTracking/leaveRequestController';

const router = Router();

// All routes require authentication.
router.use(protect);

// ---- Project members ----
router.get(
  '/projects/:projectId/members',
  requirePermission('time-tracking', 'view'),
  listProjectMembers,
);
router.post(
  '/projects/:projectId/members',
  requirePermission('time-tracking-others', 'create'),
  createProjectMemberValidator,
  handleValidationResult,
  addProjectMember,
);
router.put(
  '/projects/:projectId/members/:memberId',
  requirePermission('time-tracking-others', 'edit'),
  updateProjectMemberValidator,
  handleValidationResult,
  updateProjectMember,
);
router.delete(
  '/projects/:projectId/members/:memberId',
  requirePermission('time-tracking-others', 'delete'),
  deleteProjectMember,
);

// ---- Project settings (billing rate / dates / customer) ----
router.put(
  '/projects/:projectId/settings',
  requirePermission('time-tracking-others', 'edit'),
  updateProjectSettingsValidator,
  handleValidationResult,
  updateProjectSettings,
);

// ---- Timesheets ----
// NOTE: the literal `/timesheets/week` must precede `/timesheets/:id/...` so
// "week" is not captured as an :id. The for-self vs for-others split (and the
// admin/owner bypass) is enforced inside the controller; route-level
// requirePermission only gates the baseline ability.

// get-or-create the (employee, week) timesheet
router.get(
  '/timesheets/week',
  requirePermission('time-tracking', 'view'),
  getOrCreateWeek,
);

// self-service: tenant active projects the acting user is NOT yet a member of.
// Literal path must precede `/timesheets/:id/...` so it's not captured as :id.
router.get(
  '/timesheets/available-projects',
  requirePermission('time-tracking', 'view'),
  listAvailableProjects,
);

// self-service: the acting user joins a project as an active MEMBER.
router.post(
  '/timesheets/join-project',
  requirePermission('time-tracking', 'create'),
  joinProjectValidator,
  handleValidationResult,
  joinProject,
);

// self-service: the acting user leaves a project (removes the row from their
// timesheet + clears their unsubmitted entries; submitted history is kept).
// Literal path must precede `/timesheets/:id/...` so it's not captured as :id.
router.delete(
  '/timesheets/leave-project/:projectId',
  requirePermission('time-tracking', 'edit'),
  leaveProject,
);

// list: ?scope=mine|pending
router.get(
  '/timesheets',
  requirePermission('time-tracking', 'view'),
  listTimesheets,
);

// bulk replace the week's entries (DRAFT/REJECTED only)
router.put(
  '/timesheets/:id/entries',
  requirePermission('time-tracking', 'edit'),
  replaceEntriesValidator,
  handleValidationResult,
  replaceEntries,
);

// DRAFT/REJECTED -> SUBMITTED
router.post(
  '/timesheets/:id/submit',
  requirePermission('time-tracking', 'edit'),
  submitTimesheet,
);

// SUBMITTED -> APPROVED (others)
router.post(
  '/timesheets/:id/approve',
  requirePermission('time-tracking-others', 'edit'),
  approveTimesheet,
);

// SUBMITTED -> REJECTED (others)
router.post(
  '/timesheets/:id/reject',
  requirePermission('time-tracking-others', 'edit'),
  rejectTimesheetValidator,
  handleValidationResult,
  rejectTimesheet,
);

// ---- Time reports ----
router.get(
  '/time-reports/summary',
  requirePermission('time-tracking', 'view'),
  getTimeSummaryReport,
);

// ---- Holidays (Phase C) ----
router.get('/holidays', requirePermission('time-tracking', 'view'), listHolidays);
router.post(
  '/holidays',
  requirePermission('time-tracking-others', 'create'),
  createHolidayValidator,
  handleValidationResult,
  createHoliday,
);
router.put(
  '/holidays/:id',
  requirePermission('time-tracking-others', 'edit'),
  updateHolidayValidator,
  handleValidationResult,
  updateHoliday,
);
router.delete(
  '/holidays/:id',
  requirePermission('time-tracking-others', 'delete'),
  deleteHoliday,
);

// ---- Leave types (Phase C) ----
router.get('/leave-types', requirePermission('time-tracking', 'view'), listLeaveTypes);
router.post(
  '/leave-types',
  requirePermission('time-tracking-others', 'create'),
  createLeaveTypeValidator,
  handleValidationResult,
  createLeaveType,
);
router.put(
  '/leave-types/:id',
  requirePermission('time-tracking-others', 'edit'),
  updateLeaveTypeValidator,
  handleValidationResult,
  updateLeaveType,
);
router.delete(
  '/leave-types/:id',
  requirePermission('time-tracking-others', 'delete'),
  deleteLeaveType,
);

// ---- Leave allocations (Phase C) ----
// GET: own via time-tracking,view; others clamped inside the controller.
router.get(
  '/leave-allocations',
  requirePermission('time-tracking', 'view'),
  listLeaveAllocations,
);
router.post(
  '/leave-allocations',
  requirePermission('time-tracking-others', 'create'),
  upsertLeaveAllocationValidator,
  handleValidationResult,
  createLeaveAllocation,
);
router.put(
  '/leave-allocations/:id',
  requirePermission('time-tracking-others', 'edit'),
  upsertLeaveAllocationValidator,
  handleValidationResult,
  updateLeaveAllocation,
);

// ---- Leave requests (Phase C) ----
// Self-service create: time-tracking,create (the request is for the acting user).
router.post(
  '/leave-requests',
  requirePermission('time-tracking', 'create'),
  createLeaveRequestValidator,
  handleValidationResult,
  createLeaveRequest,
);
// list: ?scope=mine|pending (pending gated on manage-others inside the controller).
router.get(
  '/leave-requests',
  requirePermission('time-tracking', 'view'),
  listLeaveRequests,
);
router.get(
  '/leave-requests/:id',
  requirePermission('time-tracking', 'view'),
  getLeaveRequest,
);
// PENDING -> APPROVED (others; balance-checked for paid types).
router.post(
  '/leave-requests/:id/approve',
  requirePermission('time-tracking-others', 'edit'),
  approveLeaveRequest,
);
// PENDING -> REJECTED (others).
router.post(
  '/leave-requests/:id/reject',
  requirePermission('time-tracking-others', 'edit'),
  rejectLeaveRequestValidator,
  handleValidationResult,
  rejectLeaveRequest,
);
// cancel (own or manage-others; status guards inside the controller).
router.post(
  '/leave-requests/:id/cancel',
  requirePermission('time-tracking', 'edit'),
  cancelLeaveRequest,
);

// ---- Leave reports (Phase C) ----
// own via time-tracking,view; others clamped inside the controller.
router.get(
  '/leave-reports/summary',
  requirePermission('time-tracking', 'view'),
  getLeaveSummaryReport,
);

// ---- Leave balances (Phase C) ----
// own via time-tracking,view; others clamped inside the controller.
router.get(
  '/leave-balances',
  requirePermission('time-tracking', 'view'),
  getLeaveBalances,
);

export default router;
// CommonJS export so `require('./routes/timeTrackingRoutes')` under ts-node returns
// the router directly (matches dimensionRoutes.ts / authRoutes.ts). Without this,
// require() yields `{ default: router }` and `router.use(...)` throws
// "argument handler must be a function".
module.exports = router;
