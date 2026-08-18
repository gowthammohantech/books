import { useEffect, useState } from "react";
import Modal from "@components/admin/Modal";
import axios, { AxiosError } from "axios";
import Constants from "@constants/api";
import type { RootState } from "@store/index";
import { useSelector } from "react-redux";
import SubmitButton from "@components/admin/SubmitButton";
import { toast } from "sonner";
import DynamicCustomFields from "@components/admin/DynamicCustomFields";
import ImageCropperUpload from "@components/common/ImageCropperUpload";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

interface BrandFormData {
    id: string;
    brand_name: string;
    status: boolean;
    brand_image: File | null;
    brandImageUrl: string;
}

const CreateBrandModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
    const setInitialFormData = (): BrandFormData => ({
        id: "",
        brand_name: "",
        status: true,
        brand_image: null,
        brandImageUrl: "",
    });
    const { token } = useSelector((state: RootState) => state.auth);
    const [formData, setFormData] = useState<BrandFormData>(setInitialFormData());
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [customFields, setCustomFields] = useState<Record<string, any>>({});
    const [activeCustomFields, setActiveCustomFields] = useState<any[]>([]);

    const handleCustomFieldChange = (fieldSlugOrId: string, value: any) => {
        setCustomFields(prev => ({ ...prev, [fieldSlugOrId]: value }));
    };

    // Reset form whenever modal opens
    useEffect(() => {
        if (isOpen) {
            setFormData(setInitialFormData());
            setFormErrors({});
            setCustomFields({});
        }
    }, [isOpen]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;

        setFormData(prev => {
            const updated = {
                ...prev,
                [name]: value,
            };
            return updated;
        });
    };


    const handleCroppedBrandImage = (file: File) => {
        setFormData(prev => ({
            ...prev,
            brand_image: file,
            brandImageUrl: URL.createObjectURL(file),
        }));
    };

    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};
        if (!formData.brand_name.trim()) {
            newErrors.brand_name = 'Brand name is required.';
        } else if (formData.brand_name.length < 3 || formData.brand_name.length > 50) {
            newErrors.brand_name = 'Brand name must be between 3 and 50 characters.';
        }
        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateForm()) return;

        const data = new FormData();
        data.append('brand_name', formData.brand_name);
        data.append('status', String(formData.status || false));

        if (formData.brand_image instanceof File) {
            data.append('brand_image', formData.brand_image);
        }

        // Append custom fields (slug→id resolved from loaded definitions)
        Object.entries(customFields)
            .filter(([, val]) => {
                if (val === undefined || val === null) return false;
                if (typeof val === 'string' && val.trim() === '') return false;
                if (Array.isArray(val) && val.length === 0) return false;
                return true;
            })
            .forEach(([fieldSlugOrId, val], index) => {
                const matchedField = activeCustomFields.find(f => f.fieldSlug === fieldSlugOrId || f.id === fieldSlugOrId);
                const finalFieldId = matchedField ? matchedField.id : fieldSlugOrId;
                data.append(`customFields[${index}][fieldId]`, finalFieldId);
                if (Array.isArray(val)) {
                    data.append(`customFields[${index}][value]`, val.join(','));
                } else if (val instanceof Date) {
                    const year = val.getFullYear();
                    const month = String(val.getMonth() + 1).padStart(2, '0');
                    const day = String(val.getDate()).padStart(2, '0');
                    data.append(`customFields[${index}][value]`, `${year}-${month}-${day}`);
                } else if (val instanceof File) {
                    data.append(`customField_${finalFieldId}`, val);
                } else {
                    data.append(`customFields[${index}][value]`, String(val));
                }
            });

        try {
            setIsSubmitting(true);
            await axios.post(Constants.CREATE_BRAND_URL, data, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
            });
            toast.success('Brand created successfully');
            onSuccess();
        } catch (error: any | AxiosError) {
            setFormErrors(error?.response?.data?.errors || {});
            toast.error('Something went wrong. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Create Brand">
            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Image Upload Section */}
                <div>
                    <label className="block text-sm font-medium text-red-500  mb-1">Brand Image *</label>
                    <ImageCropperUpload
                        value={formData.brandImageUrl || undefined}
                        aspect={1}
                        label="Upload Image"
                        onCropped={handleCroppedBrandImage}
                    />
                    {formErrors.brand_image && <p className="text-red-500 text-xs mt-1">{formErrors.brand_image}</p>}
                </div>
                {/* Name Input */}
                <div>
                    <label htmlFor="brand_name" className="block text-sm font-medium text-red-500  mb-1">Name *</label>
                    <input id="brand_name" name="brand_name" type="text" maxLength={50} value={formData.brand_name || ""} onChange={handleChange} placeholder="Enter Brand Name" className="w-full bg-white  text-gray-950  px-4 py-2 border border-gray-300  rounded-md text-sm focus:ring-purple-600 focus:border-purple-600" />
                    {formErrors.brand_name && <p className="text-red-500 text-xs mt-1">{formErrors.brand_name}</p>}
                </div>
                {/* Custom Fields */}
                <DynamicCustomFields
                    moduleSlug="brands"
                    values={customFields}
                    onChange={handleCustomFieldChange}
                    onFieldsLoaded={setActiveCustomFields}
                />

                {/* Form Buttons */}
                <div className="flex justify-end pt-2 space-x-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50 text-gray-700   cursor-pointer">Cancel</button>
                    <SubmitButton isDisabled={isSubmitting} isLoading={isSubmitting} mode={"create"} />
                </div>
            </form>
        </Modal>
    );
}

export default CreateBrandModal;
