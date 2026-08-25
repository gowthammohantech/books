import type { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';

import { prisma } from '../../../lib/prisma';

// Validation middleware
export const createSupplierValidator = [
  body('supplier_name')
    .trim()
    .notEmpty()
    .withMessage('Supplier name is required')
    .isLength({ min: 2 })
    .withMessage('Supplier name must be at least 2 characters')
    .isLength({ max: 50 })
    .withMessage('Supplier name cannot exceed 50 characters'),

  body('supplier_email')
    .trim()
    .notEmpty()
    .withMessage('Supplier email is required')
    .isEmail()
    .withMessage('Invalid email address')
    .custom(async (value: string) => {
      const existing = await prisma.supplier.findFirst({
        where: { supplier_email: value, isDeleted: false },
      });
      if (existing) {
        throw new Error('Supplier email already exists');
      }
      return true;
    }),

  body('supplier_phone')
    .trim()
    .notEmpty()
    .withMessage('Supplier phone is required')
    .withMessage('Invalid phone number'),

  body('balance')
    .trim()
    .optional()
    .isNumeric()
    .withMessage('Balance must be a valid number')
    .custom((value: unknown, { req }) => {
      if (value == 0) {
        (req as Request).body.balance_type = null;
      }
      return true;
    }),

  body('balance_type')
    .trim()
    .optional()
    .custom((value: unknown, { req }) => {
      const balance = (req as Request).body.balance;
      if (balance && balance != 0) {
        if (!['credit', 'debit'].includes(value as string)) {
          throw new Error("Balance type must be either 'credit' or 'debit'");
        }
      }
      return true;
    }),

  body('password')
    .optional()
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),

  (req: Request, res: Response, next: NextFunction): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const formattedErrors: Record<string, string> = {};
      errors.array().forEach((err) => {
        // express-validator v7 error shape: { path, msg, ... }
        const e = err as { path?: string; param?: string; msg: string };
        const key = e.path ?? e.param ?? 'unknown';
        if (!formattedErrors[key]) {
          formattedErrors[key] = e.msg;
        }
      });
      res.status(422).json({
        message: 'Validation failed',
        errors: formattedErrors,
      });
      return;
    }
    next();
  },
];

// CommonJS interop for legacy JS routes that still use require().
module.exports = {
  createSupplierValidator,
};
module.exports.createSupplierValidator = createSupplierValidator;
