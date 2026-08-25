import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import { useEffect, useState, type FC } from "react";
import axios, { AxiosError } from "axios";
import Constants from "@constants/api";
import { toast } from "sonner";
import Modal from "@components/admin/Modal";
import DateInput from "@components/admin/DateInput";
import SubmitButton from "@components/admin/SubmitButton";
import type { OptionType } from "@models/common";
import { useDebounce } from "@hooks/useDebounce";
import type { PendingPurchase } from "@models/purchase";
import SmartDropdown from "@components/admin/SmartDropdown";
import { Button, FormField, fieldControlClasses } from "@components/ui";

interface PaymentFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
}
interface PaymentFormData {
    id?: string;
    purchaseId: string;
    supplierId: string;
    referenceNumber: string;
    paymentDate: Date | null;
    sourceType: 'BANK' | 'PETTY_CASH' | null;
    bankId: string | null;
    amount: number;
    paidAmount: number;
    dueAmount: number;
    paymentMode: string | null;
    notes: string;
    attachment: File | null;
}
const initialFormData: PaymentFormData = {
    purchaseId: '',
    supplierId: '',
    referenceNumber: '',
    paymentDate: new Date(),
    sourceType: null,
    bankId: null,
    amount: 0,
    paidAmount: 0,
    dueAmount: 0,
    paymentMode: null,
    notes: '',
    attachment: null
}
const PaymentFormModal: FC<PaymentFormModalProps> = ({ isOpen, onClose, onConfirm }) => {
    const { token } = useSelector((state: RootState) => state.auth);
    const [formData, setFormData] = useState<PaymentFormData>(initialFormData);
    const [errors, setErrors] = useState<{ [key: string]: string }>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [purchaseSearchKeyword, setPurchaseSearchKeyword] = useState('');
    const debouncedPurchaseSearch = useDebounce(purchaseSearchKeyword, 700);
    const [purchases, setPurchases] = useState<PendingPurchase[]>([]);
    const [purchaseOptions, setPurchaseOptions] = useState<OptionType[]>([]);
    const [selectedPurchase, setSelectedPurchase] = useState<OptionType | null>(null);
    const [sourceSearchKeyword, setSourceSearchKeyword] = useState('');
    const [bankSearchKeyword, setBankSearchKeyword] = useState('');
    const debouncedSearchTermBankAccount = useDebounce(bankSearchKeyword, 500);
    const [bankAccountOptions, setBankAccountOptions] = useState<OptionType[]>([]);
    const [paymentModeOptions, setPaymentModeOptions] = useState<OptionType[]>([]);
    const [paymentModeSearchKeyword, setPaymentModeSearchKeyword] = useState('');

    const paymentSourceSoptions: OptionType[] = [
        { id: 'PETTY_CASH', name: 'Petty Cash' },
        { id: 'BANK', name: 'Bank Transfer' },
    ];

    useEffect(() => {
        if (isOpen) {
            setFormData(initialFormData);
            setErrors({});
        }
        fetchPaymentModes();
    }, [isOpen]);

    const fetchPaymentModes = async () => {
        try {
            const response = await axios.get(Constants.GET_ALL_PAYMENT_MODES_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setPaymentModeOptions(response.data.data);
        } catch (error) {
            console.error('Error fetching payment modes:', error);
        }
    }

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
    }, [debouncedSearchTermBankAccount]);

    useEffect(() => {
        const fetchPendingPurchases = async () => {
            try {
                const response = await axios.get(Constants.GET_ALL_PENDING_PURCHASES_URL, {
                    params: { search: debouncedPurchaseSearch },
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                let data = response.data.data;
                if (data) {
                    let formattedOptions = data.map((purchase: PendingPurchase) => {
                        return {
                            id: purchase.id,
                            name: purchase.purchaseId,
                        }
                    });
                    setPurchaseOptions(formattedOptions);
                    setPurchases(data);
                } else {
                    setPurchases([]);
                    setPurchaseOptions([]);
                }
            } catch (error) {
                toast.error('Failed to fetch pending purchases.');
            }
        }
        fetchPendingPurchases();
    }, [debouncedPurchaseSearch]);

    const handlePurchaseSelect = (option: OptionType) => {
        if (option) {
            let selectedPurchase = purchases.find(p => p.id === option.id);
            let newFormData = { ...formData };
            if (selectedPurchase?.payment) {
                newFormData.amount = selectedPurchase?.payment?.dueAmount || 0;
            } else {
                newFormData.amount = selectedPurchase?.totalAmount || 0;
            }
            newFormData.supplierId = selectedPurchase?.vendor?.id || '';
            newFormData.purchaseId = option.id;
            setSelectedPurchase(option);
            setFormData(prev => ({ ...prev, ...newFormData }));
        } else {
            setSelectedPurchase(null);
            setFormData(prev => ({ ...prev, purchaseId: '' }));
        }
    }

    const handlePaymentSourceSelect = (item: OptionType) => {
        if (item) {
            handleFormChange('sourceType', item.id);
        } else {
            handleFormChange('sourceType', null);
        }
    }

    const handleBankAccountSelect = (item: OptionType) => {
        if (item) {
            handleFormChange('bankId', item.id);
        } else {
            handleFormChange('bankId', null);
        }
    }

    const handlePaymentModeSelect = (item: OptionType) => {
        if (item) {
            handleFormChange('paymentMode', item.id);
        } else {
            handleFormChange('paymentMode', null);
        }
    }
    const handleFormChange = (field: keyof PaymentFormData, value: any) => {
        let newFormData = { ...formData, [field]: value };

        if (field === 'purchaseId') {
            const selectedPurchase = purchases.find(p => p.id === value);
            if (selectedPurchase?.payment) {
                newFormData.amount = selectedPurchase?.payment?.dueAmount || 0;
            } else {
                newFormData.amount = selectedPurchase?.totalAmount || 0;
            }
            newFormData.supplierId = selectedPurchase?.vendor?.id || '';
        }

        if (field === 'paidAmount') {
            if (Number(value) > newFormData.amount) {
                setErrors(prev => ({ ...prev, paidAmount: 'Paid amount cannot exceed total amount.' }));
            } else if (Number(value) < 1) {
                setErrors(prev => ({ ...prev, paidAmount: 'Paid amount must be greater than 0.' }));
            } else {
                const newErrors = { ...errors };
                delete newErrors.paidAmount;
                setErrors(newErrors);
            }
            let dueAmount = newFormData.amount - Number(value);
            newFormData.dueAmount = dueAmount;
        }
        setFormData(newFormData);
    };

    const validateForm = (): boolean => {
        const newErrors: { [key: string]: string } = {};
        if (!formData.purchaseId) newErrors.purchaseId = 'Purchase ID is required.';
        if (!formData.paymentDate) newErrors.paymentDate = 'Payment date is required.';
        if (formData.paidAmount <= 0) newErrors.paidAmount = 'Paid amount must be greater than 0.';
        if (formData.paidAmount > formData.amount) newErrors.paidAmount = 'Paid amount cannot exceed total amount.';
        if (formData.sourceType === null) newErrors.sourceType = 'Payment source is required.';
        if (formData.sourceType === 'BANK' && formData.bankId === null) newErrors.bankId = 'Bank account is required.';
        if (formData.sourceType === 'BANK' && formData.paymentMode === null) newErrors.paymentMode = 'Payment mode is required.';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) return;

        const apiData = new FormData();

        apiData.append('purchaseId', formData.purchaseId);
        apiData.append('contactId', formData.supplierId);
        apiData.append('dueAmount', String(formData.amount - formData.paidAmount));
        apiData.append('referenceNumber', formData.referenceNumber);
        if (formData.paymentDate instanceof Date) {
            const year = formData.paymentDate.getFullYear();
            const month = String(formData.paymentDate.getMonth() + 1).padStart(2, "0");
            const day = String(formData.paymentDate.getDate()).padStart(2, "0");

            apiData.append("paymentDate", `${year}-${month}-${day}`);
        }

        apiData.append('amount', String(formData.amount));
        apiData.append('paidAmount', String(formData.paidAmount));
        apiData.append('paymentMode', formData.paymentMode || '');
        apiData.append('bankId', formData.bankId || '');
        apiData.append('sourceType', formData.sourceType || '');
        apiData.append('notes', formData.notes);
        if (formData.attachment) {
            apiData.append('attachment', formData.attachment);
        }

        try {
            setIsSubmitting(true);
            await axios.post(Constants.CREATE_SUPPLIER_PAYMENT_URL, apiData, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
            });
            toast.success('Payment created successfully');
            onConfirm();
        } catch (error: any | AxiosError) {
            const errorResponse = error as AxiosError<{ errors: { [key: string]: string }; message?: string }>;
            if (errorResponse.response?.data?.errors) {
                setErrors(errorResponse.response.data.errors);
            } else if (axios.isAxiosError(error) && errorResponse.response?.data?.message) {
                toast.error(errorResponse.response.data.message);
            } else {
                toast.error('An unexpected error occurred.');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={'Add New Payment'} size="3xl">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Purchase ID */}
                    <div>
                        <label className="block text-sm font-medium text-heading">Purchase ID <span className="text-danger">*</span></label>
                        <SmartDropdown
                            items={purchaseOptions}
                            value={purchaseSearchKeyword}
                            onChange={setPurchaseSearchKeyword}
                            onSelect={(item) => handlePurchaseSelect(item as OptionType)}
                            placeholder="Search or select purchase ID"
                            selectedItem={selectedPurchase}
                        />
                        {errors.purchaseId && <p className="text-danger text-xs mt-1">{errors.purchaseId}</p>}
                    </div>

                    {/* Payment Date */}
                    <div>
                        <DateInput
                            label="Payment Date"
                            value={formData.paymentDate}
                            onChange={(newDate) => handleFormChange('paymentDate', newDate)}
                            isRequired
                        />
                        {errors.paymentDate && <p className="text-danger text-xs mt-1">{errors.paymentDate}</p>}
                    </div>

                    {/* Reference Number */}
                    <FormField
                        label="Reference Number"
                        type="text"
                        value={formData.referenceNumber}
                        onChange={(e) => handleFormChange('referenceNumber', e.target.value)}
                    />

                    {/* Total Amount */}
                    <FormField
                        label="Total Amount"
                        type="number"
                        value={formData.amount}
                        readOnly
                        error={errors.amount}
                    />

                    {/* Paid Amount */}
                    <FormField
                        label="Paid Amount"
                        required
                        type="number"
                        value={formData.paidAmount}
                        onChange={(e) => handleFormChange('paidAmount', e.target.value)}
                        error={errors.paidAmount}
                    />

                    {/* Due Amount */}
                    <FormField
                        label="Due Amount"
                        required
                        type="number"
                        value={formData.dueAmount}
                        onChange={(e) => handleFormChange('dueAmount', e.target.value)}
                        readOnly
                        error={errors.dueAmount}
                    />
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
                        {errors.sourceType && <p className="text-danger text-sm">{errors.sourceType}</p>}
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
                        {errors.bankId && <p className="text-danger text-sm">{errors.bankId}</p>}
                    </div>
                    {/* Payment Mode */}
                    <div className={`${formData.sourceType === 'BANK' ? '' : 'hidden'}`}>
                        <label className="block text-sm font-medium text-heading">Payment Mode <em className="text-danger">*</em></label>
                        <SmartDropdown
                            items={paymentModeOptions}
                            value={paymentModeSearchKeyword}
                            placeholder="Search or Select Payment Mode"
                            onChange={(keyword) => setPaymentModeSearchKeyword(keyword)}
                            onSelect={(item) => handlePaymentModeSelect(item as OptionType)}
                            selectedItem={paymentModeOptions.find(paymentMode => paymentMode.id === formData.paymentMode) || null}
                            serverside={false}
                        />
                        {errors.paymentMode && <p className="text-danger text-sm">{errors.paymentMode}</p>}
                    </div>

                    {/* Notes */}
                    <div className="md:col-span-3">
                        <FormField label="Notes">
                            {(field) => (
                                <textarea
                                    id={field.id}
                                    value={formData.notes}
                                    onChange={(e) => handleFormChange('notes', e.target.value)}
                                    rows={2}
                                    className={fieldControlClasses()}
                                ></textarea>
                            )}
                        </FormField>
                    </div>

                    {/* Attachment */}
                    <div className="md:col-span-3">
                        <label className="block text-sm font-medium text-heading">Attachment</label>
                        <div className="mt-1 flex justify-center px-4 pt-5 pb-4 border-2 border-border border-dashed rounded-control">
                            <div className="space-y-1 text-center">
                                {/* <UploadCloud className="mx-auto h-12 w-12 text-body" /> */}
                                <div className="flex text-sm text-body">
                                    <label htmlFor="attachment" className="relative cursor-pointer bg-white rounded-control font-medium text-purple-600 hover:text-purple-600">
                                        <span>Browse files</span>
                                        <input id="attachment" name="attachment" type="file" className="sr-only" onChange={(e) => handleFormChange('attachment', e.target.files ? e.target.files[0] : null)} />
                                    </label>
                                </div>
                                <p className="text-xs text-body">Max size: 5MB</p>
                            </div>
                        </div>
                        {formData.attachment && <p className="mt-2 text-sm text-body">Selected: {formData.attachment.name}</p>}
                    </div>
                </div>

                <div className="flex justify-end items-center px-4 pb-4 pt-4 gap-3">
                    <Button type="button" variant="white" onClick={onClose}>Cancel</Button>
                    <SubmitButton isDisabled={isSubmitting} isLoading={isSubmitting} mode="create" />
                </div>
            </form>
        </Modal>
    );
};

export default PaymentFormModal;