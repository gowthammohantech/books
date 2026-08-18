import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

import { prisma } from '../lib/prisma';

function formatValidationErrors(errorsArr: unknown[]): Record<string, string> {
  const formatted: Record<string, string> = {};
  for (const err of errorsArr) {
    const e = err as { path?: string; msg: string };
    const path = e.path || 'general';
    if (!formatted[path]) {
      formatted[path] = '';
    }
    formatted[path] = e.msg;
  }
  return formatted;
}

const createChains: ValidationChain[] = [
  body('brand_name')
    .notEmpty()
    .withMessage('Brand name is required')
    .isLength({ min: 3 })
    .withMessage('Brand name must be at least 3 characters')
    .custom(async (value: string) => {
      const existing = await prisma.brand.findFirst({
        where: { brand_name: { equals: value, mode: 'insensitive' } },
      });
      if (existing) {
        throw new Error('Brand name already exists');
      }
      return true;
    }),

  // Brand image is optional.
];

const createFinaliser: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({
      message: 'Validation failed',
      errors: formatValidationErrors(errors.array()),
    });
    return;
  }
  next();
};

const updateChains: ValidationChain[] = [
  // Brand image - optional
  body('brand_image')
    .optional()
    .custom((value: unknown, { req }) => {
      if (value === '' && !req.file) {
        throw new Error('Brand image cannot be empty if provided');
      }
      return true;
    }),

  // Brand name - optional
  body('brand_name')
    .optional()
    .isLength({ min: 3 })
    .withMessage('Brand name must be at least 3 characters')
    .custom(async (value: string, { req }) => {
      const id = (req.params as { id?: string })?.id;
      const existing = await prisma.brand.findFirst({
        where: {
          brand_name: { equals: value, mode: 'insensitive' },
          NOT: id ? { id } : undefined,
        },
      });
      if (existing) {
        throw new Error('Brand name already exists');
      }
      return true;
    }),
];

const updateFinaliser: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({
      message: 'Validation failed',
      errors: formatValidationErrors(errors.array()),
    });
    return;
  }
  next();
};

export const createBrandValidator: (ValidationChain | RequestHandler)[] = [
  ...createChains,
  createFinaliser,
];

export const updateBrandValidator: (ValidationChain | RequestHandler)[] = [
  ...updateChains,
  updateFinaliser,
];

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createBrandValidator,
  updateBrandValidator,
};
module.exports.createBrandValidator = createBrandValidator;
module.exports.updateBrandValidator = updateBrandValidator;
