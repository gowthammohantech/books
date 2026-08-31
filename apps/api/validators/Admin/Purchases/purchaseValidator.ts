import { body, ValidationChain } from 'express-validator';

import { prisma } from '../../../lib/prisma';

export const purchaseValidator: ValidationChain[] = [
  // body('purchaseOrderId')
  //   .notEmpty().withMessage('Purchase order ID is required')
  //   .isString().withMessage('Purchase order ID must be a string'),

  // body('vendorId')
  //   .notEmpty().withMessage('Vendor ID is required')
  //   .isString().withMessage('Invalid vendor ID format'),

  body('purchaseDate')
    .notEmpty().withMessage('Purchase date is required')
    .isISO8601().withMessage('Invalid date format')
    .toDate(),

  body('items')
    .isArray({ min: 1 }).withMessage('At least one item is required'),

  body('items.*.qty')
    .notEmpty().withMessage('Quantity is required')
    .isNumeric().withMessage('Quantity must be a number')
    .toFloat(),

  body('items.*.rate')
    .notEmpty().withMessage('Rate is required')
    .isNumeric().withMessage('Rate must be a number')
    .toFloat(),

  body('userId')
    .notEmpty().withMessage('User ID is required'),

  body('billFrom')
    .notEmpty().withMessage('Bill from user ID is required'),

  // Accept contactId (unified contacts), or supplierId (new), or billTo (legacy fallback)
  body('contactId').optional().isString(),
  body('supplierId').optional().isString(),
  body('billTo').optional().isString(),
  body().custom((_value, { req }) => {
    const b = req.body as Record<string, unknown>;
    if (!b.contactId && !b.supplierId && !b.billTo) {
      throw new Error('A contact (or supplierId/billTo for legacy) is required');
    }
    return true;
  }),

  // Optional fields
  body('referenceNo').optional().isString(),
  body('notes').optional().isString(),
  body('termsAndCondition').optional().isString(),
  body('paidAmount').optional().isNumeric().toFloat(),
  body('bank').optional().isString(),
];

export const supplierPaymentValidator: ValidationChain[] = [
  body('purchaseId')
    .notEmpty().withMessage('Purchase ID is required')
    .custom(async (value: string) => {
      const purchase = await prisma.purchase.findUnique({ where: { id: value } });
      if (!purchase) {
        throw new Error('Purchase not found');
      }
      return true;
    }),

  body('amount')
    .notEmpty().withMessage('Amount is required')
    .isNumeric().withMessage('Amount must be a number')
    .toFloat(),

  body('paymentDate')
    .notEmpty().withMessage('Payment date is required')
    .isISO8601().withMessage('Invalid date format')
    .toDate(),

  body('userId')
    .notEmpty().withMessage('User ID is required')
    .custom(async (value: string) => {
      const user = await prisma.user.findUnique({ where: { id: value } });
      if (!user) {
        throw new Error('User not found');
      }
      return true;
    }),

  // Optional fields
  body('paymentMode').optional().isString(),
  body('referenceNumber').optional().isString(),
  body('notes').optional().isString(),
];

// CommonJS interop for legacy JS routes
module.exports = { purchaseValidator, supplierPaymentValidator };
module.exports.purchaseValidator = purchaseValidator;
module.exports.supplierPaymentValidator = supplierPaymentValidator;
