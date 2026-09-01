import api from '@lib/apiClient';
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";

import { useDispatch, useSelector } from "react-redux";
import Constants from "@constants/api";
import type { RootState } from "@store/index";
import { setSessionContext } from "@store/auth/authSlice";
import { currentTenantId, tenantSession } from "@utils/tenantStorage";
import type { SessionPayload } from "@models/tenant";

/**
 * WHAT CHANGED, AND WHY.
 *
 * This context used to ask the INSTALL a global question on boot, without
 * authenticating: `GET /api/admin/app-version` counted every `user_type:1` user
 * and every CompanySettings row on the box, and the answer picked one of three
 * entire route trees. Neither half of that question survives multi-tenancy —
 * "has the admin registered?" is meaningless when there are fifty admins, and
 * "is company setup done?" has a different answer per workspace.
 *
 * The replacement is `GET /api/auth/session`: the same questions asked per
 * session, behind auth, about the workspace the caller's token names. It also
 * carries the workspace list, which is how the tenant switcher learns what it
 * can offer — one call rather than two.
 *
 * Signed out, there is no question to ask and therefore NO GATE AT ALL. That is
 * the point of the change: the old code could not render a public page without
 * first deciding what kind of install this was.
 */
export interface SetupStatus {
    /** Has THIS workspace been through /setup? */
    companySettingsComplete: boolean;
}

interface SetupContextProps {
    /** Null while signed out or not yet known — callers must not gate on false. */
    status: SetupStatus | null;
    isLoading: boolean;
    /** Re-read the session (after /setup completes, or after a switch). */
    refresh: () => Promise<void>;
    /** Optimistic local update so /setup can navigate without a round trip. */
    setCompanySettingsComplete: (complete: boolean) => void;
}

const SetupStatusContext = createContext<SetupContextProps | undefined>(undefined);

const CACHE_KEY = "setupStatus";

export const SetupStatusProvider = ({ children }: { children: ReactNode }) => {
    const dispatch = useDispatch();
    const { token, isAuthenticated } = useSelector((state: RootState) => state.auth);

    // Seed from the cache so an authenticated reload does not flash the gate.
    const [status, setStatus] = useState<SetupStatus | null>(() => {
        const tenantId = currentTenantId();
        return tenantId ? tenantSession.getJson<SetupStatus>(tenantId, CACHE_KEY) : null;
    });
    const [isLoading, setIsLoading] = useState<boolean>(!!token);

    // A ref, not state: the effect must not re-run when it changes.
    const lastFetchedFor = useRef<string | null>(null);

    const load = useCallback(async () => {
        const authToken = token;
        if (!authToken) {
            setStatus(null);
            setIsLoading(false);
            return;
        }
        try {
            const response = await api.get(Constants.SESSION_URL);
            const data: SessionPayload | undefined = response.data?.data;
            if (!data || typeof data !== "object") {
                // Answered by something other than the API — a dev server
                // returning index.html, a proxy error page. Cache nothing:
                // JSON.stringify(undefined) is `undefined`, which Storage
                // coerces to the string "undefined" and poisons the session.
                console.error("Unexpected session payload", response.data);
                return;
            }

            const next: SetupStatus = {
                companySettingsComplete: !!data.setup?.companySettingsComplete,
            };
            setStatus(next);

            const tenantId = data.tenant?.id ?? currentTenantId();
            if (tenantId) tenantSession.setJson(tenantId, CACHE_KEY, next);

            // One fetch, two consumers: the gate below and the workspace
            // switcher in the header. Memberships change out of band (an
            // invite, a removal), so this response is the authority.
            dispatch(
                setSessionContext({
                    tenant: data.tenant ?? null,
                    memberships: data.memberships ?? [],
                })
            );
        } catch (e) {
            // A 401 is already handled globally by the axios interceptor in
            // main.tsx, which logs out and bounces to login. Anything else
            // leaves `status` as it was: the gate stays closed rather than
            // guessing, and the error boundary above the router catches a
            // genuine render failure.
            console.error("Failed to load session", e);
        } finally {
            setIsLoading(false);
        }
    }, [token, dispatch]);

    useEffect(() => {
        if (!token) {
            lastFetchedFor.current = null;
            setStatus(null);
            setIsLoading(false);
            return;
        }
        // Refetch when the TOKEN changes, which is exactly when the workspace
        // may have changed. (A switch also reloads the page, so in practice
        // this fires on a fresh boot; it also covers login without a reload.)
        if (lastFetchedFor.current === token) return;
        lastFetchedFor.current = token;
        setIsLoading(true);
        void load();
    }, [token, load]);

    const setCompanySettingsComplete = useCallback((complete: boolean) => {
        const next = { companySettingsComplete: complete };
        setStatus(next);
        const tenantId = currentTenantId();
        if (tenantId) tenantSession.setJson(tenantId, CACHE_KEY, next);
    }, []);

    const value = useMemo(
        () => ({
            status: isAuthenticated ? status : null,
            isLoading,
            refresh: load,
            setCompanySettingsComplete,
        }),
        [isAuthenticated, status, isLoading, load, setCompanySettingsComplete]
    );

    return (
        <SetupStatusContext.Provider value={value}>{children}</SetupStatusContext.Provider>
    );
};

export const useSetupStatus = () => {
    const context = useContext(SetupStatusContext);
    if (!context) throw new Error("useSetupStatus must be used within SetupStatusProvider");
    return context;
};
