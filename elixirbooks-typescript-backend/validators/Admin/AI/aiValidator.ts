import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain, ValidationError } from 'express-validator';

const handleValidationResult: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors: Record<string, string> = {};
    errors.array().forEach((err: ValidationError) => {
      const path = 'path' in err ? (err as { path: string }).path : (err as { param?: string }).param || '';
      if (path && !formattedErrors[path]) {
        formattedErrors[path] = err.msg;
      }
    });
    res.status(422).json({
      message: 'Validation failed',
      errors: formattedErrors,
    });
    return;
  }
  next();
};

export const processPromptValidator: Array<ValidationChain | RequestHandler> = [
  body('prompt')
    .notEmpty()
    .withMessage('Prompt is required')
    .isString()
    .withMessage('Prompt must be a string')
    .isLength({ min: 5 })
    .withMessage('Prompt must be at least 5 characters')
    .isLength({ max: 2000 })
    .withMessage('Prompt must not exceed 2000 characters'),

  handleValidationResult,
];

export const confirmDocumentValidator: Array<ValidationChain | RequestHandler> = [
  body('promptLogId')
    .notEmpty()
    .withMessage('Prompt log ID is required')
    .isString()
    .withMessage('Invalid prompt log ID'),

  body('documentType')
    .notEmpty()
    .withMessage('Document type is required')
    .isIn(['invoice', 'purchase_order', 'quotation', 'expense'])
    .withMessage('Document type must be invoice, purchase_order, quotation, or expense'),

  body('payload').notEmpty().withMessage('Document payload is required'),

  handleValidationResult,
];

export const updateConfigValidator: Array<ValidationChain | RequestHandler> = [
  body('aiEnabled').optional().isBoolean().withMessage('aiEnabled must be a boolean'),

  body('enabledModules').optional().isObject().withMessage('enabledModules must be an object'),

  body('defaultCurrency')
    .optional()
    .isString()
    .withMessage('defaultCurrency must be a string'),

  body('defaultTaxType')
    .optional()
    .isIn(['GST', 'CGST_SGST', 'IGST', 'VAT', 'none'])
    .withMessage('Invalid tax type'),

  body('autoApplyTax').optional().isBoolean().withMessage('autoApplyTax must be a boolean'),

  body('defaultPaymentTermsDays')
    .optional()
    .isInt({ min: 0, max: 365 })
    .withMessage('Payment terms must be between 0 and 365 days'),

  body('maxPromptsPerDay')
    .optional()
    .isInt({ min: 1, max: 10000 })
    .withMessage('Max prompts per day must be between 1 and 10000'),

  handleValidationResult,
];

// CommonJS interop for legacy JS routes
module.exports = {
  processPromptValidator,
  confirmDocumentValidator,
  updateConfigValidator,
};
module.exports.processPromptValidator = processPromptValidator;
module.exports.confirmDocumentValidator = confirmDocumentValidator;
module.exports.updateConfigValidator = updateConfigValidator;
