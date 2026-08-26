import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

import { prisma } from '../lib/prisma';

const validate: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors: Record<string, string> = {};
    for (const err of errors.array()) {
      const field = (err as unknown as { path?: string }).path ?? 'general';
      // Only keep the first error for each field
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
  next();
};

export const createCurrencyValidator: (ValidationChain | RequestHandler)[] = [
  // --- Validation for name ---
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Currency name is required')
    .isLength({ min: 2 })
    .withMessage('Currency name must be at least 2 characters')
    .isLength({ max: 50 })
    .withMessage('Currency name cannot exceed 50 characters')
    .custom(async (value: string) => {
      const existing = await prisma.currency.findFirst({
        where: {
          name: { equals: value, mode: 'insensitive' },
          isDeleted: false,
        },
      });
      if (existing) {
        throw new Error('Currency name already exists');
      }
      return true;
    }),

  // --- Validation for code ---
  body('code')
    .trim()
    .notEmpty()
    .withMessage('Currency code is required')
    .isLength({ min: 3, max: 3 })
    .withMessage('Currency code must be exactly 3 characters')
    .isUppercase()
    .withMessage('Currency code must be uppercase')
    .custom(async (value: string) => {
      const existing = await prisma.currency.findFirst({
        where: {
          code: { equals: value, mode: 'insensitive' },
          isDeleted: false,
        },
      });
      if (existing) {
        throw new Error('Currency code already exists');
      }
      return true;
    }),

  // --- Validation for symbol ---
  body('symbol')
    .trim()
    .notEmpty()
    .withMessage('Currency symbol is required')
    .isLength({ max: 5 })
    .withMessage('Currency symbol cannot exceed 5 characters'),

  // --- Validation for isDefault ---
  body('isDefault')
    .optional()
    .isBoolean()
    .withMessage('isDefault must be a boolean value'),

  // --- Validation for status ---
  body('status')
    .optional()
    .isBoolean()
    .withMessage('status must be a boolean value'),

  validate,
];

// CommonJS interop for legacy JS routes
module.exports = {
  createCurrencyValidator,
};
module.exports.createCurrencyValidator = createCurrencyValidator;
