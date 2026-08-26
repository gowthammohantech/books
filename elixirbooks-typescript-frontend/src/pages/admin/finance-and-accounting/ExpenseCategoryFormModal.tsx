import Modal from "@components/admin/Modal";
import SubmitButton from "@components/admin/SubmitButton";
import Switch from "@components/admin/Switch";
import Constants from "@constants/api";
import type { ExpenseCategoryFormData, ExpenseCategoryShape } from "@models/expense";
import type { RootState } from "@store/index";
import axios from "axios";
import { useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "sonner";
import { Button, FormField, fieldControlClasses } from "@components/ui";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (newCategory: ExpenseCategoryShape) => void;
    editItem?: ExpenseCategoryShape
}

const ExpenseCategoryFormModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, editItem }) => {
    const prepareInitialFormData = () => {
        let initialData = null;
        if (editItem) {
            initialData = {
                title: editItem.title,
                description: editItem.description,
                status: editItem.status
            }
        } else {
            initialData = {
                title: '',
                description: '',
                status: true
            }
        }

        return initialData

    };
    const { token } = useSelector((state: RootState) => state.auth);
    const [formData, setFormData] = useState<ExpenseCategoryFormData>(prepareInitialFormData());
    const [isSaving, setIsSaving] = useState(false);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    }

    const validated = () => {
        const newErrors: { [key: string]: string } = {};
        // Validate title
        if (!formData.title.trim()) {
            newErrors.title = "Title is required.";
        } else if (formData.title.length < 3 || formData.title.length > 50) {
            newErrors.title = "Title must be between 3 and 50 characters.";
        }

        // Validate description
        if (formData.description && formData.description.length < 3 || formData.description.length > 150) {
            newErrors.description = "Description must be between 3 and 150 characters.";
        }

        setFormErrors(newErrors);

        return Object.keys(newErrors).length === 0;
    };

    const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validated()) return false;
        try {
            setIsSaving(true);
            if (editItem) {
                const response = await axios.put(`${Constants.UPDATE_EXPENSE_CATEGORY_URL}/${editItem.id}`, formData, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                onSuccess(response.data.data);
                toast.success(response.data.message);
            } else {
                const response = await axios.post(Constants.CREATE_NEW_EXPENSE_CATEGORY_URL, formData, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                onSuccess(response.data.data);
                toast.success(response.data.message);
            }

        } catch (error) {
            toast.error('Something went wrong');
        } finally {
            setIsSaving(false);
        }
    };
    return (
        <>
            <Modal isOpen={isOpen} onClose={onClose} title="Expense Category" size="xl">
                {/* title */}
                <form onSubmit={handleFormSubmit}>
                    <FormField
                        label="Title"
                        required
                        type="text"
                        name="title"
                        id="title"
                        onChange={handleChange}
                        value={formData.title}
                        error={formErrors.title}
                    />
                    {/* Description */}
                    <FormField label="Description" id="description" containerClassName="mt-4" error={formErrors.description}>
                        {(field) => (
                            <textarea
                                id={field.id}
                                aria-describedby={field['aria-describedby']}
                                aria-invalid={field['aria-invalid']}
                                onChange={handleChange}
                                value={formData.description}
                                name="description"
                                className={fieldControlClasses(Boolean(formErrors.description))}
                            />
                        )}
                    </FormField>
                    {/* Status */}
                    <div className="flex flex-row mt-4 gap-6 items-center">
                        <label htmlFor="status" className="text-sm font-medium text-heading">Status <span className="text-danger">*</span></label>
                        <Switch name="status" checked={formData.status} onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.checked }))} disabled={false} className="mt-4" />
                    </div>
                    <div className="flex justify-end mt-4">
                        <Button type="button" variant="white" onClick={onClose} className="mr-2">Cancel</Button>
                        <SubmitButton isDisabled={isSaving} onClick={() => { }} isLoading={isSaving} mode={editItem ? "edit" : "create"} />
                    </div>
                </form>
            </Modal>
        </>
    );
};
export default ExpenseCategoryFormModal;