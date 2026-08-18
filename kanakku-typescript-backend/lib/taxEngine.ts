import type { TaxRate, TaxRegime, TaxKind } from '@prisma/client';
import { euStandardRate, isEuMember, isReverseCharge } from './euVat';

export interface TaxLine {
  taxRateId: string;
  name: string;
  kind: TaxKind | null;
  percent: number;
  amount: number;
}

export interface LineComputeInput {
  qty: number;
  rate: number;          // unit price
  discount?: number;     // absolute, applied before tax
  appliedTaxes: Array<Pick<TaxRate, 'id' | 'name' | 'taxKind'> & { rate: number | string }>;
}

export interface LineComputeOutput {
  taxableAmount: number;
  taxes: TaxLine[];
  totalTax: number;
  lineTotal: number;
}

/**
 * Pure: compute the per-line taxable amount and the breakdown of taxes.
 * All amounts rounded half-up to 2 decimal places.
 */
export function computeLineTaxes(input: LineComputeInput): LineComputeOutput {
  const taxable = round2(input.qty * input.rate - (input.discount ?? 0));
  const taxes: TaxLine[] = input.appliedTaxes.map((t) => {
    const percent = Number(t.rate);
    const amount = round2((taxable * percent) / 100);
    return {
      taxRateId: t.id,
      name: t.name,
      kind: t.taxKind ?? null,
      percent,
      amount,
    };
  });
  const totalTax = round2(taxes.reduce((sum, x) => sum + x.amount, 0));
  return { taxableAmount: taxable, taxes, totalTax, lineTotal: round2(taxable + totalTax) };
}

export interface SuggestInput {
  regime: TaxRegime;
  companyCountryId: string | null;
  companyStateId: string | null;
  customerCountryId: string | null;
  customerStateId: string | null;
  libraryRates: Array<TaxRate>;
}

/**
 * Pure: pick which TaxRate rows from the library should apply by default for this line.
 * Caller can override per line.
 */
export function suggestTaxesForLine(input: SuggestInput): TaxRate[] {
  const lib = input.libraryRates.filter((r) => r.isActive && !r.isDeleted && r.regime === input.regime);

  if (input.regime === 'NONE') return [];

  if (input.regime === 'GST_INDIA') {
    const sameCountry =
      input.companyCountryId !== null &&
      input.customerCountryId !== null &&
      input.companyCountryId === input.customerCountryId;
    const sameState =
      sameCountry &&
      input.companyStateId !== null &&
      input.customerStateId !== null &&
      input.companyStateId === input.customerStateId;
    if (sameState) {
      // Intra-state: CGST + SGST (or UTGST if a union territory)
      const cgst = lib.find((r) => r.taxKind === 'CGST');
      const sgst = lib.find((r) => r.taxKind === 'SGST');
      const utgst = lib.find((r) => r.taxKind === 'UTGST');
      // Prefer SGST when present; fall back to UTGST for union territories
      if (cgst && sgst) return [cgst, sgst];
      if (cgst && utgst) return [cgst, utgst];
      return [];
    }
    // Inter-state: IGST
    const igst = lib.find((r) => r.taxKind === 'IGST');
    return igst ? [igst] : [];
  }

  if (input.regime === 'VAT_GENERIC') {
    // Default to the first VAT-kind rate
    const vat = lib.find((r) => r.taxKind === 'VAT' || r.taxKind === null);
    return vat ? [vat] : [];
  }

  if (input.regime === 'US_SALES_TAX') {
    // Match customer state
    if (input.customerStateId) {
      const matched = lib.filter((r) => r.taxKind === 'SALES_TAX' && r.stateId === input.customerStateId);
      return matched;
    }
    return [];
  }

  return [];
}

export interface ResolveLineTaxesInput {
  taxableAmount: number;
  regime: TaxRegime;
  companyCountryId?: string | null;
  companyStateId?: string | null;
  partyCountryId?: string | null;
  partyStateId?: string | null;
  libraryRates: TaxRate[];
  groupRateIds?: string[];
}

export interface ResolveLineTaxesOutput {
  taxes: TaxLine[];
  totalTax: number;
}

/**
 * Resolve which taxes apply to a line, then compute the amounts.
 * Uses suggestTaxesForLine when company+party location info is present;
 * falls back to IGST (GST) or groupRateIds rows (other regimes) when not.
 */
export function resolveLineTaxes(input: ResolveLineTaxesInput): ResolveLineTaxesOutput {
  const {
    taxableAmount,
    regime,
    companyCountryId,
    companyStateId,
    partyCountryId,
    partyStateId,
    libraryRates,
    groupRateIds,
  } = input;

  // Try the suggest engine first
  let applicableRates: TaxRate[] = suggestTaxesForLine({
    regime,
    companyCountryId: companyCountryId ?? null,
    companyStateId: companyStateId ?? null,
    customerCountryId: partyCountryId ?? null,
    customerStateId: partyStateId ?? null,
    libraryRates,
  });

  // Fall back when suggest returns nothing
  if (applicableRates.length === 0) {
    if (regime === 'GST_INDIA') {
      // Fall back to the inter-state (IGST) rate from the library
      const lib = libraryRates.filter((r) => r.isActive && !r.isDeleted && r.regime === regime);
      const igst = lib.find((r) => r.taxKind === 'IGST');
      if (igst) applicableRates = [igst];
    } else if (groupRateIds && groupRateIds.length > 0) {
      // Non-GST: use the caller-supplied group rate IDs
      const idSet = new Set(groupRateIds);
      applicableRates = libraryRates.filter(
        (r) => idSet.has(r.id) && r.isActive && !r.isDeleted,
      );
    }
  }

  const { taxes, totalTax } = computeLineTaxes({
    qty: 1,
    rate: taxableAmount,
    appliedTaxes: applicableRates.map((r) => ({
      id: r.id,
      name: r.name,
      taxKind: r.taxKind,
      rate: Number(r.rate),
    })),
  });

  return { taxes, totalTax };
}

// ---------------------------------------------------------------------------
// Unified tax (spec 2026-07-12 §4B): kind-less GST_INDIA rate synthesis.
// A single "GST 18%" rate (taxKind null) is split into statutory components at
// resolve time; rates that DO carry a taxKind keep behaving as today.
// ---------------------------------------------------------------------------

export interface GstComponentSpec {
  kind: TaxKind;
  percent: number;
  name: string;
}

export interface SplitGstInput {
  /** Total GST percent of the kind-less rate (e.g. 18). */
  totalPercent: number;
  /** true = intra-state supply (company state === party state). */
  intraState: boolean;
  /** true = the shared state is a union territory without legislature → UTGST. */
  unionTerritory?: boolean;
}

/**
 * Pure: split a single kind-less GST_INDIA rate into components —
 * intra-state → CGST half + SGST half (UTGST for union territories),
 * inter-state → IGST at the full rate. Halving is exact (5 → 2.5 + 2.5).
 */
export function splitGstRate(input: SplitGstInput): GstComponentSpec[] {
  const fmt = (n: number): string => String(Number(n.toFixed(4)));
  if (!input.intraState) {
    return [{ kind: 'IGST', percent: input.totalPercent, name: `IGST ${fmt(input.totalPercent)}%` }];
  }
  const half = input.totalPercent / 2;
  const stateKind: TaxKind = input.unionTerritory ? 'UTGST' : 'SGST';
  return [
    { kind: 'CGST', percent: half, name: `CGST ${fmt(half)}%` },
    { kind: stateKind, percent: half, name: `${stateKind} ${fmt(half)}%` },
  ];
}

/**
 * India union territories WITHOUT their own legislature levy UTGST instead of
 * SGST on intra-UT supplies. Matched on State.state_code (Delhi, Puducherry and
 * J&K have legislatures and levy SGST, so they are NOT listed).
 */
const INDIA_UT_STATE_CODES = new Set(['AN', 'CH', 'DH', 'DD', 'DN', 'LA', 'LD']);

export function isUnionTerritoryStateCode(stateCode: string | null | undefined): boolean {
  return stateCode ? INDIA_UT_STATE_CODES.has(stateCode.trim().toUpperCase()) : false;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Per-country flat-rate compute (AU / NZ / UK / EU)
//
// These regimes derive their rate from the regime itself (+ optional per-line
// override or supplier/customer party context) rather than from tenant
// `TaxRate` library rows. They are exposed via `computeRegimeTax`, a NEW,
// backward-compatible entry point — existing GST_INDIA / US_SALES_TAX /
// VAT_GENERIC flows continue to use suggest/resolve/computeLineTaxes with
// library rows and are untouched.
// ---------------------------------------------------------------------------

/** Default flat statutory rate (percent) for the per-country regimes. */
const GST_AU_RATE = 10;
const GST_NZ_RATE = 15;
const VAT_UK_STANDARD_RATE = 20;

export const REVERSE_CHARGE_NOTE =
  'Reverse charge — VAT to be accounted for by the recipient';

export interface RegimeTaxInput {
  regime: TaxRegime;
  /** Net amount the tax is charged on. */
  taxableAmount: number;
  /**
   * Per-line rate override (percent). Used by VAT_UK to support
   * standard 20 / reduced 5 / zero 0 tax classes. When omitted, VAT_UK
   * defaults to the standard rate.
   */
  lineRate?: number;
  /** Supplier (tenant) ISO-2 country — used by VAT_EU for rate + reverse-charge. */
  supplierCountry?: string | null;
  /** Customer (contact) ISO-2 country — used by VAT_EU for reverse-charge. */
  customerCountry?: string | null;
  /** Whether the customer supplied a structurally valid EU VAT number. */
  customerVatValid?: boolean;
  /**
   * Whether the supplier (tenant) is registered for the EU One-Stop-Shop scheme.
   * When true, B2C cross-border EU supplies are taxed at the DESTINATION
   * member-state rate instead of the origin (supplier) rate. Defaults to off.
   */
  ossRegistered?: boolean;
}

export interface RegimeTaxOutput {
  /** Effective rate applied (percent). */
  rate: number;
  /** Computed tax amount (rounded half-up to 2dp). */
  totalTax: number;
  /** True when an EU B2B cross-border supply was zero-rated under reverse charge. */
  reverseCharge: boolean;
  /** Human-readable note for the invoice layer (only set on reverse charge). */
  note?: string;
  /**
   * True when an EU B2C cross-border supply was taxed at the DESTINATION rate
   * under the One-Stop-Shop scheme. Undefined/false for all other supplies.
   */
  oss?: boolean;
}

/**
 * Pure: compute tax for the flat per-country regimes (AU/NZ/UK/EU).
 *
 * Backward-compatible: this is a new function; it does not alter the existing
 * library-row compute path used by GST_INDIA / US_SALES_TAX / VAT_GENERIC.
 * Passing one of those regimes here returns a zero result (those regimes must
 * be computed via resolveLineTaxes with their library rates).
 *
 *  - GST_AU → 10% GST
 *  - GST_NZ → 15% GST
 *  - VAT_UK → `lineRate` when supplied (20 standard / 5 reduced / 0 zero),
 *             else the 20% standard rate
 *  - VAT_EU → supplier member-state standard rate; if the supply is an EU B2B
 *             cross-border supply (isReverseCharge) → 0% + reverseCharge marker
 */
export function computeRegimeTax(input: RegimeTaxInput): RegimeTaxOutput {
  const taxable = round2(input.taxableAmount);

  switch (input.regime) {
    case 'GST_AU':
      return flat(GST_AU_RATE, taxable);

    case 'GST_NZ':
      return flat(GST_NZ_RATE, taxable);

    case 'VAT_UK': {
      const rate =
        input.lineRate === undefined || input.lineRate === null
          ? VAT_UK_STANDARD_RATE
          : input.lineRate;
      return flat(rate, taxable);
    }

    case 'VAT_EU': {
      const supplierCountry = input.supplierCountry ?? '';
      const customerCountry = input.customerCountry ?? '';
      const reverseCharge = isReverseCharge({
        supplierCountry,
        customerCountry,
        customerVatValid: input.customerVatValid === true,
      });
      if (reverseCharge) {
        return { rate: 0, totalTax: 0, reverseCharge: true, note: REVERSE_CHARGE_NOTE };
      }
      // OSS: B2C cross-border EU supply taxed at the DESTINATION member-state rate
      // when the supplier is OSS-registered. (Reverse-charge above already handled
      // B2B cross-border; domestic — same country — falls through to origin below.)
      if (
        input.ossRegistered === true &&
        isEuMember(customerCountry) &&
        normalizeForCompare(customerCountry) !== normalizeForCompare(supplierCountry)
      ) {
        const destRate = euStandardRate(customerCountry) ?? 0;
        return { ...flat(destRate, taxable), oss: true };
      }
      const rate = euStandardRate(supplierCountry) ?? 0;
      return flat(rate, taxable);
    }

    default:
      // NONE, or a library-row regime computed elsewhere.
      return { rate: 0, totalTax: 0, reverseCharge: false };
  }
}

/** Trim + uppercase an ISO-2 code for a case-insensitive same-country compare. */
function normalizeForCompare(country: string): string {
  return (country ?? '').trim().toUpperCase();
}

function flat(rate: number, taxable: number): RegimeTaxOutput {
  return {
    rate,
    totalTax: round2((taxable * rate) / 100),
    reverseCharge: false,
  };
}
