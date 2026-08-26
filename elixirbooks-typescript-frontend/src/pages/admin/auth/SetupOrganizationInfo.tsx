import type { SetupCurrencies, SetupDropdownResponse, SetupFormData, SetupTimezones } from "@models/setup";
import { useEffect, useState } from "react";
import { UploadCloud, ImagePlus, Building2, MapPin, Globe, Calendar, Currency, Loader2Icon } from "lucide-react";
import Cookies from "js-cookie";
import axios from "axios";
import Constants from "@constants/api";
import SmartDropdown from "@components/admin/SmartDropdown";
import type { OptionType } from "@models/common";
import { useDebounce } from "@hooks/useDebounce";
import { toast } from "sonner";
import { useSetupStatus } from "@context/SetupStatusContext";
import { useDispatch } from "react-redux";
import { fetchSystemSettings } from "@store/systemSettingsSlice";
import type { AppDispatch } from "@store/index";

interface TimeZoneOptionType {
    id: string;
    name: string;
    offset: string;
}

interface DateFormatOptionType {
    id: string;
    name: string;
    format: string;
}

interface CurrencyOptionType {
    id: string;
    name: string;
    symbol: string;
}
const SetupOrganizationInfo: React.FC = () => {
    const prepareInitialFormData = () => {
        return {
            companyName: '',
            address: '',
            country: '',
            state: '',
            city: '',
            pincode: '',
            currencyId: '',
            timezoneId: '',
            dateFormatId: '',
            siteLogo: null,
            taxRegime: 'NONE',
        }
    }
    const token = Cookies.get('authToken') ?? null;
    const dispatch: AppDispatch = useDispatch();
    const { setStatus } = useSetupStatus();
    const [formData, setFormData] = useState<SetupFormData>(prepareInitialFormData());
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [isSaving, setIsSaving] = useState(false);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const [timezoneOptions, setTimeZoneOptions] = useState<TimeZoneOptionType[]>([]);
    const [dateFormatOptions, setDateFormatOptions] = useState<DateFormatOptionType[]>([]);
    const [currencyOptions, setCurrencyOptions] = useState<CurrencyOptionType[]>([]);
    const [timezoneSearchKeyword, setTimezoneSearchKeyword] = useState<string>('');
    const [dateFormatSearchKeyword, setDateFormatSearchKeyword] = useState<string>('');
    const [currencySearchKeyword, setCurrencySearchKeyword] = useState<string>('');
    const [countryOptions, setCountryOptions] = useState<OptionType[]>([]);
    const [countrySearchKeyword, setCountrySearchKeyword] = useState<string>('');
    const debouncedCountrySearch = useDebounce(countrySearchKeyword, 300);

    useEffect(() => {
        const fetchDropdownData = async () => {
            try {
                const response = await axios<SetupDropdownResponse>(Constants.FETCH_SETUP_DROPDOWNS_URL, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                const data = response.data.data;
                const timeZones = data.timezones.map((timezone) => {
                    return {
                        id: timezone.id,
                        name: timezone.name + ' (' + timezone.offset + ')',
                        offset: timezone.offset
                    }
                });
                setTimeZoneOptions(timeZones);

                const dateFormats = data.dateFormats.map((format) => {
                    return {
                        id: format.id,
                        name: format.title,
                        format: format.format
                    }
                });
                setDateFormatOptions(dateFormats);

                const currencies = data.currencies.map((currency) => {
                    return {
                        id: currency.id,
                        name: currency.name + ' (' + currency.symbol + ')',
                        symbol: currency.symbol
                    }
                });
                setCurrencyOptions(currencies);
            } catch (error) {
                console.error('Error fetching dropdown data:', error);
            }
        }

        fetchDropdownData();
    }, [token]);

    useEffect(() => {
        const fetchCountries = async () => {
            try {
                const response = await axios.get(Constants.FETCH_COUNTRIES_URL, {
                    params: {
                        search: debouncedCountrySearch
                    },
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                })
                let formattedCountries = response.data.map((country: any) => {
                    return {
                        id: country.id,
                        name: country.name
                    }
                });
                setCountryOptions(formattedCountries);
            } catch (error) {

            }
        }
        fetchCountries();
    }, [debouncedCountrySearch]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
        const maxSizeInMB = 2;

        // Validate file type
        if (!validTypes.includes(file.type)) {
            alert("Invalid file type. Only PNG, JPG, JPEG, or SVG files are allowed.");
            return;
        }

        // Validate file size
        const fileSizeInMB = file.size / (1024 * 1024);
        if (fileSizeInMB > maxSizeInMB) {
            alert("File size exceeds 2MB. Please choose a smaller image.");
            return;
        }

        setFormData((prev) => ({ ...prev, siteLogo: file }));

        const reader = new FileReader();
        reader.onloadend = () => setLogoPreview(reader.result as string);
        reader.readAsDataURL(file);
    };

    const handleCurrencySelect = (currency: SetupCurrencies) => {
        if (currency) {
            setFormData((prev) => ({ ...prev, currencyId: currency.id }));
        } else {
            setFormData((prev) => ({ ...prev, currencyId: '' }));
        }
    }

    const handleTimezoneSelect = (timezone: SetupTimezones) => {
        if (timezone) {
            setFormData((prev) => ({ ...prev, timezoneId: timezone.id }));
        } else {
            setFormData((prev) => ({ ...prev, timezoneId: '' }));
        }
    }

    const handleDateFormatSelect = (format: OptionType | null) => {
        if (format) {
            setFormData((prev) => ({ ...prev, dateFormatId: format.id }));
        } else {
            setFormData((prev) => ({ ...prev, dateFormatId: '' }));
        }
    }

    const handleCountrySelect = (country: OptionType | null) => {
        const countryId = country ? country.id : '';
        setFormData((prev) => ({ ...prev, country: countryId }));
    }

    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};
        if (!formData.companyName) newErrors.companyName = 'Company name is required.';
        if (!formData.address) newErrors.address = 'Address is required.';
        if (!formData.country) newErrors.country = 'Country is required.';
        if (!formData.state) newErrors.state = 'State is required.';
        if (!formData.city) newErrors.city = 'City is required.';
        if (!formData.pincode) newErrors.pincode = 'Pincode is required.';
        if (!formData.currencyId) newErrors.currencyId = 'Currency is required.';
        if (!formData.timezoneId) newErrors.timezoneId = 'Timezone is required.';
        if (!formData.dateFormatId) newErrors.dateFormatId = 'Date format is required.';
        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) return;
        console.log(formData);
        try {
            setIsSaving(true);
            let payloadFormData = new FormData();
            if (formData.siteLogo instanceof File) {
                payloadFormData.append('siteLogo', formData.siteLogo);
            }
            Object.entries(formData).forEach(([key, value]) => {
                if (key !== 'siteLogo' && value !== undefined && value !== null) {
                    payloadFormData.append(key, String(value));
                }
            });
            await axios.patch(Constants.UPDATE_COMPANY_SETUP_URL, payloadFormData, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data'
                }
            });
            setStatus({
                new_register: false,      // user just registered
                company_settings: false,   // company setup done
            });
            if (token) dispatch(fetchSystemSettings(token));
            toast.success('Company info updated successfully.');
            //navigate with page refresh to trigger setup status change
            window.location.replace("/admin/dashboard");
        } catch (error) {
            toast.error('Failed to update company info.');
        } finally {
            // setIsSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 flex flex-col justify-center items-center px-2 py-2">
            {/* Form Container */}
            <form
                onSubmit={handleSubmit}
                className="p-4 w-full mt-4 mb-4 max-w-4xl bg-white rounded-2xl shadow-sm border border-purple-100 overflow-hidden"
            >
                <div className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-3">
                        <div className="p-2 bg-purple-100 rounded-lg">
                            <Building2 className="w-4 h-4 text-purple-600" />
                        </div>
                        <h1 className="text-xl font-bold text-gray-900">Organization Setup</h1>
                    </div>
                    <p className="text-sm text-gray-600 font-medium">
                        Set up your company details to get started.
                    </p>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Company Logo Upload */}
                    <div className="md:col-span-2">
                        <label className="block text-sm font-semibold text-gray-800 mb-2">
                            Company Logo
                        </label>

                        <div className="flex items-center gap-4 p-2 bg-white rounded-xl border border-gray-200 transition-all duration-200">
                            {/* Logo Preview */}
                            <div className="flex-shrink-0 relative group">
                                {logoPreview ? (
                                    <img
                                        src={logoPreview}
                                        alt="Logo"
                                        className="h-16 w-32 object-contain rounded-lg border border-gray-200 p-2"
                                    />
                                ) : (
                                    <div className="h-16 w-32 flex items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-gray-400">
                                        <ImagePlus size={20} />
                                    </div>
                                )}
                            </div>

                            {/* Upload Button & Info */}
                            <div className="flex flex-col justify-center flex-1">
                                <label className="cursor-pointer inline-flex items-center gap-2 text-sm text-purple-600 font-medium hover:text-purple-700 transition">
                                    <UploadCloud size={16} />
                                    {logoPreview ? 'Change Logo' : 'Upload Logo'}
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleLogoUpload}
                                        className="hidden"
                                    />
                                </label>

                                <p className="text-xs text-gray-500 mt-1">
                                    PNG, JPG, or SVG — max 2MB
                                </p>
                            </div>
                        </div>
                    </div>


                    {/* Company Name */}
                    <div className="col-span-full">
                        <label className="flex items-center text-sm font-semibold text-gray-800 mb-2">
                            <Building2 className="w-4 h-4 mr-2 text-purple-600" />
                            Company Name <em className="text-red-600 ml-1">*</em>
                        </label>
                        <input
                            type="text"
                            name="companyName"
                            value={formData.companyName}
                            onChange={handleChange}
                            placeholder="Enter your company name"
                            className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-transparent transition-all duration-200"
                        />
                        {formErrors.companyName && <p className="text-red-600 text-sm mt-1">{formErrors.companyName}</p>}
                    </div>

                    {/* Address */}
                    <div className="col-span-full">
                        <label className="flex items-center text-sm font-semibold text-gray-800 mb-2">
                            <MapPin className="w-4 h-4 mr-2 text-purple-600" />
                            Office Address <em className="text-red-600 ml-1">*</em>
                        </label>
                        <textarea
                            name="address"
                            rows={2}
                            value={formData.address}
                            onChange={handleChange}
                            placeholder="Enter your complete business address"
                            className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-transparent transition-all duration-200 resize-none"
                        />
                        {formErrors.address && <p className="text-red-600 text-sm mt-1">{formErrors.address}</p>}
                    </div>

                    {/* Location Fields Grid */}
                    <div className="col-span-full">
                        <h3 className="flex items-center text-sm font-semibold text-gray-800 mb-4">
                            <Globe className="w-4 h-4 mr-2 text-purple-600" />
                            Location Details
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Country <em className="text-red-600">*</em></label>
                                <SmartDropdown
                                    items={countryOptions}
                                    value={countrySearchKeyword}
                                    onChange={setCountrySearchKeyword}
                                    onSelect={(item) => handleCountrySelect(item as OptionType)}
                                    placeholder="Type to search for a country"
                                    selectedItem={countryOptions.find(item => item.id === formData.country)}
                                />
                                {formErrors.country && <p className="text-red-600 text-sm mt-1">{formErrors.country}</p>}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Tax Regime</label>
                                <select
                                    name="taxRegime"
                                    value={formData.taxRegime ?? 'NONE'}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, taxRegime: e.target.value }))}
                                    className="mt-1 text-gray-700 p-2 block focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600 w-full border border-gray-200 rounded-md"
                                >
                                    <option value="NONE">No tax</option>
                                    <option value="GST_INDIA">India GST</option>
                                    <option value="VAT_GENERIC">VAT (UK, EU, AU, etc.)</option>
                                    <option value="US_SALES_TAX">US Sales Tax</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">State/Province <em className="text-red-600">*</em></label>
                                <input
                                    type="text"
                                    name="state"
                                    value={formData.state}
                                    onChange={handleChange}
                                    placeholder="Enter state or province"
                                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                {formErrors.state && <p className="text-red-600 text-sm mt-1">{formErrors.state}</p>}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">City <em className="text-red-600">*</em></label>
                                <input
                                    type="text"
                                    name="city"
                                    value={formData.city}
                                    onChange={handleChange}
                                    placeholder="Enter city"
                                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                {formErrors.city && <p className="text-red-600 text-sm mt-1">{formErrors.city}</p>}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Postal Code <em className="text-red-600">*</em></label>
                                <input
                                    type="text"
                                    name="pincode"
                                    value={formData.pincode}
                                    onChange={handleChange}
                                    placeholder="ZIP / Postal Code"
                                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-transparent transition-all duration-200"
                                />
                                {formErrors.pincode && <p className="text-red-600 text-sm mt-1">{formErrors.pincode}</p>}
                            </div>
                        </div>
                    </div>

                    {/* System Settings */}
                    <div className="col-span-full">
                        <h3 className="flex items-center text-sm font-semibold text-gray-800 mb-4">
                            <Calendar className="w-4 h-4 mr-2 text-purple-600" />
                            System Preferences
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label className="flex items-center text-sm font-medium text-gray-700 mb-2">
                                    <Currency className="w-4 h-4 mr-2 text-purple-600" />
                                    Currency <em className="text-red-600 ml-1">*</em>
                                </label>
                                <SmartDropdown
                                    items={currencyOptions}
                                    value={currencySearchKeyword}
                                    onChange={setCurrencySearchKeyword}
                                    onSelect={(currency) => handleCurrencySelect(currency as SetupCurrencies)}
                                    placeholder="Type to search currency"
                                    selectedItem={currencyOptions.find((currency) => currency.id === formData.currencyId)}
                                    serverside={false}
                                />
                                {formErrors.currencyId && <p className="text-red-600 text-sm mt-1">{formErrors.currencyId}</p>}
                            </div>

                            <div>
                                <label className="flex items-center text-sm font-medium text-gray-700 mb-2">
                                    <Globe className="w-4 h-4 mr-2 text-purple-600" />
                                    Timezone <em className="text-red-600 ml-1">*</em>
                                </label>
                                <SmartDropdown
                                    items={timezoneOptions}
                                    value={timezoneSearchKeyword}
                                    onChange={setTimezoneSearchKeyword}
                                    onSelect={(timezone) => handleTimezoneSelect(timezone as SetupTimezones)}
                                    placeholder="Type to search timezone"
                                    selectedItem={timezoneOptions.find((timezone) => timezone.id === formData.timezoneId)}
                                    serverside={false}
                                />
                                {formErrors.timezoneId && <p className="text-red-600 text-sm mt-1">{formErrors.timezoneId}</p>}
                            </div>

                            <div>
                                <label className="flex items-center text-sm font-medium text-gray-700 mb-2">
                                    <Calendar className="w-4 h-4 mr-2 text-purple-600" />
                                    Date Format <em className="text-red-600 ml-1">*</em>
                                </label>
                                <SmartDropdown
                                    items={dateFormatOptions}
                                    value={dateFormatSearchKeyword}
                                    onChange={setDateFormatSearchKeyword}
                                    onSelect={(dateFormat) => handleDateFormatSelect(dateFormat as OptionType)}
                                    placeholder="Type to search date format"
                                    selectedItem={dateFormatOptions.find((dateFormat) => dateFormat.id === formData.dateFormatId)}
                                    serverside={false}
                                />
                                {formErrors.dateFormatId && <p className="text-red-600 text-sm mt-1">{formErrors.dateFormatId}</p>}
                            </div>
                        </div>
                    </div>

                    {/* Submit Button */}
                    <div className="col-span-full pt-4 border-t border-gray-200">
                        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                            <p className="text-sm text-gray-600 text-center sm:text-left">
                                <strong>Note:</strong> All details can be updated later in System Settings.
                            </p>
                            <button
                                type="submit"
                                disabled={isSaving}
                                className={`flex items-center justify-center gap-2 w-[320px] max-w-full px-6 bg-purple-600 hover:bg-purple-700 text-white font-medium text-sm py-3 rounded-lg transition-all duration-200 shadow-sm ${isSaving ? "opacity-60 cursor-not-allowed" : ""
                                    }`}
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2Icon size={18} className="animate-spin" />
                                        <span>Loading...</span>
                                    </>
                                ) : (
                                    "Save & Continue"
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
}

export default SetupOrganizationInfo;