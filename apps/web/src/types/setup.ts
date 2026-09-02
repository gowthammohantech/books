import type { BusinessType, SetupModuleKey } from "@elixirbooks/enums";

/**
 * Everything the setup wizard collects across its four steps.
 *
 * Held as ONE object for the whole wizard rather than per step, because the
 * steps are not independent: the business type chosen in step 1 seeds the
 * module ticks in step 3, and the country chosen in step 2 decides which tax
 * identifier step 2 itself asks for.
 */
export interface SetupFormData {
    /** Step 1. Null until chosen — the wizard cannot guess it. */
    businessType: BusinessType | null;

    /** Step 2 — the company. */
    companyName: string;
    /** Country.id. Sent as `country`; the server resolves it to countryId too. */
    country: string;
    /** Country.iso2, kept client-side to pick the tax-id field. Never sent. */
    countryIso2: string;
    /** State.id when picked from the list, '' when the country has no list. */
    stateId: string;
    /** The state's display name. This is what CompanySettings.state stores. */
    state: string;
    city: string;
    pincode: string;
    address: string;

    /** Step 2 — whichever ONE of these the country calls for. */
    gstin: string;
    vatNumber: string;
    abn: string;
    nzGstNumber: string;

    /** Step 2 — regional. All three are required by the server today. */
    currencyId: string;
    timezoneId: string;
    dateFormatId: string;

    /** Step 3. Always includes the `included` groups. */
    enabledModules: SetupModuleKey[];
}

export interface SetupDropdownResponse {
    success: boolean;
    message: string;
    data: {
        currencies: SetupCurrencies[];
        timezones: SetupTimezones[];
        dateFormats: SetupDateFormats[];
    };
}

export interface SetupTimezones {
    id: string;
    name: string;
    offset: string;
}

export interface SetupDateFormats {
    id: string;
    title: string;
    format: string;
}

export interface SetupCurrencies {
    id: string;
    name: string;
    symbol: string;
}

/** `GET /admin/countries` — iso2 was added for the wizard's tax-id field. */
export interface SetupCountry {
    id: string;
    name: string;
    iso2?: string | null;
}

/** `GET /admin/states/:countryId`. */
export interface SetupState {
    id: string;
    name: string;
}
