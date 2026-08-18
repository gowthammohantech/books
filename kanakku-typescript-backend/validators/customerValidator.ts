import fs from 'fs';

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

import { PHONE_REGEX, PHONE_ERROR } from '../utils/validation';

function isPlainObject(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  return true;
}

function objectShapeValidator(message: string): RequestHandler {
  // Wrapper that returns a custom validator chain element compatible signature.
  return (() => message) as unknown as RequestHandler;
}

const chains: ValidationChain[] = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Customer name is required')
    .isLength({ min: 2 })
    .withMessage('Customer name must be at least 2 characters')
    .isLength({ max: 100 })
    .withMessage('Customer name cannot exceed 100 characters'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Please provide a valid email address'),

  body('phone')
    .optional()
    .trim()
    .matches(PHONE_REGEX)
    .withMessage(PHONE_ERROR),

  body('status')
    .optional()
    .isIn(['Active', 'Inactive'])
    .withMessage('Status must be either Active or Inactive'),

  body('billingAddress')
    .optional()
    .custom((value: unknown) => {
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return isPlainObject(parsed);
      } catch {
        return false;
      }
    })
    .withMessage('Billing address must be a valid object'),

  body('shippingAddress')
    .optional()
    .custom((value: unknown) => {
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return isPlainObject(parsed);
      } catch {
        return false;
      }
    })
    .withMessage('Shipping address must be a valid object'),

  body('bankDetails')
    .optional()
    .custom((value: unknown) => {
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return isPlainObject(parsed);
      } catch {
        return false;
      }
    })
    .withMessage('Bank details must be a valid object'),

  body('profile_image_removed')
    .optional()
    .isBoolean()
    .withMessage('profile_image_removed must be a boolean'),
];

const finaliser: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  // Image validation
  if (req.file) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
      res.status(422).json({
        success: false,
        message: 'Validation failed',
        errors: { image: 'Only JPEG, PNG, and GIF images are allowed' },
      });
      return;
    }

    if (req.file.size > 2 * 1024 * 1024) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
      res.status(422).json({
        success: false,
        message: 'Validation failed',
        errors: { image: 'Image size must be less than 2MB' },
      });
      return;
    }
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
    }

    const formattedErrors: Record<string, string> = {};
    for (const err of errors.array()) {
      const field = (err as unknown as { path: string }).path;
      if (!formattedErrors[field]) {
        formattedErrors[field] = err.msg;
      }
    }

    res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: formattedErrors,
    });
    return;
  }

  // Parse JSON strings for addresses if needed
  for (const field of ['billingAddress', 'shippingAddress', 'bankDetails']) {
    if (req.body[field] && typeof req.body[field] === 'string') {
      try {
        req.body[field] = JSON.parse(req.body[field]);
      } catch {
        /* leave as-is; the custom validator above already flagged it */
      }
    }
  }

  next();
};

export const createCustomerValidator: (ValidationChain | RequestHandler)[] = [
  ...chains,
  finaliser,
];

// Suppress unused-warning helper from the TS surface
void objectShapeValidator;

// CommonJS interop for legacy JS routes
module.exports = { createCustomerValidator };
module.exports.createCustomerValidator = createCustomerValidator;
