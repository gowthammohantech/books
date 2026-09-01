import { Navigate, Route, Routes } from "react-router-dom";
import { useSelector } from "react-redux";
import AdminRoute from "./AdminRoute";
import AdminLogin from "@pages/admin/auth/AdminLogin";
import AdminRegister from "@pages/admin/auth/AdminRegister";
import AdminLogout from "@pages/admin/auth/AdminLogout";
import SetupOrganizationInfo from "@pages/admin/auth/SetupOrganizationInfo";
import SsoLanding from "@pages/admin/auth/SsoLanding";
import WorkspacePicker from "@pages/admin/auth/WorkspacePicker";
import PublicInvoiceViewer from "@pages/public/PublicInvoiceViewer";
import PublicQuotationViewer from "@pages/public/PublicQuotationViewer";
import { useSetupStatus } from "@context/SetupStatusContext";
import RouteErrorBoundary from "@components/RouteErrorBoundary";
import Seo from "@components/admin/Seo";
import type { RootState } from "@store/index";

/**
 * ONE route tree, not three.
 *
 * This file used to mount one of three entirely different `<Routes>` trees
 * depending on an unauthenticated, install-wide probe: "has any admin
 * registered?" and "does any CompanySettings row exist?". Both questions were
 * about the box rather than about the caller, and neither survives an install
 * that serves more than one company — a fresh workspace signing up would have
 * flipped every existing tenant's browser into the register-only tree.
 *
 * Now the tree is fixed and the gates are per-route:
 *
 *   public       always mounted, no session required, no probe on the way in
 *   /signin      always reachable — the app mounts at the root, so the login
 *                page is a sibling of it rather than a child
 *   /signup      always reachable — signup is public and uncapped
 *   /workspaces  reachable while signed in, and NOT behind the setup gate: an
 *                un-set-up workspace is precisely when you need a way out to a
 *                different one
 *   /setup       reachable while signed in; where an un-set-up workspace lands
 *   /*           the app, redirected to /setup until THIS workspace is set up.
 *                Its own catch-all serves 404s; a second one here would be the
 *                same pattern and would shadow it.
 *
 * The setup question is now per workspace (`companySettingsComplete` from
 * GET /api/auth/session), so switching into a new workspace correctly lands in
 * /setup while the one you came from stays fully set up.
 */
const iframePage = (src: string, title: string) => (
    <iframe
        src={src}
        style={{ width: "100%", height: "100vh", border: "none" }}
        title={title}
    />
);

const AppRoutes = () => {
    const { status, isLoading } = useSetupStatus();
    const { isAuthenticated } = useSelector((state: RootState) => state.auth);

    // Only a signed-IN visitor waits for the session fetch. A signed-out one
    // opening a public invoice link must never be blocked on a call that will
    // not be made — that coupling is what the old boot probe imposed on every
    // visitor, including the customer clicking a payment link.
    if (isAuthenticated && isLoading && !status) return <></>;

    // `status === null` means "not known yet", which must NOT gate: treating
    // unknown as incomplete would bounce a working session into /setup on any
    // transient failure of the session call.
    const needsSetup = isAuthenticated && status !== null && !status.companySettingsComplete;

    const appTree = needsSetup ? <Navigate to="/setup" replace /> : <AdminRoute />;

    return (
        <RouteErrorBoundary>
            <Routes>
                {/* ---- Public: no session, no gate ---- */}
                <Route path="/sso" element={<SsoLanding />} />
                <Route path="/invoice/:token" element={<PublicInvoiceViewer />} />
                <Route path="/quotation/:token" element={<PublicQuotationViewer />} />
                <Route path="/signin" element={<><Seo title="Sign in" /><AdminLogin /></>} />
                <Route path="/signup" element={<><Seo title="Create account" /><AdminRegister /></>} />
                <Route path="/documentation" element={iframePage("/documentation/index.html", "Documentation")} />
                <Route
                    path="/documentation/mobile"
                    element={iframePage("/documentation/mobile/index.html", "Mobile Documentation")}
                />
                <Route path="/landing" element={iframePage("/landing/index.html", "Landing")} />

                {/* ---- Workspace picker: signed in, no workspace context needed ---- */}
            <Route
                path="/workspaces"
                element={
                    isAuthenticated ? (
                        <><Seo title="Choose a company" /><WorkspacePicker /></>
                    ) : (
                        <Navigate to="/signin" replace />
                    )
                }
            />

            {/* ---- Setup: signed in, workspace not yet configured ---- */}
                <Route
                    path="/setup"
                    element={
                        isAuthenticated ? (
                            <><Seo title="Set up your workspace" /><SetupOrganizationInfo /></>
                        ) : (
                            <Navigate to="/signin" replace />
                        )
                    }
                />

                {/* Mounted ahead of the setup gate on purpose: without it, a user
                    whose workspace is mid-setup has no way out of /setup except
                    clearing cookies. */}
                <Route path="/logout" element={<AdminLogout />} />

                {/* ---- The app ---- */}
                <Route path="/*" element={appTree} />
            </Routes>
        </RouteErrorBoundary>
    );
};

export default AppRoutes;
