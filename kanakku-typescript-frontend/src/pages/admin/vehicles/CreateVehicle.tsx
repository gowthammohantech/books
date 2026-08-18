import React, { useState, useEffect } from 'react';
import InputField from '@components/admin/InputField';
import SmartDropdown from '@components/admin/SmartDropdown';
import Switch from '@components/admin/Switch';
import axios, { AxiosError } from 'axios';
import Constants from '@constants/api';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useDebounce } from '@hooks/useDebounce';
import { PageHeader } from '@/context/PageHeaderContext';
import { Save } from 'lucide-react';
import { Button } from '@components/ui';

interface VehicleFormProps {
    vehicleData?: VehicleFormData | null;
}

export interface VehicleFormData {
    id?: string;
    customerId: string;
    customerName: string;
    name: string;
    make: string;
    model: string;
    year: string;
    registrationNumber: string;
    vin: string;
    mileage: string;
    notes: string;
    status: boolean;
}

interface CustomerOption {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    subLabel?: string;
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

const initialFormData: VehicleFormData = {
    customerId: '',
    customerName: '',
    name: '',
    make: '',
    model: '',
    year: '',
    registrationNumber: '',
    vin: '',
    mileage: '',
    notes: '',
    status: true,
};

const VehicleForm: React.FC<VehicleFormProps> = ({ vehicleData = null }) => {
    const [formData, setFormData] = useState<VehicleFormData>(initialFormData);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const { token } = useSelector((state: RootState) => state.auth);
    const [isEditMode, setIsEditMode] = useState(!!vehicleData);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();

    // Customer dropdown state
    const [customers, setCustomers] = useState<CustomerOption[]>([]);
    const [customerSearchInput, setCustomerSearchInput] = useState<string>('');
    const debouncedCustomerSearch = useDebounce(customerSearchInput, 400);
    const [isLoadingCustomers, setIsLoadingCustomers] = useState<boolean>(false);

    useEffect(() => {
        if (vehicleData) {
            setFormData({
                id: vehicleData.id,
                customerId: vehicleData.customerId || '',
                customerName: vehicleData.customerName || '',
                name: vehicleData.name || '',
                make: vehicleData.make || '',
                model: vehicleData.model || '',
                year: vehicleData.year || '',
                registrationNumber: vehicleData.registrationNumber || '',
                vin: vehicleData.vin || '',
                mileage: vehicleData.mileage || '',
                notes: vehicleData.notes || '',
                status: vehicleData.status,
            });
            setIsEditMode(true);
        }
    }, [vehicleData]);

    // Fetch customers (debounced search)
    useEffect(() => {
        const fetchCustomers = async () => {
            try {
                setIsLoadingCustomers(true);
                const response = await axios.get(Constants.GET_CUSTOMERS_WITH_SEARCH_URL, {
                    params: { search: debouncedCustomerSearch, limit: 100, page: 1 },
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                const rows: CustomerOption[] = (response.data?.data?.customers || []).map((c: { id: string; name: string; email?: string; phone?: string }) => ({
                    id: c.id,
                    name: c.name,
                    email: c.email,
                    phone: c.phone,
                    subLabel: c.email || c.phone || undefined,
                }));
                setCustomers(rows);
            } catch (error) {
                console.error('Failed to load customers:', error);
            } finally {
                setIsLoadingCustomers(false);
            }
        };
        fetchCustomers();
    }, [debouncedCustomerSearch, token]);

    const handleFormChange = (field: keyof VehicleFormData, value: string | boolean) => {
        if (field === 'year' || field === 'mileage') {
            const numericValue = typeof value === 'string' ? value.replace(/[^0-9]/g, '') : value;
            setFormData(prev => ({ ...prev, [field]: numericValue as string }));
        } else {
            setFormData(prev => ({ ...prev, [field]: value }));
        }
        if (formErrors[field]) {
            setFormErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    const validateForm = (): boolean => {
        const errors: { [key: string]: string } = {};

        if (!formData.customerId.trim()) {
            errors.customerId = 'Customer is required.';
        }
        if (formData.name && formData.name.length > 100) {
            errors.name = 'Name must be at most 100 characters.';
        }
        if (formData.make && formData.make.length > 50) {
            errors.make = 'Make must be at most 50 characters.';
        }
        if (formData.model && formData.model.length > 50) {
            errors.model = 'Model must be at most 50 characters.';
        }
        if (formData.year) {
            const y = Number(formData.year);
            if (!Number.isFinite(y) || y < 1900 || y > 2100) {
                errors.year = 'Year must be between 1900 and 2100.';
            }
        }
        if (formData.registrationNumber && formData.registrationNumber.length > 50) {
            errors.registrationNumber = 'Registration number must be at most 50 characters.';
        }
        if (formData.vin && formData.vin.length > 17) {
            errors.vin = 'VIN must be at most 17 characters.';
        }
        if (formData.mileage) {
            const m = Number(formData.mileage);
            if (!Number.isFinite(m) || m < 0) {
                errors.mileage = 'Mileage must be 0 or greater.';
            }
        }
        if (formData.notes && formData.notes.length > 500) {
            errors.notes = 'Notes must be at most 500 characters.';
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

    const buildPayload = () => {
        const payload: Record<string, unknown> = {
            customerId: formData.customerId,
            name: formData.name.trim() || null,
            make: formData.make.trim() || null,
            model: formData.model.trim() || null,
            year: formData.year ? Number(formData.year) : null,
            registrationNumber: formData.registrationNumber.trim() || null,
            vin: formData.vin.trim() || null,
            mileage: formData.mileage ? Number(formData.mileage) : null,
            notes: formData.notes.trim() || null,
            status: formData.status,
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
                await axios.put(`${Constants.UPDATE_VEHICLE_URL}/${formData.id}`, payload, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                });
                toast.success('Vehicle updated successfully');
            } else {
                await axios.post(Constants.CREATE_VEHICLE_URL, payload, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                });
                toast.success('Vehicle created successfully');
            }
            navigate('/admin/vehicles');
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

    const selectedCustomer: CustomerOption | null = formData.customerId
        ? (customers.find((c) => c.id === formData.customerId)
            || { id: formData.customerId, name: formData.customerName || '' })
        : null;

    return (
        <div className="p-6 bg-white rounded-card shadow-card border border-border overflow-x-auto">
            <PageHeader title={isEditMode ? 'Edit Vehicle' : 'Add Vehicle'}>
                <Button
                    variant="white"
                    onClick={() => navigate('/admin/vehicles')}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    form="vehicle-form"
                    disabled={isSubmitting}
                    leftIcon={<Save size={16} />}
                >
                    {isEditMode ? 'Save Changes' : 'Create'}
                </Button>
            </PageHeader>
            <form id="vehicle-form" className="space-y-8" onSubmit={handleSubmit}>
                <section>
                    <h3 className="text-lg font-semibold leading-6 text-gray-950 border-b border-gray-200 pb-2 mb-6">
                        Basic Details
                    </h3>
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-6">
                        <div className="sm:col-span-3">
                            <label className="block text-sm font-medium text-gray-700">
                                Customer <span className="text-red-500">*</span>
                            </label>
                            <SmartDropdown
                                items={customers}
                                value={customerSearchInput}
                                onChange={setCustomerSearchInput}
                                onSelect={(item) => {
                                    if (item) {
                                        handleFormChange('customerId', String(item.id));
                                        handleFormChange('customerName', item.name);
                                    } else {
                                        handleFormChange('customerId', '');
                                        handleFormChange('customerName', '');
                                    }
                                }}
                                selectedItem={selectedCustomer}
                                placeholder="Type to search customer"
                                loading={isLoadingCustomers}
                            />
                            {formErrors.customerId && (
                                <p className="mt-1 text-sm text-red-500">{formErrors.customerId}</p>
                            )}
                        </div>

                        <InputField
                            id="vehicleName"
                            label="Name"
                            value={formData.name}
                            onChange={(e) => handleFormChange('name', e.target.value)}
                            placeholder="e.g. Family SUV"
                            maxLength={100}
                            className="sm:col-span-3"
                            error={formErrors.name}
                        />

                        <InputField
                            id="vehicleMake"
                            label="Make"
                            value={formData.make}
                            onChange={(e) => handleFormChange('make', e.target.value)}
                            placeholder="e.g. Toyota"
                            maxLength={50}
                            className="sm:col-span-2"
                            error={formErrors.make}
                        />
                        <InputField
                            id="vehicleModel"
                            label="Model"
                            value={formData.model}
                            onChange={(e) => handleFormChange('model', e.target.value)}
                            placeholder="e.g. Camry"
                            maxLength={50}
                            className="sm:col-span-2"
                            error={formErrors.model}
                        />
                        <InputField
                            id="vehicleYear"
                            label="Year"
                            type="text"
                            value={formData.year}
                            onChange={(e) => handleFormChange('year', e.target.value)}
                            placeholder="e.g. 2022"
                            maxLength={4}
                            className="sm:col-span-2"
                            error={formErrors.year}
                        />

                        <InputField
                            id="vehicleRegistrationNumber"
                            label="Registration Number"
                            value={formData.registrationNumber}
                            onChange={(e) => handleFormChange('registrationNumber', e.target.value)}
                            placeholder="e.g. KA01AB1234"
                            maxLength={50}
                            className="sm:col-span-3"
                            error={formErrors.registrationNumber}
                        />
                        <InputField
                            id="vehicleVin"
                            label="VIN"
                            value={formData.vin}
                            onChange={(e) => handleFormChange('vin', e.target.value)}
                            placeholder="17-char Vehicle Identification Number"
                            maxLength={17}
                            className="sm:col-span-3"
                            error={formErrors.vin}
                        />

                        <InputField
                            id="vehicleMileage"
                            label="Mileage"
                            type="text"
                            value={formData.mileage}
                            onChange={(e) => handleFormChange('mileage', e.target.value)}
                            placeholder="e.g. 45000"
                            className="sm:col-span-2"
                            error={formErrors.mileage}
                        />

                        <div className="sm:col-span-4">
                            <label htmlFor="vehicleNotes" className="block text-sm font-medium text-gray-700">
                                Notes
                            </label>
                            <textarea
                                id="vehicleNotes"
                                name="vehicleNotes"
                                value={formData.notes}
                                onChange={(e) => handleFormChange('notes', e.target.value)}
                                placeholder="Enter any notes about this vehicle"
                                maxLength={500}
                                rows={3}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-600 focus:border-purple-600 sm:text-sm text-gray-950"
                            />
                            {formErrors.notes && <p className="mt-1 text-sm text-red-500">{formErrors.notes}</p>}
                        </div>

                        <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                            <div className="flex items-center gap-3">
                                <Switch
                                    name="vehicleStatus"
                                    checked={formData.status}
                                    onChange={(e) => handleFormChange('status', e.target.checked)}
                                />
                                <span className="text-sm text-gray-700">
                                    {formData.status ? 'Active' : 'Inactive'}
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

            </form>
        </div>
    );
};

export default VehicleForm;
