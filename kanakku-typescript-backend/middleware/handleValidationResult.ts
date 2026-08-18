import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { validationResult } from 'express-validator';

/**
 * Shared express-validator result handler. Several validators are exported as bare
 * ValidationChain[] arrays with no result check, so their rules ran but errors were
 * never returned. Append this after such chains to surface a 422 with field-level
 * messages, matching the format already used by the self-contained validators.
 */
export const handleValidationResult: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors: Record<string, string> = {};
    for (const err of errors.array()) {
      const field = (err as unknown as { path?: string }).path ?? 'general';
      if (!formattedErrors[field]) {
        formattedErrors[field] = err.msg;
      }
    }
    res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: formattedErrors,
    });
    return;
  }
  next();
};

// CommonJS interop for legacy JS route files.
module.exports = { handleValidationResult };
module.exports.handleValidationResult = handleValidationResult;
