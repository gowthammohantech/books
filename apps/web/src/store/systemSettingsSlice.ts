import api from '@lib/apiClient';
import Constants from "@constants/api";
import type { SystemSettings } from "@models/system-settings";
import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

import { assetUrl } from "@utils/assetUrl";
import { currentTenantId, tenantLocal } from "@utils/tenantStorage";

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
// also repairs stale URLs read back from storage.
const normalizeSettings = (data: any) => {
    if (data?.company) {
        for (const key of ["siteLogo", "favicon", "companyLogo"] as const) {
            if (data.company[key]) data.company[key] = assetUrl(data.company[key]);
        }
    }
    return data;
};

/**
 * These settings are PER WORKSPACE — company name, logo, tax regime, default
 * currency and the caller's permission set all differ between them. Cached
 * under the workspace's own key so a person who belongs to two companies can
 * never be served one company's branding over the other's data, and never a
 * permission set their membership here does not grant.
 *
 * No tenant (signed out, or a token with no claim) means no cache to read:
 * returning null makes the caller fetch, which is the safe direction.
 */
export const hydrateFromStorage = createAsyncThunk("system/hydrate", async () => {
    const tenantId = currentTenantId();
    if (!tenantId) return null;
    return normalizeSettings(tenantLocal.getJson<SystemSettings>(tenantId, "systemSettings"));
});

export const fetchSystemSettings = createAsyncThunk("system/save", async () => {
    const response = await api.get(Constants.FETCH_SYSTEM_SETTINGS_URL);

    const data = normalizeSettings(response.data.data || null);
    // Key the cache by the workspace the TOKEN names, not by whatever redux
    // currently believes: the token is what the backend actually scoped this
    // response by, so it is the only id under which the response is true.
    const tenantId = currentTenantId();
    if (data && tenantId) {
        tenantLocal.setJson(tenantId, "systemSettings", data);
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