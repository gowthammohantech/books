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
];

export const loginValidator: ValidationChain[] = [
  body('email')
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Must be a valid email'),
  body('password')
    .notEmpty().withMessage('Password is required'),
];

// CommonJS interop for legacy JS callers
module.exports = { registerValidator, loginValidator };
module.exports.registerValidator = registerValidator;
module.exports.loginValidator = loginValidator;
