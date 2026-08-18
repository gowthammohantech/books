import React, { useState, useEffect } from 'react';
import { Save, Trash2Icon } from 'lucide-react';
import ImageCropperUpload from '@components/common/ImageCropperUpload';
import InputField from '@components/admin/InputField';
import axios, { AxiosError } from 'axios';
import Constants from '@constants/api';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import { useNavigate } from 'react-router-dom';
import { toast } from "sonner";
import CurrencySelect from '@components/admin/CurrencySelect';
import { PageHeader } from '@/context/PageHeaderContext';
import { useCurrencies } from '@hooks/useCurrencies';
import { isValidPhone, isValidPostalCode, PHONE_ERROR, POSTAL_CODE_ERROR } from '@utils/validation';

// Interface for props, allowing existing customer data to be passed for editing
interface CustomerFormProps {
    customerData?: CustomerFormData | null;
}

interface CustomerFormData {
    id?: string;
    name: string;
    email: string;
    phone: string;
    website: string;
    image: File | null;
    imagePreview: string | null;
    profile_image_removed: boolean;
    notes: string;
    status: boolean;
    currencyCode: string;
    billingName: string;
    billingAddressLine1: string;
    billingAddressLine2: string;
    billingCity: string;
    billingState: string;
    billingCountry: string;
    billingPincode: string;
    shippingName: string;
    shippingAddressLine1: string;
    shippingAddressLine2: string;
    shippingCity: string;
    shippingState: string;
    shippingCountry: string;
    shippingPincode: string;
    bankName: string;
    accountHolderName: string;
    accountNumber: string;
    IFSC: string;
    branch: string;
    _billingAddress?: any;
    _shippingAddress?: any;
    _bankDetails?: any;
}

const initialFormData: CustomerFormData = {
    name: '',
    email: '',
    phone: '',
    website: '',
    image: null,
    imagePreview: null,
    profile_image_removed: false,
    notes: '',
    status: true,
    currencyCode: '',
    billingName: '',
    billingAddressLine1: '',
    billingAddressLine2: '',
    billingCity: '',
    billingState: '',
    billingCountry: '',
    billingPincode: '',
    shippingName: '',
    shippingAddressLine1: '',
    shippingAddressLine2: '',
    shippingCity: '',
    shippingState: '',
    shippingCountry: '',
    shippingPincode: '',
    bankName: '',
    accountHolderName: '',
    accountNumber: '',
    IFSC: '',
    branch: '',
};

type ErrorResponse = {
    errors: { [key: string]: string };
};

const CustomerForm: React.FC<CustomerFormProps> = ({ customerData = null }) => {
    const [formData, setFormData] = useState<CustomerFormData>(initialFormData);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const { token } = useSelector((state: RootState) => state.auth);
    const [isEditMode, setIsEditMode] = useState(!!customerData);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();
    const { defaultCurrencyCode } = useCurrencies();

    // For new customers: seed currencyCode from the company default once it loads
    useEffect(() => {
        if (!customerData && defaultCurrencyCode) {
            setFormData(prev => ({
                ...prev,
                currencyCode: prev.currencyCode || defaultCurrencyCode,
            }));
        }
    }, [defaultCurrencyCode, customerData]);

    useEffect(() => {
        if (customerData) {
            setFormData({
                ...initialFormData,
                id: customerData.id,
                name: customerData.name || '',
                email: customerData.email || '',
                phone: customerData.phone || '',
                website: customerData.website || '',
                imagePreview: customerData.imagePreview || null,
                notes: customerData.notes || '',
                status: customerData.status,
                currencyCode: customerData.currencyCode || defaultCurrencyCode,
                billingName: customerData.billingName || '',
                billingAddressLine1: customerData.billingAddressLine1 || '',
                billingAddressLine2: customerData.billingAddressLine2 || '',
                billingCity: customerData.billingCity || '',
                billingState: customerData.billingState || '',
                billingCountry: customerData.billingCountry || '',
                billingPincode: customerData.billingPincode || '',
                shippingName: customerData.shippingName || '',
                shippingAddressLine1: customerData.shippingAddressLine1 || '',
                shippingAddressLine2: customerData.shippingAddressLine2 || '',
                shippingCity: customerData.shippingCity || '',
                shippingState: customerData.shippingState || '',
                shippingCountry: customerData.shippingCountry || '',
                shippingPincode: customerData.shippingPincode || '',
                bankName: customerData.bankName || '',
                accountHolderName: customerData.accountHolderName || '',
                accountNumber: customerData.accountNumber || '',
                IFSC: customerData.IFSC || '',
                branch: customerData.branch || '',
                image: null,
                profile_image_removed: false,
            });
            setIsEditMode(true);
        }
    }, [customerData]);


    const handleRemoveImage = () => {
        setFormData(prev => ({
            ...prev,
            image: null,
            imagePreview: null,
            profile_image_removed: true
        }));
    };

    const handleFormChange = (field: keyof CustomerFormData, value: any) => {
        // Store raw value — phone may contain +/()/-/spaces and postcodes may be
        // alphanumeric (UK), so we no longer strip to digits-only here.
        setFormData(prev => ({ ...prev, [field]: value }));
        if (formErrors[field]) {
            setFormErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    const handleCopyAddress = () => {
        setFormData(prev => ({
            ...prev,
            shippingName: prev.billingName,
            shippingAddressLine1: prev.billingAddressLine1,
            shippingAddressLine2: prev.billingAddressLine2,
            shippingCity: prev.billingCity,
            shippingState: prev.billingState,
            shippingCountry: prev.billingCountry,
            shippingPincode: prev.billingPincode,
        }));
        toast.info("Billing address copied to shipping address.");
    };

    const validateForm = () => {
        setFormErrors({});
        const errors: { [key: string]: string } = {};
        if (!formData.name.trim()) errors.name = 'Name is required.';
        if (formData.name.trim() && formData.name.trim().length < 3) errors.name = 'Name must be at least 3 characters.';
        if (!formData.email.trim()) errors.email = 'Email is required.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errors.email = 'Email is not valid.';
        if (!formData.phone.trim()) errors.phone = 'Phone is required.';
        if (formData.phone.trim() && !isValidPhone(formData.phone)) errors.phone = PHONE_ERROR;
        if (!formData.billingName.trim()) errors.billingName = 'Billing name is required.';
        if (!formData.billingAddressLine1.trim()) errors.billingAddressLine1 = 'Billing address is required.';
        if (!formData.billingCity.trim()) errors.billingCity = 'Billing city is required.';
        if (!formData.billingState.trim()) errors.billingState = 'Billing state is required.';
        if (!formData.billingCountry.trim()) errors.billingCountry = 'Billing country is required.';
        if (!formData.billingPincode.trim()) errors.billingPincode = 'Billing pincode is required.';
        else if (!isValidPostalCode(formData.billingPincode)) errors.billingPincode = `Billing pincode: ${POSTAL_CODE_ERROR}`;
        if (!formData.shippingName.trim()) errors.shippingName = 'Shipping name is required.';
        if (!formData.shippingAddressLine1.trim()) errors.shippingAddressLine1 = 'Shipping address is required.';
        if (!formData.shippingCity.trim()) errors.shippingCity = 'Shipping city is required.';
        if (!formData.shippingState.trim()) errors.shippingState = 'Shipping state is required.';
        if (!formData.shippingCountry.trim()) errors.shippingCountry = 'Shipping country is required.';
        if (!formData.shippingPincode.trim()) errors.shippingPincode = 'Shipping pincode is required.';
        else if (!isValidPostalCode(formData.shippingPincode)) errors.shippingPincode = `Shipping pincode: ${POSTAL_CODE_ERROR}`;

        if (formData.website.trim() && formData.website.trim().length < 3) errors.website = 'Website must be at least 3 characters.';
        if (formData.notes.trim() && formData.notes.trim().length < 3) errors.notes = 'Notes must be at least 3 characters.';

        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            toast.error('Please fix the errors in the form.');
            return false;
        }
        return true;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) return;

        const _formData = new FormData();
        _formData.append('name', formData.name);
        _formData.append('email', formData.email);
        _formData.append('phone', formData.phone);
        _formData.append('website', formData.website);
        _formData.append('notes', formData.notes);
        if (formData.currencyCode) {
            _formData.append('currencyCode', formData.currencyCode);
        }

        if (formData.image) {
            _formData.append('image', formData.image);
        }
        _formData.append('profile_image_removed', String(formData.profile_image_removed));

        const _billingAddress = {
            name: formData.billingName, addressLine1: formData.billingAddressLine1, addressLine2: formData.billingAddressLine2, city: formData.billingCity, state: formData.billingState, country: formData.billingCountry, pincode: formData.billingPincode
        };
        const _shippingAddress = {
            name: formData.shippingName, addressLine1: formData.shippingAddressLine1, addressLine2: formData.shippingAddressLine2, city: formData.shippingCity, state: formData.shippingState, country: formData.shippingCountry, pincode: formData.shippingPincode
        };
        const _bankDetails = {
            bankName: formData.bankName, accountHolderName: formData.accountHolderName, accountNumber: formData.accountNumber, IFSC: formData.IFSC, branch: formData.branch
        };

        _formData.append('billingAddress', JSON.stringify(_billingAddress));
        _formData.append('shippingAddress', JSON.stringify(_shippingAddress));
        _formData.append('bankDetails', JSON.stringify(_bankDetails));

        try {
            setIsSubmitting(true);
            if (isEditMode) {
                _formData.append('id', String(formData.id));
                await axios.put(`${Constants.UPDATE_CUSTOMER_URL}/${formData.id}`, _formData, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
                });
                toast.success('Customer updated successfully');
            } else {
                await axios.post(Constants.CREATE_CUSTOMER_URL, _formData, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
                });
                toast.success('Customer created successfully');
            }
            navigate('/admin/customers');
        } catch (error) {
            const axiosError = error as AxiosError<ErrorResponse>;

            if (axiosError.response?.data?.errors) {
                setFormErrors(axiosError.response.data.errors);
            }
            // Prefer the real backend reason (e.g. an invalid-image-type 400) over a
            // generic message so upload/validation failures are actionable.
            const backendMsg = (axiosError.response?.data as { message?: string } | undefined)?.message;
            toast.error(backendMsg || 'Something went wrong. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="p-6 bg-white  rounded-card shadow-card border border-border ">
            <PageHeader title={isEditMode ? 'Edit Customer' : 'Add Customer'}>
                <button
                    type="button"
                    onClick={() => navigate('/admin/customers')}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    form="customer-form"
                    disabled={isSubmitting}
                    className="px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md shadow-sm hover:bg-purple-700 focus:outline-none flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                    <Save size={16} />
                    {isEditMode ? 'Save Changes' : 'Create'}
                </button>
            </PageHeader>
            <form id="customer-form" className="space-y-8" onSubmit={handleSubmit}>
                <section>
                    <h3 className="text-lg font-semibold leading-6 text-gray-950  border-b border-gray-200  pb-2 mb-6">Basic Details</h3>
                    <div className="mb-6 flex items-center gap-5">
                        <ImageCropperUpload
                            value={formData.imagePreview || undefined}
                            aspect={1}
                            accept="image/png, image/jpeg"
                            label="Upload Image"
                            onCropped={(file) => setFormData(prev => ({
                                ...prev,
                                image: file,
                                imagePreview: URL.createObjectURL(file),
                                profile_image_removed: false,
                            }))}
                        />
                        {formData.imagePreview && (
                            <button
                                type="button"
                                onClick={handleRemoveImage}
                                className="text-sm font-medium text-red-600 hover:text-red-500 flex items-center gap-1 cursor-pointer"
                            >
                                <Trash2Icon size={14} />
                                Remove
                            </button>
                        )}
                    </div>
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-6">
                        <InputField id="customerName" label="Name" value={formData.name} onChange={e => handleFormChange('name', e.target.value)} placeholder="Enter Name" required className="sm:col-span-2" error={formErrors.name} />
                        <InputField id="customerEmail" label="Email" value={formData.email} onChange={e => handleFormChange('email', e.target.value)} placeholder="Enter Email Address" type="email" required className="sm:col-span-2" error={formErrors.email} />
                        <InputField id="customerPhone" label="Phone Number" placeholder="Enter Phone Number" value={formData.phone} onChange={e => handleFormChange('phone', e.target.value)} type="text" maxLength={15} required className="sm:col-span-2" error={formErrors.phone} />
                        <InputField id="customerWebsite" label="Website" placeholder="Enter Website" value={formData.website} onChange={e => handleFormChange('website', e.target.value)} className="sm:col-span-2" error={formErrors.website} />
                        <InputField id="customerNotes" label="Notes" placeholder="Enter Notes" value={formData.notes} onChange={e => handleFormChange('notes', e.target.value)} className="sm:col-span-2" error={formErrors.notes} />
                        <div className="sm:col-span-2">
                            <CurrencySelect
                                value={formData.currencyCode || defaultCurrencyCode}
                                onChange={(code) => handleFormChange('currencyCode', code)}
                            />
                        </div>
                    </div>
                </section>

                <section className="grid grid-cols-1 gap-x-8 gap-y-10 lg:grid-cols-2">
                    <div className="space-y-6">
                        <div className="flex justify-between items-center border-b border-gray-200  pb-2">
                            <h3 className="text-lg font-semibold leading-6 text-gray-950 ">Billing Address</h3>
                        </div>
                        <InputField id="billingName" label="Name" value={formData.billingName} onChange={e => handleFormChange('billingName', e.target.value)} placeholder="Enter Name" required error={formErrors.billingName} />
                        <InputField id="billingAddress1" label="Address Line 1" value={formData.billingAddressLine1} onChange={e => handleFormChange('billingAddressLine1', e.target.value)} placeholder="Enter Address Line 1" required error={formErrors.billingAddressLine1} />
                        <InputField id="billingAddress2" label="Address Line 2" value={formData.billingAddressLine2} onChange={e => handleFormChange('billingAddressLine2', e.target.value)} placeholder="Enter Address Line 2" error={formErrors.billingAddressLine2} />
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <InputField id="billingCountry" label="Country" value={formData.billingCountry} onChange={e => handleFormChange('billingCountry', e.target.value)} placeholder="Enter Country" required error={formErrors.billingCountry} />
                            <InputField id="billingState" label="State" value={formData.billingState} onChange={e => handleFormChange('billingState', e.target.value)} placeholder="Enter State" required error={formErrors.billingState} />
                        </div>
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <InputField id="billingCity" label="City" value={formData.billingCity} onChange={e => handleFormChange('billingCity', e.target.value)} placeholder="Enter City" required error={formErrors.billingCity} />
                            <InputField id="billingPincode" type='text' label="Pincode" maxLength={12} value={formData.billingPincode} onChange={e => handleFormChange('billingPincode', e.target.value)} placeholder="Enter Pincode" required error={formErrors.billingPincode} />
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="flex justify-between items-center border-b border-gray-200  pb-2">
                            <h3 className="text-lg font-semibold leading-6 text-gray-950 ">Shipping Address</h3>
                            {/* FIX: Added onClick handler */}
                            <button type="button" onClick={handleCopyAddress} className="text-sm font-medium text-purple-600 hover:text-purple-600">
                                ⎘ Copy From Billing
                            </button>
                        </div>
                        <InputField id="shippingName" label="Name" placeholder="Enter Name" required value={formData.shippingName} onChange={e => handleFormChange('shippingName', e.target.value)} error={formErrors.shippingName} />
                        <InputField id="shippingAddress1" label="Address Line 1" value={formData.shippingAddressLine1} onChange={e => handleFormChange('shippingAddressLine1', e.target.value)} placeholder="Enter Address Line 1" required error={formErrors.shippingAddressLine1} />
                        <InputField id="shippingAddress2" label="Address Line 2" value={formData.shippingAddressLine2} onChange={e => handleFormChange('shippingAddressLine2', e.target.value)} placeholder="Enter Address Line 2" error={formErrors.shippingAddressLine2} />
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <InputField id="shippingCountry" label="Country" value={formData.shippingCountry} onChange={e => handleFormChange('shippingCountry', e.target.value)} placeholder="Enter Country" required error={formErrors.shippingCountry} />
                            <InputField id="shippingState" label="State" value={formData.shippingState} onChange={e => handleFormChange('shippingState', e.target.value)} placeholder="Enter State" required error={formErrors.shippingState} />
                        </div>
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <InputField id="shippingCity" label="City" value={formData.shippingCity} onChange={e => handleFormChange('shippingCity', e.target.value)} placeholder="Enter City" required error={formErrors.shippingCity} />
                            <InputField id="shippingPincode" type='text' label="Pincode" maxLength={12} value={formData.shippingPincode} onChange={e => handleFormChange('shippingPincode', e.target.value)} placeholder="Enter Pincode" required error={formErrors.shippingPincode} />
                        </div>
                    </div>
                </section>

                <section>
                    <h3 className="text-lg font-semibold leading-6 text-gray-950  border-b border-gray-200  pb-2 mb-6">Banking Details (Optional)</h3>
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                        <InputField id="bankName" label="Bank Name" value={formData.bankName} onChange={e => handleFormChange('bankName', e.target.value)} placeholder="Enter Bank Name" error={formErrors.bankName} />
                        <InputField id="bankBranch" label="Branch" value={formData.branch} onChange={e => handleFormChange('branch', e.target.value)} placeholder="Enter Branch Name" error={formErrors.branch} />
                        <InputField id="bankAccountHolder" label="Account Holder" value={formData.accountHolderName} onChange={e => handleFormChange('accountHolderName', e.target.value)} placeholder="Enter Account Holder Name" error={formErrors.accountHolderName} />
                    </div>
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 mt-6">
                        <InputField id="bankAccountNumber" label="Account Number" value={formData.accountNumber} onChange={e => handleFormChange('accountNumber', e.target.value)} placeholder="Enter Account Number" error={formErrors.accountNumber} />
                        <InputField id="bankIfsc" label="IFSC" value={formData.IFSC} onChange={e => handleFormChange('IFSC', e.target.value)} placeholder="Enter IFSC Code" error={formErrors.IFSC} />
                    </div>
                </section>

            </form>
        </div>
    );
};

export default CustomerForm;