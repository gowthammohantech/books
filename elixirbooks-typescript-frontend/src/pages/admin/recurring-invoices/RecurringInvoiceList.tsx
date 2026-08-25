import { Edit, PauseCircle, PlayCircle, PlayIcon, ListIcon, StopCircle } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
import { Badge } from "@components/ui";
import type { BadgeColor } from "@components/ui";
import type { Action } from "@components/admin/tableActions";
import useDateFormatter from "@hooks/useDateFormatter";
import type {
    RecurringScheduleSummary,
    RecurringScheduleStatus,
    ScheduleOccurrence,
} from "@models/recurringInvoice";
import { PageHeader } from "@/context/PageHeaderContext";

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// e.g. "Monthly", "Weekly", "Every 2 weeks"
const formatCadence = (row: RecurringScheduleSummary): string => {
    if (!row.repeatEvery) return '—';
    if (row.repeatEvery === 'custom') {
        const n = row.customIntervalNumber ?? 0;
        const t = row.customIntervalType ?? 'day';
        return n === 1 ? `Every ${t}` : `Every ${n} ${t}s`;
    }
    const adverb: Record<string, string> = {
        day: 'Daily',
        week: 'Weekly',
        month: 'Monthly',
        year: 'Yearly',
    };
    return adverb[row.repeatEvery] ?? capitalize(row.repeatEvery);
};

const STATUS_COLOR: Record<RecurringScheduleStatus, BadgeColor> = {
    DRAFT: 'gray',
    ACTIVE: 'success',
    PAUSED: 'warning',
    ENDED: 'danger',
    COMPLETED: 'info',
};

const RecurringInvoiceList: React.FC = () => {
    const { formatDate } = useDateFormatter();
    const [searchParams, setSearchParams] = useSearchParams();
    const [schedules, setSchedules] = useState<RecurringScheduleSummary[]>([]);
    const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const [isLoading, setIsLoading] = useState(false);
    const [busyRowId, setBusyRowId] = useState<string | null>(null);

    const [viewingOccurrencesOf, setViewingOccurrencesOf] = useState<RecurringScheduleSummary | null>(null);
    const [occurrences, setOccurrences] = useState<ScheduleOccurrence[]>([]);
    const [occurrencesLoading, setOccurrencesLoading] = useState(false);

    const fetchSchedules = async (
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
            const response = await axios.get(Constants.RECURRING_SCHEDULES_URL, {
                params,
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setSchedules(response.data.data?.schedules || []);
            setPagination(response.data.data?.pagination || { total: 0, page: 1, limit: 10, totalPages: 1 });
        } catch (error) {
            console.error("Error fetching recurring schedules:", error);
            toast.error("Failed to fetch recurring schedules.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchSchedules(search, limit, page);
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

    // Edit the SCHEDULE template (NOT the generated invoice).
    const handleEditClick = (row: RecurringScheduleSummary) => {
        navigate(`/admin/recurring-schedules/edit/${row.id}`);
    };

    const extractMsg = (error: unknown, fallback: string): string =>
        (axios.isAxiosError(error) && (error.response?.data as { message?: string } | undefined)?.message) || fallback;

    const postLifecycle = async (
        row: RecurringScheduleSummary,
        action: 'pause' | 'resume' | 'end',
        successMsg: string,
    ) => {
        if (busyRowId) return;
        try {
            setBusyRowId(row.id);
            await axios.post(
                `${Constants.RECURRING_SCHEDULES_URL}/${row.id}/${action}`,
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success(successMsg);
            await fetchSchedules(search, limit, page);
        } catch (error) {
            console.error(`Error on schedule ${action}:`, error);
            toast.error(extractMsg(error, `Failed to ${action} schedule.`));
        } finally {
            setBusyRowId(null);
        }
    };

    const handleEnd = (row: RecurringScheduleSummary) => {
        if (busyRowId) return;
        const ok = window.confirm(
            'End this recurring schedule? This is permanent — no further invoices will be generated.',
        );
        if (!ok) return;
        void postLifecycle(row, 'end', 'Schedule ended');
    };

    const handleRunNow = async (row: RecurringScheduleSummary) => {
        if (busyRowId) return;
        try {
            setBusyRowId(row.id);
            const resp = await axios.post(
                `${Constants.RECURRING_SCHEDULES_URL}/${row.id}/run-now`,
                {},
                { headers: { 'Authorization': `Bearer ${token}` } },
            );
            const newNum = resp.data?.data?.invoice?.invoiceNumber ?? '';
            toast.success(newNum ? `Generated invoice ${newNum}` : 'Invoice generated');
            await fetchSchedules(search, limit, page);
        } catch (error) {
            console.error('Error running schedule now:', error);
            toast.error(extractMsg(error, 'Failed to generate invoice.'));
        } finally {
            setBusyRowId(null);
        }
    };

    const handleViewOccurrences = async (row: RecurringScheduleSummary) => {
        setViewingOccurrencesOf(row);
        setOccurrences([]);
        try {
            setOccurrencesLoading(true);
            const resp = await axios.get(
                `${Constants.RECURRING_SCHEDULES_URL}/${row.id}/occurrences`,
                { headers: { 'Authorization': `Bearer ${token}` } },
            );
            setOccurrences(resp.data?.data?.occurrences || []);
        } catch (error) {
            console.error('Error fetching occurrences:', error);
            toast.error('Failed to fetch generated invoices.');
        } finally {
            setOccurrencesLoading(false);
        }
    };

    const tableActions: Action<RecurringScheduleSummary>[] = [
        {
            label: 'Edit schedule',
            icon: <Edit size={14} />,
            primary: true,
            requirePermission: { moduleSlug: 'recurring-invoices', action: 'edit' },
            onClick: (row) => { handleEditClick(row); },
        },
        {
            label: 'Pause',
            icon: <PauseCircle size={14} />,
            primary: true,
            requirePermission: { moduleSlug: 'recurring-invoices', action: 'edit' },
            onClick: (row) => { void postLifecycle(row, 'pause', 'Schedule paused'); },
        },
        {
            label: 'Resume',
            icon: <PlayCircle size={14} />,
            primary: true,
            requirePermission: { moduleSlug: 'recurring-invoices', action: 'edit' },
            onClick: (row) => { void postLifecycle(row, 'resume', 'Schedule resumed'); },
        },
        {
            label: 'Run now',
            icon: <PlayIcon size={14} />,
            requirePermission: { moduleSlug: 'recurring-invoices', action: 'create' },
            onClick: (row) => { void handleRunNow(row); },
        },
        {
            label: 'View occurrences',
            icon: <ListIcon size={14} />,
            requirePermission: { moduleSlug: 'recurring-invoices', action: 'view' },
            onClick: (row) => { void handleViewOccurrences(row); },
        },
        {
            label: 'End',
            icon: <StopCircle size={14} />,
            variant: 'danger',
            requirePermission: { moduleSlug: 'recurring-invoices', action: 'delete' },
            onClick: (row) => { handleEnd(row); },
        },
    ];

    // Show actions relevant to the schedule's current lifecycle state.
    const buildActionsFor = (row: RecurringScheduleSummary) => {
        return tableActions.filter((a) => {
            if (a.label === 'Pause') return row.status === 'ACTIVE';
            if (a.label === 'Resume') return row.status === 'PAUSED';
            if (a.label === 'Run now') return row.status === 'ACTIVE';
            if (a.label === 'End') return row.status === 'ACTIVE' || row.status === 'PAUSED';
            return true;
        });
    };

    const tableHeaders = ['#', 'Name', 'Customer', 'Cadence', 'Next Run', 'Status', 'Occurrences', 'Total', 'Actions'];

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Recurring Invoices">
                <button
                    type="button"
                    onClick={() => navigate('/admin/recurring-schedules/new')}
                    className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium px-4 py-2 rounded-md"
                >
                    New Recurring Invoice
                </button>
            </PageHeader>

            {/* Search Input & PageLength */}
            <div className="flex justify-between items-center">
                <input
                    type="text"
                    placeholder="Search by name..."
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
                        <option className="text-gray-800 " key={num} value={num}>{num} / page</option>
                    ))}
                </select>
            </div>

            {/* Table */}
            <Table headers={tableHeaders}>
                {!isLoading && schedules && schedules.map((row, index) => (
                    <TableRow
                        key={row.id}
                        index={index + 1}
                        row={row}
                        onRowClick={handleEditClick}
                        columns={[
                            <span className="text-gray-800 font-medium">{row.name || '—'}</span>,
                            row.customer
                                ? (
                                    <Link
                                        to={`/admin/contacts/${row.customer.id}`}
                                        className="text-purple-600 hover:underline"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {row.customer.name}
                                    </Link>
                                )
                                : '—',
                            formatCadence(row),
                            row.nextRunDate ? formatDate(row.nextRunDate) : '—',
                            <Badge color={STATUS_COLOR[row.status] ?? 'gray'}>
                                {capitalize(row.status.toLowerCase())}
                            </Badge>,
                            row.occurrencesCount,
                            row.TotalAmount ?? '—',
                        ]}
                        actions={buildActionsFor(row)}
                    />
                ))}
                {!isLoading && !schedules.length &&
                    <NoRecords colSpan={9} message="No recurring schedules found" />
                }
                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-1 text-gray-950 font-semibold" colSpan={9}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}
            </Table>

            {/* Pagination Component */}
            {!isLoading && pagination.totalPages > 1 && (
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
            )}

            {viewingOccurrencesOf && (
                <div
                    className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
                    onClick={() => setViewingOccurrencesOf(null)}
                >
                    <div
                        className="bg-white rounded-md p-4 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-lg font-medium mb-3">
                            Generated invoices — {viewingOccurrencesOf.name || '—'}
                        </h3>
                        {occurrencesLoading && <LoaderSpinner />}
                        {!occurrencesLoading && occurrences.length === 0 && (
                            <p className="text-sm text-gray-500">No invoices generated yet.</p>
                        )}
                        {!occurrencesLoading && occurrences.length > 0 && (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left border-b">
                                        <th className="py-2">#</th>
                                        <th>Invoice</th>
                                        <th>Date</th>
                                        <th>Status</th>
                                        <th>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {occurrences.map((o, idx) => (
                                        <tr key={o.id} className="border-b">
                                            <td className="py-2">{idx + 1}</td>
                                            <td>
                                                <Link
                                                    className="text-purple-700 underline"
                                                    to={`/admin/view-invoice/${o.id}`}
                                                >
                                                    {o.invoiceNumber ?? '—'}
                                                </Link>
                                            </td>
                                            <td>{o.date ? formatDate(o.date) : '—'}</td>
                                            <td>{o.status}</td>
                                            <td>{o.total ?? '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                        <div className="text-right mt-3">
                            <button
                                type="button"
                                onClick={() => setViewingOccurrencesOf(null)}
                                className="px-3 py-1 text-sm border rounded"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RecurringInvoiceList;
