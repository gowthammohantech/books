import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import axios, { AxiosError } from 'axios';
import { toast } from 'sonner';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import InputField from '@components/admin/InputField';
import CurrencySelect from '@components/admin/CurrencySelect';
import { useCurrencies } from '@hooks/useCurrencies';
import FullPageLoader from '@components/admin/FullPageLoader';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button, Badge } from '@components/ui';
import { Save } from 'lucide-react';
import useDateFormatter from '@hooks/useDateFormatter';

// ── Types ────────────────────────────────────────────────────────────────────

type DefaultTaxTreatment = 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'REVERSE_CHARGE' | 'OUT_OF_SCOPE';
type ContactStatus = 'ACTIVE' | 'HIDDEN';

interface CountryOption {
    id: string;
    name: string;
}

interface ContactFormData {
    // Identity
    firstName: string;
    lastName: string;
    organisation: string;
    showNameOnInvoice: boolean;
    // Comms
    email: string;
    billingEmail: string;
    telephone: string;
    mobile: string;
    // Address
    addressLine1: string;
    addressLine2: string;
    addressLine3: string;
    town: string;
    region: string;
    postcode: string;
    countryId: string;
    /** ISO-2 country code captured for EU cross-border reverse-charge detection */
    country: string;
    // Invoicing
    defaultPaymentTermDays: string;
    defaultTaxTreatment: DefaultTaxTreatment;
    vatRegNumber: string;
    /** Customer VAT number (UK/EU) used by the server tax engine */
    vatNumber: string;
    gstin: string;
    invoiceLanguage: string;
    invoiceSequencePrefix: string;
    useContactEmailSettings: boolean;
    // Currency
    currencyCode: string;
    // Status
    status: ContactStatus;
}

type ErrorResponse = {
    errors: { [key: string]: string };
    message?: string;
};

const initialFormData: ContactFormData = {
    firstName: '',
    lastName: '',
    organisation: '',
    showNameOnInvoice: false,
    email: '',
    billingEmail: '',
    telephone: '',
    mobile: '',
    addressLine1: '',
    addressLine2: '',
    addressLine3: '',
    town: '',
    region: '',
    postcode: '',
    countryId: '',
    country: '',
    defaultPaymentTermDays: '',
    defaultTaxTreatment: 'STANDARD',
    vatRegNumber: '',
    vatNumber: '',
    gstin: '',
    invoiceLanguage: '',
    invoiceSequencePrefix: '',
    useContactEmailSettings: false,
    currencyCode: '',
    status: 'ACTIVE',
};

// ── Component ─────────────────────────────────────────────────────────────────

const CONTACTS_URL = `${Constants.API_BASE_URL}/admin/contacts`;

const ContactForm: React.FC = () => {
    const { id } = useParams<{ id?: string }>();
    const isEditMode = !!id;
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);

    const [formData, setFormData] = useState<ContactFormData>(initialFormData);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isFetching, setIsFetching] = useState(isEditMode);
    // VIES verification status (read-only; set server-side on save when VIES is enabled)
    const [viesValid, setViesValid] = useState<boolean | null>(null);
    const [viesCheckedAt, setViesCheckedAt] = useState<string | null>(null);
    const { formatDate } = useDateFormatter();

    // Country dropdown
    const [countries, setCountries] = useState<CountryOption[]>([]);
    const [isLoadingCountries, setIsLoadingCountries] = useState(false);

    const { defaultCurrencyCode } = useCurrencies();

    // Seed currency default for new contacts
    useEffect(() => {
        if (!isEditMode && defaultCurrencyCode) {
            setFormData((prev) => ({
                ...prev,
                currencyCode: prev.currencyCode || defaultCurrencyCode,
            }));
        }
    }, [defaultCurrencyCode, isEditMode]);

    // Fetch countries on mount
    useEffect(() => {
        const fetchCountries = async () => {
            try {
                setIsLoadingCountries(true);
                const response = await axios.get(Constants.FETCH_COUNTRIES_URL, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const list: CountryOption[] = (response.data || []).map((c: { id: string | number; name: string }) => ({
                    id: String(c.id),
                    name: c.name,
                }));
                setCountries(list);
            } catch (error) {
                console.error('Failed to load countries:', error);
            } finally {
                setIsLoadingCountries(false);
            }
        };
        fetchCountries();
    }, [token]);

    // Load existing contact for edit mode
    useEffect(() => {
        if (!isEditMode) return;
        const fetchContact = async () => {
            try {
                setIsFetching(true);
                const response = await axios.get(`${CONTACTS_URL}/${id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = response.data.data;
                if (data) {
                    setFormData({
                        firstName: data.firstName || '',
                        lastName: data.lastName || '',
                        organisation: data.organisation || '',
                        showNameOnInvoice: data.showNameOnInvoice ?? false,
                        email: data.email || '',
                        billingEmail: data.billingEmail || '',
                        telephone: data.telephone || '',
                        mobile: data.mobile || '',
                        addressLine1: data.addressLine1 || '',
                        addressLine2: data.addressLine2 || '',
                        addressLine3: data.addressLine3 || '',
                        town: data.town || '',
                        region: data.region || '',
                        postcode: data.postcode || '',
                        countryId: data.countryId ? String(data.countryId) : '',
                        country: data.country || '',
                        defaultPaymentTermDays: data.defaultPaymentTermDays != null ? String(data.defaultPaymentTermDays) : '',
                        defaultTaxTreatment: data.defaultTaxTreatment || 'STANDARD',
                        vatRegNumber: data.vatRegNumber || '',
                        vatNumber: data.vatNumber || '',
                        gstin: data.gstin || '',
                        invoiceLanguage: data.invoiceLanguage || '',
                        invoiceSequencePrefix: data.invoiceSequencePrefix || '',
                        useContactEmailSettings: data.useContactEmailSettings ?? false,
                        currencyCode: data.currencyCode || defaultCurrencyCode || '',
                        status: data.status || 'ACTIVE',
                    });
                    setViesValid(data.viesValid ?? null);
                    setViesCheckedAt(data.viesCheckedAt ?? null);
                }
            } catch (error) {
                console.error('Error fetching contact:', error);
                toast.error('Failed to load contact.');
            } finally {
                setIsFetching(false);
            }
        };
        fetchContact();
    }, [id, isEditMode, token]);

    const handleFormChange = (field: keyof ContactFormData, value: string | boolean) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        if (formErrors[field]) {
            setFormErrors((prev) => ({ ...prev, [field]: '' }));
        }
    };

    // Client-side identity validation: need org OR (firstName + lastName)
    const validateForm = (): boolean => {
        setFormErrors({});
        const errors: { [key: string]: string } = {};

        const hasOrg = formData.organisation.trim().length > 0;
        const hasFirstName = formData.firstName.trim().length > 0;
        const hasLastName = formData.lastName.trim().length > 0;

        if (!hasOrg && !(hasFirstName && hasLastName)) {
            errors.identity = 'Provide an organisation name, or both a first name and last name.';
        }

        if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            errors.email = 'Email is not valid.';
        }

        if (formData.billingEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.billingEmail)) {
            errors.billingEmail = 'Billing email is not valid.';
        }

        if (formData.defaultPaymentTermDays.trim()) {
            const days = Number(formData.defaultPaymentTermDays);
            if (!Number.isInteger(days) || days < 0) {
                errors.defaultPaymentTermDays = 'Payment terms must be a non-negative whole number.';
            }
        }

        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            if (errors.identity) {
                toast.error(errors.identity);
            } else {
                toast.error('Please fix the errors in the form.');
            }
            return false;
        }
        return true;
    };

    const buildPayload = () => ({
        firstName: formData.firstName.trim() || null,
        lastName: formData.lastName.trim() || null,
        organisation: formData.organisation.trim() || null,
        showNameOnInvoice: formData.showNameOnInvoice,
        email: formData.email.trim() || null,
        billingEmail: formData.billingEmail.trim() || null,
        telephone: formData.telephone.trim() || null,
        mobile: formData.mobile.trim() || null,
        addressLine1: formData.addressLine1.trim() || null,
        addressLine2: formData.addressLine2.trim() || null,
        addressLine3: formData.addressLine3.trim() || null,
        town: formData.town.trim() || null,
        region: formData.region.trim() || null,
        postcode: formData.postcode.trim() || null,
        countryId: formData.countryId || null,
        country: formData.country.trim().toUpperCase() || null,
        defaultPaymentTermDays: formData.defaultPaymentTermDays.trim() ? Number(formData.defaultPaymentTermDays) : null,
        defaultTaxTreatment: formData.defaultTaxTreatment,
        vatRegNumber: formData.vatRegNumber.trim() || null,
        vatNumber: formData.vatNumber.trim() || null,
        gstin: formData.gstin.trim() || null,
        invoiceLanguage: formData.invoiceLanguage.trim() || null,
        invoiceSequencePrefix: formData.invoiceSequencePrefix.trim() || null,
        useContactEmailSettings: formData.useContactEmailSettings,
        currencyCode: formData.currencyCode || null,
        status: formData.status,
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) return;

        try {
            setIsSubmitting(true);
            const payload = buildPayload();

            if (isEditMode) {
                await axios.put(`${CONTACTS_URL}/${id}`, payload, {
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                });
                toast.success('Contact updated successfully');
            } else {
                await axios.post(CONTACTS_URL, payload, {
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                });
                toast.success('Contact created successfully');
            }
            navigate('/admin/contacts');
        } catch (error) {
            const axiosError = error as AxiosError<ErrorResponse>;
            const data = axiosError.response?.data;
            if (data?.errors) {
                setFormErrors(data.errors);
                if (data.errors.identity) {
                    toast.error(data.errors.identity);
                } else {
                    toast.error('Please fix the errors in the form.');
                }
            } else {
                toast.error(data?.message || 'Something went wrong. Please try again.');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Shared select class ───────────────────────────────────────────────────

    const selectClass = 'mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-purple-600 focus:border-purple-600 sm:text-sm text-gray-950 disabled:bg-gray-50';

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <>
            <PageHeader title={isEditMode ? 'Edit Contact' : 'New Contact'}>
                <Button
                    variant="white"
                    onClick={() => navigate('/admin/contacts')}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    form="contact-form"
                    disabled={isSubmitting}
                    leftIcon={<Save size={16} />}
                >
                    {isEditMode ? 'Save Changes' : 'Create'}
                </Button>
            </PageHeader>
            <div className="p-6 bg-white rounded-card shadow-card border border-border">
                <form id="contact-form" className="space-y-8" onSubmit={handleSubmit}>

                    {/* ── Identity ──────────────────────────────────────────── */}
                    <section>
                        <h3 className="text-lg font-semibold leading-6 text-gray-950 border-b border-gray-200 pb-2 mb-6">
                            Identity
                        </h3>
                        {formErrors.identity && (
                            <p className="mb-4 text-sm text-red-500">{formErrors.identity}</p>
                        )}
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-6">
                            <InputField
                                id="contactFirstName"
                                label="First Name"
                                value={formData.firstName}
                                onChange={(e) => handleFormChange('firstName', e.target.value)}
                                placeholder="Enter first name"
                                className="sm:col-span-2"
                                error={formErrors.firstName}
                            />
                            <InputField
                                id="contactLastName"
                                label="Last Name"
                                value={formData.lastName}
                                onChange={(e) => handleFormChange('lastName', e.target.value)}
                                placeholder="Enter last name"
                                className="sm:col-span-2"
                                error={formErrors.lastName}
                            />
                            <InputField
                                id="contactOrganisation"
                                label="Organisation"
                                value={formData.organisation}
                                onChange={(e) => handleFormChange('organisation', e.target.value)}
                                placeholder="Enter organisation name"
                                className="sm:col-span-2"
                                error={formErrors.organisation}
                            />
                            <div className="sm:col-span-6 flex items-center gap-3">
                                <input
                                    id="contactShowNameOnInvoice"
                                    type="checkbox"
                                    checked={formData.showNameOnInvoice}
                                    onChange={(e) => handleFormChange('showNameOnInvoice', e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-600"
                                />
                                <label htmlFor="contactShowNameOnInvoice" className="text-sm text-gray-700">
                                    Show name on invoice
                                </label>
                            </div>
                        </div>
                    </section>

                    {/* ── Communications ────────────────────────────────────── */}
                    <section>
                        <h3 className="text-lg font-semibold leading-6 text-gray-950 border-b border-gray-200 pb-2 mb-6">
                            Communications
                        </h3>
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-6">
                            <InputField
                                id="contactEmail"
                                label="Email"
                                type="email"
                                value={formData.email}
                                onChange={(e) => handleFormChange('email', e.target.value)}
                                placeholder="Enter email address"
                                className="sm:col-span-3"
                                error={formErrors.email}
                            />
                            <InputField
                                id="contactBillingEmail"
                                label="Billing Email"
                                type="email"
                                value={formData.billingEmail}
                                onChange={(e) => handleFormChange('billingEmail', e.target.value)}
                                placeholder="Enter billing email"
                                className="sm:col-span-3"
                                error={formErrors.billingEmail}
                            />
                            <InputField
                                id="contactTelephone"
                                label="Telephone"
                                value={formData.telephone}
                                onChange={(e) => handleFormChange('telephone', e.target.value)}
                                placeholder="Enter telephone number"
                                className="sm:col-span-3"
                                error={formErrors.telephone}
                            />
                            <InputField
                                id="contactMobile"
                                label="Mobile"
                                value={formData.mobile}
                                onChange={(e) => handleFormChange('mobile', e.target.value)}
                                placeholder="Enter mobile number"
                                className="sm:col-span-3"
                                error={formErrors.mobile}
                            />
                        </div>
                    </section>

                    {/* ── Address ───────────────────────────────────────────── */}
                    <section>
                        <h3 className="text-lg font-semibold leading-6 text-gray-950 border-b border-gray-200 pb-2 mb-6">
                            Address
                        </h3>
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-6">
                            <InputField
                                id="contactAddressLine1"
                                label="Address Line 1"
                                value={formData.addressLine1}
                                onChange={(e) => handleFormChange('addressLine1', e.target.value)}
                                placeholder="Enter address line 1"
                                className="sm:col-span-6"
                                error={formErrors.addressLine1}
                            />
                            <InputField
                                id="contactAddressLine2"
                                label="Address Line 2"
                                value={formData.addressLine2}
                                onChange={(e) => handleFormChange('addressLine2', e.target.value)}
                                placeholder="Enter address line 2"
                                className="sm:col-span-6"
                                error={formErrors.addressLine2}
                            />
                            <InputField
                                id="contactAddressLine3"
                                label="Address Line 3"
                                value={formData.addressLine3}
                                onChange={(e) => handleFormChange('addressLine3', e.target.value)}
                                placeholder="Enter address line 3"
                                className="sm:col-span-6"
                                error={formErrors.addressLine3}
                            />
                            <InputField
                                id="contactTown"
                                label="Town / City"
                                value={formData.town}
                                onChange={(e) => handleFormChange('town', e.target.value)}
                                placeholder="Enter town or city"
                                className="sm:col-span-2"
                                error={formErrors.town}
                            />
                            <InputField
                                id="contactRegion"
                                label="Region / State"
                                value={formData.region}
                                onChange={(e) => handleFormChange('region', e.target.value)}
                                placeholder="Enter region or state"
                                className="sm:col-span-2"
                                error={formErrors.region}
                            />
                            <InputField
                                id="contactPostcode"
                                label="Postcode"
                                value={formData.postcode}
                                onChange={(e) => handleFormChange('postcode', e.target.value)}
                                placeholder="Enter postcode"
                                className="sm:col-span-2"
                                error={formErrors.postcode}
                            />
                            <div className="sm:col-span-3">
                                <label htmlFor="contactCountry" className="block text-sm font-medium text-gray-700">
                                    Country
                                </label>
                                <select
                                    id="contactCountry"
                                    value={formData.countryId}
                                    onChange={(e) => handleFormChange('countryId', e.target.value)}
                                    disabled={isLoadingCountries}
                                    className={selectClass}
                                >
                                    <option value="">
                                        {isLoadingCountries ? 'Loading...' : '— Select country —'}
                                    </option>
                                    {countries.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                                {formErrors.countryId && (
                                    <p className="mt-1 text-sm text-red-500">{formErrors.countryId}</p>
                                )}
                            </div>
                            <InputField
                                id="contactCountryCode"
                                label="Country Code (ISO-2)"
                                value={formData.country}
                                onChange={(e) => handleFormChange('country', e.target.value.toUpperCase())}
                                placeholder="e.g. GB, DE, AU"
                                className="sm:col-span-3"
                                maxLength={2}
                                error={formErrors.country}
                            />
                        </div>
                    </section>

                    {/* ── Invoicing ─────────────────────────────────────────── */}
                    <section>
                        <h3 className="text-lg font-semibold leading-6 text-gray-950 border-b border-gray-200 pb-2 mb-6">
                            Invoicing
                        </h3>
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-6">
                            <InputField
                                id="contactPaymentTermDays"
                                label="Default Payment Terms (days)"
                                type="number"
                                value={formData.defaultPaymentTermDays}
                                onChange={(e) => handleFormChange('defaultPaymentTermDays', e.target.value)}
                                placeholder="e.g. 30"
                                className="sm:col-span-2"
                                error={formErrors.defaultPaymentTermDays}
                            />

                            <div className="sm:col-span-2">
                                <label htmlFor="contactDefaultTaxTreatment" className="block text-sm font-medium text-gray-700">
                                    Default Tax Treatment
                                </label>
                                <select
                                    id="contactDefaultTaxTreatment"
                                    value={formData.defaultTaxTreatment}
                                    onChange={(e) => handleFormChange('defaultTaxTreatment', e.target.value as DefaultTaxTreatment)}
                                    className={selectClass}
                                >
                                    <option value="STANDARD">Standard</option>
                                    <option value="ZERO_RATED">Zero-rated</option>
                                    <option value="EXEMPT">Exempt</option>
                                    <option value="REVERSE_CHARGE">Reverse charge</option>
                                    <option value="OUT_OF_SCOPE">Out of scope</option>
                                </select>
                                {formErrors.defaultTaxTreatment && (
                                    <p className="mt-1 text-sm text-red-500">{formErrors.defaultTaxTreatment}</p>
                                )}
                            </div>

                            <InputField
                                id="contactVatRegNumber"
                                label="VAT Reg. Number"
                                value={formData.vatRegNumber}
                                onChange={(e) => handleFormChange('vatRegNumber', e.target.value)}
                                placeholder="Enter VAT registration number"
                                className="sm:col-span-2"
                                error={formErrors.vatRegNumber}
                            />
                            <div className="sm:col-span-2">
                                <InputField
                                    id="contactVatNumber"
                                    label="VAT Number (UK/EU)"
                                    value={formData.vatNumber}
                                    onChange={(e) => handleFormChange('vatNumber', e.target.value)}
                                    placeholder="e.g. DE123456789"
                                    error={formErrors.vatNumber}
                                />
                                {viesCheckedAt && (
                                    <p className="mt-1.5">
                                        {viesValid === true && (
                                            <Badge color="success">
                                                VIES verified
                                                <span className="text-xs font-normal opacity-80"> · {formatDate(viesCheckedAt)}</span>
                                            </Badge>
                                        )}
                                        {viesValid === false && (
                                            <Badge color="warning">
                                                VIES: not found
                                                <span className="text-xs font-normal opacity-80"> · {formatDate(viesCheckedAt)}</span>
                                            </Badge>
                                        )}
                                    </p>
                                )}
                            </div>
                            <InputField
                                id="contactGstin"
                                label="GSTIN"
                                value={formData.gstin}
                                onChange={(e) => handleFormChange('gstin', e.target.value)}
                                placeholder="Enter GSTIN"
                                className="sm:col-span-2"
                                error={formErrors.gstin}
                            />
                            <InputField
                                id="contactInvoiceLanguage"
                                label="Invoice Language"
                                value={formData.invoiceLanguage}
                                onChange={(e) => handleFormChange('invoiceLanguage', e.target.value)}
                                placeholder="e.g. en"
                                className="sm:col-span-2"
                                error={formErrors.invoiceLanguage}
                            />
                            <InputField
                                id="contactInvoiceSequencePrefix"
                                label="Invoice Sequence Prefix"
                                value={formData.invoiceSequencePrefix}
                                onChange={(e) => handleFormChange('invoiceSequencePrefix', e.target.value)}
                                placeholder="e.g. INV-"
                                className="sm:col-span-2"
                                error={formErrors.invoiceSequencePrefix}
                            />
                            <div className="sm:col-span-6 flex items-center gap-3">
                                <input
                                    id="contactUseContactEmailSettings"
                                    type="checkbox"
                                    checked={formData.useContactEmailSettings}
                                    onChange={(e) => handleFormChange('useContactEmailSettings', e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-600"
                                />
                                <label htmlFor="contactUseContactEmailSettings" className="text-sm text-gray-700">
                                    Use contact-level email settings
                                </label>
                            </div>
                        </div>
                    </section>

                    {/* ── Currency ──────────────────────────────────────────── */}
                    <section>
                        <h3 className="text-lg font-semibold leading-6 text-gray-950 border-b border-gray-200 pb-2 mb-6">
                            Currency
                        </h3>
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-6">
                            <div className="sm:col-span-2">
                                <CurrencySelect
                                    value={formData.currencyCode}
                                    onChange={(code) => handleFormChange('currencyCode', code)}
                                />
                            </div>
                        </div>
                    </section>

                    {/* ── Status ────────────────────────────────────────────── */}
                    <section>
                        <h3 className="text-lg font-semibold leading-6 text-gray-950 border-b border-gray-200 pb-2 mb-6">
                            Status
                        </h3>
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-6">
                            <div className="sm:col-span-2">
                                <label htmlFor="contactStatus" className="block text-sm font-medium text-gray-700">
                                    Contact Status
                                </label>
                                <select
                                    id="contactStatus"
                                    value={formData.status}
                                    onChange={(e) => handleFormChange('status', e.target.value as ContactStatus)}
                                    className={selectClass}
                                >
                                    <option value="ACTIVE">Active</option>
                                    <option value="HIDDEN">Hidden</option>
                                </select>
                            </div>
                        </div>
                    </section>

                </form>
            </div>

            {isFetching && <FullPageLoader />}
        </>
    );
};

export default ContactForm;
