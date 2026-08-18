import { useEffect, useState } from "react";
import Modal from "./Modal";
import axios, { AxiosError } from "axios";
import Constants from "@constants/api";
import type { RootState } from "@store/index";
import { useSelector } from "react-redux";
import SubmitButton from "./SubmitButton";
import { toast } from "sonner";
import type { Customer } from "@models/customer";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (newCustomer: Customer) => void;
}

interface BillingAddressFormData {
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    country: string;
    pincode: string;
}

interface CustomerFormData {
    name: string;
    email: string;
    phone: string;
    billingAddress: BillingAddressFormData;
}

const CreateCustomerForm: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
    const setInitialFormData = (): CustomerFormData => ({
        name: '',
        email: '',
        phone: '',
        billingAddress: {
            addressLine1: '',
            addressLine2: '',
            city: '',
            state: '',
            country: '',
            pincode: '',
        },
    });
    const { token } = useSelector((state: RootState) => state.auth);
    const [formData, setFormData] = useState<CustomerFormData>(setInitialFormData());
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Reset form whenever modal opens
    useEffect(() => {
        if (isOpen) {
            setFormData(setInitialFormData());
            setFormErrors({});
        }
    }, [isOpen]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        setFormErrors(prev => ({ ...prev, [name]: '' }));
    }

    const handleBillingAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            billingAddress: { ...prev.billingAddress, [name]: value },
        }));
    }

    const validateForm = () => {
        const errors: { [key: string]: string } = {};
        if (!formData.name.trim()) errors.name = 'Name is required';
        if (!formData.email.trim()) errors.email = 'Email is required';
        if (!formData.phone.trim()) errors.phone = 'Phone is required';
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) return;
        try {
            setIsSubmitting(true);
            const response = await axios.post(Constants.CREATE_CUSTOMER_MINIMAL_URL, formData, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            toast.success("Customer created successfully!");
            onSuccess(response.data.data || {});
        } catch (error) {
            const axiosError = error as AxiosError as any;
            if (axiosError.response && (axiosError.response.status === 422 || axiosError.response.status === 409)) {
                setFormErrors(axiosError.response.data.errors);
            }
        } finally {
            setIsSubmitting(false);
        }

    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Create Customer">
            <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-1 gap-6 pt-6">
                    <div>
                        <label className="block font-medium text-sm text-red-500 mb-1">
                            Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            name="name"
                            value={formData.name}
                            onChange={handleInputChange}
                            type="text"
                            placeholder="Enter Name"
                            className="border border-gray-300 rounded-md px-4 py-2 w-full text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600"
                        />
                        {formErrors.name && <p className="text-red-500 text-xs mt-1">{formErrors.name}</p>}
                    </div>
                    <div>
                        <label className="block font-medium text-sm text-red-500 mb-1">
                            Email <span className="text-red-500">*</span>
                        </label>
                        <input
                            name="email"
                            value={formData.email}
                            onChange={handleInputChange}
                            type="email"
                            placeholder="Enter Email"
                            className="border border-gray-300 rounded-md px-4 py-2 w-full text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600"
                        />
                        {formErrors.email && <p className="text-red-500 text-xs mt-1">{formErrors.email}</p>}
                    </div>
                    <div>
                        <label className="block font-medium text-sm text-red-500 mb-1">
                            Phone <span className="text-red-500">*</span>
                        </label>
                        <input
                            name="phone"
                            value={formData.phone}
                            onChange={(e) => {
                                let value = e.target.value;
                                value = value.replace(/\D/g, '');
                                if (value.length > 15) value = value.slice(0, 15);
                                setFormData(prev => ({ ...prev, phone: value }));
                                setFormErrors(prev => ({ ...prev, phone: '' }));
                            }}
                            type="tel"
                            placeholder="Enter Phone"
                            className="border border-gray-300 rounded-md px-4 py-2 w-full text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600"
                        />
                        {formErrors.phone && <p className="text-red-500 text-xs mt-1">{formErrors.phone}</p>}
                    </div>

                </div>

                {/* Billing Address (optional) — flows onto the invoice's Bill To block */}
                <div className="mt-6">
                    <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-200 pb-1 mb-3">Billing Address</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className="block font-medium text-sm text-gray-700 mb-1">Address Line 1</label>
                            <input
                                name="addressLine1"
                                value={formData.billingAddress.addressLine1}
                                onChange={handleBillingAddressChange}
                                type="text"
                                placeholder="Enter Address Line 1"
                                className="border border-gray-300 rounded-md px-4 py-2 w-full text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block font-medium text-sm text-gray-700 mb-1">Address Line 2</label>
                            <input
                                name="addressLine2"
                                value={formData.billingAddress.addressLine2}
                                onChange={handleBillingAddressChange}
                                type="text"
                                placeholder="Enter Address Line 2"
                                className="border border-gray-300 rounded-md px-4 py-2 w-full text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600"
                            />
                        </div>
                        <div>
                            <label className="block font-medium text-sm text-gray-700 mb-1">City</label>
                            <input
                                name="city"
                                value={formData.billingAddress.city}
                                onChange={handleBillingAddressChange}
                                type="text"
                                placeholder="Enter City"
                                className="border border-gray-300 rounded-md px-4 py-2 w-full text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600"
                            />
                        </div>
                        <div>
                            <label className="block font-medium text-sm text-gray-700 mb-1">State</label>
                            <input
                                name="state"
                                value={formData.billingAddress.state}
                                onChange={handleBillingAddressChange}
                                type="text"
                                placeholder="Enter State"
                                className="border border-gray-300 rounded-md px-4 py-2 w-full text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600"
                            />
                        </div>
                        <div>
                            <label className="block font-medium text-sm text-gray-700 mb-1">Country</label>
                            <input
                                name="country"
                                value={formData.billingAddress.country}
                                onChange={handleBillingAddressChange}
                                type="text"
                                placeholder="Enter Country"
                                className="border border-gray-300 rounded-md px-4 py-2 w-full text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600"
                            />
                        </div>
                        <div>
                            <label className="block font-medium text-sm text-gray-700 mb-1">Pincode</label>
                            <input
                                name="pincode"
                                value={formData.billingAddress.pincode}
                                onChange={handleBillingAddressChange}
                                type="text"
                                placeholder="Enter Pincode"
                                className="border border-gray-300 rounded-md px-4 py-2 w-full text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600"
                            />
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-md border border-gray-300 text-gray-700"
                    >
                        Cancel
                    </button>
                    <SubmitButton isDisabled={isSubmitting} isLoading={isSubmitting} mode="create">Create</SubmitButton>
                </div>
            </form>
        </Modal>
        );
}

export default CreateCustomerForm;
