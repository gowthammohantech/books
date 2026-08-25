import { body, param, ValidationChain } from 'express-validator';

export const updateStockValidator: ValidationChain[] = [
  body('productId')
    .notEmpty().withMessage('Product ID is required'),

  body('quantity')
    .notEmpty().withMessage('Quantity is required')
    .isNumeric().withMessage('Quantity must be a number')
    .toFloat()
    .custom((value: number) => value > 0)
    .withMessage('Quantity must be greater than 0'),

  body('type')
    .notEmpty().withMessage('Stock update type is required')
    .isIn(['stock_in', 'stock_out', 'adjustment'])
    .withMessage('Invalid stock update type'),

  body('notes').optional().isString(),
];

export const inventoryHistoryValidator: ValidationChain[] = [
  param('id')
    .notEmpty().withMessage('Inventory ID is required'),
];

// CommonJS interop for legacy JS routes
module.exports = { updateStockValidator, inventoryHistoryValidator };
module.exports.updateStockValidator = updateStockValidator;
module.exports.inventoryHistoryValidator = inventoryHistoryValidator;
