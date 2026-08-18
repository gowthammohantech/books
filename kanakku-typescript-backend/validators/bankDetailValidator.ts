import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, param, validationResult, ValidationChain } from 'express-validator';

import { prisma } from '../lib/prisma';

const validate: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
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

// Create validation
export const createBankDetailValidator: (ValidationChain | RequestHandler)[] = [
  body('accountHoldername')
    .trim()
    .notEmpty()
    .withMessage('Account holder name is required')
    .isLength({ min: 2 })
    .withMessage('Account holder name must be at least 2 characters')
    .isLength({ max: 100 })
    .withMessage('Account holder name cannot exceed 100 characters'),

  body('bankName')
    .trim()
    .notEmpty()
    .withMessage('Bank name is required')
    .isLength({ min: 2 })
    .withMessage('Bank name must be at least 2 characters')
    .isLength({ max: 100 })
    .withMessage('Bank name cannot exceed 100 characters'),

  body('branchName')
    .trim()
    .notEmpty()
    .withMessage('Branch name is required')
    .isLength({ min: 2 })
    .withMessage('Branch name must be at least 2 characters')
    .isLength({ max: 100 })
    .withMessage('Branch name cannot exceed 100 characters'),

  body('accountNumber')
    .trim()
    .notEmpty()
    .withMessage('Account number is required')
    .isLength({ min: 5 })
    .withMessage('Account number must be at least 5 characters')
    .isLength({ max: 20 })
    .withMessage('Account number cannot exceed 20 characters')
    .custom(async (value: string) => {
      const existingAccount = await prisma.bankDetail.findFirst({
        where: { accountNumber: value, isDeleted: false },
      });
      if (existingAccount) {
        throw new Error('Account number already exists');
      }
      return true;
    }),

  // Bank code (IFSC / sort code / routing / IBAN / SWIFT-BIC / BSB / other).
  // Kept lenient + country-agnostic; bounds wide enough for IBAN (up to 34).
  body('IFSCCode')
    .trim()
    .notEmpty()
    .withMessage('Bank code is required')
    .isLength({ min: 4 })
    .withMessage('Bank code must be at least 4 characters')
    .isLength({ max: 40 })
    .withMessage('Bank code cannot exceed 40 characters'),

  body('bankCodeType')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 20 })
    .withMessage('Invalid bank code type'),

  body('userId')
    .notEmpty()
    .withMessage('User ID is required')
    .custom(async (value: string) => {
      const user = await prisma.user.findUnique({ where: { id: value } });
      if (!user) {
        throw new Error('User not found');
      }
      return true;
    }),

  body('status')
    .optional()
    .isBoolean()
    .withMessage('Status must be a boolean value'),

  body('currencyCode')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 3, max: 3 })
    .withMessage('Currency code must be a 3-letter ISO code'),

  validate,
];

// Update validation
export const updateBankDetailValidator: (ValidationChain | RequestHandler)[] = [
  param('id')
    .notEmpty()
    .withMessage('Bank detail ID is required')
    .custom(async (value: string) => {
      const bankDetail = await prisma.bankDetail.findFirst({
        where: { id: value, isDeleted: false },
      });
      if (!bankDetail) {
        throw new Error('Bank detail not found');
      }
      return true;
    }),

  body('accountHoldername')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Account holder name must be at least 2 characters')
    .isLength({ max: 100 })
    .withMessage('Account holder name cannot exceed 100 characters'),

  body('bankName')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Bank name must be at least 2 characters')
    .isLength({ max: 100 })
    .withMessage('Bank name cannot exceed 100 characters'),

  body('branchName')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Branch name must be at least 2 characters')
    .isLength({ max: 100 })
    .withMessage('Branch name cannot exceed 100 characters'),

  body('accountNumber')
    .optional()
    .trim()
    .isLength({ min: 5 })
    .withMessage('Account number must be at least 5 characters')
    .isLength({ max: 20 })
    .withMessage('Account number cannot exceed 20 characters')
    .custom(async (value: string, { req }) => {
      const id = (req.params as { id: string } | undefined)?.id;
      const existingAccount = await prisma.bankDetail.findFirst({
        where: {
          accountNumber: value,
          isDeleted: false,
          NOT: { id },
        },
      });
      if (existingAccount) {
        throw new Error('Account number already exists');
      }
      return true;
    }),

  body('IFSCCode')
    .optional()
    .trim()
    .isLength({ min: 4 })
    .withMessage('Bank code must be at least 4 characters')
    .isLength({ max: 40 })
    .withMessage('Bank code cannot exceed 40 characters'),

  body('bankCodeType')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 20 })
    .withMessage('Invalid bank code type'),

  body('status')
    .optional()
    .isBoolean()
    .withMessage('Status must be a boolean value'),

  body('currencyCode')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 3, max: 3 })
    .withMessage('Currency code must be a 3-letter ISO code'),

  validate,
];

// ID validation (for get and delete)
export const idValidator: (ValidationChain | RequestHandler)[] = [
  param('id')
    .notEmpty()
    .withMessage('Bank detail ID is required'),
  validate,
];

// Status update validation
export const updateBankDetailStatusValidator: (ValidationChain | RequestHandler)[] = [
  param('id')
    .notEmpty()
    .withMessage('Bank detail ID is required')
    .custom(async (value: string) => {
      const bankDetail = await prisma.bankDetail.findFirst({
        where: { id: value, isDeleted: false },
      });
      if (!bankDetail) {
        throw new Error('Bank detail not found');
      }
      return true;
    }),

  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isBoolean()
    .withMessage('Status must be a boolean value'),

  validate,
];

// CommonJS interop for legacy JS routes
module.exports = {
  createBankDetailValidator,
  updateBankDetailValidator,
  idValidator,
  updateBankDetailStatusValidator,
};
module.exports.createBankDetailValidator = createBankDetailValidator;
module.exports.updateBankDetailValidator = updateBankDetailValidator;
module.exports.idValidator = idValidator;
module.exports.updateBankDetailStatusValidator = updateBankDetailStatusValidator;
