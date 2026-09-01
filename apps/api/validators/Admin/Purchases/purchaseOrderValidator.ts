import { body, ValidationChain } from 'express-validator';

export const purchaseOrderValidator: ValidationChain[] = [
  body('orderDate')
    .notEmpty().withMessage('order date is required')
    .isISO8601().withMessage('Invalid date format')
    .toDate(),

  body('items')
    .isArray({ min: 1 }).withMessage('At least one item is required'),

  // body('items.*.name')
  //   .notEmpty().withMessage('Item name is required')
  //   .isString().withMessage('Item name must be a string'),

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

  // body('paymentMode')
  //   .notEmpty().withMessage('Payment mode is required')
  //   .isIn(['CASH', 'CREDIT', 'CHECK', 'BANK_TRANSFER', 'OTHER'])
  //   .withMessage('Invalid payment mode'),

  body('userId')
    .notEmpty().withMessage('User ID is required'),

  body('billFrom')
    .notEmpty().withMessage('Bill from user ID is required'),

  // Accept contactId (unified contacts), or supplierId (new), or billTo (legacy fallback)
  body('contactId').optional({ checkFalsy: true }).isString(),
  body('supplierId').optional({ checkFalsy: true }).isString(),
  body('billTo').optional({ checkFalsy: true }).isString(),
  body().custom((_value, { req }) => {
    const b = req.body as Record<string, unknown>;
    if (!b.contactId && !b.supplierId && !b.billTo) {
      throw new Error('A contact (or supplierId/billTo for legacy) is required');
    }
    return true;
  }),

  // Optional fields
  body('referenceNo').optional({ checkFalsy: true }).isString(),
  body('notes').optional({ checkFalsy: true }).isString(),
  body('termsAndCondition').optional({ checkFalsy: true }).isString(),
  body('sign_type').optional({ checkFalsy: true }).isIn(['manualSignature', 'digitalSignature', 'none']),
  body('signatureId').optional({ checkFalsy: true }).isString(),
  body('bank').optional({ checkFalsy: true }).isString(),
  body('convert_type').optional({ checkFalsy: true }).isIn(['purchase', 'estimate', 'invoice']),
];

// Update validator - makes most fields optional
export const updatePurchaseOrderValidator: ValidationChain[] = [
  body('vendorId')
    .optional({ checkFalsy: true })
    .isString().withMessage('Invalid Vendor ID format'),

  body('dueDate')
    .optional({ checkFalsy: true })
    .isISO8601().withMessage('Invalid date format')
    .toDate(),

  body('items')
    .optional()
    .isArray({ min: 1 }).withMessage('At least one item is required'),

  body('items.*.name')
    .optional({ checkFalsy: true })
    .isString().withMessage('Item name must be a string'),

  body('items.*.productId')
    .optional({ checkFalsy: true })
    .isString().withMessage('Invalid Product ID format'),

  body('items.*.quantity')
    .optional()
    .isNumeric().withMessage('Quantity must be a number')
    .toFloat(),

  body('items.*.rate')
    .optional()
    .isNumeric().withMessage('Rate must be a number')
    .toFloat(),

  body('items.*.discount')
    .optional()
    .isNumeric().withMessage('Discount must be a number')
    .toFloat(),

  body('items.*.tax')
    .optional()
    .isNumeric().withMessage('Tax must be a number')
    .toFloat(),

  body('paymentMode')
    .optional({ checkFalsy: true })
    .isIn(['CASH', 'CREDIT', 'CHECK', 'BANK_TRANSFER', 'OTHER'])
    .withMessage('Invalid payment mode'),

  body('status')
    .optional({ checkFalsy: true })
    .isIn(['new', 'pending', 'completed', 'cancelled'])
    .withMessage('Invalid status'),

  body('billFrom')
    .optional({ checkFalsy: true })
    .isString().withMessage('Invalid Bill from user ID format'),

  body('billTo')
    .optional({ checkFalsy: true })
    .isString().withMessage('Invalid Bill to user ID format'),

  body('supplierId').optional({ checkFalsy: true }).isString(),

  // Optional fields
  body('referenceNo').optional({ checkFalsy: true }).isString(),
  body('notes').optional({ checkFalsy: true }).isString(),
  body('termsAndCondition').optional({ checkFalsy: true }).isString(),
  body('sign_type').optional({ checkFalsy: true }).isIn(['manualSignature', 'digitalSignature', 'none']),
  body('signatureId').optional({ checkFalsy: true }).isString(),
  body('bank').optional({ checkFalsy: true }).isString(),
  body('convert_type').optional({ checkFalsy: true }).isIn(['purchase', 'estimate', 'invoice']),
  body('roundOff').optional().isBoolean(),
  body('taxableAmount').optional().isNumeric(),
  body('totalDiscount').optional().isNumeric(),
  body('vat').optional().isNumeric(),
  body('TotalAmount').optional().isNumeric(),
];
