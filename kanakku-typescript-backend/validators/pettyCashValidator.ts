import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

// -----------------------------------------------------------------------------
// createPettyCash validator
// -----------------------------------------------------------------------------

const createChains: ValidationChain[] = [
  body('bankAccountId')
    .trim()
    .notEmpty()
    .withMessage('bankAccountId is required'),

  body('paymentModeId')
    .trim()
    .notEmpty()
    .withMessage('paymentModeId is required'),

  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ gt: 0 })
    .withMessage('Amount must be greater than 0'),
];

// -----------------------------------------------------------------------------
// returnPettyCash validator
// -----------------------------------------------------------------------------

const returnChains: ValidationChain[] = [
  body('bankAccountId')
    .trim()
    .notEmpty()
    .withMessage('bankAccountId is required'),

  body('paymentModeId')
    .trim()
    .notEmpty()
    .withMessage('paymentModeId is required'),

  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ gt: 0 })
    .withMessage('Amount must be greater than 0'),

  body('remarks').optional({ checkFalsy: true }).isString().withMessage('Remarks must be a string'),
];

// -----------------------------------------------------------------------------
// Shared finaliser
// -----------------------------------------------------------------------------

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

export const createPettyCashValidator: (ValidationChain | RequestHandler)[] = [
  ...createChains,
  finaliser,
];

export const returnPettyCashValidator: (ValidationChain | RequestHandler)[] = [
  ...returnChains,
  finaliser,
];

// CommonJS interop for legacy JS routes
module.exports = {
  createPettyCashValidator,
  returnPettyCashValidator,
};
module.exports.createPettyCashValidator = createPettyCashValidator;
module.exports.returnPettyCashValidator = returnPettyCashValidator;
