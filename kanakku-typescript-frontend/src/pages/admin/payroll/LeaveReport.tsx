import React, { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type { LeaveReportSummary, LeaveType } from '@models/timeTracking';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import NoRecords from '@components/admin/NoRecords';
import DateInput from '@components/admin/DateInput';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button } from '@components/ui';

// ── Filter helpers ──────────────────────────────────────────────────────────
interface StaffOption {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
}

/** yyyy-MM-dd from a local Date (no timezone shift). */
function toISODate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** First day of the current month (local). */
function startOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

const fmtDays = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });

const LeaveReport: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);

    // ── Filter state ──────────────────────────────────────────────────────────
    const [from, setFrom] = useState<Date | null>(() => startOfMonth(new Date()));
    const [to, setTo] = useState<Date | null>(() => new Date());
    const [employeeUserId, setEmployeeUserId] = useState('');
    const [leaveTypeId, setLeaveTypeId] = useState('');

    // ── Option sources ──────────────────────────────────────────────────────────
    const [staff, setStaff] = useState<StaffOption[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);

    // ── Report state ──────────────────────────────────────────────────────────
    const [summary, setSummary] = useState<LeaveReportSummary | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // ── Load filter options ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` };
        axios
            .get(Constants.FETCH_STAFF_FOR_LIST_URL, {
                params: { user_type: 3, limit: 200, page: 1 },
                headers,
            })
            .then((res) => setStaff(res.data?.data?.users ?? []))
            .catch(() => undefined);
        axios
            .get(Constants.LEAVE_TYPES_URL, { headers })
            .then((res) => setLeaveTypes((res.data?.data?.leaveTypes ?? []) as LeaveType[]))
            .catch(() => undefined);
    }, [token]);

    // ── Fetch summary ──────────────────────────────────────────────────────────
    const fetchSummary = useCallback(async () => {
        if (!from || !to) {
            toast.error('Select a date range.');
            return;
        }
        try {
            setIsLoading(true);
            const res = await axios.get(Constants.LEAVE_REPORTS_SUMMARY_URL, {
                params: {
                    from: toISODate(from),
                    to: toISODate(to),
                    ...(employeeUserId ? { employeeUserId } : {}),
                    ...(leaveTypeId ? { leaveTypeId } : {}),
                },
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.data.success) {
                setSummary(res.data.data as LeaveReportSummary);
            }
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data?.message ?? 'Failed to load report.')
                : 'Failed to load report.';
            toast.error(msg);
        } finally {
            setIsLoading(false);
        }
    }, [from, to, employeeUserId, leaveTypeId, token]);

    // Load once on mount with the default filters.
    useEffect(() => {
        fetchSummary();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const totals = summary?.totals;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            <PageHeader title="Leave Report" />

            {/* ── Filters ── */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                    <DateInput label="From" value={from} onChange={setFrom} />
                    <DateInput label="To" value={to} onChange={setTo} />
                    <div>
                        <label className="block text-sm font-medium text-heading pb-1">
                            Employee
                        </label>
                        <select
                            value={employeeUserId}
                            onChange={(e) => setEmployeeUserId(e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600"
                        >
                            <option value="">All employees</option>
                            {staff.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {`${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || s.email}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-heading pb-1">
                            Leave Type
                        </label>
                        <select
                            value={leaveTypeId}
                            onChange={(e) => setLeaveTypeId(e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600"
                        >
                            <option value="">All leave types</option>
                            {leaveTypes.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className="mt-4">
                    <Button onClick={fetchSummary} disabled={isLoading}>
                        {isLoading ? 'Loading…' : 'Run report'}
                    </Button>
                </div>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-10">
                    <LoaderSpinner />
                </div>
            ) : (
                <>
                    {/* ── Totals ── */}
                    {totals && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="bg-white border border-gray-200 rounded-lg p-4">
                                <div className="text-xs uppercase text-gray-500">Total Days</div>
                                <div className="text-2xl font-semibold text-purple-700 mt-1">
                                    {fmtDays(totals.days)}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── By type ── */}
                    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-700">
                            By Leave Type
                        </div>
                        <div className="overflow-x-auto border border-border rounded-control">
                            <table className="w-full text-sm border-collapse">
                                <thead className="bg-gray-100 text-xs uppercase text-body">
                                    <tr>
                                        <th className="px-4 py-3 text-left border-b border-border">Leave Type</th>
                                        <th className="px-4 py-3 text-right border-b border-border">Days</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(summary?.byType ?? []).length === 0 ? (
                                        <NoRecords colSpan={2} message="No data for the selected filters." />
                                    ) : (
                                        (summary?.byType ?? []).map((r) => (
                                            <tr key={r.leaveTypeId} className="border-b border-border hover:bg-gray-50">
                                                <td className="px-4 py-3 text-gray-900">
                                                    {r.leaveTypeName}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono text-gray-800">
                                                    {fmtDays(r.days)}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ── By employee ── */}
                    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-700">
                            By Employee
                        </div>
                        <div className="overflow-x-auto border border-border rounded-control">
                            <table className="w-full text-sm border-collapse">
                                <thead className="bg-gray-100 text-xs uppercase text-body">
                                    <tr>
                                        <th className="px-4 py-3 text-left border-b border-border">Employee</th>
                                        <th className="px-4 py-3 text-right border-b border-border">Days</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(summary?.byEmployee ?? []).length === 0 ? (
                                        <NoRecords colSpan={2} message="No data for the selected filters." />
                                    ) : (
                                        (summary?.byEmployee ?? []).map((r) => (
                                            <tr key={r.employeeUserId} className="border-b border-border hover:bg-gray-50">
                                                <td className="px-4 py-3 text-gray-900">
                                                    {r.employeeName}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono text-gray-800">
                                                    {fmtDays(r.days)}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default LeaveReport;
