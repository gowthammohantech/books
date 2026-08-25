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

export const PHONE_ERROR = 'Please provide a valid phone number';
export const POSTAL_CODE_ERROR = 'Please provide a valid postal/zip code';

// CommonJS interop for legacy .js files (Mongoose models, JS routes).
module.exports = { PHONE_REGEX, POSTAL_CODE_REGEX, PHONE_ERROR, POSTAL_CODE_ERROR };
module.exports.PHONE_REGEX = PHONE_REGEX;
module.exports.POSTAL_CODE_REGEX = POSTAL_CODE_REGEX;
module.exports.PHONE_ERROR = PHONE_ERROR;
module.exports.POSTAL_CODE_ERROR = POSTAL_CODE_ERROR;
