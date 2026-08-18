import React, { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type { LeaveRequest, LeaveStatus } from '@models/timeTracking';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import NoRecords from '@components/admin/NoRecords';
import PaginationWrapper from '@components/admin/PaginationWrapper';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button, Badge } from '@components/ui';
import type { BadgeColor } from '@components/ui';
import useDateFormatter from '@hooks/useDateFormatter';

// ── Status badge colours ────────────────────────────────────────────────────
const STATUS_COLORS: Record<LeaveStatus, BadgeColor> = {
    PENDING: 'warning',
    APPROVED: 'success',
    REJECTED: 'danger',
    CANCELLED: 'gray',
};

const PAGE_LIMIT = 10;

/** Backend sends a single concatenated `name`; fall back to email then id. */
const employeeName = (r: LeaveRequest): string =>
    r.employee?.name?.trim() || r.employee?.email || r.employeeUserId;

/** Parse a yyyy-MM-dd (or ISO datetime) string to a local Date at midnight. */
const parseISODate = (s: string): Date => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
};

const LeaveApprovals: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { formatDate } = useDateFormatter();

    // ── List state ──────────────────────────────────────────────────────────
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);

    // ── Action state ──────────────────────────────────────────────────────────
    const [isActioning, setIsActioning] = useState(false);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectionNote, setRejectionNote] = useState('');

    // ── Fetch pending list ────────────────────────────────────────────────────
    const fetchPending = useCallback(
        async (p: number) => {
            try {
                setIsLoading(true);
                const res = await axios.get(Constants.LEAVE_REQUESTS_URL, {
                    params: { scope: 'pending', page: p, limit: PAGE_LIMIT },
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.data.success) {
                    const data = res.data.data ?? {};
                    const list: LeaveRequest[] = data.leaveRequests ?? [];
                    setRequests(list);
                    setTotal(data.pagination?.total ?? list.length);
                    setTotalPages(data.pagination?.totalPages ?? 1);
                }
            } catch {
                toast.error('Failed to load pending leave requests.');
            } finally {
                setIsLoading(false);
            }
        },
        [token],
    );

    useEffect(() => {
        fetchPending(page);
    }, [fetchPending, page]);

    // ── Approve (balance-checked; surface 409) ──────────────────────────────────
    const handleApprove = async (r: LeaveRequest) => {
        try {
            setIsActioning(true);
            const res = await axios.post(
                Constants.LEAVE_REQUEST_APPROVE_URL(r.id),
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (res.data.success) {
                toast.success(res.data.message ?? 'Leave request approved.');
                fetchPending(page);
            }
        } catch (err: unknown) {
            // 409 → "Insufficient leave balance" (PAID overdraw block)
            const msg = axios.isAxiosError(err)
                ? (err.response?.data?.message ?? 'Approve failed.')
                : 'Approve failed.';
            toast.error(msg);
        } finally {
            setIsActioning(false);
        }
    };

    // ── Reject (note required) ──────────────────────────────────────────────────
    const handleReject = async () => {
        if (!rejectingId) return;
        if (!rejectionNote.trim()) {
            toast.error('A rejection note is required.');
            return;
        }
        try {
            setIsActioning(true);
            const res = await axios.post(
                Constants.LEAVE_REQUEST_REJECT_URL(rejectingId),
                { rejectionNote: rejectionNote.trim() },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (res.data.success) {
                toast.success(res.data.message ?? 'Leave request rejected.');
                setRejectingId(null);
                setRejectionNote('');
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

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            <PageHeader title="Leave Approvals" />

            <div className="overflow-x-auto border border-border rounded-control">
                <table className="w-full text-sm border-collapse">
                    <thead className="bg-gray-100 text-xs uppercase text-body">
                        <tr>
                            <th className="px-4 py-3 text-left border-b border-border">Employee</th>
                            <th className="px-4 py-3 text-left border-b border-border">Leave Type</th>
                            <th className="px-4 py-3 text-left border-b border-border">Dates</th>
                            <th className="px-4 py-3 text-right border-b border-border">Days</th>
                            <th className="px-4 py-3 text-left border-b border-border">Status</th>
                            <th className="px-4 py-3 text-center border-b border-border">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && (
                            <tr>
                                <td colSpan={6} className="text-center py-4">
                                    <LoaderSpinner />
                                </td>
                            </tr>
                        )}
                        {!isLoading && requests.length === 0 && (
                            <NoRecords colSpan={6} message="No leave requests awaiting approval." />
                        )}
                        {!isLoading &&
                            requests.map((r) => (
                                <tr key={r.id} className="border-b border-border hover:bg-gray-50 transition-colors">
                                    <td className="px-4 py-3 font-medium text-gray-900">
                                        {employeeName(r)}
                                    </td>
                                    <td className="px-4 py-3 text-gray-700">
                                        {r.leaveType?.name ?? '—'}
                                        {r.leaveType && !r.leaveType.paid && (
                                            <span className="ml-1 text-[10px] uppercase text-gray-400">
                                                Unpaid
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-gray-700">
                                        {formatDate(parseISODate(r.startDate))}
                                        {' – '}
                                        {formatDate(parseISODate(r.endDate))}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-gray-800">
                                        {r.totalDays}
                                    </td>
                                    <td className="px-4 py-3">
                                        <Badge color={STATUS_COLORS[r.status]} variant="soft">{r.status}</Badge>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <Button
                                                variant="success"
                                                size="sm"
                                                onClick={() => handleApprove(r)}
                                                disabled={isActioning}
                                            >
                                                Approve
                                            </Button>
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={() => {
                                                    setRejectingId(r.id);
                                                    setRejectionNote('');
                                                }}
                                                disabled={isActioning}
                                            >
                                                Reject
                                            </Button>
                                        </div>
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

            {/* ── Reject dialog ── */}
            {rejectingId && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            Reject leave request?
                        </h3>
                        <p className="text-sm text-gray-600 mb-3">
                            The request will be returned to the employee with your note.
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
                            <Button variant="danger" onClick={handleReject} disabled={isActioning}>
                                {isActioning ? 'Please wait…' : 'Reject'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LeaveApprovals;
