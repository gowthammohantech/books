import Modal from "@components/admin/Modal";
import SubmitButton from "@components/admin/SubmitButton";
import { Button, FormField, Select, fieldControlClasses } from "@components/ui";
import DateInput from "@components/admin/DateInput";
import { ymdStringToDate, dateToYmdString } from "@utils/converters";
import Constants from "@constants/api";
import type { RootState } from "@store/index";
import axios from "axios";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "sonner";

interface BankAccountOption {
    id: string;
    accountNumber: string;
    accountHoldername?: string;
    bankName: string;
}

interface PaymentModeOption {
    id: string;
    name: string;
}

interface AddBankTransactionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    /** Sensible defaults when opened from an invoice. */
    defaultType?: BankTransactionType;
    defaultAmount?: number | null;
    defaultRemarks?: string;
    defaultReferenceNo?: string;
}

type BankTransactionType =
    | "DEPOSIT"
    | "WITHDRAWAL"
    | "TRANSFER_IN"
    | "TRANSFER_OUT"
    | "PAYMENT"
    | "RECEIPT";

const TYPE_OPTIONS: { value: BankTransactionType; label: string }[] = [
    { value: "RECEIPT", label: "Receipt (money in)" },
    { value: "DEPOSIT", label: "Deposit (money in)" },
    { value: "PAYMENT", label: "Payment (money out)" },
    { value: "WITHDRAWAL", label: "Withdrawal (money out)" },
    { value: "TRANSFER_IN", label: "Transfer in" },
    { value: "TRANSFER_OUT", label: "Transfer out" },
];

const todayISO = () => new Date().toISOString().slice(0, 10);

const AddBankTransactionModal: React.FC<AddBankTransactionModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    defaultType = "RECEIPT",
    defaultAmount = null,
    defaultRemarks = "",
    defaultReferenceNo = "",
}) => {
    const { token } = useSelector((state: RootState) => state.auth);
    const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
    const [paymentModes, setPaymentModes] = useState<PaymentModeOption[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    const [form, setForm] = useState({
        bankAccountId: "",
        transactionDate: todayISO(),
        type: defaultType as BankTransactionType,
        amount: defaultAmount != null ? String(defaultAmount) : "",
        paymentModeId: "",
        referenceNo: defaultReferenceNo,
        remarks: defaultRemarks,
    });

    // Reset the form each time the modal is (re)opened so invoice defaults apply.
    useEffect(() => {
        if (!isOpen) return;
        setForm({
            bankAccountId: "",
            transactionDate: todayISO(),
            type: defaultType,
            amount: defaultAmount != null ? String(defaultAmount) : "",
            paymentModeId: "",
            referenceNo: defaultReferenceNo,
            remarks: defaultRemarks,
        });
    }, [isOpen, defaultType, defaultAmount, defaultRemarks, defaultReferenceNo]);

    useEffect(() => {
        if (!isOpen || !token) return;
        let cancelled = false;
        (async () => {
            try {
                const [accountsRes, modesRes] = await Promise.all([
                    axios.get(Constants.GET_BANK_ACCOUNTS_URL, {
                        params: { limit: 100, page: 1 },
                        headers: { Authorization: `Bearer ${token}` },
                    }),
                    axios.get(Constants.GET_ALL_PAYMENT_MODES_URL, {
                        headers: { Authorization: `Bearer ${token}` },
                    }),
                ]);
                if (cancelled) return;
                setBankAccounts(accountsRes.data?.data?.bankDetails ?? []);
                setPaymentModes(modesRes.data?.data ?? []);
            } catch {
                if (!cancelled) toast.error("Failed to load bank accounts / payment modes");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isOpen, token]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.bankAccountId) {
            toast.warning("Please select a bank account");
            return;
        }
        if (!form.amount || Number(form.amount) <= 0) {
            toast.warning("Please enter a valid amount");
            return;
        }
        try {
            setIsSaving(true);
            await axios.post(
                Constants.CREATE_BANK_TRANSACTION_URL,
                {
                    bankAccountId: form.bankAccountId,
                    transactionDate: form.transactionDate,
                    type: form.type,
                    amount: Number(form.amount),
                    ...(form.paymentModeId ? { paymentModeId: form.paymentModeId } : {}),
                    referenceNo: form.referenceNo,
                    remarks: form.remarks,
                },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success("Bank transaction added");
            onSuccess?.();
            onClose();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || "Failed to add bank transaction");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add Bank Transaction" size="lg">
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
                <Select
                    label="Bank Account"
                    value={form.bankAccountId}
                    onChange={(e) => setForm((p) => ({ ...p, bankAccountId: e.target.value }))}
                >
                    <option value="">Select a bank account…</option>
                    {bankAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                            [{acc.accountNumber}] {acc.accountHoldername ?? ""} - {acc.bankName}
                        </option>
                    ))}
                </Select>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                        label="Type"
                        value={form.type}
                        onChange={(e) =>
                            setForm((p) => ({ ...p, type: e.target.value as BankTransactionType }))
                        }
                    >
                        {TYPE_OPTIONS.map((t) => (
                            <option key={t.value} value={t.value}>
                                {t.label}
                            </option>
                        ))}
                    </Select>
                    <FormField
                        label="Amount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.amount}
                        onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                        placeholder="0.00"
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <DateInput
                            label="Date"
                            value={ymdStringToDate(form.transactionDate)}
                            onChange={(date) => setForm((p) => ({ ...p, transactionDate: dateToYmdString(date) }))}
                        />
                    </div>
                    <Select
                        label={
                            <>
                                Payment Mode <span className="text-body">(optional)</span>
                            </>
                        }
                        value={form.paymentModeId}
                        onChange={(e) => setForm((p) => ({ ...p, paymentModeId: e.target.value }))}
                    >
                        <option value="">Default (Other)</option>
                        {paymentModes.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </Select>
                </div>

                <FormField
                    label={
                        <>
                            Reference No <span className="text-body">(optional)</span>
                        </>
                    }
                    type="text"
                    value={form.referenceNo}
                    onChange={(e) => setForm((p) => ({ ...p, referenceNo: e.target.value }))}
                    placeholder="Cheque / UTR / reference"
                />

                <FormField label="Remarks">
                    {(field) => (
                        <textarea
                            id={field.id}
                            value={form.remarks}
                            onChange={(e) => setForm((p) => ({ ...p, remarks: e.target.value }))}
                            className={fieldControlClasses()}
                            rows={2}
                        />
                    )}
                </FormField>

                <div className="flex justify-end gap-3 pt-2">
                    <Button variant="white" onClick={onClose}>
                        Cancel
                    </Button>
                    <SubmitButton isDisabled={isSaving} isLoading={isSaving} mode="create">
                        {isSaving ? "Saving..." : "Add Transaction"}
                    </SubmitButton>
                </div>
            </form>
        </Modal>
    );
};

export default AddBankTransactionModal;
