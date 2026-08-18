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

const AppRoutes = () => {
    const { status, isLoading } = useSetupStatus();

    if (isLoading) return <></>;

    const storedStatus = sessionStorage.getItem("setupStatus");
    const currentStatus = storedStatus
        ? JSON.parse(storedStatus)
        : status;

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
