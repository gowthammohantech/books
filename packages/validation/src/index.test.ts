import { describe, expect, it } from 'vitest';

import {
  PHONE_ERROR,
  PHONE_REGEX,
  POSTAL_CODE_ERROR,
  POSTAL_CODE_REGEX,
  isValidPhone,
  isValidPostalCode,
} from './index';

describe('phone validation', () => {
  it.each([
    ['+44 20 7123 4567', 'UK international'],
    ['(555) 123-4567', 'US with parens'],
    ['+91 98765 43210', 'India'],
    ['555.123.4567', 'dot separated'],
    ['123456', 'shortest allowed'],
  ])('accepts %s (%s)', (value) => {
    expect(isValidPhone(value)).toBe(true);
  });

  it.each([
    ['12345', 'too short'],
    ['+1 555 123 4567 890 123', 'too long'],
    ['555-CALL-NOW', 'letters'],
    ['', 'empty'],
  ])('rejects %s (%s)', (value) => {
    expect(isValidPhone(value)).toBe(false);
  });

  it('trims before testing, so surrounding whitespace is not counted', () => {
    expect(isValidPhone('  123456  ')).toBe(true);
  });
});

describe('postal code validation', () => {
  it.each([
    ['SW1A 1AA', 'UK postcode'],
    ['90210', 'US ZIP'],
    ['90210-1234', 'ZIP+4'],
    ['560001', 'India PIN'],
    ['AB', 'shortest allowed'],
  ])('accepts %s (%s)', (value) => {
    expect(isValidPostalCode(value)).toBe(true);
  });

  it.each([
    ['A', 'too short'],
    ['ABCDEFGHIJKLM', 'too long'],
    ['SW1A_1AA', 'underscore'],
    ['', 'empty'],
  ])('rejects %s (%s)', (value) => {
    expect(isValidPostalCode(value)).toBe(false);
  });
});

describe('exports', () => {
  it('exposes the regexes so express-validator can use them directly', () => {
    expect(PHONE_REGEX).toBeInstanceOf(RegExp);
    expect(POSTAL_CODE_REGEX).toBeInstanceOf(RegExp);
  });

  it('has one message per rule, so both apps reject with the same wording', () => {
    expect(PHONE_ERROR).toBe('Please enter a valid phone number.');
    expect(POSTAL_CODE_ERROR).toBe('Please enter a valid postal/zip code.');
  });
});
