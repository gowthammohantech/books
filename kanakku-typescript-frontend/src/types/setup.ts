export interface SetupFormData {
    companyName: string;
    address: string;
    country: string;
    state: string;
    city: string;
    pincode: string;
    currencyId: string;
    timezoneId: string;
    dateFormatId: string;
    siteLogo: File | null;
    taxRegime: string;
}

export interface SetupDropdownResponse {
    success: boolean;
    message: string;
    data: {
        currencies: SetupCurrencies[];
        timezones: SetupTimezones[];
        dateFormats: SetupDateFormats[]
    }
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