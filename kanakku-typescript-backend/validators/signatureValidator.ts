import fs from 'fs';

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

function tryUnlink(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

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

const createChains: ValidationChain[] = [
  body('signatureName')
    .trim()
    .notEmpty()
    .withMessage('Signature name is required')
    .isLength({ min: 2 })
    .withMessage('Signature name must be at least 2 characters')
    .isLength({ max: 50 })
    .withMessage('Signature name cannot exceed 50 characters'),

  body('markAsDefault')
    .optional()
    .isBoolean()
    .withMessage('markAsDefault must be a boolean value'),
];

const createFinaliser: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.file) {
    res.status(422).json({
      message: 'Validation failed',
      errors: { signatureImage: 'Signature image is required' },
    });
    return;
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
  if (!allowedTypes.includes(req.file.mimetype)) {
    tryUnlink(req.file.path);
    res.status(422).json({
      message: 'Validation failed',
      errors: { signatureImage: 'Only JPEG, PNG, and GIF images are allowed' },
    });
    return;
  }

  if (req.file.size > 2 * 1024 * 1024) {
    tryUnlink(req.file.path);
    res.status(422).json({
      message: 'Validation failed',
      errors: { signatureImage: 'Image size must be less than 2MB' },
    });
    return;
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    tryUnlink(req.file?.path);

    res.status(422).json({
      message: 'Validation failed',
      errors: formatValidationErrors(errors.array()),
    });
    return;
  }

  next();
};

const updateChains: ValidationChain[] = [
  body('signatureName')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Signature name cannot be empty')
    .isLength({ min: 2 })
    .withMessage('Signature name must be at least 2 characters')
    .isLength({ max: 50 })
    .withMessage('Signature name cannot exceed 50 characters'),

  body('markAsDefault')
    .optional()
    .isBoolean()
    .withMessage('markAsDefault must be a boolean value'),

  body('status')
    .optional()
    .isBoolean()
    .withMessage('status must be a boolean value'),
];

const updateFinaliser: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // Only validate file if it's being uploaded.
  if (req.file) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      tryUnlink(req.file.path);
      res.status(422).json({
        message: 'Validation failed',
        errors: { signatureImage: 'Only JPEG, PNG, and GIF images are allowed' },
      });
      return;
    }

    if (req.file.size > 2 * 1024 * 1024) {
      tryUnlink(req.file.path);
      res.status(422).json({
        message: 'Validation failed',
        errors: { signatureImage: 'Image size must be less than 2MB' },
      });
      return;
    }
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    tryUnlink(req.file?.path);

    res.status(422).json({
      message: 'Validation failed',
      errors: formatValidationErrors(errors.array()),
    });
    return;
  }

  next();
};

export const createSignatureValidator: (ValidationChain | RequestHandler)[] = [
  ...createChains,
  createFinaliser,
];

export const updateSignatureValidator: (ValidationChain | RequestHandler)[] = [
  ...updateChains,
  updateFinaliser,
];

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createSignatureValidator,
  updateSignatureValidator,
};
module.exports.createSignatureValidator = createSignatureValidator;
module.exports.updateSignatureValidator = updateSignatureValidator;
