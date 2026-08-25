import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

import { prisma } from '../lib/prisma';

const TAX_REGIMES = ['GST_INDIA', 'VAT_GENERIC', 'US_SALES_TAX', 'NONE'] as const;
const TAX_KINDS = ['CGST', 'SGST', 'IGST', 'UTGST', 'CESS', 'VAT', 'SALES_TAX'] as const;
// GST_INDIA deliberately excluded: the unified-tax design requires a single
// kind-less "GST 18%" rate to be creatable (the engine splits it into
// CGST/SGST/IGST components at resolve time — see lib/tax/ensureGstComponentRates
// and TaxRateController.resolveLine). A taxKind MAY still be supplied for a
// legacy direct-kind GST_INDIA rate; when present it's validated against
// TAX_KINDS above like any other regime.
const KIND_REQUIRED_REGIMES = new Set(['US_SALES_TAX']);

const handleValidationErrors: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors: Record<string, string> = {};
    for (const err of errors.array()) {
      const e = err as { path?: string; msg: string };
      const path = e.path || 'general';
      formattedErrors[path] = e.msg;
    }
    res.status(422).json({
      message: 'Validation failed',
      errors: formattedErrors,
    });
    return;
  }
  next();
};

function getUserId(req: Request): string | undefined {
  return (req as Request & { user?: string }).user;
}

const createChains: ValidationChain[] = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters')
    .custom(async (value: string, { req }) => {
      const userId = getUserId(req as Request);
      if (!userId) throw new Error('Unauthorized');
      const existing = await prisma.taxRate.findFirst({
        where: { userId, isDeleted: false, name: { equals: value, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) throw new Error('A tax rate with this name already exists');
      return true;
    }),

  body('rate')
    .notEmpty()
    .withMessage('Rate is required')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Rate must be a number between 0 and 100'),

  body('regime')
    .notEmpty()
    .withMessage('Regime is required')
    .isIn(TAX_REGIMES)
    .withMessage(`Regime must be one of: ${TAX_REGIMES.join(', ')}`),

  body('taxKind')
    .optional({ nullable: true })
    .isIn(TAX_KINDS)
    .withMessage(`Tax kind must be one of: ${TAX_KINDS.join(', ')}`)
    .bail()
    .custom((value: string | null | undefined, { req }) => {
      const regime = (req.body as { regime?: string })?.regime;
      if (regime && KIND_REQUIRED_REGIMES.has(regime) && !value) {
        throw new Error(`Tax kind is required for ${regime}`);
      }
      return true;
    }),

  // Catch-all when taxKind is omitted entirely but regime requires it.
  body('regime').custom((regime: string, { req }) => {
    const kind = (req.body as { taxKind?: string | null })?.taxKind;
    if (KIND_REQUIRED_REGIMES.has(regime) && !kind) {
      throw new Error(`Tax kind is required for ${regime}`);
    }
    return true;
  }),

  body('countryId')
    .optional({ nullable: true })
    .isString()
    .withMessage('Country id must be a valid string'),

  body('stateId')
    .optional({ nullable: true })
    .isString()
    .withMessage('State id must be a valid string'),

  body('isActive').optional().isBoolean().withMessage('isActive must be true or false'),
];

const updateChains: ValidationChain[] = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters')
    .custom(async (value: string, { req }) => {
      const userId = getUserId(req as Request);
      if (!userId) throw new Error('Unauthorized');
      const id = (req.params as { id?: string })?.id;
      const existing = await prisma.taxRate.findFirst({
        where: {
          userId,
          isDeleted: false,
          name: { equals: value, mode: 'insensitive' },
          NOT: id ? { id } : undefined,
        },
        select: { id: true },
      });
      if (existing) throw new Error('A tax rate with this name already exists');
      return true;
    }),

  body('rate')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Rate must be a number between 0 and 100'),

  body('regime')
    .optional()
    .isIn(TAX_REGIMES)
    .withMessage(`Regime must be one of: ${TAX_REGIMES.join(', ')}`),

  body('taxKind')
    .optional({ nullable: true })
    .isIn(TAX_KINDS)
    .withMessage(`Tax kind must be one of: ${TAX_KINDS.join(', ')}`),

  body('countryId')
    .optional({ nullable: true })
    .isString()
    .withMessage('Country id must be a valid string'),

  body('stateId')
    .optional({ nullable: true })
    .isString()
    .withMessage('State id must be a valid string'),

  body('isActive').optional().isBoolean().withMessage('isActive must be true or false'),
];

export const createTaxRateValidator: (ValidationChain | RequestHandler)[] = [
  ...createChains,
  handleValidationErrors,
];

export const updateTaxRateValidator: (ValidationChain | RequestHandler)[] = [
  ...updateChains,
  handleValidationErrors,
];

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createTaxRateValidator,
  updateTaxRateValidator,
};
module.exports.createTaxRateValidator = createTaxRateValidator;
module.exports.updateTaxRateValidator = updateTaxRateValidator;
