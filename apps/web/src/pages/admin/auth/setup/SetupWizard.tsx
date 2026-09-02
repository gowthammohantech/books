import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { ArrowLeft, ArrowRight, Loader2Icon } from "lucide-react";
import Cookies from "js-cookie";
import { toast } from "sonner";

import api from "@lib/apiClient";
import Constants from "@constants/api";
import { Button } from "@components/ui";
import { useDebounce } from "@hooks/useDebounce";
import { useSetupStatus } from "@context/SetupStatusContext";
import { fetchSystemSettings } from "@store/systemSettingsSlice";
import type { AppDispatch } from "@store/index";
import { PRESETS, withIncluded } from "@lib/setupModules";
import { taxIdPromptFor } from "@lib/countryTaxId";
import type { BusinessType } from "@elixirbooks/enums";
import type {
    SetupCountry,
    SetupCurrencies,
    SetupDateFormats,
    SetupDropdownResponse,
    SetupFormData,
    SetupState,
    SetupTimezones,
} from "@models/setup";

import SetupStepper, { SETUP_STEPS } from "./SetupStepper";
import StepBusinessType from "./StepBusinessType";
import StepCompanyProfile from "./StepCompanyProfile";
import StepModules from "./StepModules";
import StepReview from "./StepReview";
import { clearDraft, loadDraft, saveDraft } from "./setupDraft";

/**
 * The post-signup setup wizard, mounted at /setup.
 *
 * WHY ONE COMMIT AT THE END. The gate that sends people here is
 * `session().setup.companySettingsComplete`, which is true as soon as the
 * workspace has a named company. Saving step by step would lift that gate
 * midway and let someone into an app whose modules and regional settings had
 * never been chosen, with no way back to finish. Answers survive a refresh via
 * a per-workspace sessionStorage draft instead - see setupDraft.ts.
 *
 * The country still drives the accounting country pack: the PATCH is followed
 * server-side by autoInitLedgerForUser, which seeds the chart of accounts and
 * tax rates. That is why Country, Currency, Timezone and Date format are here
 * even though the mockup omitted them - dropping them would leave the books
 * unseeded.
 */

const EMPTY_FORM: SetupFormData = {
    businessType: null,
    companyName: "",
    country: "",
    countryIso2: "",
    stateId: "",
    state: "",
    city: "",
    pincode: "",
    address: "",
    gstin: "",
    vatNumber: "",
    abn: "",
    nzGstNumber: "",
    currencyId: "",
    timezoneId: "",
    dateFormatId: "",
    enabledModules: [],
};

const SetupWizard: React.FC = () => {
    const token = Cookies.get("authToken") ?? null;
    const dispatch: AppDispatch = useDispatch();
    const { setCompanySettingsComplete } = useSetupStatus();

    const restored = useMemo(() => loadDraft(), []);
    const [step, setStep] = useState(restored?.step ?? 0);
    const [data, setData] = useState<SetupFormData>(restored?.data ?? EMPTY_FORM);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSaving, setIsSaving] = useState(false);

    const [countries, setCountries] = useState<SetupCountry[]>([]);
    const [countrySearch, setCountrySearch] = useState("");
    const debouncedCountrySearch = useDebounce(countrySearch, 300);
    const [states, setStates] = useState<SetupState[]>([]);
    const [statesLoading, setStatesLoading] = useState(false);
    const [currencies, setCurrencies] = useState<SetupCurrencies[]>([]);
    const [timezones, setTimezones] = useState<SetupTimezones[]>([]);
    const [dateFormats, setDateFormats] = useState<SetupDateFormats[]>([]);

    // Keep the draft in step with the form, so a refresh resumes where the
    // person was rather than at step 1 with an empty company name.
    useEffect(() => {
        saveDraft(step, data);
    }, [step, data]);

    useEffect(() => {
        (async () => {
            try {
                const response = await api<SetupDropdownResponse>(
                    Constants.FETCH_SETUP_DROPDOWNS_URL
                );
                const payload = response.data.data;
                setCurrencies(payload.currencies ?? []);
                setTimezones(payload.timezones ?? []);
                setDateFormats(payload.dateFormats ?? []);
            } catch {
                toast.error("Could not load currencies and formats. Refresh to try again.");
            }
        })();
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const response = await api.get<SetupCountry[]>(Constants.FETCH_COUNTRIES_URL, {
                    params: { search: debouncedCountrySearch },
                });
                setCountries(Array.isArray(response.data) ? response.data : []);
            } catch {
                /* non-fatal: leave the previous list in place */
            }
        })();
    }, [debouncedCountrySearch]);

    // States follow the country. An empty list is a legitimate answer (the geo
    // dataset is optional), and the profile step falls back to a text input.
    useEffect(() => {
        if (!data.country) {
            setStates([]);
            return;
        }
        let cancelled = false;
        setStatesLoading(true);
        (async () => {
            try {
                const response = await api.get<SetupState[]>(
                    `${Constants.FETCH_STATES_URL}/${data.country}`
                );
                if (!cancelled) setStates(Array.isArray(response.data) ? response.data : []);
            } catch {
                if (!cancelled) setStates([]);
            } finally {
                if (!cancelled) setStatesLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [data.country]);

    const patch = useCallback((next: Partial<SetupFormData>) => {
        setData((prev) => ({ ...prev, ...next }));
        setErrors((prev) => {
            if (Object.keys(prev).length === 0) return prev;
            const remaining = { ...prev };
            for (const key of Object.keys(next)) delete remaining[key];
            return remaining;
        });
    }, []);

    const chooseBusinessType = (businessType: BusinessType) => {
        patch({ businessType, enabledModules: withIncluded(PRESETS[businessType]) });
    };

    /** Only the current step is validated - a Back button must never be blocked. */
    const validateStep = (index: number): boolean => {
        const found: Record<string, string> = {};
        if (index === 0 && !data.businessType) {
            found.businessType = "Pick the one that fits best.";
        }
        if (index === 1) {
            if (!data.companyName.trim()) found.companyName = "Company name is required.";
            if (!data.country) found.country = "Country is required.";
            if (!data.state.trim()) found.state = "State is required.";
            if (!data.currencyId) found.currencyId = "Currency is required.";
            if (!data.timezoneId) found.timezoneId = "Timezone is required.";
            if (!data.dateFormatId) found.dateFormatId = "Date format is required.";
        }
        setErrors(found);
        if (found.businessType) toast.error(found.businessType);
        return Object.keys(found).length === 0;
    };

    const goNext = () => {
        if (!validateStep(step)) return;
        setStep((s) => Math.min(s + 1, SETUP_STEPS.length - 1));
    };

    const skipModules = () => {
        if (!data.businessType) return;
        patch({ enabledModules: withIncluded(PRESETS[data.businessType]) });
        setStep(SETUP_STEPS.length - 1);
    };

    const handleFinish = async () => {
        if (!validateStep(1)) {
            setStep(1);
            return;
        }
        setIsSaving(true);
        try {
            // JSON, not multipart. The wizard collects no logo (that stays in
            // Settings > Company), and an array cannot survive
            // FormData.append(key, String(value)) - it arrives as "a,b".
            const taxPrompt = taxIdPromptFor(data.countryIso2);
            await api.patch(Constants.UPDATE_COMPANY_SETUP_URL, {
                companyName: data.companyName.trim(),
                country: data.country,
                state: data.state.trim(),
                ...(data.stateId ? { stateId: data.stateId } : {}),
                city: data.city.trim(),
                pincode: data.pincode.trim(),
                address: data.address.trim(),
                currencyId: data.currencyId,
                timezoneId: data.timezoneId,
                dateFormatId: data.dateFormatId,
                businessType: data.businessType,
                enabledModules: data.enabledModules,
                // Only the field this country actually uses.
                ...(taxPrompt ? { [taxPrompt.field]: data[taxPrompt.field].trim() } : {}),
            });

            clearDraft();
            // This workspace now has a named CompanySettings, which is what
            // lifts the /setup gate. Set locally first so the redirect below
            // does not race the next session read.
            setCompanySettingsComplete(true);
            if (token) dispatch(fetchSystemSettings(token));
            toast.success("Workspace ready.");
            // A full reload, deliberately: the sidebar reads enabledModules out
            // of systemSettings, and this guarantees it mounts with them.
            window.location.replace("/dashboard");
        } catch {
            toast.error("Could not save your setup. Please try again.");
            setIsSaving(false);
        }
    };

    const isLast = step === SETUP_STEPS.length - 1;

    return (
        <div className="min-h-dvh bg-background px-4 py-8">
            <div className="mx-auto w-full max-w-3xl">
                <header className="mb-6">
                    <h1 className="text-sm font-semibold text-foreground">Set up your workspace</h1>
                </header>

                <div className="mb-8">
                    <SetupStepper current={step} onJump={setStep} />
                </div>

                <div className="mb-6">
                    <h2 className="text-2xl font-bold tracking-tight text-foreground">
                        {step === 0 && "What kind of business is this?"}
                        {step === 1 && "Company profile"}
                        {step === 2 && "Choose your modules"}
                        {step === 3 && "You're all set"}
                    </h2>
                    <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                        {step === 0 &&
                            "We tailor the menus and modules to match. You can change everything later in Settings."}
                        {step === 1 &&
                            "This workspace's company. Your country sets up the chart of accounts and tax rates."}
                        {step === 2 && (
                            <>
                                Pre-selected for a{" "}
                                <strong className="font-semibold text-foreground">
                                    {data.businessType
                                        ? data.businessType.charAt(0) +
                                          data.businessType.slice(1).toLowerCase()
                                        : "new"}
                                </strong>{" "}
                                business. Toggle anything - this only changes which menus you see,
                                and Settings can change it again later.
                            </>
                        )}
                        {step === 3 && "Review and enter your workspace. Everything here stays editable in Settings."}
                    </p>
                </div>

                {step === 2 && (
                    <div className="mb-4 flex justify-end">
                        <Button variant="white" size="sm" onClick={skipModules}>
                            Skip - use recommended
                        </Button>
                    </div>
                )}

                {step === 0 && (
                    <StepBusinessType value={data.businessType} onChange={chooseBusinessType} />
                )}
                {step === 1 && (
                    <StepCompanyProfile
                        data={data}
                        errors={errors}
                        onPatch={patch}
                        countries={countries}
                        countrySearch={countrySearch}
                        onCountrySearch={setCountrySearch}
                        states={states}
                        statesLoading={statesLoading}
                        currencies={currencies}
                        timezones={timezones}
                        dateFormats={dateFormats}
                    />
                )}
                {step === 2 && (
                    <StepModules
                        value={data.enabledModules}
                        onChange={(enabledModules) => patch({ enabledModules })}
                    />
                )}
                {step === 3 && <StepReview data={data} countries={countries} />}

                <div className="mt-8 flex items-center justify-between gap-3">
                    {step > 0 ? (
                        <Button
                            variant="white"
                            leftIcon={<ArrowLeft size={14} />}
                            onClick={() => setStep((s) => s - 1)}
                            disabled={isSaving}
                        >
                            Back
                        </Button>
                    ) : (
                        <span />
                    )}

                    {isLast ? (
                        <Button
                            onClick={handleFinish}
                            disabled={isSaving}
                            leftIcon={
                                isSaving ? <Loader2Icon size={14} className="animate-spin" /> : undefined
                            }
                            rightIcon={!isSaving ? <ArrowRight size={14} /> : undefined}
                        >
                            {isSaving ? "Setting up..." : "Enter workspace"}
                        </Button>
                    ) : (
                        <Button onClick={goNext} rightIcon={<ArrowRight size={14} />}>
                            Continue
                        </Button>
                    )}
                </div>

                <p className="mt-4 text-center text-xs text-muted-foreground">
                    Your progress is saved on this device until you finish.
                </p>
            </div>
        </div>
    );
};

export default SetupWizard;
