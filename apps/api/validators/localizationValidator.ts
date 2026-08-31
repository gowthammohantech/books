import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';
import { LocalizationStartWeek } from '@prisma/client';

import { prisma } from '../lib/prisma';

const validate: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
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

const START_WEEK_VALUES = Object.values(LocalizationStartWeek) as string[];

export const saveLocalizationValidator: (ValidationChain | RequestHandler)[] = [
  body('dateFormatId')
    .notEmpty()
    .withMessage('Date format is required')
    .custom(async (value: string) => {
      const exists = await prisma.dateFormat.findFirst({
        where: { id: value, isDeleted: false },
      });
      if (!exists) {
        throw new Error('Date format not found');
      }
      return true;
    }),

  body('timeFormatId')
    .notEmpty()
    .withMessage('Time format is required')
    .custom(async (value: string) => {
      const exists = await prisma.timeFormat.findFirst({
        where: { id: value, isDeleted: false },
      });
      if (!exists) {
        throw new Error('Time format not found');
      }
      return true;
    }),

  body('timezoneId')
    .notEmpty()
    .withMessage('Timezone is required')
    .custom(async (value: string) => {
      const exists = await prisma.timezone.findUnique({ where: { id: value } });
      if (!exists) {
        throw new Error('Timezone not found');
      }
      return true;
    }),

  body('startWeek')
    .optional()
    .isIn(START_WEEK_VALUES)
    .withMessage(`startWeek must be one of: ${START_WEEK_VALUES.join(', ')}`),

  validate,
];

// CommonJS interop for legacy JS routes
module.exports = {
  saveLocalizationValidator,
};
module.exports.saveLocalizationValidator = saveLocalizationValidator;
