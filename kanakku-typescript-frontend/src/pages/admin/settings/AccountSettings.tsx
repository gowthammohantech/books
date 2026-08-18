import React, { useState, useEffect, useCallback, useRef } from 'react';
import Constants from '../../../constants/api';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import { toast } from "sonner";
import type { AxiosError } from 'axios';
import axios from 'axios';
import SearchableDropdown from '@components/admin/SearchableDropdown';
import { User, MapPin, DatabaseIcon } from 'lucide-react';
import SubmitButton from '@components/admin/SubmitButton';
import ExportButton from '@components/admin/ExportButton';
import DateInput from '@components/admin/DateInput';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button, Card, FormField, Select } from '@components/ui';

interface LocationItem {
    id: string;
    name: string;
}

interface ApiProfile {
    profileImage?: string;
    profileImageUrl?: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    gender: 'male' | 'female' | 'other' | '';
    dateOfBirth: string;
    address: string;
    country: number | string | null;
    state: number | string | null;
    city: number | string | null;
    postalCode: string;
}

interface FormErrors {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    gender?: string;
    dateOfBirth?: string;
    address?: string;
    country?: string;
    state?: string;
    city?: string;
    postalCode?: string;
}

interface Profile extends ApiProfile {
    profileImageFile?: File | null;
}

interface Option {
    id: string;
    name: string;
}

const AccountSettings: React.FC = () => {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loadingProfile, setLoadingProfile] = useState<boolean>(true);
    const [savingProfile, setSavingProfile] = useState<boolean>(false);
    const [profileImagePreview, setProfileImagePreview] = useState<string>('');
    const [countryOptions, setCountryOptions] = useState<Option[]>([]);
    const [stateOptions, setStateOptions] = useState<Option[]>([]);
    const [cityOptions, setCityOptions] = useState<Option[]>([]);
    const [countrySearchInput, setCountrySearchInput] = useState<string>('');
    const [stateSearchInput, setStateSearchInput] = useState<string>('');
    const [citySearchInput, setCitySearchInput] = useState<string>('');
    const [loadingCountries, setLoadingCountries] = useState<boolean>(false);
    const [loadingStates, setLoadingStates] = useState<boolean>(false);
    const [loadingCities, setLoadingCities] = useState<boolean>(false);

    const { token, user } = useSelector((state: RootState) => state.auth);
    const [formErrors, setFormErrors] = useState<FormErrors>({});
    const profileImageInputRef = useRef<HTMLInputElement>(null);

    const fetchCountries = useCallback(async (searchQuery: string = '') => {
        setLoadingCountries(true);
        try {
            const url = searchQuery
                ? `${Constants.FETCH_COUNTRIES_URL}?search=${encodeURIComponent(searchQuery)}`
                : Constants.FETCH_COUNTRIES_URL;

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json() as LocationItem[];
            setCountryOptions(data.map(item => ({ id: item.id, name: item.name })));
        } catch (error) {
            toast.error("Failed to fetch countries.");
            setCountryOptions([]);
        } finally {
            setLoadingCountries(false);
        }
    }, [token]);

    const fetchStates = useCallback(async (searchQuery: string = '') => {
        if (!profile?.country) {
            setStateOptions([]);
            return;
        }

        setLoadingStates(true);
        try {
            const baseUrl = `${Constants.FETCH_STATES_URL}/${profile.country}`;
            const url = searchQuery
                ? `${baseUrl}?search=${encodeURIComponent(searchQuery)}`
                : baseUrl;

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json() as LocationItem[];
            setStateOptions(data.map(item => ({ id: item.id, name: item.name })));
        } catch (error) {
            setStateOptions([]);
        } finally {
            setLoadingStates(false);
        }
    }, [profile?.country, token]);

    const fetchCities = useCallback(async (searchQuery: string = '') => {
        if (!profile?.state) {
            setCityOptions([]);
            return;
        }

        setLoadingCities(true);
        try {
            const baseUrl = `${Constants.FETCH_CITIES_URL}/${profile.state}`;
            const url = searchQuery
                ? `${baseUrl}?search=${encodeURIComponent(searchQuery)}`
                : baseUrl;

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json() as LocationItem[];
            setCityOptions(data.map(item => ({ id: item.id, name: item.name })));
        } catch (error) {
            setCityOptions([]);
        } finally {
            setLoadingCities(false);
        }
    }, [profile?.state, token]);

    useEffect(() => {
        const fetchUserProfile = async () => {
            setLoadingProfile(true);
            try {
                const response = await fetch(Constants.FETCH_USER_PROFILE_URL, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const data = await response.json() as ApiProfile;

                const fetchedProfile: Profile = {
                    ...data,
                    profileImage: data.profileImage || '',
                    dateOfBirth: data.dateOfBirth
                        ? (() => {
                            const d = new Date(data.dateOfBirth);
                            const year = d.getFullYear();
                            const month = String(d.getMonth() + 1).padStart(2, "0");
                            const day = String(d.getDate()).padStart(2, "0");
                            return `${year}-${month}-${day}`;
                        })()
                        : "",
                };

                setProfile(fetchedProfile);
                if (fetchedProfile.profileImageUrl) {
                    setProfileImagePreview(fetchedProfile.profileImageUrl);
                }

                fetchCountries();
            } catch (error) {
                toast.error('Failed to fetch user profile.');
                setProfile({
                    firstName: '',
                    lastName: '',
                    email: '',
                    phone: '',
                    gender: '',
                    dateOfBirth: '',
                    address: '',
                    country: '',
                    state: '',
                    city: '',
                    postalCode: '',
                    profileImageFile: null
                });
            } finally {
                setLoadingProfile(false);
            }
        };
        fetchUserProfile();
    }, [token]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            fetchCountries(countrySearchInput);
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [countrySearchInput]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            fetchStates(stateSearchInput);
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [stateSearchInput]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            fetchCities(citySearchInput);
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [citySearchInput]);

    useEffect(() => {
        if (profile?.country) {
            setStateSearchInput('');
            setCitySearchInput('');
            fetchStates();
        } else {
            setStateOptions([]);
            setCityOptions([]);
        }
    }, [profile?.country]);

    useEffect(() => {
        if (profile?.state) {
            setCitySearchInput('');
            fetchCities();
        } else {
            setCityOptions([]);
        }
    }, [profile?.state]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setProfile(prev => prev ? { ...prev, [name]: value } : null);
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setProfileImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
            setProfile(prev => prev ? { ...prev, profileImageFile: file } : null);
        }
    };

    const handleCountryChange = (value: Option | null) => {
        if (value) {
            setProfile(prev => prev ? { ...prev, country: value.id, state: '', city: '' } : null);
            setCountrySearchInput(value.name);
        } else {
            setProfile(prev => prev ? { ...prev, country: '', state: '', city: '' } : null);
            setCountrySearchInput('');
        }
        setStateSearchInput('');
        setCitySearchInput('');
    };

    const handleStateChange = (value: Option | null) => {
        if (value) {
            setProfile(prev => prev ? { ...prev, state: value.id, city: '' } : null);
            setStateSearchInput(value.name);
        } else {
            setProfile(prev => prev ? { ...prev, state: '', city: '' } : null);
            setStateSearchInput('');
        }
        setCitySearchInput('');
    };

    const handleCityChange = (value: Option | null) => {
        if (value) {
            setProfile(prev => prev ? { ...prev, city: value.id } : null);
            setCitySearchInput(value.name);
        } else {
            setProfile(prev => prev ? { ...prev, city: '' } : null);
            setCitySearchInput('');
        }
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!profile) return;

        setSavingProfile(true);

        try {
            const formData = new FormData();

            Object.keys(profile).forEach(key => {
                const formKey = key as keyof Profile;
                const value = profile[formKey];

                if (
                    formKey !== 'profileImage' &&
                    formKey !== 'profileImageFile' &&
                    formKey !== 'profileImageUrl'
                ) {
                    formData.append(formKey, value !== undefined && value !== null ? String(value) : '');
                }
            });

            if (profile.profileImageFile) {
                formData.append('profileImage', profile.profileImageFile);
            }
            await axios.put(Constants.UPDATE_PROFILE_URL, formData, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setSavingProfile(false);
            setFormErrors({});
            toast.success('Profile updated successfully.');
        } catch (error) {
            const AxiosError = error as AxiosError<{ errors: FormErrors }>;
            if (AxiosError?.response?.data?.errors) setFormErrors(AxiosError.response.data.errors);
            setSavingProfile(false);
        }
    };

    const sectionHeaderClass = "flex items-center gap-2 px-5 py-4 border-b border-border text-lg font-semibold text-heading";

    if (loadingProfile) {
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
                <SubmitButton
                    form="account-settings-form"
                    isDisabled={savingProfile}
                    isLoading={savingProfile}
                    mode="edit"
                />
            </PageHeader>
            <form id="account-settings-form" onSubmit={handleSubmit} className="space-y-6">
                <Card
                    padded={false}
                    header={
                        <div className={sectionHeaderClass}>
                            <User className="w-5 h-5 text-purple-600" />
                            General Information
                        </div>
                    }
                >
                    <div className="p-5">
                        <div className="flex flex-col sm:flex-row items-center mb-8">
                            <img
                                src={profileImagePreview || "https://placehold.co/120x120/E0BBE4/FFFFFF?text=Profile"}
                                alt="Profile"
                                className="w-32 h-32 md:w-36 md:h-36 rounded-full object-cover border border-border mb-4 sm:mb-0 sm:mr-6"
                                onError={(e) => {
                                    e.currentTarget.onerror = null;
                                    e.currentTarget.src = "https://placehold.co/120x120/E0BBE4/FFFFFF?text=Profile";
                                }}
                            />
                            <div className="flex flex-col items-center sm:items-start">
                                <input
                                    ref={profileImageInputRef}
                                    type="file"
                                    id="profileImage"
                                    name="profileImage"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleImageChange}
                                />
                                <Button
                                    type="button"
                                    variant="primary"
                                    onClick={() => profileImageInputRef.current?.click()}
                                >
                                    Upload New Photo
                                </Button>
                                <p className="text-xs text-body mt-2 text-center sm:text-left">
                                    Recommended: 150×150px. JPG, PNG, or JPEG.
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <FormField
                                label="First Name"
                                required
                                id="firstName"
                                name="firstName"
                                type="text"
                                value={profile?.firstName || ''}
                                onChange={handleChange}
                                error={formErrors.firstName}
                            />
                            <FormField
                                label="Last Name"
                                id="lastName"
                                name="lastName"
                                type="text"
                                value={profile?.lastName || ''}
                                onChange={handleChange}
                                error={formErrors.lastName}
                            />
                            <FormField
                                label="Email"
                                required
                                id="email"
                                name="email"
                                type="email"
                                value={profile?.email || ''}
                                onChange={handleChange}
                                error={formErrors.email}
                            />
                            <FormField
                                label="Mobile Number"
                                required
                                id="phone"
                                name="phone"
                                type="tel"
                                value={profile?.phone || ''}
                                onChange={handleChange}
                                error={formErrors.phone}
                            />
                            <Select
                                label="Gender"
                                id="gender"
                                name="gender"
                                value={profile?.gender || ''}
                                onChange={handleChange}
                                error={formErrors.gender}
                                options={[
                                    { value: '', label: 'Select Gender' },
                                    { value: 'male', label: 'Male' },
                                    { value: 'female', label: 'Female' },
                                    { value: 'other', label: 'Other' },
                                ]}
                            />
                            <div>
                                <DateInput
                                    label="Date of Birth"
                                    value={ymdStringToDate(profile?.dateOfBirth)}
                                    onChange={(date) =>
                                        setProfile((prev) => (prev ? { ...prev, dateOfBirth: dateToYmdString(date) } : null))
                                    }
                                />
                                {formErrors.dateOfBirth && <p className="mt-1 text-sm text-danger">{formErrors.dateOfBirth}</p>}
                            </div>
                        </div>
                    </div>
                </Card>

                <Card
                    padded={false}
                    header={
                        <div className={sectionHeaderClass}>
                            <MapPin className="w-5 h-5 text-purple-600" />
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
                            value={profile?.address || ''}
                            onChange={handleChange}
                            error={formErrors.address}
                            containerClassName="md:col-span-2"
                        />

                        <FormField label="Country" required error={formErrors.country}>
                            {(field) => (
                                <SearchableDropdown
                                    id={field.id}
                                    aria-invalid={field['aria-invalid']}
                                    aria-describedby={field['aria-describedby']}
                                    options={countryOptions}
                                    placeholder={loadingCountries ? 'Loading...' : 'Select Country'}
                                    value={countryOptions.find(option => option.id === profile?.country) || null}
                                    inputValue={countrySearchInput}
                                    onInputChange={(_, value) => setCountrySearchInput(value)}
                                    onChange={(_, value) => handleCountryChange(value)}
                                    disabled={loadingCountries}
                                    loading={loadingCountries}
                                />
                            )}
                        </FormField>

                        <FormField label="State" required error={formErrors.state}>
                            {(field) => (
                                <SearchableDropdown
                                    id={field.id}
                                    aria-invalid={field['aria-invalid']}
                                    aria-describedby={field['aria-describedby']}
                                    options={stateOptions}
                                    placeholder={loadingStates ? 'Loading...' : 'Select State'}
                                    value={stateOptions.find(option => option.id === profile?.state) || null}
                                    inputValue={stateSearchInput}
                                    onInputChange={(_, value) => setStateSearchInput(value)}
                                    onChange={(_, value) => handleStateChange(value)}
                                    disabled={!profile?.country || loadingStates}
                                    loading={loadingStates}
                                />
                            )}
                        </FormField>

                        <FormField label="City" required error={formErrors.city}>
                            {(field) => (
                                <SearchableDropdown
                                    id={field.id}
                                    aria-invalid={field['aria-invalid']}
                                    aria-describedby={field['aria-describedby']}
                                    options={cityOptions}
                                    placeholder={loadingCities ? 'Loading...' : 'Select City'}
                                    value={cityOptions.find(option => option.id === profile?.city) || null}
                                    inputValue={citySearchInput}
                                    onInputChange={(_, value) => setCitySearchInput(value)}
                                    onChange={(_, value) => handleCityChange(value)}
                                    disabled={!profile?.state || loadingCities}
                                    loading={loadingCities}
                                />
                            )}
                        </FormField>

                        <FormField
                            label="Postal Code"
                            required
                            id="postalCode"
                            name="postalCode"
                            type="text"
                            value={profile?.postalCode || ''}
                            onChange={handleChange}
                            error={formErrors.postalCode}
                        />
                    </div>
                </Card>

            </form>

            {user?.user_type === 1 && (
                <Card
                    className="mt-6"
                    padded={false}
                    header={
                        <div className={sectionHeaderClass}>
                            <DatabaseIcon className="w-5 h-5 text-purple-600" />
                            Data &amp; Backup
                        </div>
                    }
                >
                    <div className="p-5">
                        <p className="text-sm text-body mb-4">
                            Download a complete backup of your company data (all records, exported as a ZIP archive).
                        </p>
                        <ExportButton
                            url={Constants.EXPORT_BACKUP_URL}
                            filename="kanakku-backup.zip"
                            label="Download full backup (.zip)"
                            variant="primary"
                        />
                    </div>
                </Card>
            )}
        </div>
    );
};

export default AccountSettings;