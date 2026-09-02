import api from '@lib/apiClient';
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import Cookies from "js-cookie";
import { useDispatch } from "react-redux";
import Constants from "@constants/api";
import { initializeAuth } from "@store/auth/authSlice";

// Landing page that completes the whatsappcrm → Elixir Books SSO handshake.
// 1. Reads the short-lived JWT from ?token=
// 2. Exchanges it for an Elixir Books session token via the backend
// 3. Stores authToken/authUser cookies the same way the login flow does
// 4. Redirects to the contact/deal-specific page (if hinted) or the dashboard
const SsoLanding = () => {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const [error, setError] = useState<string | null>(null);
    const exchangedRef = useRef(false);

    useEffect(() => {
        if (exchangedRef.current) return;
        exchangedRef.current = true;

        const token = params.get("token");
        if (!token) {
            setError("Missing SSO token.");
            return;
        }

        (async () => {
            try {
                const res = await api.post(Constants.EXTERNAL_SSO_EXCHANGE_URL, { token });
                const { token: elixirBooksToken, user } = res.data || {};
                if (!elixirBooksToken || !user) {
                    throw new Error("Malformed SSO response.");
                }

                Cookies.set("authToken", elixirBooksToken, { secure: window.location.protocol === "https:", sameSite: "Strict", expires: 7 });
                Cookies.set("authUser", JSON.stringify(user), { secure: window.location.protocol === "https:", sameSite: "Strict", expires: 7 });
                dispatch(initializeAuth());

                const contactId = params.get("contact_id");
                const dealId = params.get("deal_id");
                if (dealId) {
                    navigate(`/quotations/create?customer=${contactId ?? ""}`, { replace: true });
                } else if (contactId) {
                    navigate(`/customers?external=${contactId}`, { replace: true });
                } else {
                    navigate("/dashboard", { replace: true });
                }
            } catch (err: unknown) {
                const message = axios.isAxiosError(err)
                    ? err.response?.data?.message ?? err.message
                    : err instanceof Error ? err.message : "SSO exchange failed.";
                setError(message);
            }
        })();
    }, [params, navigate, dispatch]);

    return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
            {error ? (
                <>
                    <h2 className="text-xl font-semibold text-destructive">SSO failed</h2>
                    <p className="text-sm text-muted-foreground">{error}</p>
                    <a href="/signin" className="text-sm text-primary hover:underline">
                        Sign in manually instead
                    </a>
                </>
            ) : (
                <>
                    <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-border border-t-primary" />
                    <p className="text-sm text-muted-foreground">Signing you in…</p>
                </>
            )}
        </div>
    );
};

export default SsoLanding;
