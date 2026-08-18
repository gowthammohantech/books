/**
 * Server-authoritative invoice tax recompute for the flat per-country regimes
 * (VAT_UK / VAT_EU / GST_AU / GST_NZ).
 *
 * WHY: the legacy invoice flow SUMS client-supplied per-line tax totals, trusting
 * whatever the browser sent. For the new tax packs that is a correctness/audit gap:
 * tax must be derived server-side from the tenant's regime + the supply context.
 *
 * SCOPE: this helper ONLY handles the four flat per-country regimes. GST_INDIA /
 * US_SALES_TAX / VAT_GENERIC / NONE return `null` so the caller preserves the
 * existing (CGST/SGST<->IGST, library-row) behaviour untouched.
 *
 * EU reverse-charge: detected from supplier (tenant) country + customer (contact)
 * country + customer VAT validity. When it applies, tax = 0 and a reverse-charge
 * note is returned for persistence on the invoice.
 */
import type { TaxRegime } from '@prisma/client';
import { computeRegimeTax } from '../taxEngine';
import { parseVatNumber } from '../euVat';
import { lineTaxableBase } from '../documentTotals';

/** Regimes whose tax this helper recomputes server-side. */
const FLAT_REGIMES = new Set<TaxRegime>(['VAT_UK', 'VAT_EU', 'GST_AU', 'GST_NZ']);

export function isFlatRegime(regime: TaxRegime | null | undefined): boolean {
  return regime != null && FLAT_REGIMES.has(regime);
}

/**
 * Minimal item shape consumed from a normalised invoice line.
 *
 * The discount fields mirror `TotalsItem` in `lib/documentTotals.ts` — the
 * taxable base for the flat regimes is derived via the SAME `lineTaxableBase`
 * helper that computes `documentTotals`' persisted `totalDiscount`/`grandTotal`,
 * so a structured `discount_value`/`discount_type` discount is honoured here
 * too, not just the legacy absolute `discount`.
 */
export interface RecomputeItem {
  qty?: number;
  rate?: number;
  /** Legacy absolute discount (used only when discount_value is absent). */
  discount?: number;
  discount_type?: string | null;
  discount_value?: number | string | null;
  /** Per-line tax percent (used by VAT_UK for standard/reduced/zero classes). */
  tax?: number;
}

export interface RecomputeInput {
  regime: TaxRegime;
  items: RecomputeItem[];
  /** Supplier (tenant) ISO-2 country code. */
  supplierCountry?: string | null;
  /** Customer (contact) ISO-2 country code. */
  customerCountry?: string | null;
  /** Customer VAT number (raw); structural EU validity is derived here. */
  customerVatNumber?: string | null;
  /**
   * Supplier (tenant) EU One-Stop-Shop registration flag. When true, B2C
   * cross-border EU supplies are taxed at the DESTINATION member-state rate.
   * Only consulted for VAT_EU; defaults to off (origin rate).
   */
  ossRegistered?: boolean;
}

export interface RecomputeResult {
  /** Authoritative total tax (sum of per-line tax), rounded 2dp. */
  totalTax: number;
  /** True when an EU B2B cross-border supply was zero-rated under reverse charge. */
  reverseCharge: boolean;
  /** Reverse-charge statement to persist on the invoice (only on reverse charge). */
  note: string | null;
  /**
   * True when any line was taxed at the DESTINATION rate under the EU OSS scheme
   * (B2C cross-border, supplier OSS-registered). False otherwise.
   */
  oss: boolean;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Note persisted on the invoice when OSS destination-rate VAT was applied. */
export const OSS_NOTE =
  'VAT charged at the destination member-state rate under the EU One-Stop-Shop (OSS) scheme';

/** Allowed UK VAT line rates (percent): zero / reduced / standard. */
const VAT_UK_ALLOWED_RATES = new Set([0, 5, 20]);
const VAT_UK_STANDARD_RATE = 20;

/**
 * Clamp a client-supplied UK VAT line rate to the allowed set {0, 5, 20} so
 * VAT_UK is server-authoritative like the other flat regimes. Any rate outside
 * the set (e.g. a spoofed 1%) is rejected and snapped to the 20% standard rate.
 */
function clampUkLineRate(rate: number): number {
  return VAT_UK_ALLOWED_RATES.has(rate) ? rate : VAT_UK_STANDARD_RATE;
}

/**
 * Normalise a free-text / 2-letter country value to an ISO-2 uppercase code.
 * Returns null when it cannot be confidently mapped to a 2-letter code.
 *
 * NOTE: the literal `'EU'` is intentionally treated as NON-resolvable. It is the
 * pack-registry routing code for the generic European-Union pack, NOT a real
 * member state. If a legacy tenant still has `countryCode:'EU'` stored, we must
 * NOT use it as the VAT supplier country (it is not an EU member, so
 * `euStandardRate('EU')` is null → 0% VAT and reverse-charge breaks). Returning
 * null here makes the resolver fall through to the real `countryId`→ISO-2.
 */
function normIso2(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().toUpperCase();
  if (v === 'EU') return null;
  return /^[A-Z]{2}$/.test(v) ? v : null;
}

/** Tx-like surface needed to resolve a country FK to its ISO-2 code. */
interface CountryLookupTx {
  country: { findUnique: (args: { where: { id: string }; select: { iso2: true } }) => Promise<{ iso2: string | null } | null> };
}

/**
 * Resolve the supplier (tenant) ISO-2 country from CompanySettings.
 * Order: `countryCode` → `countryId`→Country.iso2 → `country` string (if 2-letter).
 */
export async function resolveSupplierCountry(
  tx: CountryLookupTx,
  settings: { countryCode?: string | null; countryId?: string | null; country?: string | null } | null,
): Promise<string | null> {
  if (!settings) return null;
  const fromCode = normIso2(settings.countryCode);
  if (fromCode) return fromCode;
  if (settings.countryId) {
    const c = await tx.country.findUnique({ where: { id: settings.countryId }, select: { iso2: true } });
    const fromFk = normIso2(c?.iso2);
    if (fromFk) return fromFk;
  }
  return normIso2(settings.country);
}

export interface CustomerTaxContext {
  customerCountry: string | null;
  customerVatNumber: string | null;
}

/**
 * Resolve the customer (contact) country + VAT number for reverse-charge detection.
 *
 * AUTHORITATIVE FIELD CHOICE (documented per task brief):
 *   - country: prefer the NEW `Contact.country` (ISO-2 string); fall back to the
 *     FK-resolved `Contact.countryId` → Country.iso2 when `country` is empty.
 *   - VAT number: prefer the NEW `Contact.vatNumber`; fall back to the legacy
 *     `Contact.vatRegNumber` when `vatNumber` is empty.
 */
export async function resolveCustomerTaxContext(
  tx: CountryLookupTx,
  contact:
    | { country?: string | null; countryId?: string | null; vatNumber?: string | null; vatRegNumber?: string | null }
    | null,
): Promise<CustomerTaxContext> {
  if (!contact) return { customerCountry: null, customerVatNumber: null };

  let customerCountry = normIso2(contact.country);
  if (!customerCountry && contact.countryId) {
    const c = await tx.country.findUnique({ where: { id: contact.countryId }, select: { iso2: true } });
    customerCountry = normIso2(c?.iso2);
  }

  const customerVatNumber =
    (contact.vatNumber && contact.vatNumber.trim()) ||
    (contact.vatRegNumber && contact.vatRegNumber.trim()) ||
    null;

  return { customerCountry, customerVatNumber };
}

/**
 * Recompute the authoritative tax for a flat-regime invoice.
 *
 * Returns `null` for non-flat regimes (caller keeps the existing client-derived path).
 *
 *  - GST_AU: 10% on each line's net (qty*rate - discount).
 *  - GST_NZ: 15% likewise.
 *  - VAT_UK: per-line rate (the line's `tax` percent when supplied, else 20% standard).
 *  - VAT_EU: supplier member standard rate; or 0% + reverse-charge note on EU B2B
 *            cross-border supplies with a valid customer VAT number.
 */
export function recomputeServerTax(input: RecomputeInput): RecomputeResult | null {
  if (!isFlatRegime(input.regime)) return null;

  // EU reverse-charge validity is determined once for the whole document.
  const customerVatValid =
    input.regime === 'VAT_EU' && input.customerVatNumber
      ? parseVatNumber(input.customerVatNumber).valid
      : false;

  let totalTax = 0;
  let reverseCharge = false;
  let oss = false;
  let note: string | null = null;

  for (const item of input.items) {
    // Same discounted taxable base `computeDocumentTotals` persists as
    // `totalDiscount`/`grandTotal` (percent/fixed structured discount, or the
    // legacy absolute `discount` fallback) — keeps this recompute and the
    // document totals internally consistent (see RecomputeItem doc comment).
    const taxableAmount = lineTaxableBase(item);

    const out = computeRegimeTax({
      regime: input.regime,
      taxableAmount,
      // VAT_UK honours a per-line rate; other regimes ignore lineRate.
      // The client-supplied rate is clamped to {0,5,20} (server-authoritative).
      ...(input.regime === 'VAT_UK' && item.tax !== undefined && item.tax !== null
        ? { lineRate: clampUkLineRate(Number(item.tax)) }
        : {}),
      supplierCountry: input.supplierCountry ?? null,
      customerCountry: input.customerCountry ?? null,
      customerVatValid,
      // OSS only affects VAT_EU; the engine ignores it elsewhere.
      ossRegistered: input.ossRegistered === true,
    });

    totalTax = round2(totalTax + out.totalTax);
    if (out.reverseCharge) {
      reverseCharge = true;
      if (out.note) note = out.note;
    }
    if (out.oss) {
      oss = true;
      // Reuse the invoice note mechanism for the OSS marker (no new column).
      // Reverse-charge and OSS are mutually exclusive per line, so this never
      // clobbers a reverse-charge note.
      if (!note) note = OSS_NOTE;
    }
  }

  return { totalTax, reverseCharge, note, oss };
}
