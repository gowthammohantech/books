import type { Request, Response, NextFunction } from 'express';
import { body, param, validationResult, ValidationChain } from 'express-validator';

import { prisma } from '../lib/prisma';

// Helper function to handle validation errors
function handleValidationErrors(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().reduce<Record<string, string>>((acc, error) => {
        const key = (error as unknown as { path?: string }).path ?? '';
        acc[key] = error.msg as string;
        return acc;
      }, {}),
    });
    return;
  }
  next();
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Create reminder validator
export const createReminderValidator: Array<
  ValidationChain | ((req: Request, res: Response, next: NextFunction) => void)
> = [
  // Basic reminder information
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Reminder name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Reminder name must be between 2 and 100 characters'),

  body('type')
    .notEmpty()
    .withMessage('Reminder type is required')
    .isIn(['automatic', 'manual', 'automatic_Purchase', 'manual_purchase'])
    .withMessage(
      'Reminder type must be either automatic or manual or automatic_Purchase or manual_purchase',
    ),

  body('isEnabled')
    .optional()
    .isBoolean()
    .withMessage('isEnabled must be a boolean value'),

  // Email configuration validation
  body('emailConfig.remindTo').optional(),

  body('emailConfig.fromEmail')
    .optional()
    .isEmail()
    .withMessage('From email must be a valid email address'),

  body('emailConfig.cc')
    .optional()
    .isArray()
    .withMessage('CC must be an array')
    .custom((cc: unknown) => {
      if (Array.isArray(cc) && cc.length > 0) {
        return (cc as string[]).every((email) => EMAIL_REGEX.test(email));
      }
      return true;
    })
    .withMessage('All CC emails must be valid email addresses'),

  body('emailConfig.bcc')
    .optional()
    .isArray()
    .withMessage('BCC must be an array')
    .custom((bcc: unknown) => {
      if (Array.isArray(bcc) && bcc.length > 0) {
        return (bcc as string[]).every((email) => EMAIL_REGEX.test(email));
      }
      return true;
    })
    .withMessage('All BCC emails must be valid email addresses'),

  body('emailConfig.subject')
    .notEmpty()
    .withMessage('Email subject is required'),

  body('emailConfig.body')
    .notEmpty()
    .withMessage('Email body is required')
    .isLength({ min: 1 })
    .withMessage('Email body cannot be empty'),

  // Automatic reminder specific validation
  body('remindDays')
    .if(body('type').isIn(['automatic', 'automatic_Purchase']))
    .notEmpty()
    .withMessage('Remind days is required for automatic reminders')
    .isInt({ min: 0 })
    .withMessage('Remind days must be a non-negative integer'),

  body('remindTiming')
    .if(body('type').isIn(['automatic', 'automatic_Purchase']))
    .notEmpty()
    .withMessage('Remind timing is required for automatic reminders')
    .isIn(['before', 'after', 'duedate'])
    .withMessage('Remind timing must be either before or after'),

  // Manual reminder specific validation
  body('targetInvoice')
    .optional()
    .isString()
    .withMessage('Target invoice must be a valid string')
    .custom(async (value: string) => {
      if (!value) return true;
      const invoice = await prisma.invoice.findUnique({ where: { id: value } });
      if (!invoice) throw new Error('Target invoice not found');
      return true;
    }),

  body('targetCustomer')
    .optional()
    .isString()
    .withMessage('Target customer must be a valid string')
    .custom(async (value: string) => {
      if (!value) return true;
      const customer = await prisma.customer.findUnique({ where: { id: value } });
      if (!customer) throw new Error('Target customer not found');
      return true;
    }),

  body('manualReminderData.scheduledDate')
    .optional()
    .isISO8601()
    .withMessage('Scheduled date must be a valid ISO 8601 date')
    .custom((value: string) => {
      if (value) {
        const scheduledDate = new Date(value);
        const now = new Date();
        if (scheduledDate <= now) {
          throw new Error('Scheduled date must be in the future');
        }
      }
      return true;
    }),

  body('manualReminderData.customSubject')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Custom subject cannot exceed 200 characters'),

  body('manualReminderData.customBody')
    .optional()
    .isLength({ min: 1 })
    .withMessage('Custom body cannot be empty if provided'),

  handleValidationErrors,
];

// Update reminder validator
export const updateReminderValidator: Array<
  ValidationChain | ((req: Request, res: Response, next: NextFunction) => void)
> = [
  param('id').notEmpty().withMessage('Reminder ID is required'),

  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Reminder name must be between 2 and 100 characters'),

  body('type')
    .optional()
    .isIn(['automatic', 'manual', 'automatic_Purchase', 'manual_purchase'])
    .withMessage(
      'Reminder type must be either automatic or manual or automatic_Purchase or manual_purchase',
    ),

  body('isEnabled')
    .optional()
    .isBoolean()
    .withMessage('isEnabled must be a boolean value'),

  // Email configuration validation
  body('emailConfig.remindTo').optional(),

  body('emailConfig.fromEmail')
    .optional()
    .isEmail()
    .withMessage('From email must be a valid email address'),

  body('emailConfig.cc')
    .optional()
    .isArray()
    .withMessage('CC must be an array')
    .custom((cc: unknown) => {
      if (Array.isArray(cc) && cc.length > 0) {
        return (cc as string[]).every((email) => EMAIL_REGEX.test(email));
      }
      return true;
    })
    .withMessage('All CC emails must be valid email addresses'),

  body('emailConfig.bcc')
    .optional()
    .isArray()
    .withMessage('BCC must be an array')
    .custom((bcc: unknown) => {
      if (Array.isArray(bcc) && bcc.length > 0) {
        return (bcc as string[]).every((email) => EMAIL_REGEX.test(email));
      }
      return true;
    })
    .withMessage('All BCC emails must be valid email addresses'),

  body('emailConfig.subject').optional(),

  body('emailConfig.body')
    .optional()
    .isLength({ min: 1 })
    .withMessage('Email body cannot be empty'),

  // Automatic reminder specific validation
  body('remindDays')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Remind days must be a non-negative integer'),

  body('remindTiming')
    .optional()
    .isIn(['before', 'after', 'duedate'])
    .withMessage('Remind timing must be either before or after'),

  // Manual reminder specific validation
  body('targetInvoice')
    .optional()
    .isString()
    .withMessage('Target invoice must be a valid string')
    .custom(async (value: string) => {
      if (!value) return true;
      const invoice = await prisma.invoice.findUnique({ where: { id: value } });
      if (!invoice) throw new Error('Target invoice not found');
      return true;
    }),

  body('targetCustomer')
    .optional()
    .isString()
    .withMessage('Target customer must be a valid string')
    .custom(async (value: string) => {
      if (!value) return true;
      const customer = await prisma.customer.findUnique({ where: { id: value } });
      if (!customer) throw new Error('Target customer not found');
      return true;
    }),

  body('manualReminderData.scheduledDate')
    .optional()
    .isISO8601()
    .withMessage('Scheduled date must be a valid ISO 8601 date')
    .custom((value: string) => {
      if (value) {
        const scheduledDate = new Date(value);
        const now = new Date();
        if (scheduledDate <= now) {
          throw new Error('Scheduled date must be in the future');
        }
      }
      return true;
    }),

  body('manualReminderData.customSubject')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Custom subject cannot exceed 200 characters'),

  body('manualReminderData.customBody')
    .optional()
    .isLength({ min: 1 })
    .withMessage('Custom body cannot be empty if provided'),

  handleValidationErrors,
];

// Toggle reminder status validator
export const toggleReminderStatusValidator: Array<
  ValidationChain | ((req: Request, res: Response, next: NextFunction) => void)
> = [
  param('id').notEmpty().withMessage('Reminder ID is required'),

  body('isEnabled')
    .notEmpty()
    .withMessage('isEnabled is required')
    .isBoolean()
    .withMessage('isEnabled must be a boolean value'),

  handleValidationErrors,
];

// Send manual reminder validator
export const sendManualReminderValidator: Array<
  ValidationChain | ((req: Request, res: Response, next: NextFunction) => void)
> = [
  param('id').notEmpty().withMessage('Reminder ID is required'),

  handleValidationErrors,
];

// Get reminders by type validator
export const getRemindersByTypeValidator: Array<
  ValidationChain | ((req: Request, res: Response, next: NextFunction) => void)
> = [
  param('type')
    .isIn(['automatic', 'manual', 'automatic_Purchase', 'manual_purchase'])
    .withMessage(
      'Reminder type must be either automatic or manual or automatic_Purchase or manual_purchase',
    ),

  handleValidationErrors,
];

// Get reminder by ID validator
export const getReminderByIdValidator: Array<
  ValidationChain | ((req: Request, res: Response, next: NextFunction) => void)
> = [
  param('id').notEmpty().withMessage('Reminder ID is required'),

  handleValidationErrors,
];

// Delete reminder validator
export const deleteReminderValidator: Array<
  ValidationChain | ((req: Request, res: Response, next: NextFunction) => void)
> = [
  param('id').notEmpty().withMessage('Reminder ID is required'),

  handleValidationErrors,
];

// CommonJS interop for legacy JS routes
module.exports = {
  createReminderValidator,
  updateReminderValidator,
  toggleReminderStatusValidator,
  sendManualReminderValidator,
  getRemindersByTypeValidator,
  getReminderByIdValidator,
  deleteReminderValidator,
};
module.exports.createReminderValidator = createReminderValidator;
module.exports.updateReminderValidator = updateReminderValidator;
module.exports.toggleReminderStatusValidator = toggleReminderStatusValidator;
module.exports.sendManualReminderValidator = sendManualReminderValidator;
module.exports.getRemindersByTypeValidator = getRemindersByTypeValidator;
module.exports.getReminderByIdValidator = getReminderByIdValidator;
module.exports.deleteReminderValidator = deleteReminderValidator;
