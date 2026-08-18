import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, param, validationResult, ValidationChain } from 'express-validator';

import { prisma } from '../lib/prisma';

// Items unification (spec 2026-07-12 §4A): on CREATE, `name` is the ONLY
// required field. item_type is optional (the controller derives it from
// enable_inventory when omitted; an explicit value still wins), unit is
// optional (null = "-no unit-"), selling_price defaults to 0, and tax linkage
// is optional (legacy `tax` group id OR the new `taxRateId`; the controller
// defaults to the tenant's NONE rate when neither is sent). On UPDATE the
// controller does a partial update, so everything stays optional. Format/range
// checks still run when a value IS supplied (checkFalsy treats '' as absent —
// multipart forms post '' for blank fields).
const productValidationRules = (isUpdate = false): ValidationChain[] => {
  const requiredOrOptional = (chain: ValidationChain, message: string): ValidationChain =>
    isUpdate ? chain.optional() : chain.notEmpty().withMessage(message);
  const optional = (chain: ValidationChain): ValidationChain => chain.optional({ checkFalsy: true });
  return [
    // The only required field on create:
    requiredOrOptional(body('name'), 'Name is required')
      .isLength({ min: 2 }).withMessage('Name must be at least 2 characters')
      .isLength({ max: 255 }).withMessage('Name cannot exceed 255 characters'),
    // Everything below is optional on create AND update:
    optional(body('item_type'))
      .isIn(['Product', 'Service']).withMessage('Invalid item type'),
    optional(body('unit')),
    optional(body('code')),
    optional(body('category')),
    optional(body('brand')),
    optional(body('selling_price'))
      .isFloat({ min: 0 }).withMessage('Selling price must be a non-negative number'),
    optional(body('purchase_price'))
      .isFloat({ min: 0 }).withMessage('Purchase price must be a non-negative number'),
    optional(body('discount_type'))
      .isIn(['Percentage', 'Fixed']).withMessage('Invalid discount type'),
    optional(body('discount_value'))
      .isFloat({ min: 0 }).withMessage('Discount value must be a non-negative number'),
    optional(body('tax')),
    optional(body('taxRateId')),
    optional(body('barcode')),
    optional(body('alert_quantity'))
      .isInt({ min: 0 }).withMessage('Alert quantity must be a non-negative integer'),
    optional(body('description'))
      .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),
  ];
};

const commonErrorHandler: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    next();
    return;
  }
  const formatted: Record<string, string> = {};
  for (const err of errors.array()) {
    const path = (err as unknown as { path?: string; param?: string }).path
      ?? (err as unknown as { param?: string }).param
      ?? 'general';
    if (!formatted[path]) formatted[path] = err.msg;
  }
  res.status(422).json({ message: 'Validation failed', errors: formatted });
};

export const createProductValidator: (ValidationChain | RequestHandler)[] = [
  ...productValidationRules(),
  // No name-uniqueness rule: duplicate descriptions are allowed. code/barcode stay
  // unique but are only checked when a non-empty value is actually supplied.
  body('code').custom(async (value) => {
    if (value === undefined || value === '') return true;
    const existing = await prisma.product.findFirst({ where: { code: String(value) } });
    if (existing) throw new Error('Product code already exists');
    return true;
  }),
  body('barcode').custom(async (value) => {
    if (value === undefined || value === '') return true;
    const existing = await prisma.product.findFirst({ where: { barcode: String(value) } });
    if (existing) throw new Error('Barcode already exists');
    return true;
  }),
  commonErrorHandler,
];

export const updateProductValidator: (ValidationChain | RequestHandler)[] = [
  ...productValidationRules(true),
  param('id').notEmpty().withMessage('Product ID is required'),
  // No name-uniqueness rule on update either. code/barcode still unique.
  body('code').custom(async (value, { req }) => {
    if (value === undefined || value === '') return true;
    const id = req.params?.id as string | undefined;
    const existing = await prisma.product.findFirst({
      where: { code: String(value), NOT: id ? { id } : undefined },
    });
    if (existing) throw new Error('Product code already exists');
    return true;
  }),
  body('barcode').custom(async (value, { req }) => {
    if (value === undefined || value === '') return true;
    const id = req.params?.id as string | undefined;
    const existing = await prisma.product.findFirst({
      where: { barcode: String(value), NOT: id ? { id } : undefined },
    });
    if (existing) throw new Error('Barcode already exists');
    return true;
  }),
  commonErrorHandler,
];

// CommonJS interop for legacy JS routes
module.exports = { createProductValidator, updateProductValidator };
module.exports.createProductValidator = createProductValidator;
module.exports.updateProductValidator = updateProductValidator;
