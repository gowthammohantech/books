import { body, param, ValidationChain } from 'express-validator';

import { prisma } from '../../../lib/prisma';

export const createCreditNoteValidator: ValidationChain[] = [
  body('invoiceId')
    .notEmpty().withMessage('Invoice ID is required')
    .custom(async (value: string) => {
      const invoice = await prisma.invoice.findUnique({ where: { id: value } });
      if (!invoice) throw new Error('Invoice not found');
      return true;
    }),

  body('creditNoteDate')
    .notEmpty().withMessage('Credit note date is required')
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

  body('billFrom')
    .notEmpty().withMessage('Bill from is required')
    .custom(async (value: string) => {
      const user = await prisma.user.findUnique({ where: { id: value } });
      if (!user) throw new Error('Bill From user not found');
      return true;
    }),

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

export const applyCreditNoteValidator: ValidationChain[] = [
  param('id').notEmpty().withMessage('Credit Note ID is required'),

  body('invoiceId')
    .notEmpty().withMessage('Invoice ID is required'),
];

// CommonJS interop for legacy JS routes
module.exports = { createCreditNoteValidator, applyCreditNoteValidator };
module.exports.createCreditNoteValidator = createCreditNoteValidator;
module.exports.applyCreditNoteValidator = applyCreditNoteValidator;
