import { body, ValidationChain } from 'express-validator';

export const createCustomFieldValidator: ValidationChain[] = [
  body('labelName')
    .notEmpty().withMessage('Label name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Label name must be between 2 and 100 characters'),
  body('moduleId').optional().isString().withMessage('Invalid Module ID'),
  body('dataType')
    .notEmpty().withMessage('Data type is required')
    .isString().withMessage('Invalid Data Type ID'),
  body('helpText').optional().isLength({ max: 500 }).withMessage('Help text must not exceed 500 characters'),
  body('isMandatory').optional().isBoolean(),
  body('showInTable').optional().isBoolean(),
  body('placement').optional().isIn(['document', 'lineItem']).withMessage('Invalid placement'),
];

export const updateCustomFieldValidator: ValidationChain[] = [
  body('labelName').optional().isLength({ min: 2, max: 100 }),
  body('moduleId').optional().isString(),
  body('dataType').optional().isString(),
  body('helpText').optional().isLength({ max: 500 }),
  body('isMandatory').optional().isBoolean(),
  body('showInTable').optional().isBoolean(),
  body('placement').optional().isIn(['document', 'lineItem']).withMessage('Invalid placement'),
];

module.exports = { createCustomFieldValidator, updateCustomFieldValidator };
module.exports.createCustomFieldValidator = createCustomFieldValidator;
module.exports.updateCustomFieldValidator = updateCustomFieldValidator;
