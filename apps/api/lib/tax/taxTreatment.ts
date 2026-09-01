export type TaxTreatment =
  | 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'REVERSE_CHARGE' | 'OUT_OF_SCOPE';

/** Authoritative document tax for a treatment. STANDARD (or null/undefined,
 *  i.e. legacy rows) passes the supplied per-line tax through; every other
 *  treatment suppresses tax to 0. Pure — no I/O. */
export function resolveDocumentTax(treatment: TaxTreatment | null | undefined, suppliedTax: number): number {
  if (!treatment || treatment === 'STANDARD') return suppliedTax;
  return 0;
}

/** True when the treatment suppresses tax (anything other than STANDARD). */
export function suppressesTax(treatment: TaxTreatment | null | undefined): boolean {
  return !!treatment && treatment !== 'STANDARD';
}

const VALID_TAX_TREATMENTS = new Set<TaxTreatment>([
  'STANDARD', 'ZERO_RATED', 'EXEMPT', 'REVERSE_CHARGE', 'OUT_OF_SCOPE',
]);

/** Parse an unknown body value as a TaxTreatment enum member.
 *  Returns the value when it is one of the 5 known strings; undefined otherwise.
 *  Use this in create controllers instead of copy-pasting the inline Set check. */
export function parseTaxTreatment(raw: unknown): TaxTreatment | undefined {
  if (typeof raw === 'string' && VALID_TAX_TREATMENTS.has(raw as TaxTreatment)) {
    return raw as TaxTreatment;
  }
  return undefined;
}
