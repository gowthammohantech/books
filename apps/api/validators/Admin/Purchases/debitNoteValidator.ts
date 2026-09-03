import type { Request } from 'express';
import { body, ValidationChain } from 'express-validator';

import { prisma } from '../../../lib/prisma';
import { isTenantMember } from '../../../lib/tenantMembers';

export const debitNoteValidator: ValidationChain[] = [
  body('purchaseId')
    .notEmpty().withMessage('Purchase ID is required')
    .custom(async (value: string) => {
      const purchase = await prisma.purchase.findUnique({ where: { id: value } });
      if (!purchase) throw new Error('Purchase not found');
      return true;
    }),

  body('debitNoteDate')
    .notEmpty().withMessage('Debit note date is required')
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
    .notEmpty().withMessage('User ID is required')
    .custom(async (value: string, { req }) => {
      // Membership, not mere existence: an id from another workspace satisfies
      // the foreign key but must not be accepted here. `User` is the one model
      // the tenant guard cannot cover, so this is done by hand.
      const tenantId = (req as Request).tenantId;
      if (!tenantId || !(await isTenantMember(value, tenantId))) {
        throw new Error('User not found');
      }
      return true;
    }),

  // Optional fields
  body('referenceNo').optional({ checkFalsy: true }).isString(),
  body('notes').optional({ checkFalsy: true }).isString(),
  body('termsAndCondition').optional({ checkFalsy: true }).isString(),
  body('status')
    .optional({ checkFalsy: true })
    .isIn(['new', 'pending', 'completed', 'cancelled', 'partially_paid', 'paid']),
];
