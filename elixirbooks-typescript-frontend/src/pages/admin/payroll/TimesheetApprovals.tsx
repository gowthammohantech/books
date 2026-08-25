import React, { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type {
    Timesheet,
    TimesheetStatus,
    TimesheetWeek,
} from '@models/timeTracking';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import NoRecords from '@components/admin/NoRecords';
import PaginationWrapper from '@components/admin/PaginationWrapper';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button, Badge } from '@components/ui';
import type { BadgeColor } from '@components/ui';
import useDateFormatter from '@hooks/useDateFormatter';

// ── Status badge colours ────────────────────────────────────────────────────
const STATUS_COLORS: Record<TimesheetStatus, BadgeColor> = {
    DRAFT: 'gray',
    SUBMITTED: 'info',
    APPROVED: 'success',
    REJECTED: 'danger',
};

// The list endpoint may embed a light employee summary on each row.
interface PendingTimesheet extends Timesheet {
    employee?: {
        name?: string;
        email?: string;
    };
}

const PAGE_LIMIT = 10;

const employeeName = (ts: PendingTimesheet): string =>
    ts.employee?.name?.trim() || ts.employee?.email || ts.employeeUserId;

/** Parse a yyyy-MM-dd (or ISO datetime) string to a local Date at midnight,
 *  avoiding the off-by-one shift in negative-UTC timezones. */
const parseISODate = (s: string): Date => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
};

const fmtHours = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TimesheetApprovals: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { formatDate } = useDateFormatter();

    // ── List state ──────────────────────────────────────────────────────────
    const [timesheets, setTimesheets] = useState<PendingTimesheet[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);

    // ── Detail (read-only) state ──────────────────────────────────────────────
    const [selected, setSelected] = useState<PendingTimesheet | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detail, setDetail] = useState<TimesheetWeek | null>(null);

    // ── Action state ──────────────────────────────────────────────────────────
    const [isActioning, setIsActioning] = useState(false);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectionNote, setRejectionNote] = useState('');

    // ── Fetch pending list ────────────────────────────────────────────────────
    const fetchPending = useCallback(
        async (p: number) => {
            try {
                setIsLoading(true);
                const res = await axios.get(Constants.TIMESHEETS_URL, {
                    params: { scope: 'pending', page: p, limit: PAGE_LIMIT },
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.data.success) {
                    const data = res.data.data ?? {};
                    setTimesheets(data.timesheets ?? []);
                    setTotal(data.pagination?.total ?? (data.timesheets?.length ?? 0));
                    setTotalPages(data.pagination?.totalPages ?? 1);
                }
            } catch {
                toast.error('Failed to load pending timesheets.');
            } finally {
                setIsLoading(false);
            }
        },
        [token],
    );

    useEffect(() => {
        fetchPending(page);
    }, [fetchPending, page]);

    // ── Open a timesheet read-only ────────────────────────────────────────────
    const openTimesheet = async (ts: PendingTimesheet) => {
        setSelected(ts);
        setDetail(null);
        try {
            setDetailLoading(true);
            const res = await axios.get(Constants.TIMESHEET_WEEK_URL, {
                params: {
                    employeeUserId: ts.employeeUserId,
                    weekStart: ts.weekStartDate.slice(0, 10),
                },
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.data.success) {
                setDetail(res.data.data as TimesheetWeek);
            }
        } catch {
            toast.error('Failed to load timesheet detail.');
        } finally {
            setDetailLoading(false);
        }
    };

    const closeDetail = () => {
        setSelected(null);
        setDetail(null);
        setRejectingId(null);
        setRejectionNote('');
    };

    // ── Approve ───────────────────────────────────────────────────────────────
    const handleApprove = async (ts: PendingTimesheet) => {
        try {
            setIsActioning(true);
            const res = await axios.post(
                Constants.TIMESHEET_APPROVE_URL(ts.id),
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (res.data.success) {
                toast.success(res.data.message ?? 'Timesheet approved.');
                closeDetail();
                fetchPending(page);
            }
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data?.message ?? 'Approve failed.')
                : 'Approve failed.';
            toast.error(msg);
        } finally {
            setIsActioning(false);
        }
    };

    // ── Reject ────────────────────────────────────────────────────────────────
    const handleReject = async () => {
        if (!rejectingId) return;
        if (!rejectionNote.trim()) {
            toast.error('A rejection note is required.');
            return;
        }
        try {
            setIsActioning(true);
            const res = await axios.post(
                Constants.TIMESHEET_REJECT_URL(rejectingId),
                { rejectionNote: rejectionNote.trim() },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (res.data.success) {
                toast.success(res.data.message ?? 'Timesheet rejected.');
                closeDetail();
                fetchPending(page);
            }
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data?.message ?? 'Reject failed.')
                : 'Reject failed.';
            toast.error(msg);
        } finally {
            setIsActioning(false);
        }
    };

    // ── Pagination window ─────────────────────────────────────────────────────
    const from = (page - 1) * PAGE_LIMIT + 1;
    const to = Math.min(page * PAGE_LIMIT, total);

    // ── Detail entry totals ───────────────────────────────────────────────────
    const detailTotal = (detail?.entries ?? []).reduce((s, e) => s + (Number(e.hours) || 0), 0);
    const projectName = (projectId: string) =>
        detail?.projects.find((p) => p.id === projectId)?.name ?? projectId;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            <PageHeader title="Timesheet Approvals" />

            {/* ── Pending list ── */}
            <div className="overflow-x-auto border border-border rounded-control">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-100 text-xs uppercase text-body">
                        <tr>
                            <th className="px-4 py-3 text-left border-b border-border">Employee</th>
                            <th className="px-4 py-3 text-left border-b border-border">Week starting</th>
                            <th className="px-4 py-3 text-left border-b border-border">Submitted</th>
                            <th className="px-4 py-3 text-left border-b border-border">Status</th>
                            <th className="px-4 py-3 text-center border-b border-border">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && (
                            <tr>
                                <td colSpan={5} className="text-center py-4">
                                    <LoaderSpinner />
                                </td>
                            </tr>
                        )}
                        {!isLoading && timesheets.length === 0 && (
                            <NoRecords colSpan={5} message="No timesheets awaiting approval." />
                        )}
                        {!isLoading &&
                            timesheets.map((ts) => (
                                <tr
                                    key={ts.id}
                                    className={`border-b border-border hover:bg-gray-50 transition-colors ${
                                        selected?.id === ts.id ? 'bg-purple-50' : ''
                                    }`}
                                >
                                    <td className="px-4 py-3 font-medium text-gray-900">
                                        {employeeName(ts)}
                                    </td>
                                    <td className="px-4 py-3 text-gray-700">
                                        {formatDate(parseISODate(ts.weekStartDate))}
                                    </td>
                                    <td className="px-4 py-3 text-gray-500 text-xs">
                                        {ts.submittedAt
                                            ? formatDate(new Date(ts.submittedAt))
                                            : '—'}
                                    </td>
                                    <td className="px-4 py-3">
                                        <Badge color={STATUS_COLORS[ts.status]}>{ts.status}</Badge>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => openTimesheet(ts)}
                                            className="text-purple-600 hover:text-purple-800 text-xs underline"
                                        >
                                            Review
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            </div>

            {!isLoading && totalPages > 1 && (
                <PaginationWrapper
                    count={totalPages}
                    page={page}
                    from={from}
                    to={to}
                    total={total}
                    onChange={(_, newPage) => setPage(newPage)}
                    paginationVariant="outlined"
                    paginationShape="rounded"
                />
            )}

            {/* ── Read-only detail / approve-reject ── */}
            {selected && (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50">
                        <div className="flex items-center gap-3">
                            <span className="font-semibold text-gray-900">
                                {employeeName(selected)}
                            </span>
                            <span className="text-sm text-gray-600">
                                Week of {formatDate(parseISODate(selected.weekStartDate))}
                            </span>
                            <Badge color={STATUS_COLORS[selected.status]}>
                                {selected.status}
                            </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="success"
                                onClick={() => handleApprove(selected)}
                                disabled={isActioning || detailLoading}
                            >
                                Approve
                            </Button>
                            <Button
                                variant="danger"
                                onClick={() => {
                                    setRejectingId(selected.id);
                                    setRejectionNote('');
                                }}
                                disabled={isActioning || detailLoading}
                            >
                                Reject
                            </Button>
                            <Button
                                variant="ghost"
                                onClick={closeDetail}
                                className="text-gray-500 hover:text-gray-800 text-sm underline"
                            >
                                Close
                            </Button>
                        </div>
                    </div>

                    {detailLoading ? (
                        <div className="py-10">
                            <LoaderSpinner />
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-100 text-xs uppercase text-body">
                                    <tr>
                                        <th className="px-4 py-3 text-left border-b border-border">Project</th>
                                        <th className="px-4 py-3 text-left border-b border-border">Date</th>
                                        <th className="px-4 py-3 text-right border-b border-border">Hours</th>
                                        <th className="px-4 py-3 text-center border-b border-border">Billable</th>
                                        <th className="px-4 py-3 text-left border-b border-border">Note</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(detail?.entries ?? []).length === 0 && (
                                        <NoRecords colSpan={5} message="No time entries for this week." />
                                    )}
                                    {(detail?.entries ?? []).map((e) => (
                                        <tr key={e.id} className="border-b border-border hover:bg-gray-50">
                                            <td className="px-4 py-3 text-gray-900">
                                                {projectName(e.projectId)}
                                            </td>
                                            <td className="px-4 py-3 text-gray-700">
                                                {formatDate(parseISODate(e.date))}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-gray-800">
                                                {fmtHours(Number(e.hours) || 0)}
                                            </td>
                                            <td className="px-4 py-3 text-center text-gray-600">
                                                {e.billable ? 'Yes' : 'No'}
                                            </td>
                                            <td className="px-4 py-3 text-gray-500">{e.note || '—'}</td>
                                        </tr>
                                    ))}
                                    {(detail?.entries ?? []).length > 0 && (
                                        <tr className="bg-gray-50 font-semibold text-sm">
                                            <td className="px-4 py-3 text-gray-700" colSpan={2}>
                                                Total hours
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-purple-700">
                                                {fmtHours(detailTotal)}
                                            </td>
                                            <td colSpan={2} />
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── Reject dialog ── */}
            {rejectingId && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            Reject timesheet?
                        </h3>
                        <p className="text-sm text-gray-600 mb-3">
                            The timesheet will be returned to the employee with your note.
                        </p>
                        <textarea
                            autoFocus
                            rows={3}
                            value={rejectionNote}
                            onChange={(e) => setRejectionNote(e.target.value)}
                            placeholder="Reason for rejection…"
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-600 mb-4"
                        />
                        <div className="flex justify-end gap-3">
                            <Button
                                variant="white"
                                onClick={() => {
                                    setRejectingId(null);
                                    setRejectionNote('');
                                }}
                                disabled={isActioning}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="danger"
                                onClick={handleReject}
                                disabled={isActioning}
                            >
                                {isActioning ? 'Please wait…' : 'Reject'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TimesheetApprovals;
