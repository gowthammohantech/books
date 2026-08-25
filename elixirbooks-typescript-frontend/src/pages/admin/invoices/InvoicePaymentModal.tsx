import DateInput from "@components/admin/DateInput";
import Modal from "@components/admin/Modal";
import SmartDropdown from "@components/admin/SmartDropdown";
import SubmitButton from "@components/admin/SubmitButton";
import { Button, FormField, fieldControlClasses } from "@components/ui";
import Constants from "@constants/api";
import { useDebounce } from "@hooks/useDebounce";
import type { OptionType } from "@models/common";
import type { InvoicePaymentDetails, InvoicePaymentFormData } from "@models/invoice-payment";
import type { RootState } from "@store/index";
import axios, { AxiosError } from "axios";
import type React from "react";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "sonner";

interface PaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    invoiceItem: InvoicePaymentDetails,
    onSuccess: () => void
}

const initialFormData: InvoicePaymentFormData = {
    invoiceId: '',
    received_on: new Date(),
    amount: 0,
    payment_method: null,
    bankId: null,
    notes: '',
    reference: null,
}
const InvoicePaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose, invoiceItem, onSuccess }) => {
    let paymentMethodOptions: OptionType[] = [];

    useEffect(() => {
        if (isOpen && invoiceItem) {
            setPaymentFormData({
                ...initialFormData,
                invoiceId: invoiceItem.id,
            });
            setFormErrors({});
        }
    }, [isOpen, invoiceItem]);

    if (invoiceItem.paymentMethods) {
        paymentMethodOptions = invoiceItem.paymentMethods.map((method) => ({
            id: method.id,
            name: method.name
        }));
    }
    const [paymentFormData, setPaymentFormData] = useState<InvoicePaymentFormData>({} as InvoicePaymentFormData);
    // QA #9/#30: cash receipts must NOT require a bank account. Derive whether
    // the selected method is cash from its slug so we can drop the bank field.
    const selectedPaymentMethod = (invoiceItem.paymentMethods ?? []).find(
        (m) => m.id === paymentFormData.payment_method
    );
    const isCashSelected = selectedPaymentMethod?.slug?.toLowerCase() === 'cash';
    // Account Credit redemption is likewise not a bank/register movement — no
    // "Deposit To" bank account makes sense for it either.
    const isAccountCreditSelected = selectedPaymentMethod?.slug?.toLowerCase() === 'account-credit';
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({})
    const { token } = useSelector((state: RootState) => state.auth);
    const [isSaving, setIsSaving] = useState(false);
    const [bankAccountOptions, setBankAccountOptions] = useState<OptionType[]>([]);
    const [bankSearchKeyword, setBankSearchKeyword] = useState('');
    const debouncedSearchTermBankAccount = useDebounce(bankSearchKeyword, 500);
    const [paymentModeSearchKeyword, setPaymentModeSearchKeyword] = useState('');
    // Available account-credit balance for the invoice's contact — fetched only
    // when Account Credit is the selected payment method, mirroring the same
    // Contact Summary endpoint ContactCard already uses for this balance.
    const [availableCredit, setAvailableCredit] = useState<number | null>(null);
    const [isLoadingCredit, setIsLoadingCredit] = useState(false);

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
        if (!isAccountCreditSelected || !invoiceItem.contactId) {
            setAvailableCredit(null);
            return;
        }
        let cancelled = false;
        setIsLoadingCredit(true);
        axios
            .get(`${Constants.API_BASE_URL}/admin/contacts/${invoiceItem.contactId}/summary`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((response) => {
                if (cancelled) return;
                const balance = Number(response.data?.data?.accountCreditBalance ?? 0);
                setAvailableCredit(Number.isFinite(balance) ? balance : 0);
            })
            .catch(() => {
                if (!cancelled) setAvailableCredit(null);
            })
            .finally(() => {
                if (!cancelled) setIsLoadingCredit(false);
            });
        return () => {
            cancelled = true;
        };
    }, [isAccountCreditSelected, invoiceItem.contactId, token]);

    const handleBankAccountSelect = (item: OptionType) => {
        if (item) {
            handleFormChange('bankId', item.id);
        } else {
            handleFormChange('bankId', null);
        }
    }

    const handlePaymentModeSelect = (item: OptionType) => {
        if (item) {
            const slug = (invoiceItem.paymentMethods ?? []).find((m) => m.id === item.id)
                ?.slug?.toLowerCase();
            const isCash = slug === 'cash';
            const isAccountCredit = slug === 'account-credit';
            // For cash and Account Credit, clear any chosen bank so we never submit a bankId.
            const clearsBank = isCash || isAccountCredit;
            setPaymentFormData(prev => ({
                ...prev,
                payment_method: item.id,
                ...(clearsBank ? { bankId: null } : {}),
            }));
            if (clearsBank) {
                setBankSearchKeyword('');
                setFormErrors(prev => {
                    const { bankId: _omit, ...rest } = prev;
                    return rest;
                });
            }
        } else {
            handleFormChange('payment_method', null);
        }
    }
    const handleOnClose = () => {
        onClose();
    }

    const handleFormChange = (field: keyof InvoicePaymentFormData, value: any) => {
        setPaymentFormData(prev => ({ ...prev, [field]: value }));
    }

    const validateForm = (): boolean => {
        const newErrors: { [key: string]: string } = {};

        if (!paymentFormData.received_on) {
            newErrors.received_on = 'Please select a date.';
        }

        if (!paymentFormData.amount) {
            newErrors.amount = 'Please enter an amount.';
        } else {
            if (paymentFormData.amount < 0) {
                newErrors.amount = 'Amount cannot be negative.';
            }
            if (paymentFormData.amount > invoiceItem.payment.remaining) {
                newErrors.amount = 'Amount cannot exceed remaining amount.';
            }
            // Account Credit can only cover as much as the contact currently has
            // available — cap client-side against whichever is smaller (the
            // server enforces the same rule and is authoritative regardless).
            if (isAccountCreditSelected && availableCredit != null) {
                const cap = Math.min(invoiceItem.payment.remaining, availableCredit);
                if (paymentFormData.amount > cap) {
                    newErrors.amount = `Amount cannot exceed available account credit (${availableCredit.toFixed(2)}).`;
                }
            }
        }

        if (!paymentFormData.payment_method) {
            newErrors.payment_method = 'Please select a payment method.';
        }

        // QA #9/#30: a cash receipt does not require a bank account. Only
        // require "Deposit To" when the selected method is non-cash. Account
        // Credit redemption is likewise not a bank movement, so it's exempt too.
        if (!isCashSelected && !isAccountCreditSelected && !paymentFormData.bankId) {
            newErrors.bankId = 'Please select a bank account.';
        }
        if (Object.keys(newErrors).length > 0) {
            setFormErrors(newErrors);
            return false;
        }

        setFormErrors({});
        return true;
    };
    const handleSubmit = async () => {
        if (!validateForm()) {
            return;
        }
        // Serialize received_on as a LOCAL YYYY-MM-DD string. Posting the raw Date
        // lets axios JSON.stringify it via toISOString() (UTC), so a local-midnight
        // date in IST (UTC+5:30) becomes the previous day 18:30Z and the payment
        // buckets into the prior day/month. Match how the document forms serialize.
        const received = paymentFormData.received_on;
        const receivedLocal = received instanceof Date
            ? `${received.getFullYear()}-${String(received.getMonth() + 1).padStart(2, '0')}-${String(received.getDate()).padStart(2, '0')}`
            : received;
        const payload = {
            ...paymentFormData,
            invoiceId: invoiceItem.id,
            received_on: receivedLocal,
        };
        try {
            setIsSaving(true);
            const response = await axios.post(Constants.CREATE_INVOICE_PAYMENT_URL, payload, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data.data) {
                toast.success('Invoice payment created successfully.');
                handleOnClose();
                onSuccess();
            }
        } catch (error) {
            const axiosError = error as AxiosError as any;
            const data = axiosError.response?.data;
            // Surface the real backend reason instead of failing silently. Reference is
            // optional server-side, so it is never the cause of a rejected payment.
            // Field-level errors (e.g. { amount: "Payment exceeds available account
            // credit. Available: 300" } for PAYMENT_EXCEEDS / ACCOUNT_CREDIT_EXCEEDS)
            // are more specific than the generic top-level "Validation failed." message,
            // so prefer them — whether shaped as an array (some endpoints) or an object
            // keyed by field (this one).
            const fieldErrors = data?.errors;
            const fieldMsg = Array.isArray(fieldErrors)
                ? fieldErrors.map((e: any) => e.msg || e.message).filter(Boolean).join(', ')
                : fieldErrors && typeof fieldErrors === 'object'
                    ? Object.values(fieldErrors).filter((v): v is string => typeof v === 'string').join(', ')
                    : '';
            const backendMsg = fieldMsg || data?.message || data?.error || '';
            toast.error(backendMsg || 'Failed to record payment.');
        } finally {
            setIsSaving(false);
        }
    }
    return (
        <Modal isOpen={isOpen} onClose={() => handleOnClose()} title="Invoice Payment">
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit() }}>
                {/* Invoice Number & Amount */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="form-control">
                        <label htmlFor="invoiceNumber" className="block text-sm font-medium text-heading ">
                            Invoice Number
                        </label>
                        <input type="text"
                            id="invoiceNumber"
                            className="border border-border bg-surface cursor-not-allowed mt-1 rounded-control px-4 py-2 w-full  text-heading  focus:outline-none focus:ring-1 focus:ring-purple-600"
                            value={invoiceItem.invoiceNumber} readOnly />
                    </div>
                    <div className="form-control">
                        <label htmlFor="invoiceAmount" className="block text-sm font-medium text-heading ">
                            Invoice Amount
                        </label>
                        <input type="text"
                            id="invoiceAmount"
                            className="border border-border mt-1 bg-surface cursor-not-allowed rounded-control px-4 py-2 w-full  text-heading  focus:outline-none focus:ring-1 focus:ring-purple-600"
                            value={invoiceItem.totalAmount} readOnly />
                    </div>
                </div>

                {/* Balance amount & Received Date */}
                <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="form-control">
                        <label
                            htmlFor="balanceAmount"
                            className="block text-sm font-medium text-heading ">
                            Balance Amount
                        </label>
                        <input type="text"
                            id="balanceAmount"
                            className="border border-border mt-1 bg-surface cursor-not-allowed rounded-control px-4 py-2 w-full  text-heading  focus:outline-none focus:ring-1 focus:ring-purple-600"
                            value={invoiceItem.payment.remaining || 0} readOnly />
                    </div>
                    <div className="form-control">
                        <DateInput
                            label="Received Date"
                            onChange={(newDate) => handleFormChange('received_on', newDate)}
                            value={paymentFormData.received_on || null}
                            minDate={invoiceItem.invoiceDate ? new Date(invoiceItem.invoiceDate) : undefined}
                            isRequired
                        />
                        {formErrors.received_on && <p className="text-danger text-xs mt-1">{formErrors.received_on}</p>}
                    </div>
                    {/* Payment Amount */}
                    <FormField
                        label="Payment Amount"
                        required
                        id="paymentAmount"
                        type="number"
                        onChange={(e) => handleFormChange('amount', Number(e.target.value))}
                        error={formErrors.amount}
                        helper={
                            isAccountCreditSelected
                                ? isLoadingCredit
                                    ? 'Loading available credit…'
                                    : availableCredit != null
                                        ? `Available credit: ${availableCredit.toFixed(2)}`
                                        : undefined
                                : undefined
                        }
                    />
                    <div>
                        <label className="block text-sm font-medium text-heading ">
                            Payment Method <em className="text-danger">*</em>
                        </label>
                        <SmartDropdown
                            items={paymentMethodOptions}
                            value={paymentModeSearchKeyword}
                            onChange={setPaymentModeSearchKeyword}
                            onSelect={(item) => handlePaymentModeSelect(item as OptionType)}
                            selectedItem={paymentMethodOptions.find(mode => mode.id === paymentFormData.payment_method) || null}
                            placeholder="Search or Select Payment Method"
                            serverside={false}
                        />

                        {formErrors.payment_method && <p className="text-danger text-xs mt-1">{formErrors.payment_method}</p>}
                    </div>
                </div>
                {/* Payment Method Dropdown */}

                {!isCashSelected && !isAccountCreditSelected && (
                    <div className='mt-4'>
                        <label htmlFor="bankId" className="block text-sm font-medium text-heading">Deposit To <em className="text-danger">*</em></label>
                        <SmartDropdown
                            items={bankAccountOptions}
                            value={bankSearchKeyword}
                            placeholder="Search or Select Bank Account"
                            onChange={(keyword) => setBankSearchKeyword(keyword)}
                            onSelect={(item) => handleBankAccountSelect(item as OptionType)}
                            selectedItem={bankAccountOptions.find(bank => bank.id === paymentFormData.bankId) || null}
                        />
                        {formErrors.bankId && <p className="text-danger text-sm">{formErrors.bankId}</p>}
                    </div>
                )}

                {/* Reference / Cheque no. */}
                <div className="mt-4">
                    <FormField
                        label="Reference / Cheque no. (optional)"
                        id="paymentReference"
                        type="text"
                        onChange={(e) => handleFormChange('reference', e.target.value || null)}
                        placeholder="e.g. CHQ-00123"
                    />
                </div>

                {/* Payment Note */}
                <div className="mt-4">
                    <FormField label="Payment Note (optional)" id="paymentNote">
                        {(field) => (
                            <textarea
                                id={field.id}
                                onChange={(e) => handleFormChange('notes', e.target.value)}
                                className={fieldControlClasses()}
                            ></textarea>
                        )}
                    </FormField>
                </div>
                {/* Cancel & Save */}
                <div className="flex justify-end mt-4">
                    <Button
                        variant="white"
                        onClick={() => handleOnClose()}
                        className="mr-2">
                        Cancel
                    </Button>
                    <SubmitButton isDisabled={isSaving} isLoading={isSaving} mode="create" />
                </div>
            </form>
        </Modal>
    );
};

export default InvoicePaymentModal;