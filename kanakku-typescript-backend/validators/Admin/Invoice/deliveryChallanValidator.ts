import { body, param, ValidationChain } from 'express-validator';

export const createDeliveryChallanValidator: ValidationChain[] = [
  body('challanDate')
    .notEmpty().withMessage('Challan date is required')
    .isISO8601().withMessage('Invalid date format'),

  body('items')
    .isArray({ min: 1 }).withMessage('At least one item is required'),

  body('items.*.name').notEmpty().withMessage('Item name is required'),

  body('items.*.rate')
    .isNumeric().withMessage('Item rate must be a number')
    .isFloat({ min: 0 }).withMessage('Item rate must be positive'),

  body('items.*.qty')
    .isNumeric().withMessage('Item quantity must be a number')
    .isFloat({ min: 0 }).withMessage('Item quantity must be positive'),
];

export const updateDeliveryStatusValidator: ValidationChain[] = [
  param('id').notEmpty().withMessage('Delivery Challan ID is required'),

  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['PENDING', 'DELIVERED', 'CANCELLED', 'DRAFT'])
    .withMessage('Invalid status'),

  body('receivedBy')
    .if(body('status').equals('DELIVERED'))
    .notEmpty().withMessage('Received by is required for delivered status')
    .isString().withMessage('Received by must be a string'),

  body('receivedDate')
    .if(body('status').equals('DELIVERED'))
    .notEmpty().withMessage('Received date is required for delivered status')
    .isISO8601().withMessage('Invalid date format'),
];

// CommonJS interop for legacy JS routes
module.exports = { createDeliveryChallanValidator, updateDeliveryStatusValidator };
module.exports.createDeliveryChallanValidator = createDeliveryChallanValidator;
module.exports.updateDeliveryStatusValidator = updateDeliveryStatusValidator;
