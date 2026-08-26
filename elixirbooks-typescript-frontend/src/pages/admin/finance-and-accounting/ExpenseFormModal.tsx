import DateInput from "@components/admin/DateInput";
import { ymdStringToDate, dateToYmdString } from "@utils/converters";
import Modal from "@components/admin/Modal";
import SmartDropdown from "@components/admin/SmartDropdown";
import SubmitButton from "@components/admin/SubmitButton";
import Constants from "@constants/api";
import { useDebounce } from "@hooks/useDebounce";
import type { OptionType } from "@models/common";
import type { ExpenseCategoryShape, ExpenseFormData, ExpenseListShape } from "@models/expense";
import ExpenseCategoryFormModal from "./ExpenseCategoryFormModal";
import type { RootState } from "@store/index";
import axios, { AxiosError } from "axios";
import { forEach } from "lodash";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "sonner";
import DynamicCustomFields from "@components/admin/DynamicCustomFields"; // <-- Imported reusable component
import { Button, FormField, Select, fieldControlClasses } from "@components/ui";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    editItem?: ExpenseListShape | any; // allow any for customFields mapping if not in strict model yet
}

// Extend your base interface to accommodate the new custom fields object
export type ExtendedExpenseFormData = ExpenseFormData & {
    customFields: Record<string, any>;
    isRecurring: boolean;
    repeatEvery: 'day' | 'week' | 'month' | 'year' | 'custom';
    customIntervalNumber: number | null;
    customIntervalType: 'day' | 'week' | 'month' | 'year' | null;
    startOn: string | null;
    endsOn: string | null;
    neverExpire: boolean;
    stopped: boolean;
};

const initialFormData: ExtendedExpenseFormData = {
    referenceNo: '',
    amount: 0,
    expenseDate: new Date(),
    expenseCategoryId: '',
    sourceType: '',
    bankId: null,
    paymentMode: '',
    paymentStatus: '',
    description: '',
    attachment: null,
    attachmentUrl: null,
    supplierId: null,
    paidByUserId: null,
    customFields: {},
    isRecurring: false,
    repeatEvery: 'month',
    customIntervalNumber: null,
    customIntervalType: null,
    startOn: null,
    endsOn: null,
    neverExpire: false,
    stopped: false,
} as ExtendedExpenseFormData;

const ExpenseFormModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, editItem }) => {
    const { token } = useSelector((state: RootState) => state.auth);
    const [formData, setFormData] = useState<ExtendedExpenseFormData>(initialFormData);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [paymentModeOptions, setPaymentModeOptions] = useState<OptionType[]>([]);
    const [sourceSearchKeyword, setSourceSearchKeyword] = useState('');
    const [bankSearchKeyword, setBankSearchKeyword] = useState('');
    const debouncedSearchTermBankAccount = useDebounce(bankSearchKeyword, 500);
    const [bankAccountOptions, setBankAccountOptions] = useState<OptionType[]>([]);
    const [paymentStatusSearchKeyword, setPaymentStatusSearchKeyword] = useState('');
    const [paymentModeSearchKeyword, setPaymentModeSearchKeyword] = useState('');
    const [categoryOptions, setCategoryOptions] = useState<OptionType[]>([]);
    const [categorySearchKeyword, setCategorySearchKeyword] = useState('');
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const debouncedCategorySearchKeyword = useDebounce(categorySearchKeyword, 500);
    const [supplierOptions, setSupplierOptions] = useState<OptionType[]>([]);
    const [supplierSearchKeyword, setSupplierSearchKeyword] = useState('');
    const debouncedSupplierSearchKeyword = useDebounce(supplierSearchKeyword, 500);
    const [people, setPeople] = useState<{ id: string; name: string }[]>([]);

    // State to track dynamic custom fields for validation
    const [activeCustomFields, setActiveCustomFields] = useState<any[]>([]);

    const paymentStatusOptions: OptionType[] = [
        { id: 'PENDING', name: 'Pending' },
        { id: 'PAID', name: 'Paid' },
        { id: 'CANCELLED', name: 'Cancelled' },
    ];
    const paymentSourceSoptions: OptionType[] = [
        { id: 'PETTY_CASH', name: 'Petty Cash' },
        { id: 'BANK', name: 'Bank Transfer' },
    ];
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (editItem) {
            const editItemData: ExtendedExpenseFormData = {
                amount: editItem.amount,
                expenseDate: new Date(editItem.expenseDate),
                expenseCategoryId: editItem.expenseCategory.id,
                sourceType: editItem.sourceType,
                bankId: editItem.bank?.id || null,
                paymentMode: editItem?.paymentMode?.id || null,
                paymentStatus: editItem.paymentStatus,
                description: editItem.description || '',
                attachment: null,
                attachmentUrl: editItem.attachment,
                supplierId: editItem.supplierId ?? editItem.supplier?.id ?? null,
                paidByUserId: editItem.paidByUserId ?? null,
                customFields: editItem.customFields || {}, // Hydrate custom fields if editing
                isRecurring: editItem.isRecurring ?? false,
                repeatEvery: editItem.repeatEvery ?? 'month',
                customIntervalNumber: editItem.customIntervalNumber ?? null,
                customIntervalType: editItem.customIntervalType ?? null,
                startOn: editItem.startOn ? String(editItem.startOn).slice(0, 10) : null,
                endsOn: editItem.endsOn ? String(editItem.endsOn).slice(0, 10) : null,
                neverExpire: editItem.neverExpire ?? false,
                stopped: editItem.stopped ?? false,
            };

            setFormData(editItemData);
        }
        fetchAllPaymentModes();
    }, [editItem]);

    useEffect(() => {
        const fetchExpenseCategories = async () => {
            try {
                const response = await axios.get(Constants.FETCH_EXPENSE_CATEGORIES_WITH_SEARCH_URL, {
                    params: { search: categorySearchKeyword },
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.data.data.length > 0) {
                    const formattedCategories = response.data.data.map((item: any) => {
                        return {
                            id: item.id,
                            name: item.title
                        }
                    });
                    setCategoryOptions(formattedCategories);
                } else {
                    setCategoryOptions([]);
                }
            } catch (error) {
                console.error("Error fetching expense categories:", error);
            }
        }
        fetchExpenseCategories();
    }, [debouncedCategorySearchKeyword, token]);

    useEffect(() => {
        const fetchBankAccounts = async () => {
            try {
                const response = await axios.get(Constants.FETCH_BANK_ACCOUNTS_WITH_SEARCH_URL, {
                    params: { search: debouncedSearchTermBankAccount },
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.data.data.length > 0) {
                    const formattedBankAccounts = response.data.data.map((item: any) => {
                        let accountNumber = item.accountNumber ?? "";
                        let name = item.accountHoldername ?? "";
                        let bankName = item.bankName ?? "";
                        let formattedBankName = `[${accountNumber}] ${name} - ${bankName}`;
                        return {
                            id: item.id,
                            name: formattedBankName
                        }
                    });
                    setBankAccountOptions(formattedBankAccounts);
                } else {
                    setBankAccountOptions([]);
                }
            } catch (error) {
                console.error("Error fetching bank accounts:", error);
            }
        }
        fetchBankAccounts();
    }, [debouncedSearchTermBankAccount, token]);

    useEffect(() => {
        const fetchSuppliers = async () => {
            try {
                const response = await axios.get(Constants.GET_SUPPLIERS_URL, {
                    params: { search: debouncedSupplierSearchKeyword, limit: 100, page: 1 },
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.data?.data?.suppliers?.length > 0) {
                    const formattedSuppliers = response.data.data.suppliers.map((item: any) => ({
                        id: item.id,
                        name: item.supplier_name ?? item.name ?? ''
                    }));
                    setSupplierOptions(formattedSuppliers);
                } else {
                    setSupplierOptions([]);
                }
            } catch (error) {
                console.error("Error fetching suppliers:", error);
            }
        }
        fetchSuppliers();
    }, [debouncedSupplierSearchKeyword, token]);

    useEffect(() => {
        const fetchPeople = async () => {
            try {
                const res = await axios.get(`${Constants.FETCH_USERS_URL}/1`, {
                    params: { limit: 100, page: 1 },
                    headers: { Authorization: `Bearer ${token}` },
                });
                const users = (res.data?.data ?? []) as Array<{ id: string; firstName: string; lastName: string; email?: string }>;
                setPeople(users.map((u) => ({
                    id: u.id,
                    name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || u.id,
                })));
            } catch {
                // non-fatal
            }
        };
        fetchPeople();
    }, [token]);

    const fetchAllPaymentModes = async () => {
        try {
            const response = await axios.get(Constants.GET_ALL_PAYMENT_MODES_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data.data) {
                setPaymentModeOptions(response.data.data);
            }
        } catch (error) { }
    }

    const handleFormChange = (field: keyof ExtendedExpenseFormData, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (formErrors[field]) {
            setFormErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[field];
                return newErrors;
            });
        }
    }

    // New handler for custom fields
    const handleCustomFieldChange = (fieldSlugOrId: string, value: any) => {
        setFormData(prev => ({
            ...prev,
            customFields: { ...prev.customFields, [fieldSlugOrId]: value }
        }));

        if (formErrors[`customField_${fieldSlugOrId}`]) {
            setFormErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[`customField_${fieldSlugOrId}`];
                return newErrors;
            });
        }
    };

    const handleCategorySelect = (item: OptionType) => {
        if (item) {
            handleFormChange('expenseCategoryId', item.id);
        } else {
            handleFormChange('expenseCategoryId', '');
        }
    }

    // Inline-created category: add it to the dropdown and auto-select it so the
    // user doesn't have to leave the expense form to manage expense categories.
    const handleCategoryCreated = (newCategory: ExpenseCategoryShape) => {
        const option: OptionType = { id: newCategory.id, name: newCategory.title };
        setCategoryOptions(prev =>
            prev.some(o => o.id === option.id) ? prev : [option, ...prev]
        );
        handleFormChange('expenseCategoryId', newCategory.id);
        setIsCategoryModalOpen(false);
    }
    const handleSupplierSelect = (item: OptionType) => {
        if (item) {
            handleFormChange('supplierId', item.id);
        } else {
            handleFormChange('supplierId', null);
        }
    }
    const handlePaymentSourceSelect = (item: OptionType) => {
        if (item) {
            handleFormChange('sourceType', item.id);
        } else {
            handleFormChange('sourceType', '');
        }
    }

    const handleBankAccountSelect = (item: OptionType) => {
        if (item) {
            handleFormChange('bankId', item.id);
        } else {
            handleFormChange('bankId', '');
        }
    }

    const handlePaymentStatusSelect = (item: OptionType) => {
        if (item) {
            handleFormChange('paymentStatus', item.id);
        } else {
            handleFormChange('paymentStatus', '');
        }
    }
    const handlePaymentModeSelect = (item: OptionType) => {
        if (item) {
            handleFormChange('paymentMode', item.id);
        } else {
            handleFormChange('paymentMode', '');
        }
    }

    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};
        if (formData.amount <= 0) newErrors.amount = 'Amount must be greater than 0.';
        if (formData.amount > 100000) newErrors.amount = 'Amount cannot exceed 100,000.';
        if (formData.expenseCategoryId === '') newErrors.expenseCategoryId = 'Category is required.';
        if (formData.expenseDate === null) newErrors.expenseDate = 'Expense date is required.';
        if (formData.sourceType === '') newErrors.sourceType = 'Payment source is required.';
        if (formData.sourceType === 'EMPLOYEE_PAID' && !formData.paidByUserId) {
            newErrors.paidByUserId = 'Select the person who paid.';
        }
        if (formData.sourceType !== 'EMPLOYEE_PAID') {
            if (formData.sourceType === 'BANK' && formData.bankId === '') newErrors.bankId = 'Bank account is required.';
            if (formData.sourceType === 'BANK' && formData.paymentMode === '') newErrors.paymentMode = 'Payment mode is required.';
        }
        if (formData.paymentStatus === '') newErrors.paymentStatus = 'Payment status is required.';

        // Custom Fields Validation
        activeCustomFields.forEach((field: any) => {
            if (field.isMandatory) {
                const val = formData.customFields[field.fieldSlug] ?? formData.customFields[field.id];
                const errorKey = `customField_${field.fieldSlug || field.id}`;

                if (val === undefined || val === null) {
                    newErrors[errorKey] = `${field.labelName} is required.`;
                } else if (Array.isArray(val) && val.length === 0) {
                    newErrors[errorKey] = `${field.labelName} is required.`;
                } else if (typeof val === 'string' && val.trim() === '') {
                    newErrors[errorKey] = `${field.labelName} is required.`;
                }
            }
        });

        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateForm()) {
            toast.error('Please fix the errors in the form.');
            return;
        }

        try {
            setIsSubmitting(true);
            const payload = new FormData();

            forEach(formData, (value, key) => {
                if (key === 'supplierId') {
                    // Always include supplierId so backend can clear it; send '' when null
                    payload.append(key, value == null ? '' : String(value));
                    return;
                }
                if (key === 'paidByUserId') {
                    // Only send paidByUserId when EMPLOYEE_PAID; skip otherwise
                    if (formData.sourceType === 'EMPLOYEE_PAID') {
                        payload.append(key, value == null ? '' : String(value));
                    }
                    return;
                }
                if (value !== null && value !== undefined) {
                    if (key === 'attachment' && value instanceof File) {
                        payload.append(key, value);
                    } else if (key === 'expenseDate' && value instanceof Date) {
                        payload.append(key, value.toISOString());
                    } else if (key === 'customFields') {
                        // Format custom fields perfectly for your backend array mapping
                        const customFieldsEntries = Object.entries(formData.customFields)
                            .filter(([_, val]) => {
                                if (val === undefined || val === null) return false;
                                if (typeof val === 'string' && val.trim() === '') return false;
                                if (Array.isArray(val) && val.length === 0) return false;
                                return true;
                            });

                        customFieldsEntries.forEach(([fieldSlugOrId, val], index) => {
                            const matchedField = activeCustomFields.find(f => f.fieldSlug === fieldSlugOrId || f.id === fieldSlugOrId);
                            const finalFieldId = matchedField ? matchedField.id : fieldSlugOrId;

                            payload.append(`customFields[${index}][fieldId]`, finalFieldId);

                            if (Array.isArray(val)) {
                                payload.append(`customFields[${index}][value]`, val.join(','));
                            } else if (val instanceof Date) {
                                const year = val.getFullYear();
                                const month = String(val.getMonth() + 1).padStart(2, "0");
                                const day = String(val.getDate()).padStart(2, "0");
                                payload.append(`customFields[${index}][value]`, `${year}-${month}-${day}`);
                            } else if (val instanceof File) {
                                payload.append(`customFields[${index}][value]`, val);
                            } else {
                                payload.append(`customFields[${index}][value]`, String(val));
                            }
                        });
                    } else {
                        payload.append(key, String(value));
                    }
                }
            });

            if (editItem) {
                await axios.put(`${Constants.UPDATE_EXPENSE_URL}/${editItem.id}`, payload, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                toast.success('Expense updated successfully');
                onSuccess();
            } else {
                await axios.post(Constants.CREATE_NEW_EXPENSE_URL, payload, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                toast.success('Expense created successfully');
                onSuccess();
            }
        } catch (error) {
            const errorResponse = error as AxiosError<{ errors: { [key: string]: string }; message?: string }>;
            if (errorResponse.response?.data?.errors) {
                setFormErrors(errorResponse.response.data.errors);
                toast.error('Failed to save expense due to validation errors.');
            } else if (axios.isAxiosError(error) && errorResponse.response?.data?.message) {
                toast.error(errorResponse.response.data.message);
            } else {
                toast.error('Something went wrong.');
            }
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <>
            <Modal isOpen={isOpen} onClose={onClose} title={editItem ? 'Update Expense' : 'Create New Expense'} size="3xl">
                <form onSubmit={handleSubmit}>
                    {/* Expense Date */}
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <DateInput
                                label="Expense Date"
                                value={formData.expenseDate || null}
                                onChange={(date) => handleFormChange('expenseDate', date)}
                                isRequired
                            />
                            {formErrors.expenseDate && <p className="text-danger text-sm">{formErrors.expenseDate}</p>}
                        </div>
                        {/* Amount */}
                        <FormField
                            label="Amount"
                            required
                            type="number"
                            value={formData.amount}
                            onChange={e => handleFormChange('amount', e.target.value)}
                            error={formErrors.amount}
                        />
                        {/* Category */}
                        <div>
                            <div className="flex items-center justify-between">
                                <label htmlFor="expenseCategoryId" className="block text-sm font-medium text-heading">Category <em className="text-danger">*</em></label>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setIsCategoryModalOpen(true)}
                                    className="text-xs text-purple-600 hover:text-purple-700"
                                >
                                    + Add New
                                </Button>
                            </div>
                            <SmartDropdown
                                items={categoryOptions}
                                value={categorySearchKeyword}
                                placeholder="Search or Select Category"
                                onChange={(keyword) => setCategorySearchKeyword(keyword)}
                                onSelect={(item) => handleCategorySelect(item as OptionType)}
                                selectedItem={categoryOptions.find(category => category.id === formData.expenseCategoryId) || null}
                            />
                            {formErrors.expenseCategoryId && <p className="text-danger text-sm">{formErrors.expenseCategoryId}</p>}
                        </div>
                        {/* Vendor (optional) */}
                        <div>
                            <label htmlFor="supplierId" className="block text-sm font-medium text-heading">Vendor</label>
                            <SmartDropdown
                                items={supplierOptions}
                                value={supplierSearchKeyword}
                                placeholder="Search or Select Vendor"
                                onChange={(keyword) => setSupplierSearchKeyword(keyword)}
                                onSelect={(item) => handleSupplierSelect(item as OptionType)}
                                selectedItem={supplierOptions.find(supplier => supplier.id === formData.supplierId) || null}
                            />
                            {formErrors.supplierId && <p className="text-danger text-sm">{formErrors.supplierId}</p>}
                        </div>
                        {/* Reimbursable toggle */}
                        <div className="md:col-span-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.sourceType === 'EMPLOYEE_PAID'}
                                    onChange={(e) =>
                                        handleFormChange(
                                            'sourceType',
                                            e.target.checked ? 'EMPLOYEE_PAID' : 'PETTY_CASH',
                                        )
                                    }
                                />
                                <span className="text-sm font-medium text-heading">Paid by employee (reimbursable)</span>
                            </label>
                        </div>
                        {formData.sourceType === 'EMPLOYEE_PAID' ? (
                            /* Person picker */
                            <div className="md:col-span-3">
                                <Select
                                    label="Paid by (person)"
                                    required
                                    id="paidByUserId"
                                    value={formData.paidByUserId ?? ''}
                                    onChange={(e) => handleFormChange('paidByUserId', e.target.value || null)}
                                    options={[
                                        { value: '', label: 'Select person…' },
                                        ...people.map((u) => ({ value: u.id, label: u.name })),
                                    ]}
                                    error={formErrors.paidByUserId}
                                />
                            </div>
                        ) : (
                            <>
                                {/* Payment Source */}
                                <div>
                                    <label htmlFor="sourceType" className="block text-sm font-medium text-heading">Payment Source <em className="text-danger">*</em></label>
                                    <SmartDropdown
                                        items={paymentSourceSoptions}
                                        value={sourceSearchKeyword}
                                        placeholder="Search or Select Payment Source"
                                        onChange={(keyword) => setSourceSearchKeyword(keyword)}
                                        onSelect={(item) => handlePaymentSourceSelect(item as OptionType)}
                                        selectedItem={paymentSourceSoptions.find(source => source.id === formData.sourceType) || null}
                                        serverside={false}
                                    />
                                    {formErrors.sourceType && <p className="text-danger text-sm">{formErrors.sourceType}</p>}
                                </div>
                                {/* Bank account */}
                                <div className={`${formData.sourceType === 'BANK' ? '' : 'hidden'}`}>
                                    <label htmlFor="bankId" className="block text-sm font-medium text-heading">Debit From <em className="text-danger">*</em></label>
                                    <SmartDropdown
                                        items={bankAccountOptions}
                                        value={bankSearchKeyword}
                                        placeholder="Search or Select Bank Account"
                                        onChange={(keyword) => setBankSearchKeyword(keyword)}
                                        onSelect={(item) => handleBankAccountSelect(item as OptionType)}
                                        selectedItem={bankAccountOptions.find(bank => bank.id === formData.bankId) || null}
                                    />
                                    {formErrors.bankId && <p className="text-danger text-sm">{formErrors.bankId}</p>}
                                </div>
                                {/* Payment Mode */}
                                <div className={`${formData.sourceType === 'BANK' ? '' : 'hidden'}`}>
                                    <label className="block text-sm font-medium text-heading ">Payment Mode <em className="text-danger">*</em></label>
                                    <SmartDropdown
                                        items={paymentModeOptions}
                                        value={paymentModeSearchKeyword}
                                        placeholder="Search or Select Payment Mode"
                                        onChange={(keyword) => setPaymentModeSearchKeyword(keyword)}
                                        onSelect={(item) => handlePaymentModeSelect(item as OptionType)}
                                        selectedItem={paymentModeOptions.find(paymentMode => paymentMode.id === formData.paymentMode) || null}
                                        serverside={false}
                                    />
                                    {formErrors.paymentMode && <p className="text-danger text-sm">{formErrors.paymentMode}</p>}
                                </div>
                            </>
                        )}
                        {/* Payment Status */}
                        <div>
                            <label className="block text-sm font-medium text-heading ">Payment Status <em className="text-danger">*</em></label>
                            <SmartDropdown
                                placeholder="Search or Select Payment Status"
                                items={paymentStatusOptions}
                                value={paymentStatusSearchKeyword}
                                onChange={(keyword) => setPaymentStatusSearchKeyword(keyword)}
                                onSelect={(item) => handlePaymentStatusSelect(item as OptionType)}
                                selectedItem={paymentStatusOptions.find(status => status.id === formData.paymentStatus) || null}
                                serverside={false}
                            />
                            {formErrors.paymentStatus && <p className="text-danger text-sm">{formErrors.paymentStatus}</p>}
                        </div>
                    </div>

                    {/* Description */}
                    <FormField label="Description" containerClassName="mt-4">
                        {(field) => (
                            <textarea
                                id={field.id}
                                aria-describedby={field['aria-describedby']}
                                className={fieldControlClasses()}
                                placeholder="Description"
                                value={formData.description}
                                onChange={(e) => handleFormChange('description', e.target.value)}
                            />
                        )}
                    </FormField>

                    {/* Attachment / show selected file name */}
                    <FormField
                        label="Attachment"
                        type="file"
                        containerClassName="mt-4"
                        className="file:bg-purple-50 file:text-purple-700 file:border-0 file:rounded file:px-2 file:font-semibold"
                        onChange={(e) => handleFormChange('attachment', e.target.files?.[0] || null)}
                        helper={editItem && editItem.attachment ? `leave empty if you don't want to change the attachment` : undefined}
                    />

                    {/* DYNAMIC CUSTOM FIELDS */}
                    <DynamicCustomFields
                        moduleSlug="expenses"
                        values={formData.customFields}
                        errors={formErrors}
                        onChange={handleCustomFieldChange}
                        onFieldsLoaded={setActiveCustomFields}
                    />

                    {/* RECURRING EXPENSE */}
                    <div className="border border-border rounded-card p-3 md:col-span-3 mt-3">
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={formData.isRecurring}
                                onChange={(e) => setFormData((p) => ({ ...p, isRecurring: e.target.checked }))}
                            />
                            <span className="text-sm font-medium text-heading">Make this expense recurring</span>
                        </label>

                        {formData.isRecurring && (
                            <div className="mt-3 space-y-3">
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className="text-sm text-body w-24">Frequency</span>
                                    {(['day', 'week', 'month', 'year', 'custom'] as const).map((f) => (
                                        <label key={f} className="flex items-center gap-1 text-sm">
                                            <input
                                                type="radio"
                                                name="exp-repeatEvery"
                                                value={f}
                                                checked={formData.repeatEvery === f}
                                                onChange={() => setFormData((p) => ({ ...p, repeatEvery: f }))}
                                            />
                                            <span className="capitalize">{f}</span>
                                        </label>
                                    ))}
                                </div>

                                {formData.repeatEvery === 'custom' && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-body w-24">Every</span>
                                        <FormField
                                            type="number"
                                            min={1}
                                            value={formData.customIntervalNumber ?? 1}
                                            onChange={(e) => setFormData((p) => ({ ...p, customIntervalNumber: parseInt(e.target.value, 10) || 1 }))}
                                            containerClassName="w-20"
                                        />
                                        <Select
                                            value={formData.customIntervalType ?? 'month'}
                                            onChange={(e) => setFormData((p) => ({ ...p, customIntervalType: e.target.value as 'day' | 'week' | 'month' | 'year' }))}
                                            options={[
                                                { value: 'day', label: 'day(s)' },
                                                { value: 'week', label: 'week(s)' },
                                                { value: 'month', label: 'month(s)' },
                                                { value: 'year', label: 'year(s)' },
                                            ]}
                                            containerClassName="w-28"
                                        />
                                    </div>
                                )}

                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-body w-24">Start on</span>
                                    <div className="flex-1">
                                        <DateInput
                                            label=""
                                            value={ymdStringToDate(formData.startOn)}
                                            onChange={(date) => setFormData((p) => ({ ...p, startOn: dateToYmdString(date) || null }))}
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 flex-wrap">
                                    <span className="text-sm text-body w-24">Ends on</span>
                                    <label className="flex items-center gap-1 text-sm">
                                        <input
                                            type="radio"
                                            checked={formData.neverExpire}
                                            onChange={() => setFormData((p) => ({ ...p, neverExpire: true, endsOn: null }))}
                                        />
                                        Never
                                    </label>
                                    <label className="flex items-center gap-1 text-sm">
                                        <input
                                            type="radio"
                                            checked={!formData.neverExpire}
                                            onChange={() => setFormData((p) => ({ ...p, neverExpire: false }))}
                                        />
                                        On
                                    </label>
                                    {!formData.neverExpire && (
                                        <div className="min-w-40">
                                            <DateInput
                                                label=""
                                                value={ymdStringToDate(formData.endsOn)}
                                                onChange={(date) => setFormData((p) => ({ ...p, endsOn: dateToYmdString(date) || null }))}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end mt-6">
                        <Button variant="white" onClick={onClose} className="mr-2">Cancel</Button>
                        <SubmitButton isDisabled={isSubmitting} isLoading={isSubmitting} mode={editItem ? 'edit' : 'create'} />
                    </div>
                </form>
            </Modal>

            {/* Inline "Add Category" — create an expense category without leaving the form */}
            <ExpenseCategoryFormModal
                isOpen={isCategoryModalOpen}
                onClose={() => setIsCategoryModalOpen(false)}
                onSuccess={handleCategoryCreated}
            />
        </>
    );
};

export default ExpenseFormModal;