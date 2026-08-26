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
                const res = await axios.post(Constants.EXTERNAL_SSO_EXCHANGE_URL, { token });
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
                    navigate(`/admin/quotations/create?customer=${contactId ?? ""}`, { replace: true });
                } else if (contactId) {
                    navigate(`/admin/customers?external=${contactId}`, { replace: true });
                } else {
                    navigate("/admin/dashboard", { replace: true });
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: "1rem", fontFamily: "system-ui, sans-serif" }}>
            {error ? (
                <>
                    <h2 style={{ color: "#b91c1c" }}>SSO failed</h2>
                    <p style={{ color: "#6b7280" }}>{error}</p>
                    <a href="/admin/login" style={{ color: "#2563eb" }}>Sign in manually instead</a>
                </>
            ) : (
                <>
                    <div style={{ width: 32, height: 32, border: "3px solid #e5e7eb", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    <p style={{ color: "#6b7280" }}>Signing you in…</p>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </>
            )}
        </div>
    );
};

export default SsoLanding;
