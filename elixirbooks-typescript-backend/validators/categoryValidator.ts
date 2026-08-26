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
  body('category_name')
    .notEmpty()
    .withMessage('Category name is required')
    .isLength({ min: 3 })
    .withMessage('Category name must be at least 3 characters')
    .custom(async (value: string) => {
      const existing = await prisma.category.findFirst({
        where: { category_name: { equals: value, mode: 'insensitive' } },
      });
      if (existing) {
        throw new Error('Category name already exists');
      }
      return true;
    }),

  body('slug')
    .notEmpty()
    .withMessage('Category slug is required')
    .isLength({ min: 3 })
    .withMessage('Category slug must be at least 3 characters')
    .custom(async (value: string) => {
      const existing = await prisma.category.findFirst({
        where: { slug: { equals: value, mode: 'insensitive' } },
      });
      if (existing) {
        throw new Error('Category slug already exists');
      }
      return true;
    }),

  // Category image is optional.
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
  body('category_image')
    .optional()
    .custom((value: unknown, { req }) => {
      if (!req.file && value === '') {
        throw new Error('Category image cannot be empty if provided');
      }
      return true;
    }),

  body('category_name')
    .optional()
    .isLength({ min: 3 })
    .withMessage('Category name must be at least 3 characters')
    .custom(async (value: string, { req }) => {
      const id = (req.params as { id?: string })?.id;
      const existing = await prisma.category.findFirst({
        where: {
          category_name: { equals: value, mode: 'insensitive' },
          NOT: id ? { id } : undefined,
        },
      });
      if (existing) {
        throw new Error('Category name already exists');
      }
      return true;
    }),

  body('slug')
    .optional()
    .isLength({ min: 3 })
    .withMessage('Category slug must be at least 3 characters')
    .custom(async (value: string, { req }) => {
      const id = (req.params as { id?: string })?.id;
      const existing = await prisma.category.findFirst({
        where: {
          slug: { equals: value, mode: 'insensitive' },
          NOT: id ? { id } : undefined,
        },
      });
      if (existing) {
        throw new Error('Category slug already exists');
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

export const createCategoryValidator: (ValidationChain | RequestHandler)[] = [
  ...createChains,
  createFinaliser,
];

export const updateCategoryValidator: (ValidationChain | RequestHandler)[] = [
  ...updateChains,
  updateFinaliser,
];

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createCategoryValidator,
  updateCategoryValidator,
};
module.exports.createCategoryValidator = createCategoryValidator;
module.exports.updateCategoryValidator = updateCategoryValidator;
