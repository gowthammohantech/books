import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

import { prisma } from '../lib/prisma';

async function assertCustomerOwnedByUser(value: string, req: Request): Promise<true> {
  const userId = (req as unknown as { user?: string }).user;
  if (!userId) throw new Error('Unauthorized');
  const exists = await prisma.customer.findFirst({
    where: { id: value, userId, isDeleted: false },
    select: { id: true },
  });
  if (!exists) throw new Error('Customer not found for current user');
  return true;
}

const optionalFieldChains: ValidationChain[] = [
  body('name').optional({ nullable: true }).trim().isLength({ max: 100 }).withMessage('Name max 100 chars'),
  body('make').optional({ nullable: true }).trim().isLength({ max: 50 }).withMessage('Make max 50 chars'),
  body('model').optional({ nullable: true }).trim().isLength({ max: 50 }).withMessage('Model max 50 chars'),
  body('year')
    .optional({ nullable: true })
    .isInt({ min: 1900, max: 2100 })
    .withMessage('Year must be between 1900 and 2100'),
  body('registrationNumber')
    .optional({ nullable: true })
    .trim()
    .toUpperCase()
    .isLength({ max: 50 })
    .withMessage('Registration number max 50 chars'),
  body('vin')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 17 })
    .withMessage('VIN max 17 chars')
    .matches(/^[A-HJ-NPR-Z0-9]*$/i)
    .withMessage('VIN must be alphanumeric (no I/O/Q)'),
  body('mileage').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Mileage must be >= 0'),
  body('notes').optional({ nullable: true }).trim().isLength({ max: 500 }).withMessage('Notes max 500 chars'),
];

function runValidation(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }
    next();
  };
}

export const createVehicleValidator: (ValidationChain | RequestHandler)[] = [
  body('customerId')
    .trim()
    .notEmpty()
    .withMessage('Customer is required')
    .bail()
    .custom(async (value: string, { req }) => assertCustomerOwnedByUser(value, req as Request)),
  ...optionalFieldChains,
  runValidation(),
];

export const updateVehicleValidator: (ValidationChain | RequestHandler)[] = [
  body('customerId')
    .optional({ nullable: true })
    .trim()
    .isString()
    .withMessage('Customer id must be a valid string')
    .bail()
    .custom(async (value: string, { req }) => assertCustomerOwnedByUser(value, req as Request)),
  ...optionalFieldChains,
  runValidation(),
];

// CommonJS interop for adminRoutes.js which uses `require(...)`.
module.exports = { createVehicleValidator, updateVehicleValidator };
module.exports.createVehicleValidator = createVehicleValidator;
module.exports.updateVehicleValidator = updateVehicleValidator;
