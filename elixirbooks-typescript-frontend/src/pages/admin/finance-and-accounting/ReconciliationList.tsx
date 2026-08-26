import { DateRangePicker } from "@components/admin/DateRangePicker";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import Modal from "@components/admin/Modal";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import PaymentModeBadge from "@components/admin/PaymentModeBadge";
import SmartDropdown from "@components/admin/SmartDropdown";
import SubmitButton from "@components/admin/SubmitButton";
import Switch from "@components/admin/Switch";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import TransactionTypeBadge from "@components/admin/TransactionTypeBadge";
import { Button } from "@components/ui";
import Constants from "@constants/api";
import { useCurrencyFormatter } from "@hooks/useCurrencyFormatter";
import useDateFormatter from "@hooks/useDateFormatter";
import type { BankAccount } from "@models/bank-account";
import type { OptionType, Pagination } from "@models/common";
import type { RootState } from "@store/index";
import { formatLocalDateTime } from "@utils/converters";
import { PageHeader } from "@/context/PageHeaderContext";
import axios from "axios";
import { AlertCircle, CheckCircle, ChevronDown, LandmarkIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

interface Transaction {
    id: string;
    bankAccount: {
        id: string;
        accountHoldername: string;
        bankName: string;
        accountNumber: string;
    },
    transactionDate: string;
    type: string;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    paymentMode: {
        id: string;
        name: string;
        slug: string;
    } | null;
    referenceNo: string | null;
    remarks: string | null;
    relatedType: string | null;
    relatedId: string | null;
    isReconciled: boolean;
    reconciliationDate: string | null;
    reconciliationNote: string | null;
}

interface FilterParams {
    search?: string;
    limit?: number;
    page?: number;
    bankAccountId: string | null;
    startDate: string | null;
    endDate: string | null;
    type: string | null;
    isReconciled: string | null;
}

const ReconciliationList: React.FC = () => {
    const bankId = useParams().bankId;

    const { token } = useSelector((state: RootState) => state.auth);
    const { formatDate } = useDateFormatter();
    const { format } = useCurrencyFormatter();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [itemToUpdate, setItemToUpdate] = useState<Transaction | null>(null);
    const [note, setNote] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [filterParams, setFilterParams] = useState<FilterParams>({
        limit: 10, page: 1, bankAccountId: bankId ?? null,
        startDate: null, endDate: null,
        type: null,
        isReconciled: null
    });
    const { limit = 10, page = 1 } = filterParams;
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [selectedBank, setSelectedBank] = useState<BankAccount | null>(null);
    const [accountBalance, setAccountBalance] = useState<number>(0);
    const [dateRange, setDateRange] = useState<{ startDate: Date | null, endDate: Date | null }>({
        startDate: null,
        endDate: null,
    });
    const [dateRangeError, setDateRangeError] = useState<string | null>(null);
    const [typeSearchKeyword, setTypeSearchKeyword] = useState<string>('');
    const [reconciledTypeSearchKeyword, setReconciledTypeSearchKeyword] = useState<string>('');
    const transactionTypeOptions = [
        { id: 'deposit', name: 'Deposit' },
        { id: 'withdrawal', name: 'Withdrawal' },
        { id: 'transfer_in', name: 'Transfer In' },
        { id: 'transfer_out', name: 'Transfer Out' },
    ];
    const reconciledTypeOptions = [
        { id: 'true', name: 'Matched' },
        { id: 'false', name: 'Not Matched' },
    ];
    useEffect(() => {
        fetchTransactions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterParams]);

    useEffect(() => {
        fetchBankAccounts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (selectedBank) {
            setAccountBalance(selectedBank.currentBalance || 0);
        }
    }, [selectedBank]);

    const fetchBankAccounts = async () => {
        try {
            const response = await axios.get(Constants.FETCH_BANK_ACCOUNT_WITH_BALANCE_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = response.data.data;
            setBankAccounts(data.bankDetails ?? []);

            // Set initial selected bank if bankId is provided
            if (bankId && data.bankDetails) {
                const initialBank = data.bankDetails.find((bank: BankAccount) => bank.id === bankId);
                if (initialBank) {
                    setSelectedBank(initialBank);
                    setAccountBalance(initialBank.currentBalance || 0);
                }
            }
        } catch {
            toast.error('Something went wrong');
        }
    }

    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleBankSelect = (bankId: string) => {
        const selected = bankAccounts.find(bank => bank.id === bankId) ?? null;
        setSelectedBank(selected);
        setFilterParams({ ...filterParams, bankAccountId: bankId, page: 1 }); // Reset to page 1 when bank changes
        setIsDropdownOpen(false);
    }

    const handleTypeSelect = (type: OptionType) => {
        if (type) {
            setFilterParams({ ...filterParams, type: type.id, page: 1 });
        } else {
            setFilterParams({ ...filterParams, type: null, page: 1 });
        }
    }

    const handleReconciledTypeSelect = (type: OptionType) => {
        if (type) {
            setFilterParams({ ...filterParams, isReconciled: type.id, page: 1 });
        } else {
            setFilterParams({ ...filterParams, isReconciled: null, page: 1 });
        }
    }
    const fetchTransactions = async () => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.FETCH_TRANSACTIONS_FOR_RECONCILIATION_URL, {
                params: filterParams,
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = response.data.data;
            setTransactions(data.transactions ?? []);
            setPagination(data.pagination ?? { total: 0, page: 1, limit: 10, totalPages: 1 });

        } catch {
            toast.error('Something went wrong');
        } finally {
            setIsLoading(false);
        }
    }

    const tableHeaders = ["#", "Transaction Date", "Type", "Amount", "Payment Mode", "Is Reconciled", "Action"];

    const handleCloseClick = () => {
        setIsModalOpen(false);
        setItemToUpdate(null);
    }

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const response = await axios.post(`${Constants.RECONCILE_TRANSACTION_URL}/${itemToUpdate?.id}`, {
                transactionId: itemToUpdate?.id,
                isReconciled: !itemToUpdate?.isReconciled,
                reconciliationNote: note
            }, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.status === 200) {
                fetchTransactions();
                toast.success('Transaction reconciled successfully');
                handleCloseClick();
            }
        } catch {
            toast.error('Something went wrong');
        } finally {
            setIsSubmitting(false);
        }
    }

    const handleFilterChange = (key: string, value: string | number) => {
        setFilterParams({ ...filterParams, [key]: value });
    }

    const handleClearFilters = () => {
        setDateRange({ startDate: null, endDate: null });
        setFilterParams({ ...filterParams, startDate: null, endDate: null, type: null, isReconciled: null });
    }
    const handleRangeInputChange = (range: { startDate: Date | null, endDate: Date | null }) => {
        setDateRange(range);
        if (range.startDate && range.endDate) {
            setDateRangeError(null);
            const startDateString = formatLocalDateTime(range.startDate, 'start', true);
            const endDateString = formatLocalDateTime(range.endDate, 'end', true);
            setFilterParams({ ...filterParams, startDate: startDateString, endDate: endDateString });
        } else {
            setDateRangeError('Please select start date and end date');
        }
    }

    const handleReconcileChange = (transaction: Transaction) => {
        setItemToUpdate(transaction);
        setNote(transaction.reconciliationNote ?? '');
        setIsModalOpen(true);
    }
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Bank Reconciliation" />
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex items-center gap-4">
                    <div className="relative" ref={dropdownRef}>
                        <button
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer min-w-[280px] justify-between"
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        >
                            <div className="text-left">
                                <div className="font-semibold text-gray-900 text-sm">
                                    {selectedBank ? `${selectedBank.accountHoldername} - ${selectedBank.bankName}` : 'Select Bank Account'}
                                </div>
                                <div className="text-xs text-gray-500">
                                    Account Number: {selectedBank ? `xxxx${selectedBank.accountNumber?.slice(-4)}` : 'xxxxxxxx'}
                                </div>
                            </div>
                            <ChevronDown
                                size={16}
                                className={`text-gray-500 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
                            />
                        </button>

                        {isDropdownOpen && (
                            <div className="absolute top-full left-0 mt-1 w-full max-w-md bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                                {bankAccounts && bankAccounts.length > 0 ? (
                                    bankAccounts.map((account) => {
                                        const formattedBankName = `${account.accountHoldername} - ${account.bankName}`;
                                        return (
                                            <div
                                                key={account.id}
                                                onClick={() => handleBankSelect(account.id)}
                                                className="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                            >
                                                <div className="font-medium text-gray-900 text-sm">
                                                    {formattedBankName}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    Account: xxxx{account.accountNumber?.slice(-4)}
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="px-4 py-3 text-gray-500 text-sm">
                                        No bank accounts found
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-4 p-4 bg-white">
                        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-tr from-purple-500/5 to-purple-600/5 text-purple-600 shadow-inner border border-gray-300">
                            <LandmarkIcon className="w-6 h-6" />
                        </div>
                        <div className="flex flex-col items-start">
                            <span className="text-sm font-medium text-gray-500 tracking-wide">
                                Current Balance
                            </span>
                            <span
                                className={`text-xl font-semibold ${accountBalance < 0 ? "text-red-600" : "text-green-600"
                                    }`}
                            >
                                {format(accountBalance)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
            {/* Filters */}
            <div className="flex gap-4">
                <div>
                    <DateRangePicker
                        value={dateRange}
                        onChange={handleRangeInputChange}
                    />
                    {dateRangeError && <p className="text-red-500 text-sm">{dateRangeError}</p>}
                </div>
                <div>
                    <SmartDropdown
                        items={transactionTypeOptions}
                        value={typeSearchKeyword}
                        onChange={(keyword) => setTypeSearchKeyword(keyword)}
                        onSelect={(item) => handleTypeSelect(item as OptionType)}
                        placeholder="Select Transaction Type"
                        serverside={false}
                        selectedItem={transactionTypeOptions.find(item => item.id === filterParams.type) || null}
                    />
                </div>
                <div>
                    <SmartDropdown
                        items={reconciledTypeOptions}
                        value={reconciledTypeSearchKeyword}
                        onChange={(keyword) => setReconciledTypeSearchKeyword(keyword)}
                        onSelect={(item) => handleReconciledTypeSelect(item as OptionType)}
                        placeholder="Select Reconciled Type"
                        serverside={false}
                        selectedItem={reconciledTypeOptions.find(item => item.id === filterParams.isReconciled) || null}
                    />
                </div>
                {/* clear button */}
                <div>
                    <Button
                        variant="white"
                        onClick={handleClearFilters}
                        rightIcon={<X className="w-4 h-4" />}
                        className="mt-1"
                    >
                        Clear Filters
                    </Button>
                </div>
                <div className="ml-auto">
                    <select
                        value={limit}
                        onChange={(e) => handleFilterChange('limit', e.target.value)}
                        className="border border-gray-300 px-3 py-2 rounded-md bg-white  text-gray-950  focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                    >
                        {[10, 25, 50].map((num) => (
                            <option className="text-gray-950 " key={num} value={num}>{num} / page</option>
                        ))}
                    </select>
                </div>
            </div>
            {/* Table */}
            <Table headers={tableHeaders}>
                {!isLoading && transactions.length > 0 && transactions.map((transaction, index) => {
                    return (
                        <TableRow
                            key={transaction.id}
                            index={from + index}
                            row={transaction}
                            columns={[
                                <div>
                                    <span className="text-indigo-600">{formatDate(transaction.transactionDate)}</span>
                                </div>,
                                <TransactionTypeBadge type={transaction.type} />,
                                format(transaction.amount),
                                <PaymentModeBadge mode={transaction?.paymentMode?.name ?? ''} />,
                                transaction.isReconciled ? 'Matched' : 'Not Matched',
                                <Switch name={`status-${transaction.id}`} checked={transaction.isReconciled} onChange={() => handleReconcileChange(transaction)} />,
                            ]}
                        />
                    )
                })}

                {!isLoading && transactions.length === 0 && (
                    <tr>
                        <td colSpan={8} className="text-center py-4 text-gray-900 font-semibold">
                            No transactions found
                        </td>
                    </tr>
                )}

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-gray-900 font-semibold" colSpan={8}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}
            </Table>

            {/* Pagination Component */}
            <PaginationWrapper
                count={pagination.totalPages}
                page={page}
                from={from}
                to={to}
                total={pagination.total}
                onChange={(_, newPage) => handleFilterChange('page', newPage)}
                paginationVariant="outlined"
                paginationShape="rounded"
            />

            {/* Reconcile Modal */}
            {isModalOpen && itemToUpdate && (
                <Modal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    title="Reconcile Transaction"
                >
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Status Message */}
                        <div className="text-center">
                            {itemToUpdate.isReconciled ? (
                                <div className="space-y-2">
                                    <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-2">
                                        <AlertCircle className="w-6 h-6 text-amber-600" />
                                    </div>
                                    <h4 className="text-lg font-semibold text-gray-900">Unreconcile Transaction</h4>
                                    <p className="text-gray-600">This transaction is currently reconciled. Are you sure you want to mark it as unreconciled?</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                                        <CheckCircle className="w-6 h-6 text-blue-600" />
                                    </div>
                                    <h4 className="text-lg font-semibold text-gray-900">Acknowledge Reconciliation</h4>
                                    <p className="text-gray-600">Are you sure you want to mark this transaction as reconciled?</p>
                                </div>
                            )}
                        </div>

                        {/* Note */}
                        <div className="space-y-2">
                            <label htmlFor="note" className="block text-sm font-medium text-gray-700">
                                Add a note (optional)
                            </label>
                            <textarea
                                id="note"
                                name="note"
                                placeholder="Enter any additional notes..."
                                className="border border-gray-300 rounded-md px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                rows={3}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                            ></textarea>
                        </div>

                        {/* Actions */}
                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="white" onClick={handleCloseClick}>
                                Cancel
                            </Button>
                            <SubmitButton
                                isDisabled={isSubmitting}
                                isLoading={isSubmitting}
                                mode={itemToUpdate.isReconciled ? "edit" : "create"}
                            />
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}

export default ReconciliationList;
