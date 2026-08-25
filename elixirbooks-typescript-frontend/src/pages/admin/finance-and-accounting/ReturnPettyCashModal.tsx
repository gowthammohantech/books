import Modal from "@components/admin/Modal";
import SmartDropdown from "@components/admin/SmartDropdown";
import SubmitButton from "@components/admin/SubmitButton";
import Constants from "@constants/api";
import { useDebounce } from "@hooks/useDebounce";
import type { OptionType, PaymentMode } from "@models/common";
import type { PettyCashFormData } from "@models/petty-cash";
import type { RootState } from "@store/index";
import axios from "axios";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "sonner";

interface Props {
    isOpen: boolean;
    currentBalance: number
    onClose: () => void;
    onSuccess: () => void;
    editItem?: any
}
const ReturnPettyCashModal: React.FC<Props> = ({ isOpen, currentBalance, onClose, onSuccess }) => {
    const prepareInitialFormData = () => {
        const initialData = {
            amount: 0,
            paymentModeId: '',
            bankAccountId: ''
        }

        return initialData
    }
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const [paymentModeOptions, setPaymentModeOptions] = useState<PaymentMode[]>([]);
    const [paymentModeSearchValue, setPaymentModeSearchValue] = useState('');
    const [bankAccountSearchValue, setBankAccountSearchValue] = useState('');
    const debouncedSearchTermBankAccount = useDebounce(bankAccountSearchValue, 500);
    const [bankAccountOptions, setBankAccountOptions] = useState<OptionType[]>([]);
    const [formData, setFormData] = useState<PettyCashFormData>(prepareInitialFormData());
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [bankAccountLabel, setBankAccountLabel] = useState('Transfer To');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const fetchPaymentModes = async () => {
            try {
                const response = await axios.get(Constants.GET_ALL_PAYMENT_MODES_URL, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                let data = response.data.data;
                if (data) {
                    let options = data.map((paymentMode: PaymentMode) => {
                        return {
                            id: paymentMode.id,
                            name: paymentMode.name,
                            slug: paymentMode.slug
                        };
                    });
                    setPaymentModeOptions(options);
                }

            } catch (error) {
                console.error("Error fetching payment modes:", error);
            }
        }
        fetchPaymentModes();
    }, [token]);

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

    const handlePaymentModeSelect = (item: PaymentMode) => {
        let paymentModeId = item ? item.id : '';
        setFormData((prev) => ({
            ...prev,
            paymentModeId: paymentModeId
        }));
        if (item && item.slug == 'cash') {
            setBankAccountLabel('Deposit To');
        } else {
            setBankAccountLabel('Transfer To');
        }
    }

    const handleBankAccountSelect = (item: OptionType) => {
        let bankAccountId = item ? item.id : '';
        setFormData((prev) => ({
            ...prev,
            bankAccountId: bankAccountId
        }));
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: value
        }));
    }
    const validated = () => {
        const newErrors: { [key: string]: string } = {};
        if (!formData.amount) {
            newErrors.amount = 'Amount is required.';
        } else if (formData.amount <= 0) {
            newErrors.amount = 'Amount must be greater than 0.';
        }
        if (!formData.paymentModeId) {
            newErrors.paymentModeId = 'Payment mode is required.';
        }
        if (!formData.bankAccountId) {
            newErrors.bankAccountId = 'Bank account is required.';
        }
        if (formData.amount > currentBalance) {
            newErrors.amount = `Amount cannot exceed current balance (${systemSettings?.currency.symbol}${currentBalance}) in petty cash.`;
        }
        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validated()) return false;
        try {
            setIsSaving(true);
            await axios.put(Constants.RETURN_AMOUNT_TO_PETTY_CASH_URL, formData, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            toast.success('Petty Cash returned successfully.');
            onSuccess();
        } catch (error) {
            toast.error('Something went wrong');
        } finally {
            setIsSaving(false);
        }
    }
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Return Petty Cash">
            <form onSubmit={handleSubmit}>
                <div className="mb-4">
                    <label htmlFor="amount" className="block text-sm font-medium text-red-500">Amount *</label>
                    <input type="number" name="amount" id="amount"
                        value={formData.amount}
                        onChange={handleInputChange}
                        className="border border-gray-300 mt-1 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"
                    />
                    {formErrors.amount && <p className="text-red-500 text-xs mt-1">{formErrors.amount}</p>}
                </div>
                <div className="mb-4">
                    <label htmlFor="payment_mode" className="block text-sm font-medium text-red-500">Payment Mode *</label>
                    <SmartDropdown
                        items={paymentModeOptions}
                        value={paymentModeSearchValue}
                        onChange={setPaymentModeSearchValue}
                        onSelect={(item) => handlePaymentModeSelect(item as PaymentMode)}
                        selectedItem={paymentModeOptions.find(item => item.id === formData.paymentModeId)}
                        placeholder="Type to search payment mode"
                        serverside={false}
                    />
                    {formErrors.paymentModeId && <p className="text-red-500 text-xs mt-1">{formErrors.paymentModeId}</p>}
                </div>
                <div className="mb-4">
                    <label htmlFor="bankAccountId" className="block text-sm font-medium text-red-500">{bankAccountLabel} *</label>
                    <SmartDropdown
                        items={bankAccountOptions}
                        value={bankAccountSearchValue}
                        onChange={setBankAccountSearchValue}
                        onSelect={(item) => handleBankAccountSelect(item as OptionType)}
                        selectedItem={bankAccountOptions.find(item => item.id === formData.bankAccountId)}
                        placeholder="Type to search bank account"
                    />
                    {formErrors.bankAccountId && <p className="text-red-500 text-xs mt-1">{formErrors.bankAccountId}</p>}
                </div>
                {/* Submit Buuton */}
                <div className="mb-4 flex justify-end">
                    <button type="button" onClick={onClose}
                        className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded-md shadow cursor-pointer mr-2">
                        Cancel
                    </button>
                    <SubmitButton
                        isDisabled={isSaving}
                        isLoading={isSaving}
                        mode="create"
                    />
                </div>
            </form>
        </Modal>
    );
};

export default ReturnPettyCashModal;