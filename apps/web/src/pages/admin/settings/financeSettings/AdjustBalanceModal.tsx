import api from '@lib/apiClient';
import Modal from "@components/admin/Modal";
import SubmitButton from "@components/admin/SubmitButton";
import { Button, FormField, Select, fieldControlClasses } from "@components/ui";
import DateInput from "@components/admin/DateInput";
import { ymdStringToDate, dateToYmdString } from "@utils/converters";
import Constants from "@constants/api";
import type { BankAccount } from "@models/bank-account";
import { useCurrencies } from "@hooks/useCurrencies";
import { AxiosError } from 'axios';
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface AdjustBalanceModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    bankAccount: BankAccount | null;
}

// Opening balance is locked after creation, so corrections are made as a dated
// manual DEPOSIT/WITHDRAWAL. This posts to the existing bank-transactions endpoint
// (relatedType MANUAL), which moves currentBalance and keeps full history.
type AdjustType = "DEPOSIT" | "WITHDRAWAL";

const TYPE_OPTIONS: { value: AdjustType; label: string }[] = [
    { value: "DEPOSIT", label: "Deposit (increase balance)" },
    { value: "WITHDRAWAL", label: "Withdrawal (decrease balance)" },
];

const todayISO = () => new Date().toISOString().slice(0, 10);

const AdjustBalanceModal: React.FC<AdjustBalanceModalProps> = ({ isOpen, onClose, onSuccess, bankAccount }) => {
    const { formatMoney, defaultCurrencyCode } = useCurrencies();
    const [isSaving, setIsSaving] = useState(false);

    const [form, setForm] = useState({
        transactionDate: todayISO(),
        type: "DEPOSIT" as AdjustType,
        amount: "",
        remarks: "",
    });

    // Reset each time the modal reopens for a (possibly different) account.
    useEffect(() => {
        if (!isOpen) return;
        setForm({ transactionDate: todayISO(), type: "DEPOSIT", amount: "", remarks: "" });
    }, [isOpen, bankAccount?.id]);

    if (!bankAccount) return null;

    const currency = bankAccount.currencyCode || defaultCurrencyCode;
    const current = Number(bankAccount.currentBalance ?? 0);
    const amountNum = Number(form.amount) || 0;
    const resulting = form.type === "WITHDRAWAL" ? current - amountNum : current + amountNum;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.amount || Number(form.amount) <= 0) {
            toast.warning("Please enter a valid amount");
            return;
        }
        if (!form.remarks.trim()) {
            toast.warning("Please enter a reason for the adjustment");
            return;
        }
        try {
            setIsSaving(true);
            await api.post(
                Constants.CREATE_BANK_TRANSACTION_URL,
                {
                    bankAccountId: bankAccount.id,
                    transactionDate: form.transactionDate,
                    type: form.type,
                    amount: Number(form.amount),
                    remarks: form.remarks.trim(),
                }
            );
            toast.success("Balance adjusted successfully");
            onSuccess?.();
            onClose();
        } catch (err) {
            const message = err instanceof AxiosError
                ? (err.response?.data as { message?: string } | undefined)?.message
                : undefined;
            toast.error(message || "Failed to adjust balance");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Adjust Balance" size="lg">
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
                {/* Account context (read-only) */}
                <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-sm">
                    <div className="font-medium text-gray-700 capitalize">
                        {bankAccount.bankName} · {bankAccount.accountNumber}
                    </div>
                    <div className="text-gray-700 mt-0.5">
                        Current balance: <span className="font-semibold text-gray-700">{formatMoney(current, currency)}</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-2">
                        Opening balance can't be edited. Post a dated deposit or withdrawal to correct
                        the current balance — the account's transaction history is preserved.
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                        label="Type"
                        value={form.type}
                        onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as AdjustType }))}
                    >
                        {TYPE_OPTIONS.map((t) => (
                            <option key={t.value} value={t.value}>
                                {t.label}
                            </option>
                        ))}
                    </Select>
                    <FormField
                        label="Amount"
                        required
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
                    <div className="flex flex-col justify-end">
                        <span className="block text-sm font-medium text-foreground mb-1">Resulting balance</span>
                        <span className={`text-lg font-semibold ${resulting < 0 ? "text-red-600" : "text-gray-800"}`}>
                            {formatMoney(resulting, currency)}
                        </span>
                    </div>
                </div>

                <FormField label="Reason" required>
                    {(field) => (
                        <textarea
                            id={field.id}
                            value={form.remarks}
                            onChange={(e) => setForm((p) => ({ ...p, remarks: e.target.value }))}
                            className={fieldControlClasses()}
                            rows={2}
                            placeholder="e.g. correcting opening balance entry"
                        />
                    )}
                </FormField>

                <div className="flex justify-end gap-3 pt-2">
                    <Button variant="white" onClick={onClose}>
                        Cancel
                    </Button>
                    <SubmitButton isDisabled={isSaving} isLoading={isSaving} mode="create">
                        {isSaving ? "Saving..." : "Post Adjustment"}
                    </SubmitButton>
                </div>
            </form>
        </Modal>
    );
};

export default AdjustBalanceModal;
