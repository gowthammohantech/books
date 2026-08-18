import { body } from 'express-validator';
import type { ValidationChain } from 'express-validator';
import type { Request } from 'express';

import { prisma } from '../../../lib/prisma';

function getValidatorUserId(req: Request): string | undefined {
  return (req as Request & { user?: string }).user;
}

export const supplierPaymentValidator: ValidationChain[] = [
  body('purchaseId')
    .notEmpty()
    .withMessage('Purchase ID is required')
    .bail()
    .custom(async (value: string, { req }) => {
      const userId = getValidatorUserId(req as Request);
      const where = userId
        ? { id: value, userId }
        : { id: value };
      const exists = await prisma.purchase.findFirst({
        where,
        select: { id: true },
      });
      if (!exists) throw new Error('Purchase not found');
      return true;
    }),

  // contactId is OPTIONAL: the payment is recorded against a purchase, which
  // already links the party. The record-payment modal sends the legacy
  // supplierId, not contactId. When contactId is omitted the controller falls
  // back to the purchase's own contact for the remark name. Validate the
  // contact only when a value is supplied.
  body('contactId')
    .optional({ checkFalsy: true })
    .custom(async (value: string, { req }) => {
      const userId = getValidatorUserId(req as Request);
      const where = userId
        ? { id: value, userId, isDeleted: false }
        : { id: value, isDeleted: false };
      const exists = await prisma.contact.findFirst({
        where,
        select: { id: true },
      });
      if (!exists) throw new Error('Contact not found');
      return true;
    }),

  body('paymentDate')
    .notEmpty()
    .withMessage('Payment date is required')
    .bail()
    .isISO8601()
    .withMessage('Invalid date format')
    .toDate(),

  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .bail()
    .isNumeric()
    .withMessage('Amount must be a number')
    .toFloat(),

  body('paidAmount')
    .notEmpty()
    .withMessage('Paid amount is required')
    .bail()
    .isNumeric()
    .withMessage('Paid amount must be a number')
    .toFloat(),

  body('dueAmount')
    .notEmpty()
    .withMessage('Due amount is required')
    .bail()
    .isNumeric()
    .withMessage('Due amount must be a number')
    .toFloat(),

  // Optional fields. checkFalsy so a client sending null / '' (the modal posts
  // JSON with referenceNumber/notes = null when left blank) is treated as absent
  // rather than failing .isString() on null — reference/notes are optional.
  body('referenceNumber').optional({ checkFalsy: true }).isString(),
  body('notes').optional({ checkFalsy: true }).isString(),
  body('attachment').optional({ checkFalsy: true }).isString(),
];

// CommonJS interop for legacy JS routes
module.exports = {
  supplierPaymentValidator,
};
module.exports.supplierPaymentValidator = supplierPaymentValidator;
