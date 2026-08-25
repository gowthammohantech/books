import LoaderSpinner from "@components/admin/LoaderSpinner";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import PaymentModeBadge from "@components/admin/PaymentModeBadge";
import SmartDropdown from "@components/admin/SmartDropdown";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import Constants from "@constants/api";
import { useCurrencyFormatter } from "@hooks/useCurrencyFormatter";
import useDateFormatter from "@hooks/useDateFormatter";
import { useDebounce } from "@hooks/useDebounce";
import type { BankAccount } from "@models/bank-account";
import type { BankTransaction, TransactionOverview } from "@models/bank-transaction";
import type { OptionType, Pagination } from "@models/common";
import type { RootState } from "@store/index";
import axios from "axios";
import type React from "react";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "sonner";
import TransactionOverviewModal from "./TransactionOverviewModal";
import FullPageLoader from "@components/admin/FullPageLoader";
interface FilterParams {
    search?: string;
    limit?: number;
    page?: number;
    bankAccountId: string | null;
}
interface TransactionResponse {
    success: boolean;
    message: string;
    data: {
        transactions: BankTransaction[];
        pagination: Pagination;
    }
}

interface BankAccountResponse {
    success: boolean;
    message: string;
    data: BankAccount[];
}
const BankTransactionList: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const [isLoading, setIsLoading] = useState(true);
    const [transactions, setTransactions] = useState<BankTransaction[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [bankAccounts, setBankAccounts] = useState<OptionType[]>([]);
    const [bankSearchKeyword, setBankSearchKeyword] = useState('');
    const debouncedBankSearchKeyword = useDebounce(bankSearchKeyword, 1000);
    const [filterParams, setFilterParams] = useState<FilterParams>({ limit: 10, page: 1, bankAccountId: null });
    const { limit = 10, page = 1, bankAccountId = null } = filterParams;
    const { format } = useCurrencyFormatter();
    const { formatDate } = useDateFormatter();
    const [selectedTransaction, setSelectedTransaction] = useState<BankTransaction | null>(null);
    const [details, setDetails] = useState<TransactionOverview | null>(null);
    const [isOverviewModalOpen, setIsOverviewModalOpen] = useState(false);
    const [isfetchingTransactionDetails, setIsFetchingTransactionDetails] = useState(false);
    useEffect(() => {
        fetchTransactions();
    }, [filterParams]);

    const fetchTransactions = async () => {
        try {
            setIsLoading(true);
            const response = await axios.get<TransactionResponse>(Constants.FETCH_BANK_TRANSACTION_LIST_URL, {
                params: filterParams,
                headers: { 'Authorization': `Bearer ${token}` }
            });
            let data = response.data.data;
            if (data.transactions) {
                setTransactions(data.transactions);
            }
            if (data.pagination) {
                setPagination(data.pagination);
            }
        } catch (error) {
            toast.error('Failed to fetch transactions.');
        } finally {
            setIsLoading(false);
        }
    }
    const fetchBankAccounts = async () => {
        try {
            const response = await axios.get<BankAccountResponse>(Constants.FETCH_BANK_ACCOUNTS_WITH_SEARCH_URL, {
                params: { search: debouncedBankSearchKeyword },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            let data = response.data.data;
            if (data) {
                let options = data.map((bankAccount: BankAccount) => {
                    let name = bankAccount.accountHoldername ?? "";
                    let accountNumber = bankAccount.accountNumber ?? "";
                    let bankName = bankAccount.bankName ?? "";
                    let formattedBankName = `[${accountNumber}] ${name} - ${bankName}`;
                    return {
                        id: bankAccount.id,
                        name: formattedBankName
                    }
                });
                setBankAccounts(options);
            }
        } catch (error) {
            toast.error('Failed to fetch bank accounts.');
        }
    }

    const handleSelectedBank = (item: OptionType) => {
        if (item) {
            setFilterParams({ ...filterParams, bankAccountId: item.id });
        } else {
            setFilterParams({ ...filterParams, bankAccountId: null });
        }
    }
    useEffect(() => {
        fetchBankAccounts();
    }, [debouncedBankSearchKeyword, token]);

    const tableHeaders = ['#', 'Bank', 'Transaction Type', 'Amount', 'Payment Mode', 'Transaction Date', 'Balance Before', 'Balance After'];
    const handleFilterChange = (key: string, value: string | number) => {
        setFilterParams({ ...filterParams, [key]: value });
    }

    const handleTransactionClick = async (transaction: BankTransaction) => {
        setSelectedTransaction(transaction);
    }

    useEffect(() => {
        const fetchTransactionDetails = async () => {
            try {

                if (selectedTransaction?.relatedType === 'PETTYCASH') {
                    const formattedData: TransactionOverview = {
                        relatedData: {
                            remarks: selectedTransaction?.remarks ?? ""
                        }
                    }
                    setDetails(formattedData);
                } else if (selectedTransaction?.relatedType === 'MANUAL') {
                    const formattedData: TransactionOverview = {
                        relatedData: {
                            remarks: selectedTransaction?.remarks ?? ""
                        }
                    }
                    setDetails(formattedData);
                } else {
                    setIsFetchingTransactionDetails(true);
                    const response = await axios.get(`${Constants.FETCH_TRANSACTION_DETAILS_URL}/${selectedTransaction?.id}`, {
                        params: { id: selectedTransaction?.id },
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const data = response.data.data;
                    if (data) {
                        if (selectedTransaction?.relatedType === 'EXPENSE') {
                            let firstName = data?.createdBy?.firstName ?? "";
                            let lastName = data?.createdBy?.lastName ?? "";
                            let fullName = `${firstName} ${lastName}`;
                            const formattedData: TransactionOverview = {
                                relatedData: {
                                    expenseId: data.expenseId ?? '',
                                    expenseDate: data.expenseDate ?? '',
                                    paymentMode: data.paymentMode ?? '',
                                    description: data.description ?? '',
                                    attachment: data.attachment ?? '',
                                    category: data.category ?? '',
                                    user: {
                                        name: fullName,
                                        email: data?.createdBy?.email ?? '',
                                        phone: data?.createdBy?.phone ?? '',
                                        profileImage: data?.createdBy?.profileImage ?? '',
                                    }
                                }
                            }
                            setDetails(formattedData);
                        } else if (selectedTransaction?.relatedType === 'INVOICE_PAYMENT') {
                            const formattedData: TransactionOverview = {
                                relatedData: {
                                    invoiceNumber: data.invoiceId?.invoiceNumber ?? "",
                                    payment_method: data?.payment_method?.name ?? "",
                                    received_on: data?.received_on ?? "",
                                    notes: data?.notes ?? ""
                                }
                            }
                            setDetails(formattedData);
                        } else if (selectedTransaction?.relatedType === 'SUPPLIER_PAYMENT') {
                            const formattedData: TransactionOverview = {
                                relatedData: {
                                    purchaseNumber: data?.purchaseId?.purchaseId ?? "",
                                    paymentMode: data?.paymentMode?.name ?? "",
                                    notes: data?.notes ?? "",
                                    attachment: data?.attachment ?? "",
                                    supplier: {
                                        name: data?.supplierId?.name ?? "",
                                        email: data?.supplierId?.email ?? "",
                                        phone: data?.supplierId?.phone ?? "",
                                        profileImage: data?.supplierId?.profileImage ?? "",
                                    }
                                }
                            }
                            setDetails(formattedData);
                        }
                    }
                }

                setIsOverviewModalOpen(true);
            } catch (error) {
                toast.error('Failed to fetch transaction details.');
            } finally {
                setIsFetchingTransactionDetails(false);
            }
        }
        if (selectedTransaction) {
            fetchTransactionDetails();
        }
    }, [selectedTransaction]);

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);
    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-950 ">Bank Transactions</h1>
            </div>
            <div className="flex justify-between">
                <div className="w-1/3">
                    <SmartDropdown
                        items={bankAccounts}
                        placeholder="Type to search bank..."
                        value={bankSearchKeyword}
                        onChange={(keyword) => setBankSearchKeyword(keyword)}
                        onSelect={(item) => handleSelectedBank(item as OptionType)}
                        selectedItem={bankAccounts.find((item) => item.id === bankAccountId) as OptionType}
                    />
                </div>
                <div>
                    <select
                        value={limit}
                        onChange={(e) => handleFilterChange('limit', parseInt(e.target.value))}
                        className="border border-gray-300 px-2 py-2 rounded-md bg-white  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-transparent"
                    >
                        {[10, 25, 50].map((num) => (
                            <option className="text-gray-950 " key={num} value={num}>{num} / page</option>
                        ))}
                    </select>
                </div>
            </div>

            <Table headers={tableHeaders}>
                {!isLoading && transactions.length > 0 && transactions.map((transaction, index) => {
                    let accountHolderName = transaction.bankAccount.accountHoldername ?? '';
                    let accountNumber = transaction.bankAccount.accountNumber ?? '';
                    let bankName = transaction.bankAccount.bankName ?? '';
                    let formattedBankInfo = `[${accountNumber}] ${accountHolderName} - ${bankName}`;
                    //transaction type replace _ with space 
                    let transactionType = transaction.type.replace('_', ' ');
                    return (
                        <TableRow
                            index={index + 1}
                            row={transaction}
                            key={transaction.id}
                            columns={[
                                <div className="font-bold text-indigo-600 cursor-pointer"
                                    onClick={(e) => { e.stopPropagation(); handleTransactionClick(transaction); }}
                                >
                                    {formattedBankInfo}
                                </div>,
                                transactionType,
                                format(transaction.amount),
                                <PaymentModeBadge mode={transaction.paymentMode.name} />,
                                formatDate(transaction.transactionDate, systemSettings?.dateFormat.format ?? 'DD-MM-YYYY'),
                                format(transaction.balanceBefore),
                                format(transaction.balanceAfter),
                            ]}
                            onRowClick={(item) => { void handleTransactionClick(item); }}
                        />
                    )
                })}

                {!isLoading && transactions && transactions.length === 0 && (
                    <tr>
                        <td colSpan={8} className="text-center text-gray-800  py-2 font-semibold">No Records Found</td>
                    </tr>
                )}

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-gray-950  font-semibold" colSpan={8}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}
            </Table >
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

            {/* Overview Modal */}
            {selectedTransaction && details && (
                <TransactionOverviewModal
                    isOpen={isOverviewModalOpen}
                    onClose={() => setIsOverviewModalOpen(false)}
                    transaction={selectedTransaction}
                    overviewData={details}
                >
                </TransactionOverviewModal>
            )}
            {isfetchingTransactionDetails && <FullPageLoader />}
        </div >
    );
}

export default BankTransactionList;