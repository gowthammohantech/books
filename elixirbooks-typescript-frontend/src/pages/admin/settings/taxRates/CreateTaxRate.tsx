import React, { useState, useEffect } from 'react';
import Switch from '@components/admin/Switch';
import axios, { AxiosError } from 'axios';
import Constants from '@constants/api';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { TaxRegime, TaxKind } from '@models/taxRate';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button, Card, FormField, Select } from '@components/ui';
import { Save } from 'lucide-react';

interface TaxRateFormProps {
    taxRateData?: TaxRateFormData | null;
}

export interface TaxRateFormData {
    id?: string;
    name: string;
    rate: string; // kept as string in form state, parsed on submit
    regime: TaxRegime | '';
    taxKind: TaxKind | '';
    countryId: string;
    stateId: string;
    isActive: boolean;
}

interface ValidationError {
    path?: string;
    param?: string;
    msg?: string;
    message?: string;
}

type ErrorResponse = {
    success?: boolean;
    message?: string;
    errors?: ValidationError[] | Record<string, string>;
};

interface CountryOption {
    id: string;
    name: string;
}

interface StateOption {
    id: string;
    name: string;
}

const REGIME_OPTIONS: { value: TaxRegime; label: string }[] = [
    { value: 'GST_INDIA', label: 'GST (India)' },
    { value: 'VAT_GENERIC', label: 'VAT (Generic)' },
    { value: 'US_SALES_TAX', label: 'US Sales Tax' },
    { value: 'NONE', label: 'None' },
];

const TAX_KIND_OPTIONS: { value: TaxKind; label: string }[] = [
    { value: 'CGST', label: 'CGST' },
    { value: 'SGST', label: 'SGST' },
    { value: 'IGST', label: 'IGST' },
    { value: 'UTGST', label: 'UTGST' },
    { value: 'CESS', label: 'CESS' },
    { value: 'VAT', label: 'VAT' },
    { value: 'SALES_TAX', label: 'Sales Tax' },
];

const initialFormData: TaxRateFormData = {
    name: '',
    rate: '',
    regime: '',
    taxKind: '',
    countryId: '',
    stateId: '',
    isActive: true,
};

const regimeRequiresTaxKind = (regime: TaxRegime | ''): boolean =>
    regime === 'GST_INDIA' || regime === 'US_SALES_TAX';

const TaxRateForm: React.FC<TaxRateFormProps> = ({ taxRateData = null }) => {
    const [formData, setFormData] = useState<TaxRateFormData>(initialFormData);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const { token } = useSelector((state: RootState) => state.auth);
    const [isEditMode, setIsEditMode] = useState(!!taxRateData);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();

    const [countries, setCountries] = useState<CountryOption[]>([]);
    const [states, setStates] = useState<StateOption[]>([]);
    const [isLoadingCountries, setIsLoadingCountries] = useState(false);
    const [isLoadingStates, setIsLoadingStates] = useState(false);

    useEffect(() => {
        if (taxRateData) {
            setFormData({
                id: taxRateData.id,
                name: taxRateData.name || '',
                rate: taxRateData.rate || '',
                regime: taxRateData.regime || '',
                taxKind: taxRateData.taxKind || '',
                countryId: taxRateData.countryId || '',
                stateId: taxRateData.stateId || '',
                isActive: taxRateData.isActive,
            });
            setIsEditMode(true);
        }
    }, [taxRateData]);

    useEffect(() => {
        const fetchCountries = async () => {
            try {
                setIsLoadingCountries(true);
                const response = await axios.get(Constants.FETCH_COUNTRIES_URL, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                const list: CountryOption[] = (response.data || []).map((c: { id: string; name: string }) => ({
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

    useEffect(() => {
        if (!formData.countryId) {
            setStates([]);
            return;
        }
        const fetchStates = async () => {
            try {
                setIsLoadingStates(true);
                const response = await axios.get(`${Constants.FETCH_STATES_URL}/${formData.countryId}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                const list: StateOption[] = (response.data || []).map((s: { id: string; name: string }) => ({
                    id: String(s.id),
                    name: s.name,
                }));
                setStates(list);
            } catch (error) {
                console.error('Failed to load states:', error);
            } finally {
                setIsLoadingStates(false);
            }
        };
        fetchStates();
    }, [formData.countryId, token]);

    const handleFormChange = (field: keyof TaxRateFormData, value: string | boolean) => {
        setFormData((prev) => {
            const next: TaxRateFormData = { ...prev, [field]: value } as TaxRateFormData;
            // When regime changes, clear taxKind if no longer applicable
            if (field === 'regime') {
                if (!regimeRequiresTaxKind(value as TaxRegime | '')) {
                    next.taxKind = '';
                }
            }
            // When country changes, clear state
            if (field === 'countryId') {
                next.stateId = '';
            }
            return next;
        });
        if (formErrors[field]) {
            setFormErrors((prev) => ({ ...prev, [field]: '' }));
        }
    };

    const validateForm = (): boolean => {
        const errors: { [key: string]: string } = {};

        if (!formData.name.trim()) {
            errors.name = 'Name is required.';
        } else if (formData.name.length > 50) {
            errors.name = 'Name must be at most 50 characters.';
        }

        if (!formData.regime) {
            errors.regime = 'Regime is required.';
        }

        if (regimeRequiresTaxKind(formData.regime) && !formData.taxKind) {
            errors.taxKind = 'Tax kind is required for this regime.';
        }

        if (!formData.rate.trim()) {
            errors.rate = 'Rate is required.';
        } else {
            const rateNum = Number(formData.rate);
            if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100) {
                errors.rate = 'Rate must be a number between 0 and 100.';
            }
        }

        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            toast.error('Please fix the errors in the form.');
            return false;
        }
        setFormErrors({});
        return true;
    };

    const applyServerErrors = (errors: ErrorResponse['errors']) => {
        if (!errors) return;
        const mapped: { [key: string]: string } = {};
        if (Array.isArray(errors)) {
            errors.forEach((err) => {
                const key = err.path || err.param || '';
                const msg = err.msg || err.message || 'Invalid value';
                if (key) {
                    mapped[key] = msg;
                }
            });
        } else if (typeof errors === 'object') {
            Object.entries(errors).forEach(([key, value]) => {
                mapped[key] = String(value);
            });
        }
        if (Object.keys(mapped).length > 0) {
            setFormErrors(mapped);
        }
    };

    const buildPayload = (): Record<string, unknown> => {
        const payload: Record<string, unknown> = {
            name: formData.name.trim(),
            rate: Number(formData.rate),
            regime: formData.regime,
            taxKind: regimeRequiresTaxKind(formData.regime) ? formData.taxKind : null,
            countryId: formData.countryId || null,
            stateId: formData.stateId || null,
            isActive: formData.isActive,
        };
        return payload;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) return;

        try {
            setIsSubmitting(true);
            const payload = buildPayload();

            if (isEditMode && formData.id) {
                await axios.put(`${Constants.UPDATE_TAX_RATE_URL}/${formData.id}`, payload, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                });
                toast.success('Tax rate updated successfully');
            } else {
                await axios.post(Constants.CREATE_TAX_RATE_URL, payload, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                });
                toast.success('Tax rate created successfully');
            }
            navigate('/admin/settings/tax-rates');
        } catch (error) {
            const axiosError = error as AxiosError<ErrorResponse>;
            const data = axiosError.response?.data;
            if (data?.errors) {
                applyServerErrors(data.errors);
                toast.error('Please fix the errors in the form.');
            } else {
                toast.error(data?.message || 'Something went wrong. Please try again.');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const showTaxKind = regimeRequiresTaxKind(formData.regime);

    return (
        <div>
            <PageHeader title={isEditMode ? 'Edit Tax' : 'Add Tax'}>
                <Button
                    type="button"
                    variant="white"
                    onClick={() => navigate('/admin/settings/tax-rates')}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    form="tax-rate-form"
                    variant="primary"
                    disabled={isSubmitting}
                    isLoading={isSubmitting}
                    leftIcon={<Save size={16} />}
                >
                    {isEditMode ? 'Save Changes' : 'Create'}
                </Button>
            </PageHeader>
            <form id="tax-rate-form" onSubmit={handleSubmit}>
                <Card
                    padded={false}
                    header={
                        <div className="flex items-center gap-2 px-5 py-4 border-b border-border text-lg font-semibold text-heading">
                            Tax Details
                        </div>
                    }
                >
                    <div className="p-5 grid grid-cols-1 gap-6 sm:grid-cols-6">
                        <FormField
                            id="taxRateName"
                            label="Name"
                            value={formData.name}
                            onChange={(e) => handleFormChange('name', e.target.value)}
                            placeholder="e.g. CGST 9%"
                            maxLength={50}
                            required
                            containerClassName="sm:col-span-3"
                            error={formErrors.name}
                        />

                        <Select
                            id="taxRateRegime"
                            name="taxRateRegime"
                            label="Regime"
                            required
                            value={formData.regime}
                            onChange={(e) => handleFormChange('regime', e.target.value)}
                            containerClassName="sm:col-span-3"
                            placeholder="Select regime"
                            options={REGIME_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                            error={formErrors.regime}
                        />

                        {showTaxKind && (
                            <Select
                                id="taxRateKind"
                                name="taxRateKind"
                                label="Tax Kind"
                                required
                                value={formData.taxKind}
                                onChange={(e) => handleFormChange('taxKind', e.target.value)}
                                containerClassName="sm:col-span-3"
                                placeholder="Select tax kind"
                                options={TAX_KIND_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                                error={formErrors.taxKind}
                            />
                        )}

                        <FormField
                            id="taxRateRate"
                            label="Rate %"
                            type="number"
                            value={formData.rate}
                            onChange={(e) => handleFormChange('rate', e.target.value)}
                            placeholder="e.g. 9.5"
                            required
                            containerClassName="sm:col-span-3"
                            error={formErrors.rate}
                        />

                        <Select
                            id="taxRateCountry"
                            name="taxRateCountry"
                            label="Country"
                            value={formData.countryId}
                            onChange={(e) => handleFormChange('countryId', e.target.value)}
                            disabled={isLoadingCountries}
                            containerClassName="sm:col-span-3"
                            placeholder={isLoadingCountries ? 'Loading...' : '— Select country (optional) —'}
                            options={countries.map((c) => ({ value: c.id, label: c.name }))}
                            error={formErrors.countryId}
                        />

                        <Select
                            id="taxRateState"
                            name="taxRateState"
                            label="State"
                            value={formData.stateId}
                            onChange={(e) => handleFormChange('stateId', e.target.value)}
                            disabled={!formData.countryId || isLoadingStates}
                            containerClassName="sm:col-span-3"
                            placeholder={
                                !formData.countryId
                                    ? '— Select country first —'
                                    : isLoadingStates
                                        ? 'Loading...'
                                        : '— Select state (optional) —'
                            }
                            options={states.map((s) => ({ value: s.id, label: s.name }))}
                            error={formErrors.stateId}
                        />

                        <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-heading mb-2">Status</label>
                            <div className="flex items-center gap-3">
                                <Switch
                                    name="taxRateIsActive"
                                    checked={formData.isActive}
                                    onChange={(e) => handleFormChange('isActive', e.target.checked)}
                                />
                                <span className="text-sm text-body">
                                    {formData.isActive ? 'Active' : 'Inactive'}
                                </span>
                            </div>
                        </div>
                    </div>
                </Card>

            </form>
        </div>
    );
};

export default TaxRateForm;
