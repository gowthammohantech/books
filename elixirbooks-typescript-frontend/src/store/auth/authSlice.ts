import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import axios from "axios";
import Cookies from "js-cookie";
import Constants from "../../constants/api";
import { isTokenExpired } from "../../utils/auth";

export interface AuthState {
    isAuthenticated: boolean;
    user: any;
    token: string | null;
    isLoading: boolean;
    error: string | null;
}

// initial state
const initialState: AuthState = {
    isAuthenticated: false,
    user: null,
    token: "",
    isLoading: false,
    error: null,
};

// --- LOGIN ASYNC ACTION ---
export const loginUser = createAsyncThunk(
    "auth/login",
    async (credentials: { email: string; password: string }, { rejectWithValue }) => {
        try {
            const response = await axios.post(Constants.LOGIN_URL, {
                email: credentials.email,
                password: credentials.password,
            });

            const { token, user } = response.data;

            //  Store securely in cookies (7 days expiry)
            Cookies.set("authToken", token, { secure: window.location.protocol === "https:", sameSite: "Strict", expires: 7 });
            Cookies.set("authUser", JSON.stringify(user), { secure: window.location.protocol === "https:", sameSite: "Strict", expires: 7 });

            return { token, user };
        } catch (error: any) {
            let errorMessage = "Login failed. Please try again.";
            if (axios.isAxiosError(error) && error.response) {
                errorMessage = error.response.data.message || error.response.statusText;
            } else if (error instanceof Error) {
                errorMessage = error.message;
            }
            return rejectWithValue(errorMessage);
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
            state.error = null;

            // Clear cookies
            Cookies.remove("authToken");
            Cookies.remove("authUser");
            Cookies.remove("systemSettings");

            // Defensive: clear stale register/setup state that may linger
            sessionStorage.removeItem("setupStatus");
            localStorage.removeItem("authToken");
            localStorage.removeItem("authUser");
        },
        // Merge a partial update into the logged-in user (e.g. after a profile
        // edit) and refresh the persisted cookie so the change survives reload.
        updateUser: (state, action: PayloadAction<Record<string, any>>) => {
            if (!state.user) return;
            state.user = { ...state.user, ...action.payload };
            Cookies.set("authUser", JSON.stringify(state.user), {
                secure: window.location.protocol === "https:",
                sameSite: "Strict",
                expires: 7,
            });
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
                    Cookies.remove("authToken");
                    Cookies.remove("authUser");
                    return;
                }
                try {
                    state.token = token;
                    state.user = JSON.parse(user);
                    state.isAuthenticated = true;
                } catch (e) {
                    console.error("Failed to parse user data from cookies", e);
                    state.isAuthenticated = false;
                    state.user = null;
                    state.token = "";
                    Cookies.remove("authToken");
                    Cookies.remove("authUser");
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
            .addCase(loginUser.fulfilled, (state, action: PayloadAction<{ token: string; user: any }>) => {
                state.isLoading = false;
                state.isAuthenticated = true;
                state.token = action.payload.token;
                state.user = action.payload.user;
                state.error = null;
            })
            .addCase(loginUser.rejected, (state, action: PayloadAction<any>) => {
                state.isLoading = false;
                state.isAuthenticated = false;
                state.user = null;
                state.token = null;
                state.error = action.payload || "Login failed.";
            });
    },
});

// export actions
export const { logout, initializeAuth, updateUser } = authSlice.actions;

// export reducer
export default authSlice.reducer;
