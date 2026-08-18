import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios, { AxiosError } from 'axios';
import { toast } from 'sonner';
import { useSelector } from 'react-redux';
import { CirclePlusIcon, X } from 'lucide-react';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import type {
    LeaveType,
    LeaveRequest,
    LeaveBalance,
    LeaveStatus,
    LeavePortion,
} from '@models/timeTracking';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import NoRecords from '@components/admin/NoRecords';
import DateInput from '@components/admin/DateInput';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button, Card, Badge } from '@components/ui';
import type { BadgeColor } from '@components/ui';
import useDateFormatter from '@hooks/useDateFormatter';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract a human-readable server error message from an axios error. */
const serverMessage = (error: unknown, fallback: string): string => {
    const ax = error as AxiosError<{ message?: string; error?: string }>;
    return ax.response?.data?.message || ax.response?.data?.error || fallback;
};

/** yyyy-MM-dd from a local Date (no timezone shift). */
function toISODate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Parse a yyyy-MM-dd (or ISO datetime) string to a local Date at midnight. */
function parseISODate(s: string): Date {
    const datePart = s.slice(0, 10);
    const [y, m, d] = datePart.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

const STATUS_COLORS: Record<LeaveStatus, BadgeColor> = {
    PENDING: 'warning',
    APPROVED: 'success',
    REJECTED: 'danger',
    CANCELLED: 'gray',
};

const PORTION_OPTIONS: { value: LeavePortion; label: string }[] = [
    { value: 'FULL', label: 'Full day' },
    { value: 'AM', label: 'Half day (morning)' },
    { value: 'PM', label: 'Half day (afternoon)' },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear - 2 + i);

const fmtDays = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * A request that is still active (PENDING) — or an APPROVED request whose start
 * is in the future — can be cancelled by the employee.
 */
const canCancel = (r: LeaveRequest): boolean => {
    if (r.status === 'PENDING') return true;
    if (r.status === 'APPROVED') {
        const start = parseISODate(r.startDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return start.getTime() > today.getTime();
    }
    return false;
};

// ── Component ──────────────────────────────────────────────────────────────────

const MyLeave: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { formatDate } = useDateFormatter();
    const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

    // --- Data ---
    const [types, setTypes] = useState<LeaveType[]>([]);
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [year, setYear] = useState<number>(currentYear);
    const [loadingBalances, setLoadingBalances] = useState(false);
    const [loadingRequests, setLoadingRequests] = useState(false);

    // --- Request form ---
    const [leaveTypeId, setLeaveTypeId] = useState<string>('');
    const [startDate, setStartDate] = useState<Date | null>(null);
    const [endDate, setEndDate] = useState<Date | null>(null);
    const [defaultPortion, setDefaultPortion] = useState<LeavePortion>('FULL');
    const [reason, setReason] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);

    // --- Cancel ---
    const [cancellingId, setCancellingId] = useState<string | null>(null);

    // ── Fetchers ───────────────────────────────────────────────────────────────
    const fetchTypes = useCallback(async () => {
        try {
            const res = await axios.get(Constants.LEAVE_TYPES_URL, { headers: authHeaders });
            // Only active types are selectable for new requests.
            const all = (res.data?.data ?? []) as LeaveType[];
            setTypes(all.filter((t) => t.isActive));
        } catch (error) {
            toast.error(serverMessage(error, 'Failed to load leave types.'));
        }
    }, [authHeaders]);

    const fetchBalances = useCallback(async () => {
        try {
            setLoadingBalances(true);
            const res = await axios.get(Constants.LEAVE_BALANCES_URL, {
                params: { year },
                headers: authHeaders,
            });
            setBalances((res.data?.data?.balances ?? []) as LeaveBalance[]);
        } catch (error) {
            toast.error(serverMessage(error, 'Failed to load leave balances.'));
            setBalances([]);
        } finally {
            setLoadingBalances(false);
        }
    }, [authHeaders, year]);

    const fetchRequests = useCallback(async () => {
        try {
            setLoadingRequests(true);
            const res = await axios.get(Constants.LEAVE_REQUESTS_URL, {
                params: { scope: 'mine' },
                headers: authHeaders,
            });
            const data = res.data?.data;
            // Tolerate both a bare array and a paginated `{ requests: [...] }` envelope.
            const list: LeaveRequest[] = Array.isArray(data)
                ? data
                : (data?.requests ?? data?.leaveRequests ?? []);
            setRequests(list);
        } catch (error) {
            toast.error(serverMessage(error, 'Failed to load your leave requests.'));
            setRequests([]);
        } finally {
            setLoadingRequests(false);
        }
    }, [authHeaders]);

    useEffect(() => {
        fetchTypes();
        fetchRequests();
    }, [fetchTypes, fetchRequests]);

    useEffect(() => {
        fetchBalances();
    }, [fetchBalances]);

    // ── Derived ────────────────────────────────────────────────────────────────
    const selectedBalance = useMemo(
        () => balances.find((b) => b.leaveTypeId === leaveTypeId),
        [balances, leaveTypeId],
    );
    const selectedType = useMemo(
        () => types.find((t) => t.id === leaveTypeId),
        [types, leaveTypeId],
    );

    // ── Submit a new request ─────────────────────────────────────────────────────
    const resetForm = () => {
        setLeaveTypeId('');
        setStartDate(null);
        setEndDate(null);
        setDefaultPortion('FULL');
        setReason('');
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!leaveTypeId) {
            toast.error('Select a leave type.');
            return;
        }
        if (!startDate || !endDate) {
            toast.error('Select a start and end date.');
            return;
        }
        if (endDate.getTime() < startDate.getTime()) {
            toast.error('End date cannot be before the start date.');
            return;
        }
        try {
            setSubmitting(true);
            const payload = {
                leaveTypeId,
                startDate: toISODate(startDate),
                endDate: toISODate(endDate),
                defaultPortion,
                reason: reason.trim() || undefined,
            };
            await axios.post(Constants.LEAVE_REQUESTS_URL, payload, { headers: authHeaders });
            toast.success('Leave request submitted.');
            resetForm();
            fetchRequests();
            fetchBalances();
        } catch (error) {
            // 0-day → 400; overlap → 409; overdraw → 409. Surface the server message.
            toast.error(serverMessage(error, 'Failed to submit leave request.'));
        } finally {
            setSubmitting(false);
        }
    };

    // ── Cancel a request ─────────────────────────────────────────────────────────
    const handleCancel = async (r: LeaveRequest) => {
        try {
            setCancellingId(r.id);
            await axios.post(
                Constants.LEAVE_REQUEST_CANCEL_URL(r.id),
                {},
                { headers: authHeaders },
            );
            toast.success('Leave request cancelled.');
            fetchRequests();
            fetchBalances();
        } catch (error) {
            toast.error(serverMessage(error, 'Failed to cancel leave request.'));
        } finally {
            setCancellingId(null);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            <PageHeader title="My Leave" />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* ── Request form ──────────────────────────────────────────── */}
                <Card title="Request Leave" className="lg:col-span-2">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-heading pb-1">
                                    Leave Type <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={leaveTypeId}
                                    onChange={(e) => setLeaveTypeId(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-950 bg-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                                >
                                    <option value="">Select leave type…</option>
                                    {types.map((t) => (
                                        <option key={t.id} value={t.id}>
                                            {t.name}
                                            {t.paid ? '' : ' (unpaid)'}
                                        </option>
                                    ))}
                                </select>
                                {leaveTypeId && (
                                    <p className="mt-1 text-xs text-gray-500">
                                        {selectedType && !selectedType.paid ? (
                                            <>Unpaid leave — does not deduct from a balance.</>
                                        ) : selectedBalance ? (
                                            <>
                                                Remaining ({year}):{' '}
                                                <span className="font-semibold text-gray-800">
                                                    {fmtDays(selectedBalance.remaining)} days
                                                </span>
                                            </>
                                        ) : loadingBalances ? (
                                            <>Loading balance…</>
                                        ) : (
                                            <>No balance allocated for {year}.</>
                                        )}
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-heading pb-1">
                                    Portion <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={defaultPortion}
                                    onChange={(e) =>
                                        setDefaultPortion(e.target.value as LeavePortion)
                                    }
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-950 bg-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                                >
                                    {PORTION_OPTIONS.map((p) => (
                                        <option key={p.value} value={p.value}>
                                            {p.label}
                                        </option>
                                    ))}
                                </select>
                                {defaultPortion !== 'FULL' && (
                                    <p className="mt-1 text-xs text-gray-500">
                                        Applies a half day to every date in the range.
                                    </p>
                                )}
                            </div>
                            <DateInput
                                label="Start Date"
                                isRequired
                                value={startDate}
                                onChange={(d) => {
                                    setStartDate(d);
                                    // Keep end ≥ start for convenience.
                                    if (d && (!endDate || endDate.getTime() < d.getTime())) {
                                        setEndDate(d);
                                    }
                                }}
                            />
                            <DateInput
                                label="End Date"
                                isRequired
                                value={endDate}
                                onChange={setEndDate}
                                minDate={startDate ?? undefined}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-heading pb-1">
                                Reason
                            </label>
                            <textarea
                                rows={3}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Optional — add a note for your approver."
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-950 bg-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                            />
                        </div>
                        <div className="flex justify-end pt-2">
                            <Button
                                type="submit"
                                isLoading={submitting}
                                disabled={submitting}
                                leftIcon={<CirclePlusIcon size={14} />}
                            >
                                Submit Request
                            </Button>
                        </div>
                    </form>
                </Card>

                {/* ── Balances panel ────────────────────────────────────────── */}
                <Card
                    title="My Balances"
                    actions={
                        <select
                            value={year}
                            onChange={(e) => setYear(Number(e.target.value))}
                            className="px-2 py-1 border border-gray-300 rounded-md text-xs text-gray-950 bg-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                        >
                            {YEARS.map((y) => (
                                <option key={y} value={y}>
                                    {y}
                                </option>
                            ))}
                        </select>
                    }
                >
                    {loadingBalances ? (
                        <div className="py-6 text-center">
                            <LoaderSpinner />
                        </div>
                    ) : balances.length === 0 ? (
                        <p className="py-4 text-center text-sm font-medium text-gray-500">
                            No balances allocated for {year}.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {balances.map((b) => (
                                <div
                                    key={b.leaveTypeId}
                                    className="border border-gray-200 rounded-lg p-3"
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm font-medium text-gray-900">
                                            {b.leaveTypeName}
                                        </span>
                                        {b.paid ? (
                                            <Badge color="success">Paid</Badge>
                                        ) : (
                                            <Badge color="gray">Unpaid</Badge>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                        <div>
                                            <div className="text-gray-400">Allocated</div>
                                            <div className="font-semibold text-gray-800">
                                                {fmtDays(b.allocated + b.carriedOver)}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-gray-400">Used</div>
                                            <div className="font-semibold text-gray-800">
                                                {fmtDays(b.used)}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-gray-400">Remaining</div>
                                            <div className="font-semibold text-purple-700">
                                                {fmtDays(b.remaining)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>

            {/* ── My requests ───────────────────────────────────────────────── */}
            <Card title="My Requests">
                <div className="overflow-x-auto border border-border rounded-control">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-100 text-xs uppercase text-body">
                            <tr>
                                <th className="px-4 py-3 text-left border-b border-border">Leave Type</th>
                                <th className="px-4 py-3 text-left border-b border-border">Dates</th>
                                <th className="px-4 py-3 text-right border-b border-border">Days</th>
                                <th className="px-4 py-3 text-left border-b border-border">Status</th>
                                <th className="px-4 py-3 text-left border-b border-border">Reason</th>
                                <th className="px-4 py-3 text-right border-b border-border">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loadingRequests ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-4">
                                        <LoaderSpinner />
                                    </td>
                                </tr>
                            ) : requests.length === 0 ? (
                                <NoRecords colSpan={6} message="No leave requests yet." />
                            ) : (
                                requests.map((r) => (
                                    <tr key={r.id} className="border-b border-border hover:bg-gray-50 align-top">
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-gray-900">
                                                {r.leaveType?.name}
                                            </div>
                                            {r.leaveType && !r.leaveType.paid && (
                                                <div className="text-xs text-gray-400">Unpaid</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                                            {formatDate(parseISODate(r.startDate))}
                                            {r.startDate.slice(0, 10) !==
                                                r.endDate.slice(0, 10) && (
                                                <> – {formatDate(parseISODate(r.endDate))}</>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-gray-800">
                                            {fmtDays(r.totalDays)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge color={STATUS_COLORS[r.status]}>
                                                {r.status}
                                            </Badge>
                                            {r.status === 'REJECTED' && r.rejectionNote && (
                                                <div className="mt-1 text-xs text-danger max-w-[220px]">
                                                    {r.rejectionNote}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-gray-600 max-w-[240px]">
                                            {r.reason || <span className="text-gray-300">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {canCancel(r) ? (
                                                <Button
                                                    variant="white"
                                                    size="sm"
                                                    isLoading={cancellingId === r.id}
                                                    disabled={cancellingId === r.id}
                                                    onClick={() => handleCancel(r)}
                                                    leftIcon={<X size={14} />}
                                                >
                                                    Cancel
                                                </Button>
                                            ) : (
                                                <span className="text-gray-300">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};

export default MyLeave;
