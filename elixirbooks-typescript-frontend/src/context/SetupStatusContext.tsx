import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import axios from "axios";
import Constants from "@constants/api";

interface SetupStatus {
    new_register: boolean;
    company_settings: boolean;
}

interface SetupContextProps {
    status: SetupStatus;
    setStatus: (status: SetupStatus) => void;
    isLoading: boolean;
}

const SetupStatusContext = createContext<SetupContextProps | undefined>(undefined);

export const SetupStatusProvider = ({ children }: { children: ReactNode }) => {
    const [status, setStatus] = useState<SetupStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadStatus = async () => {
            try {
                const stored = sessionStorage.getItem("setupStatus");
                if (stored) {
                    setStatus(JSON.parse(stored));
                } else {
                    const response = await axios.get(Constants.APP_VERSION_URL);
                    setStatus(response.data.data);
                    sessionStorage.setItem("setupStatus", JSON.stringify(response.data.data));
                }
            } catch (e) {
                console.error("Failed to load setup status", e);
            } finally {
                setIsLoading(false);
            }
        };
        loadStatus();
    }, []);

    // Keep sessionStorage synced with state
    useEffect(() => {
        if (status) sessionStorage.setItem("setupStatus", JSON.stringify(status));
    }, [status]);

    return (
        <SetupStatusContext.Provider value={{ status: status || { new_register: true, company_settings: true }, setStatus: status => setStatus(status), isLoading }}>
            {children}
        </SetupStatusContext.Provider>
    );
};

export const useSetupStatus = () => {
    const context = useContext(SetupStatusContext);
    if (!context) throw new Error("useSetupStatus must be used within SetupStatusProvider");
    return context;
};
