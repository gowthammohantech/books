import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

// Valid enum values (mirrored from Prisma schema)
const CATEGORY_GROUPS = [
  'ADMIN_EXPENSES',
  'GENERAL_OVERHEADS',
  'COST_OF_SALES',
  'PAYROLL',
  'TAXES',
  'INCOME',
  'CAPITAL',
  'OWNER_FUNDS',
  'USER_PAYMENTS',
] as const;

const CATEGORY_APPLIES_TO = [
  'MONEY_IN',
  'MONEY_OUT',
  'MONEY_IN_USER',
  'MONEY_OUT_USER',
] as const;

// ---------------------------------------------------------------------------
// Shared result finaliser
// ---------------------------------------------------------------------------

const finaliser: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
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
      success: false,
      message: 'Validation failed',
      errors: formattedErrors,
    });
    return;
  }
  next();
};

// ---------------------------------------------------------------------------
// createTransactionCategoryValidator
// ---------------------------------------------------------------------------

const createChains: ValidationChain[] = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('name is required'),

  body('group')
    .notEmpty()
    .withMessage('group is required')
    .isIn(CATEGORY_GROUPS)
    .withMessage(`group must be one of: ${CATEGORY_GROUPS.join(', ')}`),

  body('appliesTo')
    .notEmpty()
    .withMessage('appliesTo is required')
    .isIn(CATEGORY_APPLIES_TO)
    .withMessage(`appliesTo must be one of: ${CATEGORY_APPLIES_TO.join(', ')}`),

  body('accountId')
    .trim()
    .notEmpty()
    .withMessage('accountId is required'),

  body('taxApplicable')
    .optional()
    .isBoolean()
    .withMessage('taxApplicable must be a boolean'),

  body('defaultTaxRateId')
    .optional({ nullable: true })
    .isString()
    .withMessage('defaultTaxRateId must be a string'),

  body('code')
    .optional()
    .isString()
    .withMessage('code must be a string'),

  body('status')
    .optional()
    .isBoolean()
    .withMessage('status must be a boolean'),
];

export const createTransactionCategoryValidator: (ValidationChain | RequestHandler)[] = [
  ...createChains,
  finaliser,
];

// ---------------------------------------------------------------------------
// updateTransactionCategoryValidator
// ---------------------------------------------------------------------------

const updateChains: ValidationChain[] = [
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('name cannot be empty'),

  body('group')
    .optional()
    .isIn(CATEGORY_GROUPS)
    .withMessage(`group must be one of: ${CATEGORY_GROUPS.join(', ')}`),

  body('appliesTo')
    .optional()
    .isIn(CATEGORY_APPLIES_TO)
    .withMessage(`appliesTo must be one of: ${CATEGORY_APPLIES_TO.join(', ')}`),

  body('accountId')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('accountId cannot be empty'),

  body('taxApplicable')
    .optional()
    .isBoolean()
    .withMessage('taxApplicable must be a boolean'),

  body('defaultTaxRateId')
    .optional({ nullable: true })
    .isString()
    .withMessage('defaultTaxRateId must be a string'),

  body('code')
    .optional()
    .isString()
    .withMessage('code must be a string'),

  body('status')
    .optional()
    .isBoolean()
    .withMessage('status must be a boolean'),
];

export const updateTransactionCategoryValidator: (ValidationChain | RequestHandler)[] = [
  ...updateChains,
  finaliser,
];

// ---------------------------------------------------------------------------
// CommonJS interop for legacy JS routes
// ---------------------------------------------------------------------------

module.exports = {
  createTransactionCategoryValidator,
  updateTransactionCategoryValidator,
};
module.exports.createTransactionCategoryValidator = createTransactionCategoryValidator;
module.exports.updateTransactionCategoryValidator = updateTransactionCategoryValidator;
