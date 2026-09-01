import { body, ValidationChain } from 'express-validator';

export const createCustomFieldDataTypeValidator: ValidationChain[] = [
  body('type').notEmpty().withMessage('Type is required'),
  body('description').optional().isString(),
  body('isActive').optional().isBoolean(),
];

export const updateCustomFieldDataTypeValidator: ValidationChain[] = [
  body('type').optional().isString(),
  body('description').optional().isString(),
  body('isActive').optional().isBoolean(),
];
