import React, { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type { TimeReportSummary, TimesheetStatus } from '@models/timeTracking';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import NoRecords from '@components/admin/NoRecords';
import DateInput from '@components/admin/DateInput';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button } from '@components/ui';
import { useCurrencies } from '@hooks/useCurrencies';

// ── Filter helpers ──────────────────────────────────────────────────────────
interface ProjectOption {
    id: string;
    name: string;
}

interface StaffOption {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
}

const STATUS_OPTIONS: TimesheetStatus[] = ['APPROVED', 'SUBMITTED', 'REJECTED', 'DRAFT'];

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

const fmtHours = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TimeReports: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { formatMoney, defaultCurrencyCode } = useCurrencies();

    // ── Filter state ──────────────────────────────────────────────────────────
    const [from, setFrom] = useState<Date | null>(() => startOfMonth(new Date()));
    const [to, setTo] = useState<Date | null>(() => new Date());
    const [projectId, setProjectId] = useState('');
    const [employeeUserId, setEmployeeUserId] = useState('');
    const [status, setStatus] = useState<TimesheetStatus>('APPROVED');

    // ── Option sources ──────────────────────────────────────────────────────────
    const [projects, setProjects] = useState<ProjectOption[]>([]);
    const [staff, setStaff] = useState<StaffOption[]>([]);

    // ── Report state ──────────────────────────────────────────────────────────
    const [summary, setSummary] = useState<TimeReportSummary | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // ── Load filter options ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` };
        axios
            .get(Constants.FETCH_PROJECTS_URL, { params: { limit: 500, page: 1 }, headers })
            .then((res) => {
                const raw = res.data?.data;
                const arr: ProjectOption[] = Array.isArray(raw) ? raw : (raw?.projects ?? []);
                setProjects(arr);
            })
            .catch(() => undefined);
        axios
            .get(Constants.FETCH_STAFF_FOR_LIST_URL, {
                params: { user_type: 3, limit: 200, page: 1 },
                headers,
            })
            .then((res) => setStaff(res.data?.data?.users ?? []))
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
            const res = await axios.get(Constants.TIME_REPORTS_SUMMARY_URL, {
                params: {
                    from: toISODate(from),
                    to: toISODate(to),
                    status,
                    ...(projectId ? { projectId } : {}),
                    ...(employeeUserId ? { employeeUserId } : {}),
                },
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.data.success) {
                setSummary(res.data.data as TimeReportSummary);
            }
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data?.message ?? 'Failed to load report.')
                : 'Failed to load report.';
            toast.error(msg);
        } finally {
            setIsLoading(false);
        }
    }, [from, to, status, projectId, employeeUserId, token]);

    // Load once on mount with the default filters.
    useEffect(() => {
        fetchSummary();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const totals = summary?.totals;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            <PageHeader title="Time Reports" />

            {/* ── Filters ── */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                    <DateInput label="From" value={from} onChange={setFrom} />
                    <DateInput label="To" value={to} onChange={setTo} />
                    <div>
                        <label className="block text-sm font-medium text-heading pb-1">
                            Project
                        </label>
                        <select
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600"
                        >
                            <option value="">All projects</option>
                            {projects.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                    </div>
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
                            Status
                        </label>
                        <select
                            value={status}
                            onChange={(e) => setStatus(e.target.value as TimesheetStatus)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600"
                        >
                            {STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s}>
                                    {s}
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
                                <div className="text-xs uppercase text-gray-500">Total Hours</div>
                                <div className="text-2xl font-semibold text-gray-900 mt-1">
                                    {fmtHours(totals.hours)}
                                </div>
                            </div>
                            <div className="bg-white border border-gray-200 rounded-lg p-4">
                                <div className="text-xs uppercase text-gray-500">
                                    Billable Hours
                                </div>
                                <div className="text-2xl font-semibold text-gray-900 mt-1">
                                    {fmtHours(totals.billableHours)}
                                </div>
                            </div>
                            <div className="bg-white border border-gray-200 rounded-lg p-4">
                                <div className="text-xs uppercase text-gray-500">Amount</div>
                                <div className="text-2xl font-semibold text-purple-700 mt-1">
                                    {formatMoney(totals.amount, defaultCurrencyCode)}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── By project ── */}
                    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-700">
                            By Project
                        </div>
                        <div className="overflow-x-auto border border-border rounded-control">
                            <table className="w-full text-sm border-collapse">
                                <thead className="bg-gray-100 text-xs uppercase text-body">
                                    <tr>
                                        <th className="px-4 py-3 text-left border-b border-border">Project</th>
                                        <th className="px-4 py-3 text-right border-b border-border">Hours</th>
                                        <th className="px-4 py-3 text-right border-b border-border">Billable</th>
                                        <th className="px-4 py-3 text-right border-b border-border">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(summary?.byProject ?? []).length === 0 ? (
                                        <NoRecords colSpan={4} message="No data for the selected filters." />
                                    ) : (
                                        (summary?.byProject ?? []).map((r) => (
                                            <tr key={r.projectId} className="border-b border-border hover:bg-gray-50">
                                                <td className="px-4 py-3 text-gray-900">{r.projectName}</td>
                                                <td className="px-4 py-3 text-right font-mono text-gray-800">
                                                    {fmtHours(r.hours)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono text-gray-800">
                                                    {fmtHours(r.billableHours)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono text-gray-800">
                                                    {formatMoney(r.amount, defaultCurrencyCode)}
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
                                        <th className="px-4 py-3 text-right border-b border-border">Hours</th>
                                        <th className="px-4 py-3 text-right border-b border-border">Billable</th>
                                        <th className="px-4 py-3 text-right border-b border-border">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(summary?.byEmployee ?? []).length === 0 ? (
                                        <NoRecords colSpan={4} message="No data for the selected filters." />
                                    ) : (
                                        (summary?.byEmployee ?? []).map((r) => (
                                            <tr key={r.employeeUserId} className="border-b border-border hover:bg-gray-50">
                                                <td className="px-4 py-3 text-gray-900">{r.employeeName}</td>
                                                <td className="px-4 py-3 text-right font-mono text-gray-800">
                                                    {fmtHours(r.hours)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono text-gray-800">
                                                    {fmtHours(r.billableHours)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono text-gray-800">
                                                    {formatMoney(r.amount, defaultCurrencyCode)}
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

export default TimeReports;
