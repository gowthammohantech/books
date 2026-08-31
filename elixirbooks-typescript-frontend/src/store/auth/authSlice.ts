import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import axios from "axios";
import Cookies from "js-cookie";
import Constants from "../../constants/api";
import { isTokenExpired } from "../../utils/auth";
import { purgeTenantScoped, parseStored } from "../../utils/tenantStorage";
import type { ActiveTenant, TenantSummary } from "../../types/tenant";
import type { RegisterFormData } from "../../types/register";

const cookieOptions = {
    secure: window.location.protocol === "https:",
    sameSite: "Strict" as const,
    expires: 7,
};

export interface AuthState {
    isAuthenticated: boolean;
    user: any;
    token: string | null;
    /** The workspace this token is scoped to. Null before login. */
    activeTenant: ActiveTenant | null;
    /**
     * Every workspace this person can act in. NOT cookied — it is unbounded in
     * size and a cookie is sent on every request. Re-read from
     * GET /api/auth/session on boot, which is one call and always current.
     */
    memberships: TenantSummary[];
    isLoading: boolean;
    isSwitchingTenant: boolean;
    error: string | null;
}

// initial state
const initialState: AuthState = {
    isAuthenticated: false,
    user: null,
    token: "",
    activeTenant: null,
    memberships: [],
    isLoading: false,
    isSwitchingTenant: false,
    error: null,
};

/** Persist a freshly minted token and the workspace it belongs to, together. */
function persistSession(token: string, user: unknown, tenant: ActiveTenant | null) {
    Cookies.set("authToken", token, cookieOptions);
    Cookies.set("authUser", JSON.stringify(user), cookieOptions);
    if (tenant) Cookies.set("activeTenant", JSON.stringify(tenant), cookieOptions);
}

/** Drop every trace of the session. Shared by logout and by boot-time rejection. */
function clearSession() {
    Cookies.remove("authToken");
    Cookies.remove("authUser");
    Cookies.remove("activeTenant");
    // `systemSettings` was removed here as a COOKIE, but systemSettingsSlice
    // writes it to localStorage — so logout never actually cleared it. That was
    // already a stale-data bug; with more than one workspace on the machine it
    // would be one company's branding, currency and PERMISSION SET surviving
    // into another company's session. purgeTenantScoped drops the real thing.
    purgeTenantScoped();
    // Defensive: pre-namespace keys, and stray copies some older builds wrote
    // to localStorage instead of cookies.
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");
    localStorage.removeItem("systemSettings");
    sessionStorage.removeItem("setupStatus");
}

/** The shape login / register / switch-tenant / create-tenant all return. */
interface SessionResponse {
    token: string;
    user?: any;
    tenant?: ActiveTenant | null;
    memberships?: TenantSummary[];
}

function readError(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error) && error.response) {
        return error.response.data?.message || error.response.statusText || fallback;
    }
    if (error instanceof Error) return error.message;
    return fallback;
}

// --- LOGIN ASYNC ACTION ---
export const loginUser = createAsyncThunk(
    "auth/login",
    async (credentials: { email: string; password: string }, { rejectWithValue }) => {
        try {
            const response = await axios.post(Constants.LOGIN_URL, {
                email: credentials.email,
                password: credentials.password,
            });

            const { token, user, tenant, memberships } = response.data as SessionResponse;

            //  Store securely in cookies (7 days expiry)
            persistSession(token, user, tenant ?? null);

            return {
                token,
                user,
                tenant: tenant ?? null,
                memberships: memberships ?? [],
            };
        } catch (error: any) {
            return rejectWithValue(readError(error, "Login failed. Please try again."));
        }
    }
);

/**
 * Sign up: creates the person AND their first workspace in one call.
 *
 * There is no longer an "an admin already exists, registration is closed" path
 * — that cap is what made an install single-tenant. `companyName` is the new
 * required field: it names the workspace being created, which previously had
 * no name because there was only ever one.
 */
export const registerUser = createAsyncThunk(
    "auth/register",
    // The whole form goes to the server, `confirmPassword` included: the
    // backend validator re-checks that the two passwords match rather than
    // trusting the client to have done it.
    async (form: RegisterFormData, { rejectWithValue }) => {
        try {
            const response = await axios.post(Constants.REGISTER_URL, form);
            const data = response.data as SessionResponse;
            persistSession(data.token, data.user, data.tenant ?? null);
            return {
                token: data.token,
                user: data.user,
                tenant: data.tenant ?? null,
                memberships: data.memberships ?? [],
            };
        } catch (error: unknown) {
            return rejectWithValue(readError(error, "Could not create your account."));
        }
    }
);

/**
 * Move the session to another of the caller's workspaces.
 *
 * THE HARD RELOAD IS DELIBERATE. There are ~585 bare `axios` call sites across
 * ~204 files and no shared instance, so there is no interceptor seam at which
 * in-flight requests could be cancelled or re-based. Surgically invalidating
 * caches would leave whichever requests were already on the wire to resolve
 * into components that now believe they are showing a different company —
 * which is precisely the failure this whole phase exists to prevent. A reload
 * is the only honest way to purge 200+ modules of component state plus the
 * react-query cache, and it also guarantees the new cookie is in place before
 * any request fires.
 */
export const switchTenant = createAsyncThunk(
    "auth/switchTenant",
    async (tenantId: string, { rejectWithValue }) => {
        try {
            const token = Cookies.get("authToken");
            const response = await axios.post(
                Constants.SWITCH_TENANT_URL,
                { tenantId },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            const data = response.data as SessionResponse;

            // Drop every OTHER workspace's cached data before the reload. Doing
            // it here rather than after the reload means the new page never sees
            // the old workspace's values, not even for one render.
            purgeTenantScoped(data.tenant?.id ?? tenantId);

            const user = parseStored<unknown>(Cookies.get("authUser"));
            persistSession(data.token, user, data.tenant ?? null);

            return { token: data.token, tenant: data.tenant ?? null, memberships: data.memberships ?? [] };
        } catch (error: unknown) {
            return rejectWithValue(readError(error, "Could not switch workspace."));
        }
    }
);

/** Create an additional workspace owned by the signed-in user. */
export const createTenant = createAsyncThunk(
    "auth/createTenant",
    async (companyName: string, { rejectWithValue }) => {
        try {
            const token = Cookies.get("authToken");
            const response = await axios.post(
                Constants.CREATE_TENANT_URL,
                { companyName },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            const data = response.data as SessionResponse;

            purgeTenantScoped(data.tenant?.id ?? null);
            const user = parseStored<unknown>(Cookies.get("authUser"));
            persistSession(data.token, user, data.tenant ?? null);

            return { token: data.token, tenant: data.tenant ?? null, memberships: data.memberships ?? [] };
        } catch (error: unknown) {
            return rejectWithValue(readError(error, "Could not create workspace."));
        }
    }
);

// --- SLICE ---
export const authSlice = createSlice({
    name: "auth",
    initialState,
    reducers: {
        logout: (state) => {
            state.isAuthenticated = false;
            state.user = null;
            state.token = null;
            state.activeTenant = null;
            state.memberships = [];
            state.error = null;

            clearSession();
        },
        // Merge a partial update into the logged-in user (e.g. after a profile
        // edit) and refresh the persisted cookie so the change survives reload.
        updateUser: (state, action: PayloadAction<Record<string, any>>) => {
            if (!state.user) return;
            state.user = { ...state.user, ...action.payload };
            Cookies.set("authUser", JSON.stringify(state.user), cookieOptions);
        },
        /**
         * Refresh the workspace list and the active workspace from
         * GET /api/auth/session. Memberships change out of band — someone is
         * invited to a second company, or removed from one — so the session
         * response is the authority, not the cookie written at login.
         */
        setSessionContext: (
            state,
            action: PayloadAction<{ tenant: ActiveTenant | null; memberships: TenantSummary[] }>
        ) => {
            state.activeTenant = action.payload.tenant;
            state.memberships = action.payload.memberships;
            if (action.payload.tenant) {
                Cookies.set("activeTenant", JSON.stringify(action.payload.tenant), cookieOptions);
            }
        },
        initializeAuth: (state) => {
            //  Read from cookies
            const token = Cookies.get("authToken");
            const user = Cookies.get("authUser");

            if (token && user) {
                // Reject expired or invalid tokens immediately at boot
                if (isTokenExpired(token)) {
                    state.isAuthenticated = false;
                    state.user = null;
                    state.token = "";
                    state.activeTenant = null;
                    state.memberships = [];
                    clearSession();
                    return;
                }
                try {
                    state.token = token;
                    state.user = JSON.parse(user);
                    state.isAuthenticated = true;
                    // Best-effort: the authoritative copy arrives with the
                    // session fetch a moment later. Having it now avoids a
                    // frame where the header shows no workspace name.
                    state.activeTenant = parseStored<ActiveTenant>(Cookies.get("activeTenant"));
                } catch (e) {
                    console.error("Failed to parse user data from cookies", e);
                    state.isAuthenticated = false;
                    state.user = null;
                    state.token = "";
                    state.activeTenant = null;
                    clearSession();
                }
            }
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(loginUser.pending, (state) => {
                state.isLoading = true;
                state.error = null;
            })
            .addCase(loginUser.fulfilled, (state, action) => {
                state.isLoading = false;
                state.isAuthenticated = true;
                state.token = action.payload.token;
                state.user = action.payload.user;
                state.activeTenant = action.payload.tenant;
                state.memberships = action.payload.memberships;
                state.error = null;
            })
            .addCase(loginUser.rejected, (state, action: PayloadAction<any>) => {
                state.isLoading = false;
                state.isAuthenticated = false;
                state.user = null;
                state.token = null;
                state.activeTenant = null;
                state.memberships = [];
                state.error = action.payload || "Login failed.";
            })
            // Registration signs the new user straight in — same state
            // transition as a login, so it shares login's reducers.
            .addCase(registerUser.pending, (state) => {
                state.isLoading = true;
                state.error = null;
            })
            .addCase(registerUser.fulfilled, (state, action) => {
                state.isLoading = false;
                state.isAuthenticated = true;
                state.token = action.payload.token;
                state.user = action.payload.user;
                state.activeTenant = action.payload.tenant;
                state.memberships = action.payload.memberships;
                state.error = null;
            })
            .addCase(registerUser.rejected, (state, action: PayloadAction<any>) => {
                state.isLoading = false;
                state.error = action.payload || "Could not create your account.";
            })
            .addCase(switchTenant.pending, (state) => {
                state.isSwitchingTenant = true;
                state.error = null;
            })
            .addCase(switchTenant.fulfilled, (state, action) => {
                state.isSwitchingTenant = false;
                state.token = action.payload.token;
                state.activeTenant = action.payload.tenant;
                state.memberships = action.payload.memberships;
            })
            .addCase(switchTenant.rejected, (state, action: PayloadAction<any>) => {
                // Stay in the current workspace: the token was never replaced,
                // so the session is still coherent.
                state.isSwitchingTenant = false;
                state.error = action.payload || "Could not switch workspace.";
            })
            .addCase(createTenant.pending, (state) => {
                state.isSwitchingTenant = true;
                state.error = null;
            })
            .addCase(createTenant.fulfilled, (state, action) => {
                state.isSwitchingTenant = false;
                state.token = action.payload.token;
                state.activeTenant = action.payload.tenant;
                state.memberships = action.payload.memberships;
            })
            .addCase(createTenant.rejected, (state, action: PayloadAction<any>) => {
                state.isSwitchingTenant = false;
                state.error = action.payload || "Could not create workspace.";
            });
    },
});

// export actions
export const { logout, initializeAuth, updateUser, setSessionContext } = authSlice.actions;

// export reducer
export default authSlice.reducer;
