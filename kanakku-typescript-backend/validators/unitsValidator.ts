import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

import { prisma } from '../lib/prisma';

const handleValidationResult: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors: Record<string, string> = {};
    for (const err of errors.array()) {
      const e = err as { path?: string; msg: string };
      const path = e.path || 'general';
      if (!formattedErrors[path]) {
        formattedErrors[path] = e.msg;
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

const createChains: ValidationChain[] = [
  // Unit Name
  body('unit_name')
    .notEmpty()
    .withMessage('Unit name is required')
    .matches(/^[A-Za-z\s]+$/)
    .withMessage('Unit name must contain only letters and spaces')
    .isLength({ min: 2 })
    .withMessage('Unit name must be at least 2 characters')
    .custom(async (value: string) => {
      const existing = await prisma.unit.findFirst({
        where: { unit_name: { equals: value, mode: 'insensitive' } },
      });
      if (existing) {
        throw new Error('Unit name already exists');
      }
      return true;
    }),

  // Short Name
  body('short_name')
    .notEmpty()
    .withMessage('Short name is required')
    .isAlpha()
    .withMessage('Short name must contain only letters')
    .isLength({ min: 1 })
    .withMessage('Short name must be at least 1 characters'),

  // Status
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isBoolean()
    .withMessage('Status must be a boolean value'),
];

const updateChains: ValidationChain[] = [
  // Unit Name
  body('unit_name')
    .optional()
    .matches(/^[A-Za-z\s]+$/)
    .withMessage('Unit name must contain only letters and spaces')
    .isLength({ min: 2 })
    .withMessage('Unit name must be at least 2 characters')
    .custom(async (value: string | undefined, { req }) => {
      if (typeof value === 'undefined') return true;

      const unitId = (req.params as { id?: string })?.id;
      if (!unitId) throw new Error('Unit ID is required for update');

      const existing = await prisma.unit.findFirst({
        where: { unit_name: { equals: value, mode: 'insensitive' } },
      });

      if (existing && existing.id !== unitId) {
        throw new Error('Unit name already exists');
      }

      return true;
    }),

  // Short Name
  body('short_name')
    .optional()
    .isAlpha()
    .withMessage('Short name must contain only letters')
    .isLength({ min: 1 })
    .withMessage('Short name must be at least 1 characters'),

  // Status
  body('status').optional().isBoolean().withMessage('Status must be a boolean value'),
];

export const createUnitValidator: (ValidationChain | RequestHandler)[] = [
  ...createChains,
  handleValidationResult,
];

export const updateUnitValidator: (ValidationChain | RequestHandler)[] = [
  ...updateChains,
  handleValidationResult,
];

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createUnitValidator,
  updateUnitValidator,
};
module.exports.createUnitValidator = createUnitValidator;
module.exports.updateUnitValidator = updateUnitValidator;
