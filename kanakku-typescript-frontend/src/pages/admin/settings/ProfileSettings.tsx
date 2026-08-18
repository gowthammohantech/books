import DateInput from "@components/admin/DateInput";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import SearchableDropdown from "@components/admin/SearchableDropdown";
import SubmitButton from "@components/admin/SubmitButton";
import ImageCropperUpload from "@components/common/ImageCropperUpload";
import Constants from "@constants/api";
import { useDebounce } from "@hooks/useDebounce";
import type { RootState } from "@store/index";
import axios from "axios";
import { forEach } from "lodash";
import { MapPin, User2Icon } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { updateUser } from "@store/auth/authSlice";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { isValidPhone, isValidPostalCode, PHONE_ERROR, POSTAL_CODE_ERROR } from "@utils/validation";
import { Button, Card, FormField, fieldControlClasses } from '@components/ui';
import { PageHeader } from "@/context/PageHeaderContext";

// --- Interfaces and Initial State ---

interface ApiProfile {
    profileImage?: string;
    profileImageUrl?: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    gender: string;
    dateOfBirth: Date | null;
    address: string;
    country: string | null;
    state: string | null;
    city: string | null;
    postalCode: string;
    profileImageFile?: File | null;
}

interface OptionType {
    id: string;
    name: string;
}

const initialProfile: ApiProfile = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    gender: '',
    dateOfBirth: null,
    address: '',
    country: null,
    state: null,
    city: null,
    postalCode: '',
};

const genderOptions: OptionType[] = [
    { id: 'male', name: 'Male' },
    { id: 'female', name: 'Female' },
    { id: 'other', name: 'Other' },
];

// --- Component ---

const ProfileSettings: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const dispatch = useDispatch();

    // State Declarations (Simplified and more robust)
    const [profile, setProfile] = useState<ApiProfile>(initialProfile);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [profileImagePreview, setProfileImagePreview] = useState<string>('');

    // Location Dropdown States
    const [selectedCountry, setSelectedCountry] = useState<OptionType | null>(null);
    const [selectedState, setSelectedState] = useState<OptionType | null>(null);
    const [selectedCity, setSelectedCity] = useState<OptionType | null>(null);
    const [countryOptions, setCountryOptions] = useState<OptionType[]>([]);
    const [stateOptions, setStateOptions] = useState<OptionType[]>([]);
    const [cityOptions, setCityOptions] = useState<OptionType[]>([]);

    // Search Input and Debounced Values
    const [countrySearchInput, setCountrySearchInput] = useState<string>('');
    const [stateSearchInput, setStateSearchInput] = useState<string>('');
    const [citySearchInput, setCitySearchInput] = useState<string>('');
    const debouncedCountrySearch = useDebounce(countrySearchInput, 300);
    const debouncedStateSearch = useDebounce(stateSearchInput, 300);
    const debouncedCitySearch = useDebounce(citySearchInput, 300);
    const navigate = useNavigate();
    // Loading States
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    // Data Fetching Logic (wrapped in useCallback and cleaned up)
    const fetchUserProfile = useCallback(async () => {
        if (!token) return;
        setIsLoading(true);
        try {
            const response = await axios(Constants.FETCH_USER_PROFILE_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = response.data;
            if (data) {
                setProfile({
                    ...initialProfile,
                    firstName: data.firstName || '',
                    lastName: data.lastName || '',
                    email: data.email || '',
                    phone: data.phone || '',
                    gender: data.gender || '',
                    dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
                    address: data.address || '',
                    country: data.country?.id || null,
                    state: data.state?.id || null,
                    city: data.city?.id || null,
                    postalCode: data.postalCode || ''
                });

                if (data.profileImageUrl) setProfileImagePreview(data.profileImageUrl);
                if (data.country) setSelectedCountry({ id: data.country.id, name: data.country.name });
                if (data.state) setSelectedState({ id: data.state.id, name: data.state.name });
                if (data.city) setSelectedCity({ id: data.city.id, name: data.city.name });
            }
        } catch (error) {
            console.error("Failed to fetch user profile", error);
            toast.error("Could not load your profile data.");
        } finally {
            setIsLoading(false);
        }
    }, [token]);

    useEffect(() => {
        fetchUserProfile();
    }, [fetchUserProfile]);

    const fetchCountries = useCallback(async () => {
        if (!token) return;
        try {
            const response = await axios(Constants.FETCH_COUNTRIES_URL, {
                params: { search: debouncedCountrySearch },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setCountryOptions(response.data.map((c: any) => ({ id: String(c.id), name: c.name })));
        } catch (error) {
            console.error('Error fetching countries:', error);
        }
    }, [token, debouncedCountrySearch]);

    useEffect(() => {
        fetchCountries();
    }, [fetchCountries]);

    const fetchStates = useCallback(async () => {
        if (!token || !selectedCountry) return;
        try {
            const response = await axios(`${Constants.FETCH_STATES_URL}/${selectedCountry.id}`, {
                params: { search: debouncedStateSearch },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setStateOptions(response.data.map((s: any) => ({ id: String(s.id), name: s.name })));
        } catch (error) {
            console.error('Error fetching states:', error);
            toast.error('Failed to load states for the selected country.');
        }
    }, [token, selectedCountry, debouncedStateSearch]);

    useEffect(() => {
        if (selectedCountry) fetchStates();
    }, [fetchStates]);

    const fetchCities = useCallback(async () => {
        if (!token || !selectedState) return;
        try {
            const response = await axios(`${Constants.FETCH_CITIES_URL}/${selectedState.id}`, {
                params: { search: debouncedCitySearch },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setCityOptions(response.data.map((c: any) => ({ id: String(c.id), name: c.name })));
        } catch (error) {
            console.error('Error fetching cities:', error);
        }
    }, [token, selectedState, debouncedCitySearch]);

    useEffect(() => {
        if (selectedState) fetchCities();
    }, [fetchCities]);

    // Form Handlers (Centralized and robust logic)
    const handleFormChange = (field: keyof ApiProfile, value: any) => {
        setProfile(prev => ({ ...prev, [field]: value }));
        if (formErrors[field]) {
            setFormErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[field];
                return newErrors;
            });
        }
    };

    const handleCountryChange = (option: OptionType | null) => {
        setSelectedCountry(option);
        setCountrySearchInput('');
        setSelectedState(null);
        setSelectedCity(null);
        setStateOptions([]);
        setCityOptions([]);
        setStateSearchInput('');
        setCitySearchInput('');
        setProfile(prev => ({ ...prev, country: option?.id ?? null, state: null, city: null }));
    };

    const handleStateChange = (option: OptionType | null) => {
        setSelectedState(option);
        setStateSearchInput('');
        setSelectedCity(null);
        setCityOptions([]);
        setCitySearchInput('');
        setProfile(prev => ({ ...prev, state: option?.id ?? null, city: null }));
    };

    const handleCityChange = (option: OptionType | null) => {
        setSelectedCity(option);
        setCitySearchInput('');
        handleFormChange('city', option?.id ?? null);
    };

    // Form Validation and Submission Logic
    // Starred fields are mandatory: check presence first, then validate FORMAT when a value is present.
    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};

        // Required (starred) fields — presence checks
        if (!profile.firstName?.trim()) newErrors.firstName = 'First name is required';
        if (!profile.lastName?.trim()) newErrors.lastName = 'Last name is required';
        if (!profile.gender) newErrors.gender = 'Gender is required';
        if (!profile.dateOfBirth) newErrors.dateOfBirth = 'Date of birth is required';
        if (!profile.address?.trim()) newErrors.address = 'Address is required';
        // Country/state/city are optional: many countries have no city dataset, which
        // used to make the profile unsavable. Backend already treats them as optional.
        if (!profile.postalCode?.trim()) newErrors.postalCode = 'Postal code is required';

        // Format checks (only when a value is present)
        if (profile.email && !/^\S+@\S+\.\S+$/.test(profile.email)) newErrors.email = 'Invalid email format';
        if (profile.phone && !isValidPhone(profile.phone)) newErrors.phone = PHONE_ERROR;
        if (profile.postalCode && !newErrors.postalCode && !isValidPostalCode(profile.postalCode)) newErrors.postalCode = POSTAL_CODE_ERROR;

        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateForm()) {
            toast.error("Please correct the errors before saving.");
            return;
        }
        setIsSubmitting(true);
        try {
            const formData = new FormData();
            const profileToSubmit = { ...profile };

            forEach(profileToSubmit, (value, key) => {
                if (!['profileImageFile', 'profileImageUrl', 'profileImage', 'dateOfBirth'].includes(key)) {
                    formData.append(key, value !== null ? String(value) : '');
                }
            });

            if (profileToSubmit.dateOfBirth) {
                formData.append('dateOfBirth', new Date(profileToSubmit.dateOfBirth).toISOString().split('T')[0]);
            }
            if (profileToSubmit.profileImageFile) {
                formData.append('profileImage', profileToSubmit.profileImageFile);
            }

            const res = await axios.put(Constants.UPDATE_PROFILE_URL, formData, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            // Sync the top-right header avatar (auth.user) without a re-login.
            const updatedUser = res.data?.user;
            if (updatedUser) {
                dispatch(updateUser({
                    profileImageUrl: updatedUser.profileImageUrl ?? null,
                    firstName: updatedUser.firstName,
                    lastName: updatedUser.lastName,
                }));
            }
            toast.success('Profile updated successfully');
            // Re-fetch so country/state/city dropdowns re-sync to saved values
            await fetchUserProfile();
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 422) {
                const serverErrors = error.response.data?.errors as Record<string, string> | undefined;
                if (serverErrors && Object.keys(serverErrors).length > 0) {
                    setFormErrors(serverErrors);
                    toast.error('Please correct the highlighted errors.');
                } else {
                    toast.error(error.response.data?.message ?? 'Validation failed.');
                }
            } else {
                toast.error('Failed to update profile.');
            }
            console.error("Profile update error", error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const selectedGenderValue = genderOptions.find(g => g.id === profile.gender) || null;

    const sectionHeaderClass = "flex items-center gap-2 px-5 py-4 border-b border-border text-lg font-semibold text-heading";

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <LoaderSpinner size={32} />
                <p className="ml-3 text-body text-base">Loading Profile...</p>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <PageHeader title="Account Settings">
                <Button
                    type="button"
                    variant="white"
                    onClick={() => navigate("/admin/dashboard")}
                >
                    Cancel
                </Button>
                <SubmitButton form="profile-settings-form" isDisabled={isSubmitting} isLoading={isSubmitting} mode="edit" />
            </PageHeader>
            <form id="profile-settings-form" onSubmit={handleSubmit} noValidate className="space-y-6">
                {/* General Settings */}
                <Card
                    padded={false}
                    header={
                        <div className={sectionHeaderClass}>
                            <User2Icon className="w-5 h-5 text-purple-600" />
                            General Information
                        </div>
                    }
                >
                    <div className="p-5">
                        <div className="flex items-center mb-8">
                            <ImageCropperUpload
                                value={profileImagePreview || undefined}
                                autoDetectAspect
                                label="Upload New Photo"
                                accept="image/png, image/jpeg"
                                onCropped={(file) => {
                                    handleFormChange('profileImageFile', file);
                                    setProfileImagePreview(URL.createObjectURL(file));
                                }}
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-4">
                            <FormField
                                label="First Name"
                                required
                                id="firstName"
                                name="firstName"
                                type="text"
                                placeholder="Enter First Name"
                                value={profile.firstName}
                                onChange={(e) => handleFormChange('firstName', e.target.value)}
                                error={formErrors.firstName}
                            />
                            <FormField
                                label="Last Name"
                                required
                                id="lastName"
                                name="lastName"
                                type="text"
                                placeholder="Enter Last Name"
                                value={profile.lastName}
                                onChange={(e) => handleFormChange('lastName', e.target.value)}
                                error={formErrors.lastName}
                            />
                            <FormField
                                label="Email"
                                required
                                id="email"
                                name="email"
                                type="email"
                                placeholder="Enter Email"
                                value={profile.email}
                                onChange={(e) => handleFormChange('email', e.target.value)}
                                error={formErrors.email}
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <FormField
                                label="Phone"
                                required
                                id="phone"
                                name="phone"
                                type="tel"
                                placeholder="Enter Phone number"
                                value={profile.phone}
                                onChange={(e) => handleFormChange('phone', e.target.value)}
                                error={formErrors.phone}
                            />
                            <FormField label="Gender" required error={formErrors.gender}>
                                {(field) => (
                                    <SearchableDropdown
                                        id={field.id}
                                        aria-invalid={field['aria-invalid']}
                                        aria-describedby={field['aria-describedby']}
                                        placeholder="Select Gender"
                                        options={genderOptions}
                                        value={selectedGenderValue}
                                        onChange={(_, val) => handleFormChange('gender', (val as OptionType)?.id ?? '')}
                                    />
                                )}
                            </FormField>
                            <div>
                                <DateInput label="Date of Birth" value={profile.dateOfBirth} onChange={(date) => handleFormChange('dateOfBirth', date)} isRequired maxDate={new Date()} />
                                {formErrors.dateOfBirth && <p className="mt-1 text-sm text-danger">{formErrors.dateOfBirth}</p>}
                            </div>
                        </div>
                    </div>
                </Card>

                {/* Address Information */}
                <Card
                    padded={false}
                    header={
                        <div className={sectionHeaderClass}>
                            <MapPin className="w-5 h-5 text-purple-600" />
                            Address Information
                        </div>
                    }
                >
                    <div className="p-5">
                        <FormField label="Address" required error={formErrors.address} containerClassName="mb-4">
                            {(field) => (
                                <textarea
                                    id={field.id}
                                    aria-invalid={field['aria-invalid']}
                                    aria-describedby={field['aria-describedby']}
                                    value={profile.address}
                                    onChange={(e) => handleFormChange('address', e.target.value)}
                                    rows={3}
                                    className={fieldControlClasses(Boolean(formErrors.address))}
                                />
                            )}
                        </FormField>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                            <FormField label="Country" error={formErrors.country}>
                                {(field) => (
                                    <SearchableDropdown
                                        id={field.id}
                                        aria-invalid={field['aria-invalid']}
                                        aria-describedby={field['aria-describedby']}
                                        placeholder="Search Country"
                                        options={countryOptions}
                                        value={selectedCountry}
                                        inputValue={countrySearchInput}
                                        onInputChange={(_, val) => setCountrySearchInput(val)}
                                        onChange={(_, val) => handleCountryChange(val as OptionType | null)}
                                    />
                                )}
                            </FormField>
                            <FormField label="State" error={formErrors.state}>
                                {(field) => (
                                    <SearchableDropdown
                                        id={field.id}
                                        aria-invalid={field['aria-invalid']}
                                        aria-describedby={field['aria-describedby']}
                                        placeholder="Search State"
                                        options={stateOptions}
                                        value={selectedState}
                                        inputValue={stateSearchInput}
                                        onInputChange={(_, val) => setStateSearchInput(val)}
                                        onChange={(_, val) => handleStateChange(val as OptionType | null)}
                                        disabled={!selectedCountry}
                                    />
                                )}
                            </FormField>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <FormField label="City" error={formErrors.city}>
                                {(field) => (
                                    <SearchableDropdown
                                        id={field.id}
                                        aria-invalid={field['aria-invalid']}
                                        aria-describedby={field['aria-describedby']}
                                        placeholder="Search City"
                                        options={cityOptions}
                                        value={selectedCity}
                                        inputValue={citySearchInput}
                                        onInputChange={(_, val) => setCitySearchInput(val)}
                                        onChange={(_, val) => handleCityChange(val as OptionType | null)}
                                        disabled={!selectedState}
                                    />
                                )}
                            </FormField>
                            <FormField
                                label="Pincode"
                                required
                                id="pincode"
                                name="pincode"
                                type="text"
                                value={profile.postalCode}
                                onChange={(e) => handleFormChange('postalCode', e.target.value)}
                                error={formErrors.postalCode}
                            />
                        </div>
                    </div>
                </Card>
            </form>
        </div>
    );
};

export default ProfileSettings;
