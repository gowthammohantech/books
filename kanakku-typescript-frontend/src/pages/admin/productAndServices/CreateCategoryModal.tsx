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

interface CategoryFormData {
    id: string;
    category_name: string;
    slug: string;
    status: boolean;
    category_image: File | null;
    categoryImageUrl: string;
}

const CreateCategoryModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
    const setInitialFormData = (): CategoryFormData => ({
        id: '',
        category_name: '',
        slug: '',
        status: true,
        category_image: null,
        categoryImageUrl: ''
    });
    const { token } = useSelector((state: RootState) => state.auth);
    const [formData, setFormData] = useState<CategoryFormData>(setInitialFormData());
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

            if (name === "category_name") {
                updated.slug = value.trim().replace(/\s+/g, "-").toLowerCase();
            }

            return updated;
        });
    };


    const handleCroppedCategoryImage = (file: File) => {
        setFormData(prev => ({
            ...prev,
            category_image: file,
            categoryImageUrl: URL.createObjectURL(file),
        }));
    };

    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};
        if (!formData.category_name.trim()) {
            newErrors.category_name = 'Category name is required.';
        } else if (formData.category_name.length < 3) {
            newErrors.category_name = 'Name must be at least 3 characters.';
        }
        if (!formData.slug.trim()) {
            newErrors.slug = 'Slug is required.';
        }
        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateForm()) return;

        const data = new FormData();
        data.append('category_name', formData.category_name);
        data.append('slug', formData.slug);
        data.append('status', String(formData.status || false));

        if (formData.category_image instanceof File) {
            data.append('category_image', formData.category_image);
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
            await axios.post(Constants.CREATE_CATEGORY_URL, data, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
            });
            toast.success('Category created successfully');
            onSuccess();
        } catch (error: any | AxiosError) {
            setFormErrors(error?.response?.data?.errors || {});
            toast.error('Something went wrong. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Create Category">
            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Image Upload Section */}
                <div>
                    <label className="block text-sm font-medium text-gray-700  mb-1">Image</label>
                    <ImageCropperUpload
                        value={formData.categoryImageUrl || undefined}
                        aspect={1}
                        label="Upload Image"
                        onCropped={handleCroppedCategoryImage}
                    />
                    {formErrors.category_image && <p className="text-red-500 text-xs mt-1">{formErrors.category_image}</p>}
                </div>
                {/* Name Input */}
                <div>
                    <label htmlFor="category_name" className="block text-sm font-medium text-gray-700  mb-1">Name <span className="text-red-500">*</span></label>
                    <input id="category_name" name="category_name" type="text" maxLength={100} value={formData.category_name || ""} onChange={handleChange} placeholder="Enter Category Name" className="w-full bg-white  text-gray-950  px-4 py-2 border border-gray-300  rounded-md text-sm focus:ring-purple-600 focus:border-purple-600" />
                    {formErrors.category_name && <p className="text-red-500 text-xs mt-1">{formErrors.category_name}</p>}
                </div>
                {/* Slug Input */}
                <div>
                    <label htmlFor="slug" className="block text-sm font-medium text-gray-700  mb-1">Slug <span className="text-red-500">*</span></label>
                    <input id="slug" type="text" name="slug" maxLength={100} value={formData.slug || ""} onChange={handleChange} placeholder="Enter Category Slug" className="w-full bg-white  text-gray-950  px-4 py-2 border border-gray-300  rounded-md text-sm focus:ring-purple-600 focus:border-purple-600" />
                    {formErrors.slug && <p className="text-red-500 text-xs mt-1">{formErrors.slug}</p>}
                </div>
                {/* Custom Fields */}
                <DynamicCustomFields
                    moduleSlug="categories"
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

export default CreateCategoryModal;
