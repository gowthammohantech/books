import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

const validate: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors: Record<string, string> = {};
    for (const err of errors.array()) {
      const field = (err as unknown as { path: string }).path;
      if (!formattedErrors[field]) {
        formattedErrors[field] = err.msg;
      }
    }
    res.status(422).json({
      message: 'Validation failed',
      errors: formattedErrors,
    });
    return;
  }
  next();
};

export const createRoleValidator: (ValidationChain | RequestHandler)[] = [
  body('roleName')
    .trim()
    .notEmpty()
    .withMessage('Role name is required')
    .isLength({ min: 2 })
    .withMessage('Role name must be at least 2 characters')
    .isLength({ max: 255 })
    .withMessage('Role name cannot exceed 255 characters'),

  body('status')
    .optional()
    .isBoolean()
    .withMessage('Status must be a boolean value'),

  validate,
];

// CommonJS interop for legacy JS routes
module.exports = { createRoleValidator };
module.exports.createRoleValidator = createRoleValidator;
