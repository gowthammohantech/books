import type { RootState } from "@store/index";
import { hasPermission } from "@utils/hasPermission";
import { CalendarDays, CircleMinusIcon, CirclePlusIcon, PiggyBank, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import Constants from "@constants/api";
import axios from "axios";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import { toast } from "sonner";
import useDateFormatter from "@hooks/useDateFormatter";
import PettyCashModal from "./AddPettyCashModal";
import { useCurrencyFormatter } from "@hooks/useCurrencyFormatter";
import type { PettyCash, PettyCashTransaction } from "@models/petty-cash";
import ReturnPettyCashModal from "./ReturnPettyCashModal";
import type { Pagination } from "@models/common";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import PaymentModeBadge from "@components/admin/PaymentModeBadge";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button } from "@components/ui";

interface ExpenseResponse {
    success: boolean;
    message: string;
    data: {
        pettyCash: PettyCash;
    }
}
interface PettyCashTransactionResponse {
    success: boolean;
    message: string;
    data: {
        transactions: PettyCashTransaction[];
        pagination: Pagination;
    }
}
interface FilterParams {
    search?: string;
    limit?: number;
    page?: number;
}
const PettyCashList: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const { formatDate } = useDateFormatter();
    const { format } = useCurrencyFormatter();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [pettyCashRecords, setPettyCashRecords] = useState<PettyCash>(); //its not an array just one object
    const [isLoading, setIsLoading] = useState(false);
    const [isReturnPettyCashModalOpen, setIsReturnPettyCashModalOpen] = useState(false);
    const [currentBalance, setCurrentBalance] = useState(0);
    const [transactions, setTransactions] = useState<PettyCashTransaction[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [filterParams, setFilterParams] = useState<FilterParams>({});
    const { search = '', limit = 10, page = 1 } = filterParams;

    useEffect(() => {
        fetchPettyCashList();
    }, [filterParams]);

    const fetchPettyCashList = async () => {
        try {
            const response = await axios.get<ExpenseResponse>(Constants.PETTY_CASH_LIST_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data.success && response.data.data.pettyCash) {
                setPettyCashRecords(response.data.data.pettyCash);
                setCurrentBalance(response.data.data.pettyCash?.currentBalance || 0);
            }
        } catch (error) {
            toast.error('Failed to fetch petty cash.');
        }
    }
    const handleCreateClick = () => {
        setIsReturnPettyCashModalOpen(false);
        setIsModalOpen(true);
    };

    const handleReturnPettyCashClick = () => {
        setIsModalOpen(false);
        setIsReturnPettyCashModalOpen(true);
    }
    const handleSuccess = () => {
        setIsModalOpen(false);
        setIsReturnPettyCashModalOpen(false);
        fetchPettyCashList();
        fetchTransactions();
    }

    const handleFilterChange = (key: string, value: string | number) => {
        setFilterParams({ ...filterParams, [key]: value });
    }

    const tableHeaders = ['#', 'Transaction Type', 'Amount', 'Transaction Date', 'Payment Mode', 'Source Type', 'Source Details'];
    const fetchTransactions = async () => {
        try {
            setIsLoading(true);
            const response = await axios.get<PettyCashTransactionResponse>(Constants.FETCH_PETTYCASH_TRANSACTION_LIST_URL,
                {
                    params: filterParams,
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            if (response.data.data && response.data.data.transactions) {
                setTransactions(response.data.data.transactions);
                setPagination(response.data.data.pagination);
            }
        } catch (error) {
            toast.error('Failed to fetch petty cash transactions.');
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        fetchTransactions();
    }, [filterParams]);

    // Calculate pagination display text
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Petty Cash">
                {hasPermission(permissions, 'expenses', 'create') &&
                    <div className="flex gap-2">
                        <Button onClick={() => { handleCreateClick(); }} leftIcon={<CirclePlusIcon size={14} />}>
                            Add Petty Cash
                        </Button>
                        <Button onClick={() => { handleReturnPettyCashClick(); }} leftIcon={<CircleMinusIcon size={14} />}>
                            Return Petty Cash
                        </Button>
                    </div>
                }
            </PageHeader>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                {/* Opening Balance */}
                <div className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500/10 to-indigo-500/5 p-4 backdrop-blur-sm border border-indigo-200 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-6" />
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <div className="p-2 rounded-2xl border border-indigo-200 bg-indigo-100 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                <PiggyBank size={18} />
                            </div>
                            <h2 className="text-sm font-semibold text-gray-700 group-hover:text-indigo-700 transition-colors">
                                Opening Balance
                            </h2>
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-indigo-700 tracking-tight mt-1">
                        {format(pettyCashRecords?.openingBalance || 0)}
                    </p>
                </div>

                {/* Current Balance */}
                <div className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-green-500/10 to-green-500/5 p-4 backdrop-blur-sm border border-green-200 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-6" />
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <div className="p-2 rounded-2xl border border-green-200 bg-green-100 text-green-600 group-hover:bg-green-600 group-hover:text-white transition-colors">
                                <Wallet size={18} />
                            </div>
                            <h2 className="text-sm font-semibold text-gray-700 group-hover:text-green-700 transition-colors">
                                Current Balance
                            </h2>
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-green-700 tracking-tight mt-1">
                        {format(pettyCashRecords?.currentBalance || 0)}
                    </p>
                </div>

                {/* As on Date */}
                <div className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-500/10 to-amber-500/5 p-4 backdrop-blur-sm border border-amber-200 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl transform translate-x-8 -translate-y-6" />
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <div className="p-2 rounded-2xl border border-amber-200 bg-amber-100 text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                                <CalendarDays size={18} />
                            </div>
                            <h2 className="text-sm font-semibold text-gray-700 group-hover:text-amber-700 transition-colors">
                                As on Date
                            </h2>
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-amber-700 tracking-tight mt-1">
                        {formatDate(
                            pettyCashRecords?.asOnDate || new Date().toISOString(),
                            systemSettings?.dateFormat.format || "d-m-Y"
                        )}
                    </p>
                </div>
            </div>

            {/* Search Input & PageLength */}
            <h4 className="text-lg font-bold mb-2">Petty Cash Transactions</h4>
            <div className="flex justify-between items-center">
                <input
                    type="text"
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => handleFilterChange('search', e.target.value)}
                    className="border border-gray-300 rounded-md px-4 py-2 w-full md:w-64  text-gray-950  focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                />
                <select
                    value={limit}
                    onChange={(e) => handleFilterChange('limit', parseInt(e.target.value))}
                    className="border border-gray-300 px-3 py-2 rounded-md bg-white  text-gray-950  focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                >
                    {[10, 25, 50].map((num) => (
                        <option className="text-gray-950 " key={num} value={num}>{num} / page</option>
                    ))}
                </select>
            </div>
            <Table headers={tableHeaders}>
                {!isLoading && transactions && transactions.length > 0 && transactions.map((transaction, index) => {
                    let transactionType: React.ReactNode = transaction.transactionType ?? "";

                    const type = transactionType.toString().toLowerCase();

                    if (type === "add") {
                        transactionType = <span className="text-green-600 font-semibold">{transaction.transactionType}</span>;
                    } else if (type === "spend") {
                        transactionType = <span className="text-red-600 font-semibold">{transaction.transactionType}</span>;
                    } else if (type === "return") {
                        transactionType = <span className="text-indigo-600 font-semibold">{transaction.transactionType}</span>;
                    }

                    // Determine what to show in the source column
                    let sourceInfo = "";
                    let transactionSourceType = "";

                    if (transaction.relatedType === "BANK") {
                        // Bank transaction - show bank info
                        const accountNumber = transaction?.transactionSource?.bankInfo?.accountNumber || "";
                        const accountHolderName = transaction?.transactionSource?.bankInfo?.accountHolderName || "-";
                        const bankName = transaction?.transactionSource?.bankInfo?.bankName || "-";
                        sourceInfo = `[${accountNumber}] ${accountHolderName} - ${bankName}`;
                        transactionSourceType = transaction.transactionSource?.type || "";
                    } else if (transaction.relatedType === "EXPENSE") {
                        // Expense transaction - show "Expense"
                        sourceInfo = "Expense";
                        transactionSourceType = "EXPENSE_PAYMENT";
                    } else if (transaction.relatedType === "SUPPLIER_PAYMENT") {
                        // Supplier payment - show "Supplier Payment"
                        sourceInfo = "Supplier Payment";
                        transactionSourceType = "SUPPLIER_PAYMENT";
                    } else {
                        sourceInfo = transaction.transactionSource?.description || "Other";
                        transactionSourceType = transaction.transactionSource?.type || "";
                    }

                    const formattedSourceType = transactionSourceType.toLowerCase().split("_").join("-");

                    return (
                        <TableRow
                            index={index + 1}
                            row={transaction}
                            key={transaction.id}
                            columns={[
                                transactionType,
                                format(transaction.amount),
                                formatDate(transaction.transactionDate, systemSettings?.dateFormat.format || "d-m-Y"),
                                transaction?.paymentMode?.name && <PaymentModeBadge mode={transaction?.paymentMode?.name} />,
                                <div className="capitalize">{formattedSourceType}</div>,
                                sourceInfo
                            ]}
                        >
                        </TableRow>
                    );
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

            {/* Add Petty Cash Form Modal */}
            {
                isModalOpen &&
                <PettyCashModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    onSuccess={() => handleSuccess()}
                />
            }

            {/* Return Petty Cash Form Modal */}
            {
                isReturnPettyCashModalOpen &&
                <ReturnPettyCashModal
                    isOpen={isReturnPettyCashModalOpen}
                    currentBalance={currentBalance}
                    onClose={() => setIsReturnPettyCashModalOpen(false)}
                    onSuccess={() => handleSuccess()}
                />
            }
        </div >
    );
};

export default PettyCashList;