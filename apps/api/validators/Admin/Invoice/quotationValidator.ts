import { body, ValidationChain } from 'express-validator';

export const quotationValidator: ValidationChain[] = [
  body('quotationDate')
    .notEmpty().withMessage('Quotation date is required')
    .isISO8601().withMessage('Invalid date format')
    .toDate(),

  body('expiryDate')
    .notEmpty().withMessage('Expiry date is required')
    .isISO8601().withMessage('Invalid date format')
    .toDate(),

  body('items')
    .isArray({ min: 1 }).withMessage('At least one item is required'),

  body('items.*.id')
    .notEmpty().withMessage('Product ID is required'),

  body('items.*.qty')
    .notEmpty().withMessage('Quantity is required')
    .isNumeric().withMessage('Quantity must be a number')
    .toFloat(),

  body('items.*.rate')
    .notEmpty().withMessage('Rate is required')
    .isNumeric().withMessage('Rate must be a number')
    .toFloat(),

  body('billFrom')
    .notEmpty().withMessage('Bill from user ID is required'),

  // Accept contactId (unified contacts) or billTo (legacy customer fallback)
  body('contactId').optional().isString(),
  body('billTo').optional().isString(),
  body().custom((_value, { req }) => {
    const b = req.body as Record<string, unknown>;
    if (!b.contactId && !b.billTo) {
      throw new Error('A contact (or billTo for legacy) is required');
    }
    return true;
  }),

  body('referenceNo').optional().isString(),
  body('notes').optional().isString(),
  body('termsAndCondition').optional().isString(),
  body('paymentTerms').optional().isString(),
  body('sign_type').optional().isIn(['eSignature', 'digitalSignature', 'none']),
  body('signatureId').optional().isString(),
  body('convert_type').optional().isIn(['quotation', 'invoice', 'purchase']),
];

export const updateQuotationValidator: ValidationChain[] = [
  body('customerId').optional().isString().withMessage('Invalid Customer ID format'),

  body('quotationDate').optional().isISO8601().withMessage('Invalid date format').toDate(),
  body('expiryDate').optional().isISO8601().withMessage('Invalid date format').toDate(),

  body('items').optional().isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.name').optional().isString().withMessage('Item name must be a string'),
  body('items.*.productId').optional().isString().withMessage('Invalid Product ID format'),
  body('items.*.quantity').optional().isNumeric().withMessage('Quantity must be a number').toFloat(),
  body('items.*.rate').optional().isNumeric().withMessage('Rate must be a number').toFloat(),
  body('items.*.discount').optional().isNumeric().withMessage('Discount must be a number').toFloat(),
  body('items.*.tax').optional().isNumeric().withMessage('Tax must be a number').toFloat(),

  body('status')
    .optional()
    .isIn(['draft', 'sent', 'accepted', 'declined'])
    .withMessage('Invalid status'),

  body('billFrom').optional().isString().withMessage('Invalid Bill from user ID format'),
  body('billTo').optional().isString().withMessage('Invalid Bill to user ID format'),

  body('referenceNo').optional().isString(),
  body('notes').optional().isString(),
  body('termsAndCondition').optional().isString(),
  body('paymentTerms').optional().isString(),
  body('sign_type').optional().isIn(['eSignature', 'digitalSignature', 'none']),
  body('signatureId').optional().isString(),
  body('convert_type').optional().isIn(['quotation', 'invoice', 'purchase']),
  body('roundOff').optional().isBoolean(),
  body('taxableAmount').optional().isNumeric(),
  body('totalDiscount').optional().isNumeric(),
  body('vat').optional().isNumeric(),
  body('TotalAmount').optional().isNumeric(),
];

// CommonJS interop for legacy JS routes
module.exports = { quotationValidator, updateQuotationValidator };
module.exports.quotationValidator = quotationValidator;
module.exports.updateQuotationValidator = updateQuotationValidator;
