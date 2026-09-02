import { describe, expect, it } from 'vitest';

import { taxIdPromptFor } from './countryTaxId';

describe('taxIdPromptFor', () => {
    it('asks India for a GSTIN', () => {
        expect(taxIdPromptFor('IN')?.field).toBe('gstin');
        expect(taxIdPromptFor('IN')?.label).toBe('GSTIN');
    });

    it('asks Australia for an ABN and New Zealand for a GST number', () => {
        expect(taxIdPromptFor('AU')?.field).toBe('abn');
        expect(taxIdPromptFor('NZ')?.field).toBe('nzGstNumber');
    });

    it('asks the UK and every EU member for a VAT number', () => {
        // The server sends GB to the GB pack and DE/FR/NL to the shared EU
        // pack; both regimes read `vatNumber`, so one branch covers them all.
        for (const iso2 of ['GB', 'DE', 'FR', 'NL', 'IE', 'ES']) {
            expect(taxIdPromptFor(iso2)?.field).toBe('vatNumber');
        }
    });

    it('asks the US for nothing — it has no company-level tax id', () => {
        expect(taxIdPromptFor('US')).toBeNull();
    });

    it('renders no field until a country is chosen', () => {
        expect(taxIdPromptFor('')).toBeNull();
        expect(taxIdPromptFor(null)).toBeNull();
        expect(taxIdPromptFor(undefined)).toBeNull();
    });

    it('falls back to VAT for an unrecognised code, matching resolvePackCode', () => {
        // resolvePackCode() sends anything it does not know to the GB pack.
        expect(taxIdPromptFor('ZZ')?.field).toBe('vatNumber');
    });

    it('is case- and whitespace-insensitive', () => {
        expect(taxIdPromptFor(' in ')?.field).toBe('gstin');
        expect(taxIdPromptFor('nz')?.field).toBe('nzGstNumber');
    });
});
