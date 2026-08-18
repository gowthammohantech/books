import React, { useMemo, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useQuery } from '@tanstack/react-query';
import type { RootState } from '@store/index';
import DateInput from '@components/admin/DateInput';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { fetchModuleHierarchy, fetchCustomFieldsByModule, fetchCustomFieldTypes } from '@api/customFieldTypeApi';
import { excludeLineItemFields } from '@lib/lineCustomFields';

interface DynamicCustomFieldsProps {
    moduleSlug: string;
    values: Record<string, any>;
    errors?: Record<string, string>;
    onChange: (fieldId: string, value: any) => void;
    onFieldsLoaded?: (fields: any[]) => void;
}

const DynamicCustomFields: React.FC<DynamicCustomFieldsProps> = ({
    moduleSlug,
    values,
    errors = {},
    onChange,
    onFieldsLoaded
}) => {
    const { token } = useSelector((state: RootState) => state.auth);

    const { data: moduleHierarchyResponse, isLoading: isModulesLoading } = useQuery({
        queryKey: ['moduleHierarchy'],
        queryFn: () => fetchModuleHierarchy(token!),
        refetchOnMount: false,
        enabled: !!token,
        staleTime: 1000 * 60 * 60
    });

    const targetModuleId = useMemo(() => {
        if (!moduleHierarchyResponse?.data) return null;
        for (const mod of moduleHierarchyResponse.data) {
            if (mod.moduleSlug === moduleSlug) return mod.id;
            if (mod.children) {
                const child = mod.children.find((c: any) => c.moduleSlug === moduleSlug);
                if (child) return child.id;
            }
        }
        return null;
    }, [moduleHierarchyResponse, moduleSlug]);

    const { data: customFieldTypesResponse, isLoading: isTypesLoading } = useQuery({
        queryKey: ['customFieldTypes'],
        queryFn: () => fetchCustomFieldTypes(token!),
        refetchOnMount: false,
        enabled: !!token,
        staleTime: 1000 * 60 * 60
    });

    const { data: customFieldsResponse, isLoading: isFieldsLoading } = useQuery({
        queryKey: ['customFields', targetModuleId],
        queryFn: () => fetchCustomFieldsByModule(token!, targetModuleId!),
        refetchOnMount: false,
        enabled: !!token && !!targetModuleId
    });

    const activeCustomFields = excludeLineItemFields(customFieldsResponse?.data?.fields || []);
    const isLoading = isModulesLoading || isTypesLoading || isFieldsLoading;

    useEffect(() => {
        if (onFieldsLoaded && activeCustomFields.length > 0) {
            onFieldsLoaded(activeCustomFields);
        }
    }, [activeCustomFields, onFieldsLoaded]);

    const getFieldTypeSlug = (typeId: string | any) => {
        if (typeof typeId === 'object' && typeId?.slug) return typeId.slug;
        const types = customFieldTypesResponse?.data || [];
        const matched = types.find((t: any) => t.id === typeId);
        return matched?.slug || 'text';
    };

    if (isLoading) {
        return (
            <div className="bg-white p-4 rounded-lg border border-gray-200 mt-4 flex items-center justify-center min-h-[100px]">
                <LoaderSpinner />
            </div>
        );
    }

    if (activeCustomFields.length === 0) return null;

    return (
        <div className="bg-white p-4 rounded-lg border border-gray-200 mt-4">
            <h3 className="font-bold text-gray-950 mb-4">Additional Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {activeCustomFields.map((field: any) => {
                    const typeSlug = getFieldTypeSlug(field.dataType);

                    // The API returns values mapped by fieldSlug, so we prioritize that key
                    const fieldKey = field.fieldSlug || field.id;

                    // Safely lookup the value (check both slug and ID just in case)
                    const currentValue = values[fieldKey] ?? values[field.id];

                    // Check errors for both potential keys
                    const errorKey = `customField_${fieldKey}`;
                    const errorKeyAlt = `customField_${field.id}`;
                    const isError = !!errors[errorKey] || !!errors[errorKeyAlt];
                    const errorMessage = errors[errorKey] || errors[errorKeyAlt];

                    return (
                        <div key={field.id} className="w-full">
                            {typeSlug !== 'datepicker' && (
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {field.labelName} {field.isMandatory && <span className="text-red-500">*</span>}
                                </label>
                            )}

                            {typeSlug === 'textarea' ? (
                                <textarea
                                    className={`border rounded-md px-4 py-2 w-full text-sm focus:outline-none focus:ring-1 focus:ring-purple-600 ${isError ? 'border-red-500' : 'border-gray-300'}`}
                                    value={currentValue || ''}
                                    onChange={(e) => onChange(fieldKey, e.target.value)}
                                    placeholder={field.helpText || `Enter ${field.labelName}`}
                                    rows={2}
                                />
                            ) : (typeSlug === 'dropdown' || typeSlug === 'select') ? (
                                <select
                                    className={`border rounded-md px-4 py-2 h-10 w-full text-sm bg-white focus:outline-none focus:ring-1 focus:ring-purple-600 ${isError ? 'border-red-500' : 'border-gray-300'}`}
                                    value={currentValue || ''}
                                    onChange={(e) => onChange(fieldKey, e.target.value)}
                                >
                                    <option value="">Select an option</option>
                                    {field.options?.map((opt: any, idx: number) => (
                                        <option key={idx} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            ) : typeSlug === 'datepicker' ? (
                                (() => {
                                    // Safely parse database string to Date object
                                    let parsedDate = null;
                                    if (currentValue) {
                                        parsedDate = new Date(currentValue);
                                        if (isNaN(parsedDate.getTime())) parsedDate = null;
                                    }
                                    return (
                                        <DateInput
                                            label={field.labelName}
                                            value={parsedDate}
                                            onChange={(newDate) => onChange(fieldKey, newDate)}
                                            isRequired={field.isMandatory}
                                        />
                                    );
                                })()
                            ) : typeSlug === 'file' ? (
                                <div className="flex flex-col gap-2">
                                    {/* Show link if the backend already has a file URL stored */}
                                    {typeof currentValue === 'string' && currentValue.startsWith('http') && (
                                        <a href={currentValue} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-purple-600 hover:underline flex items-center gap-1">
                                            View Uploaded File
                                        </a>
                                    )}
                                    <input
                                        type="file"
                                        className={`block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 ${isError ? 'border-red-500' : ''}`}
                                        onChange={(e) => onChange(fieldKey, e.target.files?.[0] || null)}
                                    />
                                </div>
                            ) : typeSlug === 'radio' ? (
                                <div className="flex flex-wrap gap-4 mt-2">
                                    {field.options?.map((opt: any, idx: number) => (
                                        <label key={idx} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                                            <input
                                                type="radio"
                                                className="h-4 w-4 text-purple-600 focus:ring-purple-600 border-gray-300"
                                                name={`custom_radio_${field.id}`}
                                                value={opt.value}
                                                checked={currentValue === opt.value}
                                                onChange={(e) => onChange(fieldKey, e.target.value)}
                                            />
                                            {opt.label}
                                        </label>
                                    ))}
                                </div>
                            ) : typeSlug === 'check_box' ? (
                                <div className="flex flex-col gap-2 mt-2">
                                    {field.options?.map((opt: any, idx: number) => {
                                        // Safely parse CSV string from database into an array
                                        let currentArray: string[] = [];
                                        if (Array.isArray(currentValue)) {
                                            currentArray = currentValue;
                                        } else if (typeof currentValue === 'string' && currentValue.trim() !== '') {
                                            currentArray = currentValue.split(',').map(v => v.trim());
                                        }

                                        const isChecked = currentArray.includes(opt.value);

                                        return (
                                            <label key={idx} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                                                <input
                                                    type="checkbox"
                                                    className="h-4 w-4 text-purple-600 focus:ring-purple-600 rounded border-gray-300"
                                                    value={opt.value}
                                                    checked={isChecked}
                                                    onChange={(e) => {
                                                        const newVal = e.target.checked
                                                            ? [...currentArray, opt.value]
                                                            : currentArray.filter((v: string) => v !== opt.value);
                                                        onChange(fieldKey, newVal);
                                                    }}
                                                />
                                                {opt.label}
                                            </label>
                                        )
                                    })}
                                </div>
                            ) : (
                                (() => {
                                    // Map the field-type slug to a native input type.
                                    const inputTypeBySlug: Record<string, string> = {
                                        date: 'date',
                                        number: 'number',
                                        currency: 'number',
                                        email: 'email',
                                        time: 'time',
                                    };
                                    const inputType = inputTypeBySlug[typeSlug] || 'text';
                                    return (
                                        <input
                                            type={inputType}
                                            step={typeSlug === 'currency' ? '0.01' : undefined}
                                            className={`border rounded-md px-4 py-2 h-10 w-full text-sm focus:outline-none focus:ring-1 focus:ring-purple-600 ${isError ? 'border-red-500' : 'border-gray-300'}`}
                                            value={currentValue || ''}
                                            onChange={(e) => onChange(fieldKey, e.target.value)}
                                            placeholder={field.helpText || `Enter ${field.labelName}`}
                                        />
                                    );
                                })()
                            )}

                            {isError && <p className="text-red-500 text-xs mt-1">{errorMessage}</p>}
                            {!isError && field.helpText && <p className="text-gray-500 text-xs mt-1 italic">{field.helpText}</p>}
                        </div>
                    )
                })}
            </div>
        </div>
    );
};

export default DynamicCustomFields;