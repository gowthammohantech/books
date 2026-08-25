// validators/expenseValidator.ts
import { body, ValidationChain } from 'express-validator';

export const createExpenseValidator: ValidationChain[] = [
  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ gt: 0 })
    .withMessage('Amount must be greater than 0'),

  body('expenseDate')
    .notEmpty()
    .withMessage('Expense date is required')
    .isISO8601()
    .withMessage('Invalid date format'),

  body('paymentStatus')
    .optional({ checkFalsy: true })
    .isIn(['PAID', 'CANCELLED', 'PENDING'])
    .withMessage('Invalid payment status'),

  body('description').optional({ checkFalsy: true }).isString(),

  body('currencyCode')
    .optional({ checkFalsy: true })
    .isString()
    .isLength({ min: 3, max: 3 })
    .withMessage('currencyCode must be a 3-character ISO currency code'),

  body('exchangeRate')
    .optional()
    .isFloat({ gt: 0 })
    .withMessage('exchangeRate must be a positive number'),
];

// CommonJS interop for legacy JS routes
module.exports = { createExpenseValidator };
module.exports.createExpenseValidator = createExpenseValidator;
