import React, { useEffect, useMemo, useState } from 'react';
import { Info, Image as ImageIcon, MapPin, Landmark, ListChecks } from 'lucide-react';
import ImageCropperUpload from '@components/common/ImageCropperUpload';
import axios from 'axios';
import Constants from '@constants/api';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@store/index';
import SearchableDropdown from '@components/admin/SearchableDropdown';
import debounce from 'lodash/debounce';
import { toast } from "sonner";
import { fetchSystemSettings } from '@store/systemSettingsSlice';
import { useNavigate } from 'react-router-dom';
import SubmitButton from '@components/admin/SubmitButton';
import { hasPermission } from '@utils/hasPermission';
import { isValidPhone, PHONE_ERROR } from '@elixirbooks/validation';
import { Button, Card, FormField, Select } from '@components/ui';
import Switch from '@components/admin/Switch';
import { PageHeader } from '@/context/PageHeaderContext';

type OptionType = {
    id: string;
    name: string;
}

interface CompanyFormData {
    companyName: string;
    email: string;
    phone: string;
    address: string;
    /** Plain free-text city — no cityId FK, no City lookup table involved. */
    city: string | null;
    state: string | null;
    /** stateId mirrors state — the FK column added by Task 1 for tax-engine lookups.
     * Null when `state` holds free-typed text (no real option picked) so the backend
     * never receives a bogus FK. */
    stateId: string | null;
    country: string | null;
    /** countryId mirrors country — same FK/free-text contract as stateId above. */
    countryId: string | null;
    pincode: string;
    siteLogo: File | null;
    siteLogo_preview_url?: string | null;
    favicon: File | null;
    favicon_preview_url?: string | null;
    companyLogo: File | null;
    companyLogo_preview_url?: string | null;
    fax: string;
    publicBaseUrl: string;
    merchantUpiId: string;
    merchantName: string;
    userId: string | null;
    // Tax identifiers (per tenant tax regime — see Task 7 tax packs)
    taxRegime: string;
    gstin: string;        // India GST identifier
    vatNumber: string;    // UK / EU VAT number
    abn: string;          // Australia Business Number
    nzGstNumber: string;  // New Zealand GST number
    // EU options (VAT_EU regime)
    ossRegistered: boolean;          // Registered for EU OSS (destination-rate VAT on B2C cross-border)
    viesValidationEnabled: boolean;  // Validate EU VAT numbers online via VIES (off by default, fails open)
    // Banking — when on, near-certain bank matches post straight to the ledger,
    // bypassing the approval queue (CompanySettings.bankAutoPostEnabled, default false).
    bankAutoPostEnabled: boolean;
    // Item Picker Display — controls which fields show in the invoice item-picker dropdown.
    itemPickerShowRate: boolean;
    itemPickerShowStock: boolean;
    itemPickerShowImage: boolean;
}

const InitialCompanyFormData: CompanyFormData = {
    companyName: '',
    email: '',
    phone: '',
    address: '',
    city: null,
    state: null,
    stateId: null,
    country: null,
    countryId: null,
    pincode: '',
    siteLogo: null,
    siteLogo_preview_url: null,
    favicon: null,
    favicon_preview_url: null,
    companyLogo: null,
    companyLogo_preview_url: null,
    fax: '',
    publicBaseUrl: '',
    merchantUpiId: '',
    merchantName: '',
    userId: null,
    taxRegime: 'NONE',
    gstin: '',
    vatNumber: '',
    abn: '',
    nzGstNumber: '',
    ossRegistered: false,
    viesValidationEnabled: false,
    bankAutoPostEnabled: false,
    itemPickerShowRate: true,
    itemPickerShowStock: true,
    itemPickerShowImage: false,
};
const CompanySettings: React.FC = () => {
    const [companyFormData, setCompanyFormData] = useState<CompanyFormData>(InitialCompanyFormData);
    //state for dropdown options
    const [countries, setCountries] = useState<OptionType[]>([]);
    const [states, setStates] = useState<OptionType[]>([]);

    //state for dropdown search
    const [countryInput, setCountryInput] = useState<string>('');
    const [stateInput, setStateInput] = useState<string>('');

    //state for loading indicators
    const [loadingCountries, setLoadingCountries] = useState(false);
    const [loadingStates, setLoadingStates] = useState(false);

    //state for selected options — may hold free-typed text (string) once freeSolo is on
    const [selectedCountry, setSelectedCountry] = useState<OptionType | string | null>(null);
    const [selectedState, setSelectedState] = useState<OptionType | string | null>(null);

    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const { token, user } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const dispatch: AppDispatch = useDispatch();
    const navigate = useNavigate();
    //update userid on mount
    useEffect(() => {
        setCompanyFormData(prev => ({ ...prev, userId: user.id }));
    }, [user]);

    useEffect(() => {
        fetchCompanySettings();
    }, []);

    const fetchCompanySettings = async () => {
        try {
            const response = await axios.get(`${Constants.FETCH_COMPANY_SETTINGS_URL}/${user.id}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const stateIdValue = response.data.data.stateId ?? (response.data.data.state ? response.data.data.state.id : null);
            const countryIdValue = response.data.data.countryId ?? (response.data.data.country ? response.data.data.country.id : null);
            setCompanyFormData(prev => ({
                ...prev,
                ...response.data.data,
                country: response.data.data.country ? response.data.data.country.id : null,
                countryId: countryIdValue,
                state: response.data.data.state ? response.data.data.state.id : null,
                stateId: stateIdValue,
                // city is a plain free-text column — no relation object, use the string as-is.
                city: response.data.data.city ?? '',
                publicBaseUrl: response.data.data.publicBaseUrl ?? '',
                merchantUpiId: response.data.data.merchantUpiId ?? '',
                merchantName: response.data.data.merchantName ?? '',
                taxRegime: response.data.data.taxRegime ?? 'NONE',
                gstin: response.data.data.gstin ?? '',
                vatNumber: response.data.data.vatNumber ?? '',
                abn: response.data.data.abn ?? '',
                nzGstNumber: response.data.data.nzGstNumber ?? '',
                ossRegistered: response.data.data.ossRegistered ?? false,
                viesValidationEnabled: response.data.data.viesValidationEnabled ?? false,
                bankAutoPostEnabled: response.data.data.bankAutoPostEnabled ?? false,
                itemPickerShowRate: response.data.data.itemPickerShowRate ?? true,
                itemPickerShowStock: response.data.data.itemPickerShowStock ?? true,
                itemPickerShowImage: response.data.data.itemPickerShowImage ?? false,
                siteLogo: null,
                siteLogo_preview_url: response.data.data.siteLogo,
                favicon: null,
                favicon_preview_url: response.data.data.favicon,
                companyLogo: null,
                companyLogo_preview_url: response.data.data.companyLogo
            }));
            //if country available then set it
            if (response.data.data.country) {
                const countryRes = await axios.get(`${Constants.FETCH_COUNTRY_URL}/${response.data.data.country.id}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                const countryData = countryRes.data;
                const countryObject = { id: countryData.id, name: countryData.name };

                setSelectedCountry(countryObject);
            }
            //if state available then set it
            if (response.data.data.state) {
                const stateRes = await axios.get(`${Constants.FETCH_STATE_URL}/${response.data.data.state.id}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                const stateData = stateRes.data;
                const stateObject = { id: stateData.id, name: stateData.name };
                setSelectedState(stateObject);
            }
        } catch (error) {
            console.error('Error fetching company settings:', error);
        }
    }
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setCompanyFormData(prev => ({ ...prev, [name]: value }));
    }

    const handleDropdownChange = (fieldName: 'country' | 'state', value: OptionType | string | null) => {
        // Free-typed text (freeSolo commit) has no backing id — store it in the plain
        // field for display, but leave the FK field (countryId/stateId) unset so the
        // backend never receives a bogus id. A real option keeps id flowing into both.
        const isFreeText = typeof value === 'string';
        const displayValue = isFreeText ? value : (value ? value.id : null);
        const idValue = isFreeText ? null : (value ? value.id : null);

        if (fieldName === 'country') {
            setSelectedCountry(value);
            setCompanyFormData(prev => ({ ...prev, country: displayValue, countryId: idValue }));
            // Reset children when parent changes
            setSelectedState(null);
            setCompanyFormData(prev => ({ ...prev, state: null, stateId: null, city: '' }));
            setStates([]);
        }
        if (fieldName === 'state') {
            setSelectedState(value);
            // Keep stateId in sync — mirrors the state FK for the tax engine
            setCompanyFormData(prev => ({ ...prev, state: displayValue, stateId: idValue }));
            // Reset child when parent changes
            setCompanyFormData(prev => ({ ...prev, city: '' }));
        }
    };

    const fetchCountries = async (searchTerm?: string) => {
        try {
            setLoadingCountries(true);
            const response = await axios.get(Constants.FETCH_COUNTRIES_URL, {
                params: { search: searchTerm },
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const transformedCountries = response.data.map((country: any) => ({
                id: String(country.id),
                name: country.name
            }));

            setCountries(transformedCountries);
        } catch (error) {
            console.error('Error fetching countries:', error);
        } finally {
            setLoadingCountries(false);
        }
    }

    const debouncedFetchCountries = useMemo(() => debounce(fetchCountries, 500), [token]);

    const fetchStates = async (countryId: string, searchTerm?: string) => {

        try {
            setLoadingStates(true);
            const response = await axios.get(`${Constants.FETCH_STATES_URL}/${countryId}`, {
                params: { search: searchTerm },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const transformedStates = response.data.map((state: any) => ({
                id: String(state.id),
                name: state.name
            }));
            setStates(transformedStates);
        } catch (error) {
            console.error('Error fetching states:', error);
        } finally {
            setLoadingStates(false);
        }
    }

    const debouncedFetchStates = useMemo(() => debounce(fetchStates, 500), [token]);

    useEffect(() => {
        debouncedFetchCountries(countryInput);
        return () => debouncedFetchCountries.cancel();
    }, [countryInput, debouncedFetchCountries]);

    useEffect(() => {
        if (companyFormData.country) {
            debouncedFetchStates(String(companyFormData.country), stateInput);
        }
        return () => debouncedFetchStates.cancel();
    }, [companyFormData.country, stateInput, debouncedFetchStates]);

    const validateCompanyForm = () => {
        const errors: { [key: string]: string } = {};

        if (!companyFormData.companyName) {
            errors.companyName = 'Company name is required';
        } else if (companyFormData.companyName.length < 3) {
            errors.companyName = 'Company name must be at least 3 characters';
        } else if (companyFormData.companyName.length > 50) {
            errors.companyName = 'Company name must be less than 50 characters';
        }

        // email
        if (!companyFormData.email) {
            errors.email = 'Email is required';
        } else if (!emailRegex.test(companyFormData.email)) {
            errors.email = 'Email is invalid';
        }

        // phone — optional, but validate format when provided. Address/contact
        // fields are optional so a logo-only (partial) save can go through.
        if (companyFormData.phone && !isValidPhone(companyFormData.phone)) {
            errors.phone = PHONE_ERROR;
        }

        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            return false;
        }
        setFormErrors({});
        return true;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateCompanyForm()) return;

        try {
            setIsSaving(true);
            const formData = new FormData();
            Object.entries(companyFormData).forEach(([key, value]) => {
                if (value === null || value === undefined) return;
                if (value instanceof File) {
                    formData.append(key, value);
                } else if (!key.endsWith("_preview_url")) {
                    formData.append(key, value as string);
                }
            });

            // countryId/stateId (used by the ledger auto-init to pick the chart-of-accounts
            // pack) are plain top-level companyFormData keys, so the generic loop above
            // already appends them — and skips them when null (free-typed country/state
            // with no real option picked), which is exactly what avoids an FK violation.

            await axios.put(
                `${Constants.UPDATE_COMPANY_SETTINGS_URL}/${companyFormData.userId}`,
                formData,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "multipart/form-data",
                    },
                }
            );

            if (token) dispatch(fetchSystemSettings(token));

            toast.success("Company settings updated successfully");
        } catch (error) {
            console.error("Error updating company settings:", error);
            toast.error("Failed to update company settings");
        } finally {
            setIsSaving(false);
        }
    };

    const sectionHeaderClass = "flex items-center gap-2 px-5 py-4 border-b border-border text-lg font-semibold text-foreground";

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <PageHeader title="Company Settings">
                <Button type="button" variant="white"
                    onClick={() => navigate("/admin/dashboard")}>
                    Cancel
                </Button>
                {hasPermission(permissions, 'website-settings', 'edit') &&
                    <SubmitButton
                        form="company-settings-form"
                        isDisabled={isSaving}
                        isLoading={isSaving}
                        mode="edit"
                    />
                }
            </PageHeader>

            <form id="company-settings-form" className="space-y-6" onSubmit={handleSubmit}>
                {/* General Information Section */}
                <Card
                    padded={false}
                    header={
                        <div className={sectionHeaderClass}>
                            <Info className="w-5 h-5 text-primary" />
                            General Information
                        </div>
                    }
                >
                    <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                            label="Company Name"
                            required
                            id="companyName"
                            name="companyName"
                            type="text"
                            value={companyFormData.companyName}
                            onChange={handleInputChange}
                            error={formErrors.companyName}
                        />
                        <FormField
                            label="Email Address"
                            required
                            id="email"
                            name="email"
                            type="email"
                            value={companyFormData.email}
                            onChange={handleInputChange}
                            error={formErrors.email}
                        />
                        <FormField
                            label="Mobile Number"
                            required
                            id="phone"
                            name="phone"
                            type="text"
                            value={companyFormData.phone}
                            onChange={handleInputChange}
                            error={formErrors.phone}
                        />
                        <FormField
                            label="Fax"
                            id="fax"
                            name="fax"
                            type="text"
                            value={companyFormData.fax}
                            onChange={handleInputChange}
                            error={formErrors.fax}
                        />
                        <FormField
                            label="Public base URL"
                            id="publicBaseUrl"
                            name="publicBaseUrl"
                            type="text"
                            placeholder="https://elixirbooks.example.com"
                            value={companyFormData.publicBaseUrl ?? ''}
                            onChange={handleInputChange}
                            helper="Defaults to current domain if blank. Used in QR codes on invoices."
                            containerClassName="col-span-1 md:col-span-2"
                        />
                        <FormField
                            label="Merchant UPI ID (optional)"
                            id="merchantUpiId"
                            name="merchantUpiId"
                            type="text"
                            placeholder="merchant@upi"
                            value={companyFormData.merchantUpiId ?? ''}
                            onChange={handleInputChange}
                            helper="Used to render a UPI payment QR on invoice templates. Leave blank to hide."
                        />
                        <FormField
                            label="Merchant display name (optional)"
                            id="merchantName"
                            name="merchantName"
                            type="text"
                            placeholder="Defaults to company name"
                            value={companyFormData.merchantName ?? ''}
                            onChange={handleInputChange}
                            helper="Displayed in the UPI app when scanned. Defaults to company name."
                        />
                    </div>
                </Card>

                {/* Tax Identifiers Section */}
                <Card
                    padded={false}
                    header={
                        <div className={sectionHeaderClass}>
                            <Info className="w-5 h-5 text-primary" />
                            Tax Identifiers
                        </div>
                    }
                >
                    <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Select
                            label="Tax Regime"
                            id="taxRegime"
                            name="taxRegime"
                            value={companyFormData.taxRegime ?? 'NONE'}
                            onChange={(e) => setCompanyFormData(prev => ({ ...prev, taxRegime: e.target.value }))}
                            helper="Applying a country pack sets this automatically."
                            options={[
                                { value: 'NONE', label: 'No tax' },
                                { value: 'GST_INDIA', label: 'India GST' },
                                { value: 'VAT_UK', label: 'UK VAT' },
                                { value: 'VAT_EU', label: 'EU VAT' },
                                { value: 'GST_AU', label: 'Australia GST' },
                                { value: 'GST_NZ', label: 'New Zealand GST' },
                                { value: 'US_SALES_TAX', label: 'US Sales Tax' },
                                { value: 'VAT_GENERIC', label: 'VAT (generic)' },
                            ]}
                        />
                        <FormField
                            label="GSTIN (India)"
                            id="gstin"
                            name="gstin"
                            type="text"
                            placeholder="e.g. 27AAAAA0000A1Z5"
                            value={companyFormData.gstin ?? ''}
                            onChange={handleInputChange}
                        />
                        <FormField
                            label="VAT Number (UK / EU)"
                            id="vatNumber"
                            name="vatNumber"
                            type="text"
                            placeholder="e.g. GB123456789 / DE123456789"
                            value={companyFormData.vatNumber ?? ''}
                            onChange={handleInputChange}
                        />
                        <FormField
                            label="ABN (Australia)"
                            id="abn"
                            name="abn"
                            type="text"
                            placeholder="e.g. 51824753556"
                            value={companyFormData.abn ?? ''}
                            onChange={handleInputChange}
                        />
                        <FormField
                            label="GST Number (New Zealand)"
                            id="nzGstNumber"
                            name="nzGstNumber"
                            type="text"
                            placeholder="e.g. 123-456-789"
                            value={companyFormData.nzGstNumber ?? ''}
                            onChange={handleInputChange}
                        />

                        {/* EU options — relevant when the tax regime is EU VAT */}
                        <div className="col-span-1 md:col-span-2 flex items-start justify-between gap-4 border-t border-border pt-4 mt-2">
                            <div>
                                <label htmlFor="ossRegistered" className="block text-sm font-medium text-foreground">
                                    Registered for EU OSS
                                </label>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Charge the destination member-state VAT rate on B2C cross-border sales and report via the OSS return.
                                </p>
                            </div>
                            <Switch
                                name="ossRegistered"
                                checked={companyFormData.ossRegistered}
                                onChange={(e) => setCompanyFormData(prev => ({ ...prev, ossRegistered: e.target.checked }))}
                            />
                        </div>
                        <div className="col-span-1 md:col-span-2 flex items-start justify-between gap-4">
                            <div>
                                <label htmlFor="viesValidationEnabled" className="block text-sm font-medium text-foreground">
                                    Validate EU VAT numbers online via VIES
                                </label>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Off by default. When on, Elixir Books contacts the EU VIES service to verify VAT numbers; it fails open (never blocks a save) and stays fully offline when off.
                                </p>
                            </div>
                            <Switch
                                name="viesValidationEnabled"
                                checked={companyFormData.viesValidationEnabled}
                                onChange={(e) => setCompanyFormData(prev => ({ ...prev, viesValidationEnabled: e.target.checked }))}
                            />
                        </div>
                    </div>
                </Card>

                {/* Banking Section */}
                <Card
                    padded={false}
                    header={
                        <div className={sectionHeaderClass}>
                            <Landmark className="w-5 h-5 text-primary" />
                            Banking
                        </div>
                    }
                >
                    <div className="p-5 grid grid-cols-1 gap-6">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <label htmlFor="bankAutoPostEnabled" className="block text-sm font-medium text-foreground">
                                    Auto-post high-confidence bank matches
                                </label>
                                <p className="text-xs text-muted-foreground mt-1">
                                    When on, near-certain matches (exact amount + known party, or a payee you've approved before) post straight to the ledger without appearing in the approval queue. You can undo any auto-posted entry. This bypasses the approval queue.
                                </p>
                            </div>
                            <Switch
                                name="bankAutoPostEnabled"
                                checked={companyFormData.bankAutoPostEnabled}
                                onChange={(e) => setCompanyFormData(prev => ({ ...prev, bankAutoPostEnabled: e.target.checked }))}
                            />
                        </div>
                    </div>
                </Card>

                {/* Item Picker Display Section */}
                <Card
                    padded={false}
                    header={
                        <div className={sectionHeaderClass}>
                            <ListChecks className="w-5 h-5 text-primary" />
                            Item Picker Display
                        </div>
                    }
                >
                    <div className="p-5 grid grid-cols-1 gap-6">
                        <p className="text-xs text-muted-foreground -mt-2">
                            Choose which fields show in the product dropdown when adding items to an invoice.
                        </p>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <label htmlFor="itemPickerShowRate" className="block text-sm font-medium text-foreground">
                                    Show rate
                                </label>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Display the selling price next to each product in the item picker.
                                </p>
                            </div>
                            <Switch
                                name="itemPickerShowRate"
                                checked={companyFormData.itemPickerShowRate}
                                onChange={(e) => setCompanyFormData(prev => ({ ...prev, itemPickerShowRate: e.target.checked }))}
                            />
                        </div>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <label htmlFor="itemPickerShowStock" className="block text-sm font-medium text-foreground">
                                    Show stock quantity
                                </label>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Display available quantity / low-stock badges for inventory-tracked products. Out-of-stock blocking (if enabled) always applies regardless of this setting.
                                </p>
                            </div>
                            <Switch
                                name="itemPickerShowStock"
                                checked={companyFormData.itemPickerShowStock}
                                onChange={(e) => setCompanyFormData(prev => ({ ...prev, itemPickerShowStock: e.target.checked }))}
                            />
                        </div>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <label htmlFor="itemPickerShowImage" className="block text-sm font-medium text-foreground">
                                    Show image
                                </label>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Display a small thumbnail next to each product name in the item picker.
                                </p>
                            </div>
                            <Switch
                                name="itemPickerShowImage"
                                checked={companyFormData.itemPickerShowImage}
                                onChange={(e) => setCompanyFormData(prev => ({ ...prev, itemPickerShowImage: e.target.checked }))}
                            />
                        </div>
                    </div>
                </Card>

                {/* Company Images Section */}
                <Card
                    padded={false}
                    header={
                        <div className={sectionHeaderClass}>
                            <ImageIcon className="w-5 h-5 text-primary" />
                            Company Images
                        </div>
                    }
                >
                    <div className="p-5 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-4 py-4 border-b border-border">
                            <div>
                                <h3 className="font-semibold text-foreground">Logo</h3>
                                <p className="text-sm text-muted-foreground font-semibold">Upload logo of your company</p>
                                {formErrors.siteLogo && <span className="text-destructive text-xs">{formErrors.siteLogo}</span>}
                            </div>
                            <ImageCropperUpload
                                value={companyFormData.siteLogo_preview_url ?? undefined}
                                autoDetectAspect
                                label="Change Photo"
                                onCropped={(file) => {
                                    setCompanyFormData((prev) => ({
                                        ...prev,
                                        siteLogo: file,
                                        siteLogo_preview_url: URL.createObjectURL(file),
                                    }));
                                }}
                            />
                            <p className="text-xs text-muted-foreground mt-1 font-semibold">Recommended size is 250 px * 100 px</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-4 py-4 border-b border-border">
                            <div>
                                <h3 className="font-semibold text-foreground">Favicon</h3>
                                <p className="text-sm text-muted-foreground font-semibold">Upload favicon of your company</p>
                                {formErrors.favicon && <span className="text-destructive text-xs">{formErrors.favicon}</span>}
                            </div>
                            <ImageCropperUpload
                                value={companyFormData.favicon_preview_url ?? undefined}
                                aspect={1}
                                label="Change Photo"
                                onCropped={(file) => {
                                    setCompanyFormData((prev) => ({
                                        ...prev,
                                        favicon: file,
                                        favicon_preview_url: URL.createObjectURL(file),
                                    }));
                                }}
                            />
                            <p className="text-xs text-muted-foreground mt-1 font-semibold">Recommended size is 32 px * 32 px</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-4 py-4 border-b-0">
                            <div>
                                <h3 className="font-semibold text-foreground">Company Icon</h3>
                                <p className="text-sm text-muted-foreground font-semibold">Upload icon of your company</p>
                                {formErrors.companyLogo && <span className="text-destructive text-xs">{formErrors.companyLogo}</span>}
                            </div>
                            <ImageCropperUpload
                                value={companyFormData.companyLogo_preview_url ?? undefined}
                                aspect={1}
                                label="Change Photo"
                                onCropped={(file) => {
                                    setCompanyFormData((prev) => ({
                                        ...prev,
                                        companyLogo: file,
                                        companyLogo_preview_url: URL.createObjectURL(file),
                                    }));
                                }}
                            />
                            <p className="text-xs text-muted-foreground mt-1 font-semibold">Recommended size is 100 px * 100 px</p>
                        </div>
                    </div>
                </Card>

                {/* Address Information Section */}
                <Card
                    padded={false}
                    header={
                        <div className={sectionHeaderClass}>
                            <MapPin className="w-5 h-5 text-primary" />
                            Address Information
                        </div>
                    }
                >
                    <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                            label="Address"
                            required
                            id="address"
                            name="address"
                            type="text"
                            value={companyFormData.address}
                            onChange={handleInputChange}
                            error={formErrors.address}
                            containerClassName="col-span-1 md:col-span-2"
                        />
                        <FormField label="Country" error={formErrors.country}>
                            {(field) => (
                                <SearchableDropdown
                                    id={field.id}
                                    aria-invalid={field['aria-invalid']}
                                    aria-describedby={field['aria-describedby']}
                                    options={countries}
                                    value={selectedCountry}
                                    onInputChange={(_, value) => setCountryInput(value)}
                                    onChange={(_, value) => handleDropdownChange('country', value)}
                                    loading={loadingCountries}
                                    freeSolo
                                />
                            )}
                        </FormField>
                        <FormField label="State" error={formErrors.state}>
                            {(field) => (
                                <SearchableDropdown
                                    id={field.id}
                                    aria-invalid={field['aria-invalid']}
                                    aria-describedby={field['aria-describedby']}
                                    options={states}
                                    value={selectedState}
                                    onInputChange={(_, value) => setStateInput(value)}
                                    onChange={(_, value) => handleDropdownChange('state', value)}
                                    disabled={!companyFormData.country}
                                    loading={loadingStates}
                                    freeSolo
                                />
                            )}
                        </FormField>
                        <FormField
                            label="City"
                            id="city"
                            name="city"
                            type="text"
                            value={companyFormData.city ?? ''}
                            onChange={handleInputChange}
                            error={formErrors.city}
                        />
                        <FormField
                            label="Postal Code"
                            required
                            id="postalCode"
                            name="pincode"
                            type="text"
                            value={companyFormData.pincode}
                            onChange={(e) => handleInputChange(e)}
                            error={formErrors.pincode}
                        />
                    </div>
                </Card>

            </form>
        </div>
    );
}

export default CompanySettings;