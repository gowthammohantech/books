// validators/timeTrackingValidator.ts
// Time Tracking — Phase 1 (Task 4): project member + project settings payload validation.

import { body, ValidationChain } from 'express-validator';

/** POST /projects/:projectId/members — body { employeeUserId, role, billingRate? } */
export const createProjectMemberValidator: ValidationChain[] = [
  body('employeeUserId')
    .notEmpty()
    .withMessage('employeeUserId is required')
    .isString()
    .withMessage('employeeUserId must be a string'),

  body('role')
    .optional()
    .isIn(['MEMBER', 'MANAGER'])
    .withMessage('role must be MEMBER or MANAGER'),

  body('billingRate')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('billingRate must be a non-negative number'),
];

/** PUT /projects/:projectId/members/:memberId — role/rate/isActive */
export const updateProjectMemberValidator: ValidationChain[] = [
  body('role')
    .optional()
    .isIn(['MEMBER', 'MANAGER'])
    .withMessage('role must be MEMBER or MANAGER'),

  body('billingRate')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('billingRate must be a non-negative number'),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
];

/** PUT /projects/:projectId/settings — { billingRate?, startDate?, endDate?, contactId? } */
export const updateProjectSettingsValidator: ValidationChain[] = [
  body('billingRate')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('billingRate must be a non-negative number'),

  body('startDate')
    .optional({ nullable: true })
    .isISO8601()
    .withMessage('startDate must be a valid date'),

  body('endDate')
    .optional({ nullable: true })
    .isISO8601()
    .withMessage('endDate must be a valid date'),

  body('contactId')
    .optional({ nullable: true })
    .isUUID()
    .withMessage('contactId must be a valid UUID'),
];

/** PUT /timesheets/:id/entries — { entries: [{projectId,date,hours,billable?,note?}] } */
export const replaceEntriesValidator: ValidationChain[] = [
  body('entries')
    .isArray()
    .withMessage('entries must be an array'),

  body('entries.*.projectId')
    .notEmpty()
    .withMessage('each entry requires a projectId')
    .isString()
    .withMessage('projectId must be a string'),

  body('entries.*.date')
    .notEmpty()
    .withMessage('each entry requires a date')
    .isISO8601()
    .withMessage('date must be a valid date'),

  // Empty/blank hours cells (the user cleared or never filled them) are NOT an
  // error — they're simply dropped by the handler (the PUT is a full-week
  // replace). Only validate the range when a value is actually present.
  body('entries.*.hours')
    .optional({ checkFalsy: true })
    .isFloat({ min: 0, max: 24 })
    .withMessage('hours must be a number between 0 and 24'),

  body('entries.*.billable')
    .optional()
    .isBoolean()
    .withMessage('billable must be a boolean'),

  body('entries.*.note')
    .optional({ nullable: true })
    .isString()
    .withMessage('note must be a string'),
];

/** POST /timesheets/join-project — { projectId } (self-join the acting user) */
export const joinProjectValidator: ValidationChain[] = [
  body('projectId')
    .notEmpty()
    .withMessage('projectId is required')
    .isString()
    .withMessage('projectId must be a string'),
];

/** POST /timesheets/:id/reject — { rejectionNote? } */
export const rejectTimesheetValidator: ValidationChain[] = [
  body('rejectionNote')
    .optional({ nullable: true })
    .isString()
    .withMessage('rejectionNote must be a string'),
];

// =============================================================================
// Phase C — Holidays
// =============================================================================

/** POST /holidays — { name, date, recurringYearly? } */
export const createHolidayValidator: ValidationChain[] = [
  body('name').notEmpty().withMessage('name is required').isString().withMessage('name must be a string'),
  body('date').notEmpty().withMessage('date is required').isISO8601().withMessage('date must be a valid date'),
  body('recurringYearly').optional().isBoolean().withMessage('recurringYearly must be a boolean'),
];

/** PUT /holidays/:id — { name?, date?, recurringYearly? } */
export const updateHolidayValidator: ValidationChain[] = [
  body('name').optional().isString().withMessage('name must be a string'),
  body('date').optional().isISO8601().withMessage('date must be a valid date'),
  body('recurringYearly').optional().isBoolean().withMessage('recurringYearly must be a boolean'),
];

// =============================================================================
// Phase C — Leave types
// =============================================================================

/** POST /leave-types — { name, paid?, defaultAllocationDays?, isActive? } */
export const createLeaveTypeValidator: ValidationChain[] = [
  body('name').notEmpty().withMessage('name is required').isString().withMessage('name must be a string'),
  body('paid').optional().isBoolean().withMessage('paid must be a boolean'),
  body('defaultAllocationDays')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('defaultAllocationDays must be a non-negative number'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
];

/** PUT /leave-types/:id — { name?, paid?, defaultAllocationDays?, isActive? } */
export const updateLeaveTypeValidator: ValidationChain[] = [
  body('name').optional().isString().withMessage('name must be a string'),
  body('paid').optional().isBoolean().withMessage('paid must be a boolean'),
  body('defaultAllocationDays')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('defaultAllocationDays must be a non-negative number'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
];

// =============================================================================
// Phase C — Leave allocations
// =============================================================================

/** POST/PUT /leave-allocations — { employeeUserId, leaveTypeId, year, allocatedDays, carriedOverDays? } */
export const upsertLeaveAllocationValidator: ValidationChain[] = [
  body('employeeUserId')
    .notEmpty()
    .withMessage('employeeUserId is required')
    .isString()
    .withMessage('employeeUserId must be a string'),
  body('leaveTypeId')
    .notEmpty()
    .withMessage('leaveTypeId is required')
    .isString()
    .withMessage('leaveTypeId must be a string'),
  body('year')
    .notEmpty()
    .withMessage('year is required')
    .isInt({ min: 1970, max: 9999 })
    .withMessage('year must be a valid year'),
  body('allocatedDays')
    .notEmpty()
    .withMessage('allocatedDays is required')
    .isFloat({ min: 0 })
    .withMessage('allocatedDays must be a non-negative number'),
  body('carriedOverDays')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('carriedOverDays must be a non-negative number'),
];

// =============================================================================
// Phase C — Leave requests
// =============================================================================

/** POST /leave-requests — { leaveTypeId, startDate, endDate, perDay?, defaultPortion?, reason? } */
export const createLeaveRequestValidator: ValidationChain[] = [
  body('leaveTypeId')
    .notEmpty()
    .withMessage('leaveTypeId is required')
    .isString()
    .withMessage('leaveTypeId must be a string'),
  body('startDate')
    .notEmpty()
    .withMessage('startDate is required')
    .isISO8601()
    .withMessage('startDate must be a valid date'),
  body('endDate')
    .notEmpty()
    .withMessage('endDate is required')
    .isISO8601()
    .withMessage('endDate must be a valid date'),
  body('defaultPortion')
    .optional()
    .isIn(['FULL', 'AM', 'PM'])
    .withMessage('defaultPortion must be FULL, AM or PM'),
  body('perDay').optional().isObject().withMessage('perDay must be an object'),
  body('reason').optional({ nullable: true }).isString().withMessage('reason must be a string'),
];

/** POST /leave-requests/:id/reject — { rejectionNote? } */
export const rejectLeaveRequestValidator: ValidationChain[] = [
  body('rejectionNote')
    .optional({ nullable: true })
    .isString()
    .withMessage('rejectionNote must be a string'),
];

// CommonJS interop for legacy JS route files.
module.exports = {
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
};
module.exports.joinProjectValidator = joinProjectValidator;
module.exports.createProjectMemberValidator = createProjectMemberValidator;
module.exports.updateProjectMemberValidator = updateProjectMemberValidator;
module.exports.updateProjectSettingsValidator = updateProjectSettingsValidator;
module.exports.replaceEntriesValidator = replaceEntriesValidator;
module.exports.rejectTimesheetValidator = rejectTimesheetValidator;
module.exports.createHolidayValidator = createHolidayValidator;
module.exports.updateHolidayValidator = updateHolidayValidator;
module.exports.createLeaveTypeValidator = createLeaveTypeValidator;
module.exports.updateLeaveTypeValidator = updateLeaveTypeValidator;
module.exports.upsertLeaveAllocationValidator = upsertLeaveAllocationValidator;
module.exports.createLeaveRequestValidator = createLeaveRequestValidator;
module.exports.rejectLeaveRequestValidator = rejectLeaveRequestValidator;
