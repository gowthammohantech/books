import type { Request } from 'express';
import { body, param, ValidationChain } from 'express-validator';

import { prisma } from '../../../lib/prisma';
import { isTenantMember } from '../../../lib/tenantMembers';

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
    .custom(async (value: string, { req }) => {
      // Membership, not mere existence: an id from another workspace satisfies
      // the foreign key but must not be accepted here. `User` is the one model
      // the tenant guard cannot cover, so this is done by hand.
      const tenantId = (req as Request).tenantId;
      if (!tenantId || !(await isTenantMember(value, tenantId))) {
        throw new Error('Bill From user not found');
      }
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
