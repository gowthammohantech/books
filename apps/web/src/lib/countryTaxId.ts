/**
 * Which tax-registration field to ask for, given the company's country.
 *
 * `utils/companyTaxId.ts` answers the same question from `taxRegime`, but the
 * setup wizard cannot: `taxRegime` is DERIVED server-side by the country pack
 * (lib/ledger/applyPack.ts) and does not exist until the setup PATCH commits.
 * The wizard has only the country the user just picked, so it keys on ISO-2.
 *
 * WHY THERE IS NO EU MEMBER LIST HERE. The server routes EU members to the
 * shared `EU` pack and everything unrecognised to `GB` (lib/ledger/
 * resolvePackCode.ts) — and both of those regimes read the SAME column,
 * `vatNumber`. So the only codes that change the answer are the four below,
 * and "everything else is VAT" reproduces the server exactly without copying a
 * 27-country table that would drift the moment the EU changes shape.
 */

/** The CompanySettings column a country's tax id is stored in. */
export type TaxIdField = 'gstin' | 'vatNumber' | 'abn' | 'nzGstNumber';

export interface TaxIdPrompt {
    field: TaxIdField;
    label: string;
    placeholder: string;
    /** Shown under the input. Never blocks submit — see the note below. */
    hint: string;
}

/**
 * The tax id to ask for, or `null` when the country has no company-level one.
 *
 * `null` is a real answer, not a failure: a US company has no federal
 * equivalent of a GSTIN, and US_SALES_TAX is exactly the regime
 * `companyTaxId()` also declines to render a field for.
 *
 * Nothing here is validated server-side beyond a trim (gstin) or a loose
 * format check (vat/abn/nzGst, in validateTaxIdentifiers). The wizard shows
 * `hint` as guidance and lets any value through: a company that has not
 * registered yet must still be able to finish setup.
 */
export function taxIdPromptFor(iso2?: string | null): TaxIdPrompt | null {
    switch ((iso2 ?? '').trim().toUpperCase()) {
        case 'IN':
            return {
                field: 'gstin',
                label: 'GSTIN',
                placeholder: '33AAECE1234F1Z5',
                hint: '15 characters. Leave blank if not GST-registered.',
            };
        case 'AU':
            return {
                field: 'abn',
                label: 'ABN',
                placeholder: '12345678901',
                hint: '11 digits.',
            };
        case 'NZ':
            return {
                field: 'nzGstNumber',
                label: 'GST Number',
                placeholder: '123456789',
                hint: '8 or 9 digits.',
            };
        case 'US':
            // No company-level tax id. Sales tax is registered per state, and
            // there is no CompanySettings column for it.
            return null;
        case '':
            // No country chosen yet — the caller renders nothing rather than
            // guessing a field it would have to swap out a moment later.
            return null;
        default:
            return {
                field: 'vatNumber',
                label: 'VAT Number',
                placeholder: 'GB123456789',
                hint: 'Include the country prefix. Leave blank if not VAT-registered.',
            };
    }
}
