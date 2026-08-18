import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, StickyNote, Plus, Trash2 } from 'lucide-react';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type {
    TimesheetWeek,
    TimeEntry,
    TimesheetStatus,
} from '@models/timeTracking';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button, Badge } from '@components/ui';
import type { BadgeColor } from '@components/ui';
import useDateFormatter from '@hooks/useDateFormatter';

// ── Date math (Monday-start week, date-only semantics) ─────────────────────────

/** Local-time Date at midnight for the Monday of the week containing `d`. */
function startOfWeekMonday(d: Date): Date {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = x.getDay(); // 0=Sun..6=Sat
    const diff = dow === 0 ? -6 : 1 - dow; // shift back to Monday
    x.setDate(x.getDate() + diff);
    return x;
}

function addDays(d: Date, n: number): Date {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
}

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

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<TimesheetStatus, BadgeColor> = {
    DRAFT: 'gray',
    SUBMITTED: 'info',
    APPROVED: 'success',
    REJECTED: 'danger',
};

// ── Cell model: keyed by `${projectId}|${isoDate}` ─────────────────────────────

interface CellState {
    hours: string; // string so the input stays controlled
    billable: boolean;
    note: string;
}

const cellKey = (projectId: string, isoDate: string) => `${projectId}|${isoDate}`;

const EMPTY_CELL: CellState = { hours: '', billable: true, note: '' };

type CellMap = Record<string, CellState>;

function buildCellMap(entries: TimeEntry[]): CellMap {
    const map: CellMap = {};
    for (const e of entries) {
        const iso = toISODate(parseISODate(e.date));
        map[cellKey(e.projectId, iso)] = {
            hours: e.hours != null ? String(e.hours) : '',
            billable: e.billable,
            note: e.note ?? '',
        };
    }
    return map;
}

const fmtHours = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Total formatted with an explicit unit so it reads like "37.50 hrs". */
const fmtHoursWithUnit = (n: number) => `${fmtHours(n)} hrs`;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY = 800;

// ── Main component ─────────────────────────────────────────────────────────────

const MyTimesheet: React.FC = () => {
    const { token, user } = useSelector((state: RootState) => state.auth);
    const employeeUserId: string | undefined = user?.id;
    const { formatDate } = useDateFormatter();

    const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMonday(new Date()));
    const [week, setWeek] = useState<TimesheetWeek | null>(null);
    const [cells, setCells] = useState<CellMap>({});
    const [loading, setLoading] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [submitting, setSubmitting] = useState(false);
    const [openNoteKey, setOpenNoteKey] = useState<string | null>(null);

    // ── Self-join: available projects the user isn't yet a member of ─────────────
    const [availableProjects, setAvailableProjects] = useState<
        Array<{ id: string; code: string; name: string }>
    >([]);
    const [joining, setJoining] = useState(false);

    // Refs for the debounced autosave so the timer always sees the latest values.
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cellsRef = useRef<CellMap>({});
    cellsRef.current = cells;

    const days = useMemo(
        () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
        [weekStart],
    );
    const dayISOs = useMemo(() => days.map(toISODate), [days]);

    const status = week?.timesheet.status;
    const editable = status === 'DRAFT' || status === 'REJECTED';
    const projects = week?.projects ?? [];

    // ── Read-only day markers (holidays / approved leave) ────────────────────────
    // The week endpoint returns holidays + leaveDays; both block time entry on
    // that date. Keyed by yyyy-MM-dd for O(1) lookup in the grid.
    const holidayByDate = useMemo(() => {
        const map: Record<string, string> = {};
        for (const h of week?.holidays ?? []) {
            map[h.date.slice(0, 10)] = h.name;
        }
        return map;
    }, [week]);

    const leaveByDate = useMemo(() => {
        const map: Record<string, { portion: string; leaveTypeName: string }> = {};
        for (const l of week?.leaveDays ?? []) {
            map[l.date.slice(0, 10)] = { portion: l.portion, leaveTypeName: l.leaveTypeName };
        }
        return map;
    }, [week]);

    /** A blocked day (holiday or leave) disables hour entry for every project. */
    const isBlockedDay = (iso: string) =>
        Boolean(holidayByDate[iso]) || Boolean(leaveByDate[iso]);

    // ── Fetch week ───────────────────────────────────────────────────────────────
    const fetchWeek = useCallback(
        async (monday: Date) => {
            if (!employeeUserId) return;
            try {
                setLoading(true);
                setSaveState('idle');
                const res = await axios.get(Constants.TIMESHEET_WEEK_URL, {
                    params: { employeeUserId, weekStart: toISODate(monday) },
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.data.success) {
                    const data: TimesheetWeek = res.data.data;
                    setWeek(data);
                    setCells(buildCellMap(data.entries));
                }
            } catch {
                toast.error('Failed to load timesheet.');
            } finally {
                setLoading(false);
            }
        },
        [employeeUserId, token],
    );

    // ── Fetch available projects (not yet a member of) ───────────────────────────
    const fetchAvailableProjects = useCallback(async () => {
        try {
            const res = await axios.get(Constants.TIMESHEET_AVAILABLE_PROJECTS_URL, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.data.success) {
                setAvailableProjects(res.data.data?.projects ?? []);
            }
        } catch {
            // Non-fatal: the picker just stays empty.
        }
    }, [token]);

    // ── Join a project (self-join), then refetch the week + the picker ───────────
    const handleJoinProject = useCallback(
        async (projectId: string) => {
            if (!projectId) return;
            try {
                setJoining(true);
                const res = await axios.post(
                    Constants.TIMESHEET_JOIN_PROJECT_URL,
                    { projectId },
                    { headers: { Authorization: `Bearer ${token}` } },
                );
                if (res.data.success) {
                    toast.success('Project added to your timesheet.');
                    await Promise.all([fetchWeek(weekStart), fetchAvailableProjects()]);
                }
            } catch (err: unknown) {
                const msg = axios.isAxiosError(err)
                    ? (err.response?.data?.message ?? 'Failed to add project.')
                    : 'Failed to add project.';
                toast.error(msg);
            } finally {
                setJoining(false);
            }
        },
        [token, weekStart, fetchWeek, fetchAvailableProjects],
    );

    // ── Leave a project (self-leave): remove the row from the timesheet ──────────
    const [leavingProjectId, setLeavingProjectId] = useState<string | null>(null);
    const handleLeaveProject = useCallback(
        async (projectId: string, projectName: string) => {
            if (!projectId) return;
            const ok = window.confirm(
                `Remove "${projectName}" from your timesheet? This clears this week's unsaved hours for it; submitted history is kept. You can re-add it any time with "+ Add project".`,
            );
            if (!ok) return;
            try {
                setLeavingProjectId(projectId);
                const res = await axios.delete(
                    Constants.TIMESHEET_LEAVE_PROJECT_URL(projectId),
                    { headers: { Authorization: `Bearer ${token}` } },
                );
                if (res.data.success) {
                    toast.success('Project removed from your timesheet.');
                    await Promise.all([fetchWeek(weekStart), fetchAvailableProjects()]);
                }
            } catch (err: unknown) {
                const msg = axios.isAxiosError(err)
                    ? (err.response?.data?.message ?? 'Failed to remove project.')
                    : 'Failed to remove project.';
                toast.error(msg);
            } finally {
                setLeavingProjectId(null);
            }
        },
        [token, weekStart, fetchWeek, fetchAvailableProjects],
    );

    useEffect(() => {
        fetchWeek(weekStart);
        // Reset any open note popover on week change
        setOpenNoteKey(null);
    }, [fetchWeek, weekStart]);

    useEffect(() => {
        fetchAvailableProjects();
    }, [fetchAvailableProjects]);

    // Flush a pending save when the component unmounts.
    useEffect(() => () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
    }, []);

    // ── Autosave (debounced full-week PUT) ───────────────────────────────────────
    const persist = useCallback(async () => {
        if (!week) return;
        // Build payload from current cells: only cells with a positive hours value.
        const entries = Object.entries(cellsRef.current)
            .map(([key, cell]) => {
                const [projectId, date] = key.split('|');
                const hours = parseFloat(cell.hours);
                return { projectId, date, hours, billable: cell.billable, note: cell.note };
            })
            .filter((e) => Number.isFinite(e.hours) && e.hours > 0)
            .map((e) => ({
                projectId: e.projectId,
                date: e.date, // yyyy-MM-dd
                hours: e.hours,
                billable: e.billable,
                note: e.note || undefined,
            }));

        try {
            setSaveState('saving');
            const res = await axios.put(
                Constants.TIMESHEET_ENTRIES_URL(week.timesheet.id),
                { entries },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (res.data.success) {
                setSaveState('saved');
                // Keep local entries in sync with what the server stored.
                if (res.data.data?.entries) {
                    setWeek((w) => (w ? { ...w, entries: res.data.data.entries } : w));
                }
            }
        } catch (err: unknown) {
            setSaveState('error');
            if (axios.isAxiosError(err) && err.response?.status === 409) {
                toast.error('This timesheet is locked and can no longer be edited.');
                // Reload to reflect the real (locked) status.
                fetchWeek(weekStart);
            } else {
                const msg = axios.isAxiosError(err)
                    ? (err.response?.data?.message ?? 'Autosave failed.')
                    : 'Autosave failed.';
                toast.error(msg);
            }
        }
    }, [week, token, fetchWeek, weekStart]);

    const scheduleSave = useCallback(() => {
        if (!editable) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        setSaveState('saving');
        saveTimer.current = setTimeout(() => {
            persist();
        }, AUTOSAVE_DELAY);
    }, [editable, persist]);

    // ── Cell editors ─────────────────────────────────────────────────────────────
    const updateCell = (key: string, patch: Partial<CellState>) => {
        setCells((prev) => ({
            ...prev,
            [key]: { ...(prev[key] ?? EMPTY_CELL), ...patch },
        }));
        scheduleSave();
    };

    // ── Submit ───────────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        if (!week) return;
        try {
            setSubmitting(true);
            // Flush any pending autosave first so nothing is lost.
            if (saveTimer.current) {
                clearTimeout(saveTimer.current);
                saveTimer.current = null;
            }
            await persist();
            const res = await axios.post(
                Constants.TIMESHEET_SUBMIT_URL(week.timesheet.id),
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (res.data.success) {
                toast.success(res.data.message ?? 'Timesheet submitted.');
                // Reload to lock the grid and reflect the new status.
                await fetchWeek(weekStart);
            }
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data?.message ?? 'Submit failed.')
                : 'Submit failed.';
            toast.error(msg);
        } finally {
            setSubmitting(false);
        }
    };

    // ── Totals ───────────────────────────────────────────────────────────────────
    const cellHours = (projectId: string, iso: string): number => {
        const c = cells[cellKey(projectId, iso)];
        const n = c ? parseFloat(c.hours) : 0;
        return Number.isFinite(n) ? n : 0;
    };

    const rowTotal = (projectId: string) =>
        dayISOs.reduce((s, iso) => s + cellHours(projectId, iso), 0);

    const colTotal = (iso: string) =>
        projects.reduce((s, p) => s + cellHours(p.id, iso), 0);

    const grandTotal = projects.reduce((s, p) => s + rowTotal(p.id), 0);

    // ── Save indicator ───────────────────────────────────────────────────────────
    const saveIndicator = () => {
        if (!editable) return null;
        const map: Record<SaveState, { text: string; cls: string }> = {
            idle: { text: 'All changes saved', cls: 'text-gray-400' },
            saving: { text: 'Saving…', cls: 'text-amber-600' },
            saved: { text: 'Saved', cls: 'text-green-600' },
            error: { text: 'Save failed', cls: 'text-red-600' },
        };
        const { text, cls } = map[saveState];
        return <span className={`text-xs ${cls}`}>{text}</span>;
    };

    // ── Submit action (top-bar slot) ─────────────────────────────────────────────
    const submitAction =
        editable && projects.length > 0 ? (
            <Button onClick={handleSubmit} disabled={submitting || loading}>
                {submitting ? 'Submitting…' : 'Submit for approval'}
            </Button>
        ) : status && status !== 'DRAFT' && status !== 'REJECTED' ? (
            <Badge color={STATUS_COLORS[status]}>{status}</Badge>
        ) : null;

    const weekEnd = addDays(weekStart, 6);

    // ── Render ───────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            <PageHeader title="My Timesheet">{submitAction}</PageHeader>

            {/* ── Week picker ── */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Button
                        variant="white"
                        size="sm"
                        onClick={() => setWeekStart((w) => addDays(w, -7))}
                        leftIcon={<ChevronLeft size={14} />}
                    >
                        Prev
                    </Button>
                    <input
                        type="date"
                        value={toISODate(weekStart)}
                        onChange={(e) => {
                            if (!e.target.value) return;
                            setWeekStart(startOfWeekMonday(parseISODate(e.target.value)));
                        }}
                        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600"
                    />
                    <Button
                        variant="white"
                        size="sm"
                        onClick={() => setWeekStart((w) => addDays(w, 7))}
                        rightIcon={<ChevronRight size={14} />}
                    >
                        Next
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setWeekStart(startOfWeekMonday(new Date()))}
                        className="text-purple-600 text-xs underline"
                    >
                        This week
                    </Button>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600">
                        {formatDate(weekStart)} – {formatDate(weekEnd)}
                    </span>
                    {status && <Badge color={STATUS_COLORS[status]}>{status}</Badge>}
                    {saveIndicator()}
                </div>
            </div>

            {/* ── Rejection note ── */}
            {status === 'REJECTED' && week?.timesheet.rejectionNote && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                    <span className="font-semibold">Rejected:</span>{' '}
                    {week.timesheet.rejectionNote}
                </div>
            )}

            {/* ── Grid header: add-project picker ── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-sm font-semibold text-gray-700">Projects</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                        Enter hours worked per day (decimal, e.g. 7.5). Use{' '}
                        <span className="font-medium">+ Add project</span> to add a row, or the
                        trash icon to remove one.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Plus size={14} className="text-gray-400" />
                    <select
                        aria-label="Add a project to your timesheet"
                        value=""
                        disabled={joining || availableProjects.length === 0}
                        onChange={(e) => {
                            const id = e.target.value;
                            if (id) handleJoinProject(id);
                            e.target.value = '';
                        }}
                        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600 disabled:bg-gray-50 disabled:text-gray-400"
                    >
                        <option value="">
                            {availableProjects.length === 0
                                ? 'No projects available'
                                : joining
                                  ? 'Adding…'
                                  : '+ Add project'}
                        </option>
                        {availableProjects.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                                {p.code ? ` (${p.code})` : ''}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* ── Grid ── */}
            <div className="bg-white border border-border rounded-control overflow-x-auto">
                {loading ? (
                    <div className="py-10">
                        <LoaderSpinner />
                    </div>
                ) : projects.length === 0 ? (
                    <div className="text-center py-10 text-gray-500 text-sm">
                        You are not an active member of any projects this week.
                    </div>
                ) : (
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-100 text-xs uppercase text-body">
                            <tr>
                                <th className="px-4 py-2 text-left sticky left-0 bg-gray-100 z-10" />
                                <th
                                    colSpan={7}
                                    className="px-2 py-2 text-center text-[10px] font-semibold tracking-wide text-gray-500"
                                >
                                    Hours per day
                                </th>
                                <th className="px-4 py-2" />
                            </tr>
                            <tr>
                                <th className="px-4 py-3 text-left border-b border-border sticky left-0 bg-gray-100 z-10">
                                    Project
                                </th>
                                {days.map((d, i) => {
                                    const iso = dayISOs[i];
                                    const holiday = holidayByDate[iso];
                                    const leave = leaveByDate[iso];
                                    return (
                                        <th
                                            key={iso}
                                            className="px-2 py-3 text-center border-b border-border min-w-[88px] align-top"
                                        >
                                            <div>{DAY_LABELS[i]}</div>
                                            <div className="text-[10px] font-normal text-gray-400">
                                                {d.getDate()}/{d.getMonth() + 1}
                                            </div>
                                            {holiday && (
                                                <div
                                                    className="mt-1 inline-block rounded bg-amber-100 text-amber-700 text-[9px] font-medium normal-case px-1.5 py-0.5 leading-tight"
                                                    title={`Holiday — ${holiday}`}
                                                >
                                                    Holiday — {holiday}
                                                </div>
                                            )}
                                            {leave && (
                                                <div
                                                    className="mt-1 inline-block rounded bg-sky-100 text-sky-700 text-[9px] font-medium normal-case px-1.5 py-0.5 leading-tight"
                                                    title={`${leave.leaveTypeName}${
                                                        leave.portion === 'FULL'
                                                            ? ''
                                                            : ` (${leave.portion} ½)`
                                                    }`}
                                                >
                                                    {leave.leaveTypeName}
                                                    {leave.portion !== 'FULL' && ' ½'}
                                                </div>
                                            )}
                                        </th>
                                    );
                                })}
                                <th className="px-4 py-3 text-right border-b border-border">Total (hrs)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {projects.map((p) => (
                                <tr key={p.id} className="border-b border-border hover:bg-gray-50">
                                    <td className="px-4 py-3 sticky left-0 bg-white z-10">
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <div className="font-medium text-gray-900">
                                                    {p.name}
                                                </div>
                                                <div className="text-xs text-gray-400">{p.code}</div>
                                            </div>
                                            {editable && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleLeaveProject(p.id, p.name)}
                                                    disabled={leavingProjectId === p.id}
                                                    title="Remove this project from your timesheet"
                                                    aria-label={`Remove ${p.name} from your timesheet`}
                                                    className="mt-0.5 text-gray-300 hover:text-danger hover:bg-danger-soft disabled:opacity-50"
                                                >
                                                    <Trash2 size={14} />
                                                </Button>
                                            )}
                                        </div>
                                    </td>
                                    {dayISOs.map((iso) => {
                                        const key = cellKey(p.id, iso);
                                        const cell = cells[key] ?? EMPTY_CELL;
                                        const hasNote = Boolean(cell.note);
                                        // Holidays / approved leave block time entry on this date.
                                        const blocked = isBlockedDay(iso);
                                        const cellDisabled = !editable || blocked;
                                        return (
                                            <td key={iso} className="px-2 py-2 text-center align-top">
                                                <div className="flex flex-col items-center gap-1">
                                                    <input
                                                        type="number"
                                                        inputMode="decimal"
                                                        value={cell.hours}
                                                        disabled={cellDisabled}
                                                        min="0"
                                                        max="24"
                                                        step="0.25"
                                                        placeholder="0"
                                                        onChange={(e) =>
                                                            updateCell(key, { hours: e.target.value })
                                                        }
                                                        className="w-16 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-purple-600 disabled:bg-gray-50 disabled:text-gray-500"
                                                    />
                                                    <div className="flex items-center gap-1">
                                                        <label
                                                            className="flex items-center gap-0.5 text-[10px] text-gray-500"
                                                            title="Billable"
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={cell.billable}
                                                                disabled={cellDisabled}
                                                                onChange={(e) =>
                                                                    updateCell(key, {
                                                                        billable: e.target.checked,
                                                                    })
                                                                }
                                                                className="h-3 w-3 accent-purple-600"
                                                            />
                                                            Bill
                                                        </label>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                setOpenNoteKey((k) =>
                                                                    k === key ? null : key,
                                                                )
                                                            }
                                                            title={cell.note || 'Add note'}
                                                            className={`p-0.5 rounded ${
                                                                hasNote
                                                                    ? 'text-purple-600'
                                                                    : 'text-gray-300 hover:text-gray-500'
                                                            }`}
                                                        >
                                                            <StickyNote size={12} />
                                                        </button>
                                                    </div>
                                                    {openNoteKey === key && (
                                                        <div className="relative">
                                                            <textarea
                                                                autoFocus
                                                                rows={2}
                                                                value={cell.note}
                                                                disabled={cellDisabled}
                                                                placeholder="Note…"
                                                                onChange={(e) =>
                                                                    updateCell(key, {
                                                                        note: e.target.value,
                                                                    })
                                                                }
                                                                onBlur={() => setOpenNoteKey(null)}
                                                                className="absolute z-20 -left-12 mt-1 w-40 border border-gray-300 rounded p-1 text-xs shadow-lg bg-white focus:outline-none focus:ring-1 focus:ring-purple-600"
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        );
                                    })}
                                    <td className="px-4 py-3 text-right font-mono font-semibold text-gray-800">
                                        {fmtHoursWithUnit(rowTotal(p.id))}
                                    </td>
                                </tr>
                            ))}

                            {/* Column totals */}
                            <tr className="border-b border-border bg-gray-50 font-semibold text-sm">
                                <td className="px-4 py-3 text-gray-700 sticky left-0 bg-gray-50 z-10">
                                    Daily total (hrs)
                                </td>
                                {dayISOs.map((iso) => (
                                    <td
                                        key={iso}
                                        className="px-2 py-3 text-center font-mono text-gray-700"
                                    >
                                        {fmtHours(colTotal(iso))}
                                    </td>
                                ))}
                                <td className="px-4 py-3 text-right font-mono text-purple-700">
                                    {fmtHoursWithUnit(grandTotal)}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default MyTimesheet;
