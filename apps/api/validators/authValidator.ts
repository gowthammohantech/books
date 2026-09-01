import { body, ValidationChain } from 'express-validator';

export const registerValidator: ValidationChain[] = [
  body('firstName')
    .notEmpty().withMessage('First name is required')
    .isAlpha().withMessage('First name must contain only letters')
    .isLength({ min: 2 }).withMessage('First name must be at least 2 characters'),

  body('lastName')
    .notEmpty().withMessage('Last name is required')
    .isAlpha().withMessage('Last name must contain only letters')
    .isLength({ min: 2 }).withMessage('Last name must be at least 2 characters'),

  body('email')
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Must be a valid email'),

  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),

  body('confirmPassword')
    .notEmpty().withMessage('Confirm password is required')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return true;
    }),

  // P5: registration creates a WORKSPACE, and this names it. Optional — it
  // falls back to "Default Workspace" — because the field is new and an older
  // client that does not send it must still be able to sign up. It is also
  // what Tenant.slug is derived from, so it is length-capped here rather than
  // silently truncated later.
  body('companyName')
    .optional({ values: 'falsy' })
    .isLength({ min: 2, max: 100 })
    .withMessage('Company name must be between 2 and 100 characters'),
];

export const loginValidator: ValidationChain[] = [
  body('email')
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Must be a valid email'),
  body('password')
    .notEmpty().withMessage('Password is required'),
];
