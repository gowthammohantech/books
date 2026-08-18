import fs from 'fs';

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

import { PHONE_REGEX, PHONE_ERROR } from '../utils/validation';

const validateAndCheckImage: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // File checks if a profile image is uploaded
  if (req.file) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* noop */
      }
      res.status(422).json({
        message: 'Validation failed',
        errors: { profileImage: 'Only JPEG and PNG images are allowed' },
      });
      return;
    }

    if (req.file.size > 2 * 1024 * 1024) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* noop */
      }
      res.status(422).json({
        message: 'Validation failed',
        errors: { profileImage: 'Image size must be less than 2MB' },
      });
      return;
    }
  }

  // Handle field validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* noop */
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
      message: 'Validation failed',
      errors: formattedErrors,
    });
    return;
  }

  next();
};

export const createStaffValidator: (ValidationChain | RequestHandler)[] = [
  // First Name
  body('firstName')
    .trim()
    .notEmpty()
    .withMessage('First name is required')
    .isLength({ min: 2 })
    .withMessage('First name must be at least 2 characters')
    .isLength({ max: 50 })
    .withMessage('First name cannot exceed 50 characters'),

  // Last Name (optional)
  body('lastName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Last name cannot exceed 50 characters'),

  // Email
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Invalid email format'),

  // Phone (optional)
  body('phone')
    .optional()
    .trim()
    .matches(PHONE_REGEX)
    .withMessage(PHONE_ERROR),

  // Gender
  body('gender')
    .optional()
    .isIn(['male', 'female', 'other'])
    .withMessage('Gender must be male, female, or other'),

  // Date of Birth
  body('dateOfBirth')
    .optional()
    .isDate()
    .withMessage('Invalid date of birth format (YYYY-MM-DD)'),

  // Password
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),

  // Address (optional)
  body('address')
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Address cannot exceed 255 characters'),

  // Country, State, City — now UUID strings under Prisma
  body('country').optional().isString().withMessage('Invalid Country ID format'),

  body('state').optional().isString().withMessage('Invalid State ID format'),

  body('city').optional().isString().withMessage('Invalid City ID format'),

  // Postal Code (optional)
  body('postalCode')
    .optional()
    .trim()
    .isLength({ max: 20 })
    .withMessage('Postal code cannot exceed 20 characters'),

  // Role ID
  body('roleId')
    .notEmpty()
    .withMessage('Role ID is required'),

  validateAndCheckImage,
];

// CommonJS interop for legacy JS routes
module.exports = { createStaffValidator };
module.exports.createStaffValidator = createStaffValidator;
