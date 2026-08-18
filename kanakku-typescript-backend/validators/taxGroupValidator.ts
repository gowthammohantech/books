import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

import { prisma } from '../lib/prisma';

const handleValidationErrors: RequestHandler = (
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
      formattedErrors[path] = e.msg;
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
  body('tax_name')
    .notEmpty()
    .withMessage('Tax name is required')
    .isLength({ min: 2, max: 30 })
    .withMessage('Tax name must be between 2 and 30 characters')
    .custom(async (value: string) => {
      const existing = await prisma.taxGroup.findFirst({
        where: { tax_name: { equals: value, mode: 'insensitive' } },
      });
      if (existing) {
        throw new Error('Tax name already exists');
      }
      return true;
    }),

  body('tax_rate_ids')
    .isArray({ min: 1 })
    .withMessage('At least one tax rate must be selected'),
];

const updateChains: ValidationChain[] = [
  body('tax_name')
    .optional()
    .isLength({ min: 2, max: 30 })
    .withMessage('Tax name must be between 2 and 30 characters')
    .custom(async (value: string | undefined, { req }) => {
      if (!value) return true;
      const id = (req.params as { id?: string })?.id;
      const existing = await prisma.taxGroup.findFirst({
        where: {
          tax_name: { equals: value, mode: 'insensitive' },
          NOT: id ? { id } : undefined,
        },
      });
      if (existing) {
        throw new Error('Tax name already exists');
      }
      return true;
    }),

  body('tax_rate_ids').optional().isArray().withMessage('Tax rate IDs must be an array'),
];

export const createTaxGroupValidator: (ValidationChain | RequestHandler)[] = [
  ...createChains,
  handleValidationErrors,
];

export const updateTaxGroupValidator: (ValidationChain | RequestHandler)[] = [
  ...updateChains,
  handleValidationErrors,
];

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createTaxGroupValidator,
  updateTaxGroupValidator,
};
module.exports.createTaxGroupValidator = createTaxGroupValidator;
module.exports.updateTaxGroupValidator = updateTaxGroupValidator;
