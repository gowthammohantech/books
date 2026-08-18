/**
 * EU VAT helpers — member-state standard-rate table, member detection,
 * structural VAT-number validation, and B2B cross-border reverse-charge logic.
 *
 * Scope: STRUCTURAL only. VAT-number validation checks the country prefix and a
 * basic per-country length/charset pattern; it does NOT verify against the EU
 * VIES online service. Reverse-charge here is the standard EU B2B intra-community
 * supply rule (both parties EU, different member states, customer has a valid VAT
 * number → recipient accounts for VAT, supplier zero-rates).
 *
 * GB (United Kingdom) is intentionally NOT an EU member (post-Brexit). Its VAT
 * number prefix is still accepted by `parseVatNumber` for structural validity,
 * but `isEuMember('GB')` and `euStandardRate('GB')` correctly treat it as non-EU.
 */

/**
 * Current STANDARD VAT rate (percent) for each of the 27 EU member states,
 * keyed by ISO-3166-1 alpha-2 country code. Reduced/zero rates are out of scope
 * for this table (handled per invoice line by the tax engine).
 */
export const EU_MEMBER_RATES: Record<string, number> = {
  AT: 20, // Austria
  BE: 21, // Belgium
  BG: 20, // Bulgaria
  HR: 25, // Croatia
  CY: 19, // Cyprus
  CZ: 21, // Czechia
  DK: 25, // Denmark
  EE: 22, // Estonia
  FI: 25.5, // Finland
  FR: 20, // France
  DE: 19, // Germany
  GR: 24, // Greece
  HU: 27, // Hungary
  IE: 23, // Ireland
  IT: 22, // Italy
  LV: 21, // Latvia
  LT: 21, // Lithuania
  LU: 17, // Luxembourg
  MT: 18, // Malta
  NL: 21, // Netherlands
  PL: 23, // Poland
  PT: 23, // Portugal
  RO: 19, // Romania
  SK: 23, // Slovakia
  SI: 22, // Slovenia
  ES: 21, // Spain
  SE: 25, // Sweden
};

/** Normalize a country code: trim, uppercase. */
function normalizeCountry(country: string): string {
  return (country ?? '').trim().toUpperCase();
}

/**
 * Case-insensitive ISO-2 lookup. Returns true iff `country` is one of the 27 EU
 * member states. GB is NOT an EU member.
 */
export function isEuMember(country: string): boolean {
  return Object.prototype.hasOwnProperty.call(EU_MEMBER_RATES, normalizeCountry(country));
}

/**
 * Standard VAT rate for an EU member state, or `null` if the country is not an
 * EU member (e.g. GB, US, unknown codes).
 */
export function euStandardRate(country: string): number | null {
  const code = normalizeCountry(country);
  return isEuMember(code) ? EU_MEMBER_RATES[code] : null;
}

/**
 * Per-country VAT-number body patterns (the part AFTER the 2-letter prefix).
 *
 * Country-SPECIFIC patterns below; every other EU member (plus the generic case)
 * falls back to a 2-12 alphanumeric body. These are structural sanity checks, not
 * checksum or VIES validation.
 *
 * Specific: DE, FR, IE, NL, GB.
 */
const VAT_BODY_PATTERNS: Record<string, RegExp> = {
  DE: /^[0-9]{9}$/, // Germany: 9 digits
  FR: /^[0-9A-Z]{2}[0-9]{9}$/, // France: 2 alnum key + 9 digits (11 chars)
  IE: /^[0-9][0-9A-Z][0-9]{5}[A-Z]{1,2}$/, // Ireland: 8-9 chars, old & new formats
  NL: /^[0-9]{9}B[0-9]{2}$/, // Netherlands: 9 digits + B + 2 digits (12 chars)
  GB: /^([0-9]{9}|[0-9]{12})$/, // United Kingdom: 9 or 12 digits
};

/** Generic fallback body: 2-12 alphanumeric. */
const GENERIC_VAT_BODY = /^[0-9A-Z]{2,12}$/;

/** Countries whose VAT prefix is structurally accepted (EU members + GB). */
function isValidVatPrefix(country: string): boolean {
  return isEuMember(country) || country === 'GB';
}

export interface ParsedVatNumber {
  /** 2-letter country prefix (uppercased). Empty if input too short. */
  country: string;
  /** The remainder of the VAT number after the prefix (uppercased, despaced). */
  number: string;
  /** True iff prefix is an EU member (or GB) AND the body matches its pattern. */
  valid: boolean;
}

/**
 * Parse and STRUCTURALLY validate a VAT number. Strips spaces, uppercases, splits
 * the first 2 chars as the country prefix, and validates the body against the
 * per-country pattern (or the generic fallback for members without a specific one).
 *
 * Does NOT perform VIES online validation.
 */
export function parseVatNumber(vat: string): ParsedVatNumber {
  const cleaned = (vat ?? '').replace(/\s+/g, '').toUpperCase();

  if (cleaned.length < 3) {
    return { country: cleaned.slice(0, 2), number: cleaned.slice(2), valid: false };
  }

  const country = cleaned.slice(0, 2);
  const number = cleaned.slice(2);

  if (!isValidVatPrefix(country)) {
    return { country, number, valid: false };
  }

  const pattern = VAT_BODY_PATTERNS[country] ?? GENERIC_VAT_BODY;
  return { country, number, valid: pattern.test(number) };
}

export interface ReverseChargeArgs {
  supplierCountry: string;
  customerCountry: string;
  customerVatValid: boolean;
}

/**
 * EU B2B cross-border reverse-charge determination.
 *
 * Returns true iff BOTH supplier and customer are EU member states, they are in
 * DIFFERENT countries, AND the customer has a valid VAT number. In that case the
 * supply is zero-rated and the customer accounts for VAT (reverse charge).
 *
 * Domestic supply (same country) → false.
 * Customer outside the EU, or without a valid VAT number → false.
 */
export function isReverseCharge(args: ReverseChargeArgs): boolean {
  const supplier = normalizeCountry(args.supplierCountry);
  const customer = normalizeCountry(args.customerCountry);

  return (
    isEuMember(supplier) &&
    isEuMember(customer) &&
    supplier !== customer &&
    args.customerVatValid === true
  );
}
