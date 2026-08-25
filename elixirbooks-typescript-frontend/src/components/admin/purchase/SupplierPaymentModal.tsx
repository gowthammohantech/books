import DateInput from "@components/admin/DateInput";
import Modal from "@components/admin/Modal";
import SmartDropdown from "@components/admin/SmartDropdown";
import SubmitButton from "@components/admin/SubmitButton";
import { Button, FormField, fieldControlClasses } from "@components/ui";
import Constants from "@constants/api";
import { useDebounce } from "@hooks/useDebounce";
import { useCurrencies } from "@hooks/useCurrencies";
import type { OptionType } from "@models/common";
import type { RootState } from "@store/index";
import axios, { AxiosError } from "axios";
import type React from "react";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "sonner";

interface SupplierPaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    purchaseId: string;
    supplierId: string;
    totalAmount: number;
    remaining: number;
    currencyCode?: string | null;
    onSuccess: () => void;
}

type SupplierPaymentSourceType = 'BANK' | 'PETTY_CASH';

interface SupplierPaymentFormData {
    purchaseId: string;
    paymentDate: Date | null;
    paidAmount: number;
    paymentMode: string | null;
    bankId: string | null;
    notes: string;
    referenceNumber: string | null;
    sourceType: SupplierPaymentSourceType;
}

const initialFormData: SupplierPaymentFormData = {
    purchaseId: '',
    paymentDate: new Date(),
    paidAmount: 0,
    paymentMode: null,
    bankId: null,
    notes: '',
    referenceNumber: null,
    sourceType: 'BANK',
};

const SupplierPaymentModal: React.FC<SupplierPaymentModalProps> = ({
    isOpen,
    onClose,
    purchaseId,
    supplierId,
    totalAmount,
    remaining,
    currencyCode,
    onSuccess,
}) => {
    const [formData, setFormData] = useState<SupplierPaymentFormData>({ ...initialFormData, purchaseId });
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const { token } = useSelector((state: RootState) => state.auth);
    const { formatMoney } = useCurrencies();
    const fmt = (n: number) => formatMoney(n, currencyCode ?? undefined);
    const [isSaving, setIsSaving] = useState(false);

    const [bankAccountOptions, setBankAccountOptions] = useState<OptionType[]>([]);
    const [bankSearchKeyword, setBankSearchKeyword] = useState('');
    const debouncedBankSearch = useDebounce(bankSearchKeyword, 500);

    const [paymentModeOptions, setPaymentModeOptions] = useState<OptionType[]>([]);
    const [paymentModeSearchKeyword, setPaymentModeSearchKeyword] = useState('');

    useEffect(() => {
        if (isOpen) {
            setFormData({ ...initialFormData, purchaseId });
            setFormErrors({});
        }
    }, [isOpen, purchaseId]);

    // Fetch bank accounts
    useEffect(() => {
        const fetchBankAccounts = async () => {
            try {
                const response = await axios.get(Constants.FETCH_BANK_ACCOUNTS_WITH_SEARCH_URL, {
                    params: { search: debouncedBankSearch },
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (response.data.data.length > 0) {
                    const formatted = response.data.data.map((item: any) => {
                        const accountNumber = item.accountNumber ?? '';
                        const name = item.accountHoldername ?? '';
                        const bankName = item.bankName ?? '';
                        return {
                            id: item.id,
                            name: `[${accountNumber}] ${name} - ${bankName}`,
                        };
                    });
                    setBankAccountOptions(formatted);
                } else {
                    setBankAccountOptions([]);
                }
            } catch (error) {
                console.error('Error fetching bank accounts:', error);
            }
        };
        fetchBankAccounts();
    }, [debouncedBankSearch, token]);

    // Fetch payment modes
    useEffect(() => {
        if (!isOpen) return;
        const fetchPaymentModes = async () => {
            try {
                const response = await axios.get(Constants.GET_ALL_PAYMENT_MODES_URL, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const modes = response.data?.data ?? response.data ?? [];
                const formatted = (Array.isArray(modes) ? modes : []).map((m: any) => ({
                    id: m.id,
                    name: m.name,
                }));
                setPaymentModeOptions(formatted);
            } catch (error) {
                console.error('Error fetching payment modes:', error);
            }
        };
        fetchPaymentModes();
    }, [isOpen, token]);

    const handleFormChange = (field: keyof SupplierPaymentFormData, value: any) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleBankAccountSelect = (item: OptionType) => {
        handleFormChange('bankId', item ? item.id : null);
    };

    const handlePaymentModeSelect = (item: OptionType) => {
        handleFormChange('paymentMode', item ? item.id : null);
    };

    const handleSourceTypeChange = (sourceType: SupplierPaymentSourceType) => {
        setFormData((prev) => ({
            ...prev,
            sourceType,
            // Clear bank-specific fields when switching to Petty Cash.
            ...(sourceType === 'PETTY_CASH' ? { bankId: null, paymentMode: null } : {}),
        }));
        // Drop any stale bank/paymentMode validation errors.
        setFormErrors((prev) => {
            const next = { ...prev };
            delete next.bankId;
            delete next.paymentMode;
            return next;
        });
    };

    const validateForm = (): boolean => {
        const errors: { [key: string]: string } = {};

        if (!formData.paymentDate) {
            errors.paymentDate = 'Please select a date.';
        }

        if (!formData.paidAmount) {
            errors.paidAmount = 'Please enter an amount.';
        } else {
            if (formData.paidAmount < 0) {
                errors.paidAmount = 'Amount cannot be negative.';
            }
            if (formData.paidAmount > remaining) {
                errors.paidAmount = 'Amount cannot exceed remaining balance';
            }
        }

        if (formData.sourceType === 'BANK') {
            if (!formData.paymentMode) {
                errors.paymentMode = 'Payment mode is required.';
            }

            if (!formData.bankId) {
                errors.bankId = 'Bank account is required.';
            }
        }

        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            return false;
        }

        setFormErrors({});
        return true;
    };

    const handleSubmit = async () => {
        if (!validateForm()) return;

        try {
            setIsSaving(true);
            // Guard against a NaN remaining (prop not yet loaded) — an undefined/NaN
            // dueAmount is rejected server-side as "Due amount is required", which used
            // to surface only as a generic "Failed to record payment".
            const dueAmount = Math.max(0, (Number(remaining) || 0) - (Number(formData.paidAmount) || 0));
            const isBank = formData.sourceType === 'BANK';
            // Serialize paymentDate as a LOCAL YYYY-MM-DD string. Sending the raw
            // Date lets axios JSON.stringify it via toISOString() (UTC), so a
            // local-midnight date in IST (UTC+5:30) rolls back to the previous day
            // and the payment buckets into the wrong day/month. Match the doc forms.
            const pd = formData.paymentDate;
            const paymentDateLocal = pd instanceof Date
                ? `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}-${String(pd.getDate()).padStart(2, '0')}`
                : pd;
            const payload = {
                purchaseId,
                supplierId,
                paymentDate: paymentDateLocal,
                amount: formData.paidAmount,
                paidAmount: formData.paidAmount,
                dueAmount,
                notes: formData.notes,
                referenceNumber: formData.referenceNumber,
                sourceType: formData.sourceType,
                // BANK requires bankId + paymentMode; PETTY_CASH needs neither
                // (backend resolves the single petty-cash account itself).
                ...(isBank
                    ? { bankId: formData.bankId, paymentMode: formData.paymentMode }
                    : {}),
            };
            const response = await axios.post(Constants.CREATE_SUPPLIER_PAYMENT_URL, payload, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (response.data.data) {
                toast.success('Supplier payment recorded successfully.');
                onClose();
                onSuccess();
            }
        } catch (error) {
            const axiosError = error as AxiosError as any;
            const data = axiosError.response?.data;
            // Surface the real backend reason (e.g. "no account mapped for role CASH",
            // "Insufficient petty cash balance") instead of a generic message so the
            // user can act. Reference is optional server-side — it is never the cause.
            const backendMsg =
                data?.message ||
                data?.error ||
                (Array.isArray(data?.errors) ? data.errors.map((e: any) => e.msg || e.message).filter(Boolean).join(', ') : '');
            toast.error(backendMsg || 'Failed to record payment.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Record Payment">
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                {/* Purchase Amount & Balance Remaining */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="form-control">
                        <label htmlFor="purchaseAmount" className="block text-sm font-medium text-heading">
                            Purchase Amount
                        </label>
                        <input
                            type="text"
                            id="purchaseAmount"
                            className="border border-border bg-surface cursor-not-allowed mt-1 rounded-control px-4 py-2 w-full text-heading focus:outline-none focus:ring-1 focus:ring-purple-600"
                            value={fmt(totalAmount)}
                            readOnly
                        />
                    </div>
                    <div className="form-control">
                        <label htmlFor="balanceRemaining" className="block text-sm font-medium text-heading">
                            Balance Remaining
                        </label>
                        <input
                            type="text"
                            id="balanceRemaining"
                            className="border border-border mt-1 bg-surface cursor-not-allowed rounded-control px-4 py-2 w-full text-heading focus:outline-none focus:ring-1 focus:ring-purple-600"
                            value={fmt(remaining || 0)}
                            readOnly
                        />
                    </div>
                </div>

                {/* Payment Date & Amount */}
                <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="form-control">
                        <DateInput
                            label="Payment Date"
                            onChange={(newDate) => handleFormChange('paymentDate', newDate)}
                            value={formData.paymentDate || null}
                            isRequired
                        />
                        {formErrors.paymentDate && <p className="text-danger text-xs mt-1">{formErrors.paymentDate}</p>}
                    </div>
                    <FormField
                        label="Payment Amount"
                        required
                        id="paymentAmount"
                        type="number"
                        value={formData.paidAmount || ''}
                        onChange={(e) => handleFormChange('paidAmount', Number(e.target.value))}
                        error={formErrors.paidAmount}
                    />
                </div>

                {/* Source of Funds */}
                <div className="mt-4">
                    <label className="block text-sm font-medium text-heading">
                        Source of Funds <em className="text-danger">*</em>
                    </label>
                    <div className="mt-1 flex gap-2">
                        {([
                            { value: 'BANK', label: 'Bank' },
                            { value: 'PETTY_CASH', label: 'Petty Cash' },
                        ] as { value: SupplierPaymentSourceType; label: string }[]).map((opt) => {
                            const isActive = formData.sourceType === opt.value;
                            return (
                                <Button
                                    key={opt.value}
                                    type="button"
                                    size="sm"
                                    variant={isActive ? 'primary' : 'white'}
                                    onClick={() => handleSourceTypeChange(opt.value)}
                                >
                                    {opt.label}
                                </Button>
                            );
                        })}
                    </div>
                </div>

                {/* Payment Method (Bank only) */}
                {formData.sourceType === 'BANK' && (
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-heading">
                            Payment Method <em className="text-danger">*</em>
                        </label>
                        <SmartDropdown
                            items={paymentModeOptions}
                            value={paymentModeSearchKeyword}
                            onChange={setPaymentModeSearchKeyword}
                            onSelect={(item) => handlePaymentModeSelect(item as OptionType)}
                            selectedItem={paymentModeOptions.find((m) => m.id === formData.paymentMode) || null}
                            placeholder="Search or Select Payment Method"
                            serverside={false}
                        />
                        {formErrors.paymentMode && <p className="text-danger text-xs mt-1">{formErrors.paymentMode}</p>}
                    </div>
                )}

                {/* Paid From (Bank account — Bank only) */}
                {formData.sourceType === 'BANK' && (
                    <div className="mt-4">
                        <label htmlFor="bankId" className="block text-sm font-medium text-heading">
                            Paid From <em className="text-danger">*</em>
                        </label>
                        <SmartDropdown
                            items={bankAccountOptions}
                            value={bankSearchKeyword}
                            placeholder="Search or select account"
                            onChange={(keyword) => setBankSearchKeyword(keyword)}
                            onSelect={(item) => handleBankAccountSelect(item as OptionType)}
                            selectedItem={bankAccountOptions.find((b) => b.id === formData.bankId) || null}
                        />
                        {formErrors.bankId && <p className="text-danger text-sm">{formErrors.bankId}</p>}
                    </div>
                )}

                {/* Reference Number */}
                <div className="mt-4">
                    <FormField
                        label="Reference / Cheque no. (optional)"
                        id="referenceNumber"
                        type="text"
                        onChange={(e) => handleFormChange('referenceNumber', e.target.value || null)}
                        placeholder="e.g. CHQ-00123"
                    />
                </div>

                {/* Notes */}
                <div className="mt-4">
                    <FormField label="Payment Note (optional)" id="paymentNotes">
                        {(field) => (
                            <textarea
                                id={field.id}
                                onChange={(e) => handleFormChange('notes', e.target.value)}
                                className={fieldControlClasses()}
                            />
                        )}
                    </FormField>
                </div>

                {/* Actions */}
                <div className="flex justify-end mt-4">
                    <Button type="button" variant="white" onClick={onClose} className="mr-2">
                        Cancel
                    </Button>
                    <SubmitButton isDisabled={isSaving} isLoading={isSaving} mode="create" />
                </div>
            </form>
        </Modal>
    );
};

export default SupplierPaymentModal;
