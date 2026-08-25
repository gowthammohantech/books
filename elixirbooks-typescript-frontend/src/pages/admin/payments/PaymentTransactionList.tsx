import { Eye } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import Table from "@components/admin/Table";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import Constants from "@constants/api";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import axios from "axios";
import TableRow from "@components/admin/TableRow";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import NoRecords from "@components/admin/NoRecords";
import useDateFormatter from "@hooks/useDateFormatter";
import type {
    GatewayKind,
    PaymentTransactionStatus,
    PaymentTransactionSummary,
} from "@models/payment";
import { PageHeader } from "@/context/PageHeaderContext";
import { Badge, type BadgeColor } from "@components/ui";

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

type StatusFilter = 'all' | 'CREATED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';

const gatewayBadgeColor = (kind: GatewayKind): BadgeColor => {
    switch (kind) {
        case 'RAZORPAY':
            return 'indigo';
        case 'STRIPE':
            return 'primary';
        case 'OFFLINE':
        default:
            return 'gray';
    }
};

const statusBadgeColor = (status: PaymentTransactionStatus): BadgeColor => {
    switch (status) {
        case 'CAPTURED':
            return 'success';
        case 'FAILED':
            return 'danger';
        case 'REFUNDED':
        case 'PARTIALLY_REFUNDED':
            return 'gray';
        case 'PENDING':
        case 'CREATED':
        default:
            return 'warning';
    }
};

const formatAmount = (amount: string | number, currency: string): string => {
    const numeric = typeof amount === 'string' ? Number(amount) : amount;
    const safe = Number.isFinite(numeric) ? numeric : 0;
    return `${currency} ${safe.toFixed(2)}`;
};

const PaymentTransactionList: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [transactions, setTransactions] = useState<PaymentTransactionSummary[]>([]);
    const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const { token } = useSelector((state: RootState) => state.auth);
    const { formatDate } = useDateFormatter();
    const [isLoading, setIsLoading] = useState(false);

    const handleViewClick = (item: PaymentTransactionSummary) => {
        // Detail page is out of scope for D.1 — log row for now.

        console.log('[PaymentTransaction] view row:', item);
        toast.info(`Transaction ${item.id.slice(0, 8)} — detail view coming soon`);
    };

    const tableActions = [
        {
            label: 'View',
            icon: <Eye size={14} />,
            onClick: (item: PaymentTransactionSummary) => { handleViewClick(item); },
        },
    ];

    const tableHeaders = ['#', 'Date', 'Invoice', 'Gateway', 'Status', 'Amount', 'Actions'];

    const fetchTransactions = async (
        searchValue?: string,
        limitValue?: number,
        pageValue?: number,
        statusValue?: StatusFilter,
    ) => {
        try {
            setIsLoading(true);
            const params: Record<string, string | number> = {
                limit: limitValue ?? 10,
                page: pageValue ?? 1,
            };
            if (searchValue && searchValue.trim()) {
                params.search = searchValue.trim();
            }
            if (statusValue && statusValue !== 'all') {
                params.status = statusValue;
            }
            const response = await axios.get(Constants.GET_PAYMENT_TRANSACTIONS_URL, {
                params,
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setTransactions(response.data?.data?.paymentTransactions || []);
            setPagination(
                response.data?.data?.pagination || { total: 0, page: 1, limit: 10, totalPages: 1 },
            );
        } catch (error) {
            console.error('Error fetching payment transactions:', error);
            toast.error('Failed to fetch payment transactions.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchTransactions(search, limit, page, statusFilter);
    }, [search, limit, page, statusFilter]);

    const handleSearch = (keyword: string) => {
        setSearchParams({ search: keyword, limit: String(limit), page: '1' });
    };

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ search, limit: String(newLimit), page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ search, limit: String(limit), page: String(newPage) });
    };

    const handleStatusFilterChange = (opt: StatusFilter) => {
        setStatusFilter(opt);
        setSearchParams({ search, limit: String(limit), page: '1' });
    };

    const from = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    // Search by invoice number (client-side filter on the page since the backend
    // doesn't yet support a free-text search param for payment transactions).
    const visibleTransactions = search.trim()
        ? transactions.filter((t) => {
            const inv = t.invoice?.invoiceNumber || '';
            return inv.toLowerCase().includes(search.trim().toLowerCase());
        })
        : transactions;

    const statusFilters: StatusFilter[] = ['all', 'CREATED', 'CAPTURED', 'FAILED', 'REFUNDED'];

    return (
        <div className="space-y-4">
            <PageHeader title="Payment Transactions" />

            {/* Search Input & PageLength */}
            <div className="flex justify-between items-center">
                <input
                    type="text"
                    placeholder="Search by invoice number..."
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="border border-gray-300 rounded-md px-4 py-2 w-full md:w-80 text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                />
                <select
                    value={limit}
                    onChange={(e) => handlePageLengthChange(Number(e.target.value))}
                    className="border border-gray-300 px-3 py-2 rounded-md bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                >
                    {[10, 25, 50].map((num) => (
                        <option className="text-gray-800" key={num} value={num}>{num} / page</option>
                    ))}
                </select>
            </div>

            {/* Status filter pills */}
            <div className="flex items-center gap-2 flex-wrap">
                {statusFilters.map((opt) => (
                    <button
                        key={opt}
                        type="button"
                        onClick={() => handleStatusFilterChange(opt)}
                        className={
                            'px-3 py-1 text-sm rounded-full border cursor-pointer ' +
                            (statusFilter === opt
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50')
                        }
                    >
                        {opt === 'all' ? 'All' : opt}
                    </button>
                ))}
            </div>

            {/* Table */}
            <Table headers={tableHeaders}>
                {!isLoading && visibleTransactions && visibleTransactions.map((tx, index) => (
                    <TableRow
                        key={tx.id}
                        index={index + 1}
                        row={tx}
                        columns={[
                            formatDate(tx.createdAt),
                            tx.invoice && tx.invoice.id
                                ? (
                                    <Link
                                        to={`/admin/invoices/edit-invoice/${tx.invoice.id}`}
                                        className="text-purple-600 hover:underline"
                                    >
                                        {tx.invoice.invoiceNumber ?? tx.invoice.id.slice(0, 8)}
                                    </Link>
                                )
                                : '—',
                            <Badge color={gatewayBadgeColor(tx.kind)}>
                                {tx.kind}
                            </Badge>,
                            <Badge color={statusBadgeColor(tx.status)}>
                                {tx.status}
                            </Badge>,
                            formatAmount(tx.amount, tx.currency),
                        ]}
                        actions={tableActions}
                    />
                ))}
                {!isLoading && !visibleTransactions.length &&
                    <NoRecords colSpan={7} message="No payment transactions found" />
                }
                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-1 text-gray-950 font-semibold" colSpan={7}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}
            </Table>

            {/* Pagination */}
            <PaginationWrapper
                count={pagination.totalPages}
                page={page}
                from={from}
                to={to}
                total={pagination.total}
                onChange={(_, newPage) => handlePageChange(newPage)}
                paginationVariant="outlined"
                paginationShape="rounded"
            />
        </div>
    );
};

export default PaymentTransactionList;
