import { body, param, ValidationChain } from 'express-validator';

import { prisma } from '../../../lib/prisma';

export const createInvoiceValidator: ValidationChain[] = [
  body('invoiceDate')
    .notEmpty().withMessage('Invoice date is required')
    .isISO8601().withMessage('Invalid date format'),

  body('items')
    .isArray({ min: 1 }).withMessage('At least one item is required'),

  body('billFrom')
    .notEmpty().withMessage('Bill from is required'),

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
];

export const updateInvoiceValidator: ValidationChain[] = [
  param('id')
    .notEmpty().withMessage('Invoice ID is required')
    .custom(async (value: string) => {
      const invoice = await prisma.invoice.findUnique({ where: { id: value } });
      if (!invoice) {
        throw new Error('Invoice not found');
      }
      return true;
    }),

  ...createInvoiceValidator,
];

// CommonJS interop for legacy JS routes
module.exports = { createInvoiceValidator, updateInvoiceValidator };
module.exports.createInvoiceValidator = createInvoiceValidator;
module.exports.updateInvoiceValidator = updateInvoiceValidator;
