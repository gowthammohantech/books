import api from '@lib/apiClient';
import { useEffect, useState } from "react";
import type { AxiosError } from 'axios';
import Constants from "@constants/api";
import SubmitButton from "@components/admin/SubmitButton";
import { toast } from "sonner";
import Switch from "@components/admin/Switch";
import type { BankAccountCreatedResponse } from "@models/bank-account";
import SmartDropdown from "@components/admin/SmartDropdown";
import type { OptionType } from "@models/common";
import { BANK_CODE_TYPES, getBankCodeType } from "@constants/bankCodeTypes";
import { Button, Drawer, FormField, Select } from '@components/ui';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (newBankAccount: BankAccountCreatedResponse) => void;
}

interface BankAccountFormData {
    id?: string;
    accountHoldername: string;
    bankName: string;
    branchName: string;
    accountNumber: string;
    bankCodeType?: string;
    IFSCCode: string;
    accountType: string;
    openingBalance: number;
    status?: boolean;
}

const bankAccountTypes: OptionType[] = [
    { id: "savings", name: "Savings" },
    { id: "current", name: "Current" },
];
const CreateBankAccountModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {

    const setInitialFormData = (): BankAccountFormData => ({
        accountHoldername: "",
        bankName: "",
        branchName: "",
        accountNumber: "",
        bankCodeType: "IFSC",
        IFSCCode: "",
        accountType: "",
        openingBalance: 0,
        status: true,
    });
    const [formData, setFormData] = useState<BankAccountFormData>(setInitialFormData());
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [accountTypeSearchInput, setAccountTypeSearchInput] = useState<string>("");

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

    const handleOptionTypeChange = (option: OptionType | null) => {
        if (option) {
            setFormData(prev => ({
                ...prev,
                accountType: option.id,
            }));
        }
    }

    const handleBankCodeTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setFormData(prev => ({ ...prev, bankCodeType: e.target.value }));
    }

    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};
        if (!formData.accountHoldername.trim()) newErrors.accountHoldername = 'Account holder name is required.';
        if (!formData.bankName.trim()) newErrors.bankName = 'Bank name is required.';
        if (!formData.accountNumber.trim()) newErrors.accountNumber = 'Account number is required.';
        if (!formData.IFSCCode.trim()) newErrors.IFSCCode = `${getBankCodeType(formData.bankCodeType).label} is required.`;
        if (!formData.accountType) newErrors.accountType = 'Account type is required.';
        // The negative case previously had two branches with the same `< 0`
        // condition, so the second was unreachable and a negative balance
        // reported "is required". openingBalance is a number defaulting to 0
        // and is never absent, so the reachable message is the wrong one; keep
        // the branch that actually describes the problem.
        if (formData.openingBalance < 0) {
            newErrors.openingBalance = 'Opening balance cannot be negative.';
        } else if (formData.openingBalance > 9999999999) {
            newErrors.openingBalance = 'Opening balance cannot exceed 9,999,999,999.';
        }
        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateForm()) return;

        const payload = {
            ...formData,
            IFSCCode: formData.IFSCCode.toUpperCase()
        };

        try {
            setIsSubmitting(true);
            const response = await api.post(Constants.CREATE_BANK_ACCOUNT_URL, payload);
            toast.success('Bank account created successfully');
            onSuccess(response.data.data || {});
        } catch (error: any | AxiosError) {
            setFormErrors(error?.response?.data?.errors || {});
            toast.error('Something went wrong. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };
    return (
        <Drawer isOpen={isOpen} onClose={onClose} title="Create Bank Account">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    {/* Account Holder Name */}
                    <FormField
                        label="Account Holder Name"
                        required
                        name="accountHoldername"
                        value={formData.accountHoldername}
                        onChange={handleChange}
                        type="text"
                        placeholder="Enter Account Holder Name"
                        error={formErrors.accountHoldername}
                    />
                    {/* Bank Name */}
                    <FormField
                        label="Bank Name"
                        required
                        name="bankName"
                        value={formData.bankName}
                        onChange={handleChange}
                        type="text"
                        placeholder="Enter Bank Name"
                        error={formErrors.bankName}
                    />
                    {/* Branch Name */}
                    <FormField
                        label="Branch Name"
                        required
                        name="branchName"
                        value={formData.branchName}
                        onChange={handleChange}
                        type="text"
                        placeholder="Enter Branch Name"
                        error={formErrors.branchName}
                    />
                    {/* accountType */}
                    <FormField label="Account Type" required error={formErrors.accountType}>
                        <SmartDropdown
                            items={bankAccountTypes}
                            value={accountTypeSearchInput}
                            onChange={(value) => setAccountTypeSearchInput(value)}
                            onSelect={(option) => handleOptionTypeChange(option as OptionType)}
                            selectedItem={bankAccountTypes.find(option => option.id == formData.accountType) || null}
                            placeholder="Select Account Type"
                            serverside={false}
                        />
                    </FormField>
                    {/* Account Number */}
                    <FormField
                        label="Account Number"
                        required
                        name="accountNumber"
                        value={formData.accountNumber}
                        onChange={handleChange}
                        type="text"
                        placeholder="Enter Account Number"
                        error={formErrors.accountNumber}
                    />

                    {/* Bank Code Type */}
                    <Select
                        label="Bank Code Type"
                        name="bankCodeType"
                        value={formData.bankCodeType || "IFSC"}
                        onChange={handleBankCodeTypeChange}
                        options={BANK_CODE_TYPES.map((t) => ({ value: t.id, label: t.label }))}
                    />

                    {/* Bank Code (label + placeholder adapt to selected type) */}
                    <FormField
                        label={getBankCodeType(formData.bankCodeType).label}
                        required
                        name="IFSCCode"
                        value={formData.IFSCCode}
                        onChange={handleChange}
                        type="text"
                        placeholder={getBankCodeType(formData.bankCodeType).placeholder}
                        error={formErrors.IFSCCode}
                    />
                    {/* Opening Balance */}
                    <FormField
                        label="Opening Balance"
                        required
                        placeholder="Enter Opening Balance"
                        disabled={false}
                        type="number"
                        name="openingBalance"
                        value={formData.openingBalance ? Number(formData.openingBalance) : 0}
                        onChange={handleChange}
                        error={formErrors.openingBalance}
                    />
                </div>
                {/* Status Switch */}
                <div className="flex items-center gap-3 pt-2">
                    <label htmlFor="status" className="font-medium text-sm text-foreground ">Status</label>
                    <Switch name="status" checked={formData.status ?? false} onChange={handleChange} />
                </div>

                {/* Buttons */}
                <div className="flex justify-end pt-4 space-x-2">
                    <Button type="button" variant="white" onClick={onClose}>Cancel</Button>
                    <SubmitButton isDisabled={isSubmitting} isLoading={isSubmitting} mode={"create"} />
                </div>
            </form>
        </Drawer>
    );
}

export default CreateBankAccountModal;
