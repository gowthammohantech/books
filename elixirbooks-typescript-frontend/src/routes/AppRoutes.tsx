import { Navigate, Route, Routes } from "react-router-dom";
import AdminRoute from "./AdminRoute";
import AdminRegister from "@pages/admin/auth/AdminRegister";
import SetupOrganizationInfo from "@pages/admin/auth/SetupOrganizationInfo";
import SsoLanding from "@pages/admin/auth/SsoLanding";
import PublicInvoiceViewer from "@pages/public/PublicInvoiceViewer";
import PublicQuotationViewer from "@pages/public/PublicQuotationViewer";
import { useSetupStatus } from "@context/SetupStatusContext";
import Seo from "@components/admin/Seo";
import NotFound from "@pages/errors/NotFound";

/** Reads the cached setup status, discarding anything unparseable. */
const readStoredSetupStatus = () => {
    const raw = sessionStorage.getItem("setupStatus");
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        // `null` parses fine but destructures to undefined fields downstream.
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        sessionStorage.removeItem("setupStatus");
        return null;
    }
};

const AppRoutes = () => {
    const { status, isLoading } = useSetupStatus();

    if (isLoading) return <></>;

    // Guarded because this parse is unrecoverable when it throws: the whole
    // router fails to render, so the user gets a blank page with no way to
    // clear the bad value short of devtools. A malformed entry is written
    // whenever the setup-status request returns an unexpected shape —
    // JSON.stringify(undefined) yields undefined, which sessionStorage stores
    // as the literal string "undefined". Drop the bad value and fall back.
    const currentStatus = readStoredSetupStatus() ?? status;

    const { new_register, company_settings } = currentStatus;

    // Fully setup -> admin pages only
    if (!new_register && !company_settings) {
        return (
            <Routes>
                <Route path="/" element={<AdminRoute />} />
                <Route path="/sso" element={<SsoLanding />} />
                <Route path="/invoice/:token" element={<PublicInvoiceViewer />} />
                <Route path="/quotation/:token" element={<PublicQuotationViewer />} />
                <Route path="/admin/*" element={<AdminRoute />} />
                <Route
                    path="/documentation"
                    element={
                        <iframe
                            src="/documentation/index.html"
                            style={{ width: "100%", height: "100vh", border: "none" }}
                            title="Documentation"
                        />
                    }
                />
                <Route
                    path="/documentation/mobile"
                    element={
                        <iframe
                            src="/documentation/mobile/index.html"
                            style={{ width: "100%", height: "100vh", border: "none" }}
                            title="Mobile Documentation"
                        />
                    }
                />

                <Route
                    path="/landing"
                    element={
                        <iframe
                            src="/landing/index.html"
                            style={{ width: "100%", height: "100vh", border: "none" }}
                            title="Landing"
                        />
                    }
                />
                <Route path="*" element={<><Seo title="Not Found" /><NotFound /></>} />
            </Routes>
        );
    }

    // User registered but company setup not done -> setup page only
    if (!new_register && company_settings) {
        return (
            <Routes>
                <Route path="/setup" element={<SetupOrganizationInfo />} />
                <Route path="*" element={<Navigate to="/setup" />} />
            </Routes>
        );
    }

    // Fresh install -> register page only
    if (new_register) {
        return (
            <Routes>
                <Route path="/register" element={<AdminRegister />} />
                <Route path="*" element={<Navigate to="/register" />} />
            </Routes>
        );
    }

    return <Navigate to="/register" />;
};

export default AppRoutes;
