// Lenient, internationally-friendly validation helpers.
//
// This is a whitelabelled product used by tenants in the US, UK, India and
// elsewhere. Phone-number and postal/zip-code formats vary enormously between
// countries (UK postcodes are alphanumeric like "SW1A 1AA", US ZIPs are 5 or
// 9 digits, Indian PINs are 6 digits, etc). Enforcing any single country's
// format breaks customer/invoice creation for everyone else, so we only do
// broad sanity checks here — never country-specific format enforcement.

// Phone: digits plus the common separators (+, spaces, parentheses, dots,
// hyphens). 6–20 characters covers short local numbers through full
// international E.164-style numbers with formatting.
export const PHONE_REGEX = /^[+()\d\s.-]{6,20}$/;

// Postal/zip code: letters, digits, spaces and hyphens. 2–12 chars covers
// everything from short codes to spaced UK postcodes and ZIP+4.
export const POSTAL_CODE_REGEX = /^[A-Za-z0-9\s-]{2,12}$/;

export const PHONE_ERROR = 'Please enter a valid phone number.';
export const POSTAL_CODE_ERROR = 'Please enter a valid postal/zip code.';

export const isValidPhone = (value: string): boolean => PHONE_REGEX.test(value.trim());

export const isValidPostalCode = (value: string): boolean =>
  POSTAL_CODE_REGEX.test(value.trim());
