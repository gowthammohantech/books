import { useSelector } from "react-redux";
import { resolveCompanyLogo } from "@utils/companyLogo";
import type { RootState } from "@store/index";

interface BottomBarProps {
    isSidebarOpen: boolean;
}

/**
 * Sidebar footer: shows which company the user is currently working in.
 * Collapses to the logo alone when the sidebar is narrow.
 */
const BottomBar: React.FC<BottomBarProps> = ({ isSidebarOpen }) => {
    const { data: systemSettings } = useSelector(
        (state: RootState) => state.systemSettings
    );
    const company = systemSettings?.company;
    const companyName = company?.companyName?.trim();
    const logoSrc = resolveCompanyLogo(company?.companyLogo || company?.favicon);

    return (
        <div className="bg-gray-50 border-t border-gray-200 px-3 py-3">
            <div
                className={`flex items-center ${isSidebarOpen ? "" : "justify-center"
                    }`}
            >
                <img
                    src={logoSrc}
                    alt={companyName || "Company logo"}
                    title={!isSidebarOpen ? companyName : undefined}
                    className="h-8 w-8 shrink-0 rounded-md border border-gray-200 bg-white object-contain p-0.5"
                />
                {companyName && (
                    <span
                        className={`ml-2 break-words text-sm font-medium leading-tight text-gray-800 transition-opacity duration-300 ${isSidebarOpen ? "opacity-100" : "hidden opacity-0"
                            }`}
                    >
                        {companyName}
                    </span>
                )}
            </div>
        </div>
    );
};

export default BottomBar;
