import Constants from "@constants/api";
import type { SystemSettings } from "@models/system-settings";
import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";
import { assetUrl } from "@utils/assetUrl";

interface SystemSettingsState {
    data: SystemSettings | null
}

const initialState: SystemSettingsState = {
    data: null
}

// Re-base company image URLs onto the reachable API origin. The backend stamps
// absolute URLs from the request host, which behind a proxy can be an internal
// address (e.g. 127.0.0.1:5000) the browser can't load. Doing it here fixes
// every consumer (sidebar, invoice/quotation/PO templates, login) at once, and
// also repairs stale URLs read back from localStorage.
const normalizeSettings = (data: any) => {
    if (data?.company) {
        for (const key of ["siteLogo", "favicon", "companyLogo"] as const) {
            if (data.company[key]) data.company[key] = assetUrl(data.company[key]);
        }
    }
    return data;
};

export const hydrateFromStorage = createAsyncThunk("system/hydrate", async () => {
    const raw = localStorage.getItem("systemSettings");
    if (!raw) return null;
    return normalizeSettings(JSON.parse(raw));
});

export const fetchSystemSettings = createAsyncThunk("system/save", async (token: string) => {
    const response = await axios.get(Constants.FETCH_SYSTEM_SETTINGS_URL, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    const data = normalizeSettings(response.data.data || null);
    if (data) {
        localStorage.setItem("systemSettings", JSON.stringify(data));
    }
    return data;
})

const systemSettingsSlice = createSlice({
    name: "system",
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(hydrateFromStorage.fulfilled, (state, action) => {
                state.data = action.payload;
            })
            .addCase(fetchSystemSettings.fulfilled, (state, action) => {
                state.data = action.payload;
            });
    },
})

export default systemSettingsSlice.reducer;