import React, { useState, useCallback, useMemo, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import axios from "axios";
import Constants from "@constants/api";
import { toast } from "sonner";
import type { CustomFieldFormState, CustomFieldTypeShape } from "@models/modulesettings/customField";
import Modal from "@components/admin/Modal";
import SmartDropdown from "@components/admin/SmartDropdown";
import SubmitButton from "@components/admin/SubmitButton";
import { Button, FormField } from "@components/ui";

interface CustomFieldFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    moduleId: string;
    customFieldTypes: CustomFieldTypeShape[];
    token: string;
    editItem?: CustomFieldFormState | null;
    allowLineItemPlacement?: boolean;
}

interface FormErrors {
    labelName?: string;
    fieldSlug?: string;
    dataType?: string;
    options?: string;
}

const CustomFieldForm: React.FC<CustomFieldFormProps> = ({
    isOpen,
    onClose,
    onSuccess,
    moduleId,
    customFieldTypes,
    token,
    editItem,
    allowLineItemPlacement = false
}) => {
    const [isLoading, setIsLoading] = useState(false);
    const [errors, setErrors] = useState<FormErrors>({});

    const getInitialState = useCallback((): CustomFieldFormState => ({
        moduleId: moduleId,
        labelName: "",
        fieldSlug: "",
        dataType: "",
        helpText: "",
        isMandatory: false,
        showInTable: false,
        options: [],
        placement: 'document'
    }), [moduleId]);

    const [formData, setFormData] = useState<CustomFieldFormState>(getInitialState());

    // Populate form data when editing
    useEffect(() => {
        if (isOpen && editItem) {
            setFormData({
                ...getInitialState(),
                ...editItem,
                options: editItem.options || []
            });
            setErrors({});
        } else if (isOpen && !editItem) {
            setFormData(getInitialState());
            setErrors({});
        }
    }, [isOpen, editItem, getInitialState]);

    const resetAndClose = useCallback(() => {
        setFormData(getInitialState());
        setErrors({});
        onClose();
    }, [getInitialState, onClose]);

    // Placement selector items (document header field vs. line-item table column)
    const placementItems = [
        { id: 'document', name: 'Document (header field)' },
        { id: 'lineItem', name: 'Line item (item table column)' },
    ];

    const selectedPlacementItem = useMemo(() => {
        return placementItems.find(item => item.id === (formData.placement ?? 'document')) || null;
    }, [formData.placement]);

    // Map API data types to SmartDropdown Item format, excluding types unsupported for the current placement
    const dropdownItems = useMemo(() => {
        const excluded = formData.placement === 'lineItem' ? ['file', 'check_box'] : [];
        return customFieldTypes
            .filter(type => !excluded.includes(type.slug))
            .map(type => ({
                id: type.id,
                name: type.name,
            }));
    }, [customFieldTypes, formData.placement]);

    // Find the currently selected item object for the SmartDropdown
    const selectedDataTypeItem = useMemo(() => {
        return dropdownItems.find(item => item.id === formData.dataType) || null;
    }, [dropdownItems, formData.dataType]);

    // Determine if the selected data type requires 'options'
    const selectedType = customFieldTypes.find(t => t.id === formData.dataType);
    const needsOptions = ['dropdown', 'radio', 'check_box'].includes(selectedType?.slug || '');

    const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setFormData(prev => ({
            ...prev,
            labelName: value,
            fieldSlug: editItem ? prev.fieldSlug : value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')
        }));
        if (errors.labelName) setErrors(prev => ({ ...prev, labelName: undefined }));
        if (errors.fieldSlug) setErrors(prev => ({ ...prev, fieldSlug: undefined }));
    };

    const handleInputChange = (field: keyof CustomFieldFormState, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (errors[field as keyof FormErrors]) {
            setErrors(prev => ({ ...prev, [field]: undefined }));
        }
    };

    const handlePlacementChange = (placement: 'document' | 'lineItem') => {
        setFormData(prev => {
            const selected = customFieldTypes.find(t => t.id === prev.dataType);
            const shouldResetDataType = placement === 'lineItem' && ['file', 'check_box'].includes(selected?.slug || '');
            return {
                ...prev,
                placement,
                dataType: shouldResetDataType ? '' : prev.dataType
            };
        });
    };

    const handleOptionChange = (index: number, key: 'label' | 'value', value: string) => {
        const newOptions = [...(formData.options || [])];
        newOptions[index][key] = value;
        setFormData(prev => ({ ...prev, options: newOptions }));
        if (errors.options) setErrors(prev => ({ ...prev, options: undefined }));
    };

    const addOption = () => {
        setFormData(prev => ({ ...prev, options: [...(prev.options || []), { label: "", value: "" }] }));
    };

    const removeOption = (index: number) => {
        const newOptions = [...(formData.options || [])];
        newOptions.splice(index, 1);
        setFormData(prev => ({ ...prev, options: newOptions }));
    };

    const validateForm = (): boolean => {
        const newErrors: FormErrors = {};
        let isValid = true;

        if (!formData.labelName.trim()) {
            newErrors.labelName = "Label name is required";
            isValid = false;
        }
        if (!formData.fieldSlug.trim()) {
            newErrors.fieldSlug = "Field slug is required";
            isValid = false;
        }
        if (!formData.dataType) {
            newErrors.dataType = "Data type is required";
            isValid = false;
        }

        if (needsOptions) {
            if (!formData.options || formData.options.length === 0) {
                newErrors.options = "At least one option is required for this data type.";
                isValid = false;
            } else {
                const hasEmptyOptions = formData.options.some(opt => !opt.label.trim() || !opt.value.trim());
                if (hasEmptyOptions) {
                    newErrors.options = "All options must have both a label and a value.";
                    isValid = false;
                }
            }
        }

        setErrors(newErrors);
        return isValid;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!validateForm()) {
            return;
        }

        const payload = { ...formData };
        if (!needsOptions) delete payload.options;

        try {
            setIsLoading(true);
            const isEditing = !!editItem?.id;

            const url = isEditing
                ? `${Constants.BASE_URL}/api/admin/custom-fields/${editItem.id}`
                : `${Constants.BASE_URL}/api/admin/custom-fields`;

            const requestConfig = {
                headers: { 'Authorization': `Bearer ${token}` }
            };

            const response = await (isEditing
                ? axios.put(url, payload, requestConfig)
                : axios.post(url, payload, requestConfig)
            );

            if (response.data?.success) {
                toast.success(response.data.message || `Custom field ${isEditing ? 'updated' : 'created'} successfully`);
                setFormData(getInitialState());
                setErrors({});
                onSuccess();
            } else {
                toast.error(response.data?.message || "Something went wrong.");
            }
        } catch (error: any) {
            const backendMsg = error.response?.data?.message || `Failed to ${editItem ? 'update' : 'create'} custom field`;
            toast.error(backendMsg);
        } finally {
            setIsLoading(false);
        }
    };

    const isEditing = !!editItem;

    return (
        <Modal
            isOpen={isOpen}
            onClose={resetAndClose}
            title={isEditing ? "Edit Custom Field" : "Add Custom Field"}
            size="2xl"
        >
            <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                        label="Label Name"
                        required
                        type="text"
                        placeholder="e.g., Customer Age"
                        value={formData.labelName}
                        onChange={handleLabelChange}
                        error={errors.labelName}
                    />

                    <FormField
                        label="Field Slug"
                        required
                        type="text"
                        placeholder="customer_age"
                        value={formData.fieldSlug}
                        readOnly={isEditing}
                        onChange={(e) => handleInputChange('fieldSlug', e.target.value)}
                        error={errors.fieldSlug}
                        className={isEditing ? 'cursor-not-allowed' : ''}
                    />

                    {allowLineItemPlacement && (
                        <FormField label="Placement" required>
                            <SmartDropdown
                                items={placementItems}
                                value={formData.placement ?? 'document'}
                                onChange={() => { }}
                                onSelect={(item) => handlePlacementChange((item ? item.id.toString() : 'document') as 'document' | 'lineItem')}
                                selectedItem={selectedPlacementItem}
                                placeholder="Select Placement..."
                                serverside={false}
                                disabled={isEditing && ['file', 'check_box'].includes(selectedType?.slug || '')}
                            />
                        </FormField>
                    )}

                    <FormField label="Data Type" required error={errors.dataType}>
                        <SmartDropdown
                            items={dropdownItems}
                            value={formData.dataType}
                            onChange={() => { }}
                            onSelect={(item) => handleInputChange('dataType', item ? item.id.toString() : "")}
                            selectedItem={selectedDataTypeItem}
                            placeholder="Select Type..."
                            serverside={false}
                            disabled={isEditing}
                        />
                    </FormField>

                    <FormField
                        label="Help Text"
                        type="text"
                        placeholder="Instructions for the user..."
                        value={formData.helpText}
                        onChange={(e) => handleInputChange('helpText', e.target.value)}
                    />
                </div>

                {needsOptions && (
                    <div className={`border p-4 rounded-control bg-surface transition-colors ${errors.options ? 'border-danger' : 'border-border'}`}>
                        <div className="flex justify-between items-center mb-3">
                            <div>
                                <label className="block text-sm font-medium text-heading">
                                    Field Options <span className="text-purple-600">*</span>
                                </label>
                                {errors.options && <p className="text-danger text-xs mt-0.5">{errors.options}</p>}
                            </div>
                            <Button type="button" variant="soft" size="sm" onClick={addOption} leftIcon={<Plus size={14} />}>
                                Add Option
                            </Button>
                        </div>

                        {formData.options?.length === 0 && (
                            <p className="text-sm text-body italic text-center py-2">No options added yet. Click "Add Option" to begin.</p>
                        )}

                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                            {formData.options?.map((opt, idx) => (
                                <div key={idx} className="flex gap-2 items-start">
                                    <div className="flex-1">
                                        <FormField
                                            placeholder="Label (e.g., Retail)"
                                            value={opt.label}
                                            onChange={(e) => handleOptionChange(idx, 'label', e.target.value)}
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <FormField
                                            placeholder="Value (e.g., retail)"
                                            value={opt.value}
                                            onChange={(e) => handleOptionChange(idx, 'value', e.target.value)}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeOption(idx)}
                                        className="mt-1 text-body hover:text-danger"
                                        aria-label="Remove option"
                                    >
                                        <Trash2 size={18} />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex gap-6 py-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-heading cursor-pointer">
                        <input
                            type="checkbox"
                            checked={formData.isMandatory}
                            onChange={(e) => handleInputChange('isMandatory', e.target.checked)}
                            className="w-4 h-4 text-purple-600 rounded border-border focus:ring-purple-600"
                        />
                        Is Mandatory?
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-heading cursor-pointer">
                        <input
                            type="checkbox"
                            checked={formData.showInTable}
                            onChange={(e) => handleInputChange('showInTable', e.target.checked)}
                            className="w-4 h-4 text-purple-600 rounded border-border focus:ring-purple-600"
                        />
                        Show In Table?
                    </label>
                </div>

                <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
                    <Button type="button" variant="white" onClick={resetAndClose}>
                        Cancel
                    </Button>
                    <SubmitButton isLoading={isLoading}>
                        {isLoading ? 'Saving...' : (isEditing ? 'Update Field' : 'Save Field')}
                    </SubmitButton>
                </div>
            </form>
        </Modal>
    );
};

export default CustomFieldForm;