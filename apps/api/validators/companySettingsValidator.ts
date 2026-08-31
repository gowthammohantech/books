import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

import { PHONE_REGEX, PHONE_ERROR } from '../utils/validation';
import { parseVatNumber } from '../lib/euVat';

function formatValidationErrors(errorsArr: unknown[]): Record<string, string> {
  const formatted: Record<string, string> = {};
  for (const err of errorsArr) {
    const e = err as { path: string; msg: string };
    if (!formatted[e.path]) {
      formatted[e.path] = e.msg;
    }
  }
  return formatted;
}

const validate: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({
      message: 'Validation failed',
      errors: formatValidationErrors(errors.array()),
    });
    return;
  }
  next();
};

const updateChains: ValidationChain[] = [
  body('companyName')
    .trim()
    .notEmpty()
    .withMessage('Company name is required')
    .isLength({ max: 100 })
    .withMessage('Company name cannot exceed 100 characters'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Invalid email address'),

  // Address/contact fields are optional so partial updates (e.g. uploading just
  // the company logo) succeed. Format is still validated when a value is given.
  body('phone')
    .optional({ checkFalsy: true })
    .trim()
    .matches(PHONE_REGEX)
    .withMessage(PHONE_ERROR),

  body('address').optional({ checkFalsy: true }).trim(),

  body('city').optional({ checkFalsy: true }),

  body('state').optional({ checkFalsy: true }),

  body('country').optional({ checkFalsy: true }),

  body('pincode').optional({ checkFalsy: true }).trim(),

  // Tax identifiers — all optional/nullable. Structural format checks only;
  // controller re-validates and persists.
  body('gstin').optional({ checkFalsy: true }).trim(),

  body('vatNumber')
    .optional({ checkFalsy: true })
    .trim()
    .custom((value: string) => parseVatNumber(value).valid)
    .withMessage('Invalid VAT number format'),

  body('abn')
    .optional({ checkFalsy: true })
    .trim()
    .custom((value: string) => /^[0-9]{11}$/.test(String(value).replace(/[\s-]/g, '')))
    .withMessage('Invalid ABN format (expected 11 digits)'),

  body('nzGstNumber')
    .optional({ checkFalsy: true })
    .trim()
    .custom((value: string) => /^[0-9]{8,9}$/.test(String(value).replace(/[\s-]/g, '')))
    .withMessage('Invalid NZ GST number format (expected 8-9 digits)'),
];

export const updateCompanySettingsValidator: (ValidationChain | RequestHandler)[] = [
  ...updateChains,
  validate,
];

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = { updateCompanySettingsValidator };
module.exports.updateCompanySettingsValidator = updateCompanySettingsValidator;
