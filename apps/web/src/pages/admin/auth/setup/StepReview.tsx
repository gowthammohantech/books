import { SETUP_MODULE_GROUPS } from "@lib/setupModules";
import { taxIdPromptFor } from "@lib/countryTaxId";
import type { SetupCountry, SetupFormData } from "@models/setup";

const BUSINESS_LABEL: Record<string, string> = {
    MANUFACTURING: "Manufacturing",
    TRADING: "Trading / Distribution",
    SERVICES: "Services",
};

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
        <span className="text-[0.8125rem] text-muted-foreground">{label}</span>
        <span className="text-right text-[0.8125rem] font-semibold text-foreground">{value}</span>
    </div>
);

interface StepReviewProps {
    data: SetupFormData;
    countries: SetupCountry[];
}

const StepReview: React.FC<StepReviewProps> = ({ data, countries }) => {
    const country = countries.find((c) => c.id === data.country);
    const taxPrompt = taxIdPromptFor(data.countryIso2);
    const taxValue = taxPrompt ? data[taxPrompt.field].trim() : "";

    // Count what the workspace will actually SEE. A locked group can never be
    // in the list, so this cannot promise a module that does not exist.
    const chosen = SETUP_MODULE_GROUPS.filter(
        (g) => g.available && data.enabledModules.includes(g.key)
    );

    return (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <Row
                label="Business type"
                value={data.businessType ? BUSINESS_LABEL[data.businessType] : "Not set"}
            />
            <Row label="Company" value={data.companyName || "Not set"} />
            <Row
                label="Location"
                value={[data.city, data.state, country?.name].filter(Boolean).join(", ") || "Not set"}
            />
            {taxPrompt && <Row label={taxPrompt.label} value={taxValue || "Not registered"} />}
            <Row
                label="Modules enabled"
                value={`${chosen.length} ${chosen.length === 1 ? "module" : "modules"}`}
            />
        </div>
    );
};

export default StepReview;
