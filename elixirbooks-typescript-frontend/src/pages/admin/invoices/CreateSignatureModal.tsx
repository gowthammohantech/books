import { useEffect, useState } from "react";
import Modal from "@components/admin/Modal";
import axios, { AxiosError } from "axios";
import Constants from "@constants/api";
import type { RootState } from "@store/index";
import { useSelector } from "react-redux";
import SubmitButton from "@components/admin/SubmitButton";
import { toast } from "sonner";
import { Image, Trash2Icon } from "lucide-react";
import Switch from "@components/admin/Switch";
import type { SignatureOptions } from "@models/signature";
import { Button, FormField } from "@components/ui";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (newSignature: SignatureOptions) => void;
}

interface SignatureFormData {
    id?: string;
    signatureName: string;
    signatureImage: File | null;
    signatureImage_preview_url?: string;
    signatureImage_removed?: boolean;
    markAsDefault?: boolean;
    status?: boolean;
}

const CreateSignatureModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
    const setInitialFormData = (): SignatureFormData => ({
        signatureName: '',
        signatureImage: null,
        signatureImage_preview_url: '',
        signatureImage_removed: false,
        markAsDefault: false,
        status: true
    });
    const { token } = useSelector((state: RootState) => state.auth);
    const [formData, setFormData] = useState<SignatureFormData>(setInitialFormData());
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Reset form whenever modal opens
    useEffect(() => {
        if (isOpen) {
            setFormData(setInitialFormData());
            setFormErrors({});
        }
    }, [isOpen]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setFormData(prev => ({
                ...prev,
                signatureImage: file,
                signatureImage_preview_url: URL.createObjectURL(file),
                signatureImage_removed: false
            }));
        }
    };
    const handleImageDelete = () => {
        setFormData(prev => ({
            ...prev,
            signatureImage: null,
            signatureImage_preview_url: '',
            signatureImage_removed: true
        }));
    };
    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};
        if (!formData.signatureName.trim()) {
            newErrors.signatureName = 'Signature name is required.';
        } else if (formData.signatureName.length < 3) {
            newErrors.signatureName = 'Name must be at least 3 characters.';
        }
        if (!formData.signatureImage) {
            newErrors.signatureImage = 'Signature image is required for new entries.';
        }
        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateForm()) return;

        const data = new FormData();
        data.append('signatureName', formData.signatureName);
        data.append('markAsDefault', String(formData.markAsDefault || false));
        data.append('status', String(formData.status || false));

        if (formData.signatureImage instanceof File) {
            data.append('signatureImage', formData.signatureImage);
        }
        if (formData.signatureImage_removed) {
            data.append('signatureImage_removed', 'true');
        }

        try {
            setIsSubmitting(true);
            const response = await axios.post(Constants.CREATE_SIGNATURE_URL, data, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
            });
            toast.success('Signature created successfully');
            onSuccess(response.data.data || {});
        } catch (error: any | AxiosError) {
            setFormErrors(error?.response?.data?.errors || {});
            toast.error('Something went wrong. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Create Signature">
            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Image Upload */}
                <label htmlFor="imageUpload" className="block text-sm font-medium text-heading mb-1">Image <span className="text-danger">*</span></label>
                <div className="flex items-start gap-4 mb-4">
                    <div className="relative w-24 h-24 border border-border rounded-control flex items-center justify-center overflow-hidden bg-white">
                        {formData.signatureImage_preview_url ? (
                            <img src={formData.signatureImage_preview_url} alt="Preview" className="w-full h-full object-contain" />
                        ) : (
                            <span className="text-xl text-body"><Image /></span>
                        )}
                        {formData.signatureImage_preview_url && (
                            <button type="button" onClick={handleImageDelete} title="Remove Image" className="absolute top-[-1px] right-[-1px] bg-white border border-danger rounded-full p-1 shadow-card hover:bg-danger group">
                                <Trash2Icon size={14} className="text-danger group-hover:text-white" />
                            </button>
                        )}
                    </div>
                    <div>
                        <label htmlFor="imageUpload" className="inline-flex items-center bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-control transition duration-200 cursor-pointer">
                            <Image size={16} className="mr-2" /> Upload Image
                        </label>
                        <input type="file" accept="image/png, image/jpeg" onChange={handleFileChange} className="hidden" id="imageUpload" />
                        <p className="text-xs text-body mt-1">PNG or JPG, max 5MB.</p>
                        {formErrors.signatureImage && <p className="text-danger text-xs mt-1">{formErrors.signatureImage}</p>}
                    </div>
                </div>

                {/* Signature Name */}
                <FormField
                    label="Name"
                    required
                    name="signatureName"
                    value={formData.signatureName}
                    onChange={handleChange}
                    type="text"
                    placeholder="Enter Signature Name"
                    error={formErrors.signatureName}
                />

                {/* Status and Is Default */}
                <div className="flex justify-between items-center gap-6 flex-wrap">
                    {/* Status Switch */}
                    <div className="flex items-center gap-3">
                        <label htmlFor="status" className="font-medium text-sm text-heading ">
                            Status
                        </label>
                        <Switch
                            name="status"
                            checked={formData.status ?? false}
                            onChange={handleChange}
                            disabled={false}
                        />
                    </div>

                    {/* Default Switch */}
                    <div className="flex items-center gap-3">
                        <label htmlFor="markAsDefault" className="font-medium text-sm text-heading ">
                            Set as Default
                        </label>
                        <Switch
                            name="markAsDefault"
                            checked={formData.markAsDefault ?? false}
                            onChange={handleChange}
                        />
                    </div>
                </div>


                {/* Buttons */}
                <div className="flex justify-end pt-4 gap-4">
                    <Button type="button" variant="white" onClick={onClose}>Cancel</Button>
                    <SubmitButton
                        isDisabled={isSubmitting}
                        isLoading={isSubmitting}
                        mode={"create"}
                    />
                </div>
            </form>
        </Modal>
    );
}

export default CreateSignatureModal;
