import { PauseCircle, PlayCircle, PlayIcon, ListIcon } from "lucide-react";
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
import type { RecurringExpenseSummary, ChildExpenseSummary } from "@models/recurringExpense";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button, Badge, FormField, Select } from "@components/ui";

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const formatFrequency = (row: RecurringExpenseSummary): string => {
    if (!row.repeatEvery) return '—';
    if (row.repeatEvery === 'custom') {
        const n = row.customIntervalNumber ?? 0;
        const t = row.customIntervalType ?? 'day';
        return `Every ${n} ${t}(s)`;
    }
    return capitalize(row.repeatEvery);
};

const RecurringExpenseList: React.FC = () => {
    const { formatDate } = useDateFormatter();
    const [searchParams, setSearchParams] = useSearchParams();
    const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpenseSummary[]>([]);
    const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const { token } = useSelector((state: RootState) => state.auth);
    const [isLoading, setIsLoading] = useState(false);
    const [busyRowId, setBusyRowId] = useState<string | null>(null);

    const [viewingChildrenOf, setViewingChildrenOf] = useState<RecurringExpenseSummary | null>(null);
    const [children, setChildren] = useState<ChildExpenseSummary[]>([]);
    const [childrenLoading, setChildrenLoading] = useState(false);

    const fetchRecurringExpenses = async (
        searchValue?: string,
        limitValue?: number,
        pageValue?: number,
    ) => {
        try {
            setIsLoading(true);
            const params: Record<string, string | number> = {
                search: searchValue ?? '',
                limit: limitValue ?? 10,
                page: pageValue ?? 1,
            };
            const response = await axios.get(Constants.GET_RECURRING_EXPENSES_URL, {
                params,
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setRecurringExpenses(response.data.data?.recurringExpenses || []);
            setPagination(response.data.data?.pagination || { total: 0, page: 1, limit: 10, totalPages: 1 });
        } catch (error) {
            console.error("Error fetching recurring expenses:", error);
            toast.error("Failed to fetch recurring expenses.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchRecurringExpenses(search, limit, page);
    }, [search, limit, page]);

    const handleSearch = (keyword: string) => {
        setSearchParams({ search: keyword, limit: String(limit), page: '1' });
    };

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ search, limit: String(newLimit), page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ search, limit: String(limit), page: String(newPage) });
    };

    const handleStopResume = async (row: RecurringExpenseSummary) => {
        if (busyRowId) return;
        try {
            setBusyRowId(row.id);
            await axios.patch(
                `${Constants.SET_EXPENSE_RECURRING_STATUS_URL}/${row.id}/recurring-status`,
                { stopped: !row.stopped },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success(row.stopped ? 'Schedule resumed' : 'Schedule stopped');
            await fetchRecurringExpenses(search, limit, page);
        } catch (error) {
            const msg = axios.isAxiosError(error)
                ? (error.response?.data as { message?: string } | undefined)?.message
                : null;
            console.error('Error toggling stopped:', error);
            toast.error(msg ?? 'Failed to update');
        } finally {
            setBusyRowId(null);
        }
    };

    const handleRunNow = async (row: RecurringExpenseSummary) => {
        if (busyRowId) return;
        try {
            setBusyRowId(row.id);
            const resp = await axios.post(
                `${Constants.RUN_RECURRING_EXPENSE_NOW_URL}/${row.id}/run-recurring-now`,
                {},
                { headers: { 'Authorization': `Bearer ${token}` } },
            );
            if (resp.status === 201) {
                const newRef = resp.data?.data?.newReferenceNo ?? '';
                toast.success(newRef ? `Created ${newRef}` : 'Created');
                await fetchRecurringExpenses(search, limit, page);
            }
        } catch (error: unknown) {
            const msg =
                (axios.isAxiosError(error) && error.response?.data?.message) ||
                'Failed to run recurring iteration.';
            console.error('Error running recurring now:', error);
            toast.error(msg);
        } finally {
            setBusyRowId(null);
        }
    };

    const handleViewChildren = async (row: RecurringExpenseSummary) => {
        setViewingChildrenOf(row);
        setChildren([]);
        try {
            setChildrenLoading(true);
            const resp = await axios.get(
                `${Constants.GET_EXPENSE_CHILDREN_URL}/${row.id}/children`,
                { headers: { 'Authorization': `Bearer ${token}` } },
            );
            setChildren(resp.data?.data?.children || []);
        } catch (error) {
            console.error('Error fetching children:', error);
            toast.error('Failed to fetch child expenses.');
        } finally {
            setChildrenLoading(false);
        }
    };

    const tableActions = [
        {
            label: 'Stop',
            icon: <PauseCircle size={14} />,
            onClick: (row: RecurringExpenseSummary) => { void handleStopResume(row); },
        },
        {
            label: 'Resume',
            icon: <PlayCircle size={14} />,
            onClick: (row: RecurringExpenseSummary) => { void handleStopResume(row); },
        },
        {
            label: 'Run now',
            icon: <PlayIcon size={14} />,
            onClick: (row: RecurringExpenseSummary) => { void handleRunNow(row); },
        },
        {
            label: 'View children',
            icon: <ListIcon size={14} />,
            onClick: (row: RecurringExpenseSummary) => { void handleViewChildren(row); },
        },
    ];

    const buildActionsFor = (row: RecurringExpenseSummary) => {
        return tableActions.filter((a) => {
            if (a.label === 'Stop') return !row.stopped;
            if (a.label === 'Resume') return row.stopped;
            return true;
        });
    };

    const tableHeaders = ['#', 'Reference', 'Amount', 'Category', 'Vendor', 'Frequency', 'Next run', 'Last run', 'Children', 'Status', 'Actions'];

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Recurring Expenses">
                <Link
                    to="/admin/expenses"
                    className="text-sm text-purple-600 hover:underline"
                >
                    Manage expenses
                </Link>
            </PageHeader>

            {/* Search Input & PageLength */}
            <div className="flex justify-between items-center">
                <FormField
                    type="text"
                    placeholder="Search by reference..."
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                    containerClassName="w-full md:w-80"
                />
                <Select
                    value={limit}
                    onChange={(e) => handlePageLengthChange(Number(e.target.value))}
                    options={[10, 25, 50].map((num) => ({ value: num, label: `${num} / page` }))}
                />
            </div>

            {/* Table */}
            <Table headers={tableHeaders}>
                {!isLoading && recurringExpenses && recurringExpenses.map((row, index) => (
                    <TableRow
                        key={row.id}
                        index={index + 1}
                        row={row}
                        columns={[
                            row.referenceNo ?? '—',
                            row.amount ?? '—',
                            row.category ? row.category.name : '—',
                            row.supplier ? row.supplier.name : '—',
                            formatFrequency(row),
                            formatDate(row.nextRecurringDate),
                            formatDate(row.lastRecurringDate),
                            row.childrenCount,
                            <Badge color={!row.stopped ? 'success' : 'gray'}>
                                {!row.stopped ? 'Active' : 'Stopped'}
                            </Badge>,
                        ]}
                        actions={buildActionsFor(row)}
                        onRowClick={(item) => { void handleViewChildren(item); }}
                    />
                ))}
                {!isLoading && !recurringExpenses.length &&
                    <NoRecords colSpan={11} message="No recurring expenses found" />
                }
                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-1 text-gray-950 font-semibold" colSpan={11}>
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
                onChange={(_, newPage) => handlePageChange(newPage)}
                paginationVariant="outlined"
                paginationShape="rounded"
            />

            {viewingChildrenOf && (
                <div
                    className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
                    onClick={() => setViewingChildrenOf(null)}
                >
                    <div
                        className="bg-white rounded-card shadow-dropdown p-4 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-lg font-semibold text-heading mb-3">
                            Children of {viewingChildrenOf.referenceNo ?? '—'}
                        </h3>
                        {childrenLoading && <LoaderSpinner />}
                        {!childrenLoading && children.length === 0 && (
                            <p className="text-sm text-body">No children yet.</p>
                        )}
                        {!childrenLoading && children.length > 0 && (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left border-b">
                                        <th className="py-2">#</th>
                                        <th>Reference</th>
                                        <th>Date</th>
                                        <th>Status</th>
                                        <th>Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {children.map((c, idx) => (
                                        <tr key={c.id} className="border-b">
                                            <td className="py-2">{idx + 1}</td>
                                            <td>{c.referenceNo ?? '—'}</td>
                                            <td>{formatDate(c.expenseDate)}</td>
                                            <td>{c.paymentStatus}</td>
                                            <td>{c.amount ?? '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                        <div className="text-right mt-3">
                            <Button variant="white" size="sm" onClick={() => setViewingChildrenOf(null)}>
                                Close
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RecurringExpenseList;
