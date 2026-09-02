import { Building2, Warehouse } from "lucide-react";

import SmartDropdown from "@components/admin/SmartDropdown";
import { Badge, FormField } from "@components/ui";
import { taxIdPromptFor } from "@lib/countryTaxId";
import type {
    SetupCountry,
    SetupCurrencies,
    SetupDateFormats,
    SetupFormData,
    SetupState,
    SetupTimezones,
} from "@models/setup";

interface Option {
    id: string;
    name: string;
}

export interface StepCompanyProfileProps {
    data: SetupFormData;
    errors: Record<string, string>;
    onPatch: (patch: Partial<SetupFormData>) => void;

    countries: SetupCountry[];
    countrySearch: string;
    onCountrySearch: (value: string) => void;

    states: SetupState[];
    statesLoading: boolean;

    currencies: SetupCurrencies[];
    timezones: SetupTimezones[];
    dateFormats: SetupDateFormats[];
}

/**
 * A card for something the product cannot do yet.
 *
 * The mockup shows Branches and Warehouses here. There is no Branch or
 * Warehouse model - loadMemberships says so in as many words, and the roadmap
 * has multi-location inventory as unstarted Phase 1 work. Rendering the cards
 * disabled says "this is coming and it is not here", which is true. Rendering
 * them live would collect two lists with nowhere to go.
 */
const ComingSoonCard: React.FC<{
    title: string;
    blurb: string;
    Icon: typeof Building2;
}> = ({ title, blurb, Icon }) => (
    <div className="rounded-xl border border-dashed border-border bg-muted/40 p-4">
        <div className="flex items-center gap-2">
            <Icon size={15} className="text-muted-foreground" aria-hidden />
            <span className="text-[0.8125rem] font-semibold text-muted-foreground">{title}</span>
            <Badge color="gray" variant="soft">
                Coming soon
            </Badge>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{blurb}</p>
    </div>
);

const StepCompanyProfile: React.FC<StepCompanyProfileProps> = ({
    data,
    errors,
    onPatch,
    countries,
    countrySearch,
    onCountrySearch,
    states,
    statesLoading,
    currencies,
    timezones,
    dateFormats,
}) => {
    // Which tax id to ask for follows the COUNTRY, because taxRegime does not
    // exist yet - the server derives it from the country pack when this commits.
    const taxPrompt = taxIdPromptFor(data.countryIso2);

    const currencyOptions: Option[] = currencies.map((c) => ({
        id: c.id,
        name: `${c.name} (${c.symbol})`,
    }));
    const timezoneOptions: Option[] = timezones.map((t) => ({
        id: t.id,
        name: `${t.name} (${t.offset})`,
    }));
    const dateFormatOptions: Option[] = dateFormats.map((d) => ({ id: d.id, name: d.title }));

    const found = (list: Option[], id: string) => list.find((o) => o.id === id) ?? null;

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                        containerClassName="sm:col-span-2"
                        label="Company name"
                        required
                        value={data.companyName}
                        error={errors.companyName}
                        placeholder="Registered name of the business"
                        onChange={(e) => onPatch({ companyName: e.target.value })}
                    />

                    <FormField label="Country" required error={errors.country}>
                        {(field) => (
                            <SmartDropdown
                                {...field}
                                items={countries.map((c) => ({ id: c.id, name: c.name }))}
                                value={countrySearch}
                                onChange={onCountrySearch}
                                onSelect={(item) => {
                                    const picked = countries.find((c) => c.id === item?.id);
                                    onPatch({
                                        country: picked?.id ?? "",
                                        countryIso2: picked?.iso2 ?? "",
                                        // The state list and any tax id already
                                        // typed belong to the OLD country.
                                        stateId: "",
                                        state: "",
                                        gstin: "",
                                        vatNumber: "",
                                        abn: "",
                                        nzGstNumber: "",
                                    });
                                }}
                                placeholder="Search for a country"
                                selectedItem={
                                    countries
                                        .map((c) => ({ id: c.id, name: c.name }))
                                        .find((c) => c.id === data.country) ?? null
                                }
                            />
                        )}
                    </FormField>

                    <FormField label="State" required error={errors.state}>
                        {(field) =>
                            states.length > 0 ? (
                                <SmartDropdown
                                    {...field}
                                    items={states}
                                    value={data.state}
                                    onChange={(value) =>
                                        // Typing is not picking: keep the text so
                                        // the field is usable, drop the id so a
                                        // stale one is never submitted.
                                        onPatch({ state: value, stateId: "" })
                                    }
                                    onSelect={(item) =>
                                        onPatch({
                                            stateId: String(item?.id ?? ""),
                                            state: item?.name ?? "",
                                        })
                                    }
                                    placeholder={
                                        statesLoading ? "Loading states..." : "Search for a state"
                                    }
                                    disabled={!data.country}
                                    loading={statesLoading}
                                    selectedItem={found(states, data.stateId)}
                                    serverside={false}
                                />
                            ) : (
                                // Countries whose states were never imported, and
                                // the moment before a country is chosen.
                                <input
                                    {...field}
                                    type="text"
                                    value={data.state}
                                    disabled={!data.country}
                                    placeholder="State or province"
                                    onChange={(e) => onPatch({ state: e.target.value, stateId: "" })}
                                    className="w-full rounded-md border border-border bg-muted px-3 py-2 text-[0.8125rem] text-foreground outline-none transition-colors min-h-[2.25rem] coarse:min-h-[2.75rem] placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                                />
                            )
                        }
                    </FormField>

                    {taxPrompt && (
                        <FormField
                            label={taxPrompt.label}
                            helper={taxPrompt.hint}
                            placeholder={taxPrompt.placeholder}
                            value={data[taxPrompt.field]}
                            error={errors[taxPrompt.field]}
                            onChange={(e) => onPatch({ [taxPrompt.field]: e.target.value })}
                        />
                    )}

                    <FormField
                        label="City"
                        value={data.city}
                        placeholder="Optional"
                        onChange={(e) => onPatch({ city: e.target.value })}
                    />
                </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <h3 className="text-[0.8125rem] font-semibold text-foreground">Regional</h3>
                <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
                    These set your books up: the country decides your chart of accounts and tax
                    rates.
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <FormField label="Currency" required error={errors.currencyId}>
                        {(field) => (
                            <SmartDropdown
                                {...field}
                                items={currencyOptions}
                                value={data.currencyId}
                                onChange={() => undefined}
                                onSelect={(item) => onPatch({ currencyId: String(item?.id ?? "") })}
                                placeholder="Search currency"
                                selectedItem={found(currencyOptions, data.currencyId)}
                                serverside={false}
                            />
                        )}
                    </FormField>

                    <FormField label="Timezone" required error={errors.timezoneId}>
                        {(field) => (
                            <SmartDropdown
                                {...field}
                                items={timezoneOptions}
                                value={data.timezoneId}
                                onChange={() => undefined}
                                onSelect={(item) => onPatch({ timezoneId: String(item?.id ?? "") })}
                                placeholder="Search timezone"
                                selectedItem={found(timezoneOptions, data.timezoneId)}
                                serverside={false}
                            />
                        )}
                    </FormField>

                    <FormField label="Date format" required error={errors.dateFormatId}>
                        {(field) => (
                            <SmartDropdown
                                {...field}
                                items={dateFormatOptions}
                                value={data.dateFormatId}
                                onChange={() => undefined}
                                onSelect={(item) =>
                                    onPatch({ dateFormatId: String(item?.id ?? "") })
                                }
                                placeholder="Search date format"
                                selectedItem={found(dateFormatOptions, data.dateFormatId)}
                                serverside={false}
                            />
                        )}
                    </FormField>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ComingSoonCard
                    title="Branches"
                    blurb="Multiple locations under one company. Not available yet - you will be able to add them from Settings once branches ship."
                    Icon={Building2}
                />
                <ComingSoonCard
                    title="Warehouses"
                    blurb="Per-location stock and transfers. Not available yet - inventory currently tracks one quantity per item."
                    Icon={Warehouse}
                />
            </div>
        </div>
    );
};

export default StepCompanyProfile;
