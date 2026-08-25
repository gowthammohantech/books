import React, { useEffect, useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';
import { CirclePlusIcon, ChevronDown, ChevronUp, Trash2Icon } from 'lucide-react';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type { PayRun, PayRunLine, DeductionLine } from '@models/payroll';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import NoRecords from '@components/admin/NoRecords';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button, Badge } from '@components/ui';
import type { BadgeColor } from '@components/ui';

const PAY_RUNS_URL = `${Constants.API_BASE_URL}/admin/payroll/runs`;

// ── Tax year helpers (mirrors MyMoney.tsx) ──────────────────────────────────

interface TaxYearOption { label: string; value: string; }

function generateTaxYears(count = 5): TaxYearOption[] {
    const today = new Date();
    const currentTaxYearStart =
        today >= new Date(today.getFullYear(), 3, 6)
            ? today.getFullYear()
            : today.getFullYear() - 1;
    const years: TaxYearOption[] = [];
    for (let i = 0; i < count; i++) {
        const startYear = currentTaxYearStart - i;
        const endYear = startYear + 1;
        const label = `${startYear}/${String(endYear).slice(2)}`;
        years.push({ label, value: label });
    }
    return years;
}

const TAX_YEARS = generateTaxYears(5);

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

// ── Status badge ──────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: PayRun['status'] }> = ({ status }) => {
    const colours: Record<PayRun['status'], BadgeColor> = {
        DRAFT: 'warning',
        FINALIZED: 'success',
        VOID: 'gray',
    };
    return <Badge color={colours[status]} variant="soft">{status}</Badge>;
};

// ── Local editable line type ──────────────────────────────────────────────────

interface EditableLine {
    employeeUserId: string;
    employeeName: string;
    gross: string;           // string so input stays controlled
    deductionLines: DeductionLine[];
    note: string;
}

function lineNet(l: EditableLine): number {
    const gross = parseFloat(l.gross) || 0;
    const deductions = l.deductionLines.reduce((s, d) => s + (d.amount || 0), 0);
    return gross - deductions;
}

function buildEditableLines(lines: PayRunLine[]): EditableLine[] {
    return lines.map((l) => ({
        employeeUserId: l.employeeUserId,
        employeeName: l.employee
            ? `${l.employee.firstName ?? ''} ${l.employee.lastName ?? ''}`.trim() || l.employeeUserId
            : l.employeeUserId,
        gross: String(l.gross),
        deductionLines: l.deductionLines.map((d) => ({ label: d.label, amount: d.amount })),
        note: l.note ?? '',
    }));
}

// ── Main component ─────────────────────────────────────────────────────────────

const PayRuns: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);

    // ── List state ─────────────────────────────────────────────────────────────
    const [runs, setRuns] = useState<PayRun[]>([]);
    const [listLoading, setListLoading] = useState(false);
    const [filterYear, setFilterYear] = useState<string>(TAX_YEARS[0].value);

    // ── Create form state ──────────────────────────────────────────────────────
    const [newYear, setNewYear] = useState<string>(TAX_YEARS[0].value);
    const [newMonth, setNewMonth] = useState<string>('1');
    const [isCreating, setIsCreating] = useState(false);

    // ── Detail / editor state ──────────────────────────────────────────────────
    const [selectedRun, setSelectedRun] = useState<PayRun | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [editableLines, setEditableLines] = useState<EditableLine[]>([]);
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
    const [isSaving, setIsSaving] = useState(false);
    const [confirmAction, setConfirmAction] = useState<'finalize' | 'void' | null>(null);
    const [isActioning, setIsActioning] = useState(false);

    // ── Fetch list ─────────────────────────────────────────────────────────────
    const fetchRuns = useCallback(async (year: string) => {
        try {
            setListLoading(true);
            const res = await axios.get(PAY_RUNS_URL, {
                params: { taxYear: year },
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.data.success) {
                setRuns(res.data.data ?? []);
            }
        } catch {
            toast.error('Failed to fetch pay runs.');
        } finally {
            setListLoading(false);
        }
    }, [token]);

    useEffect(() => { fetchRuns(filterYear); }, [fetchRuns, filterYear]);

    // ── Open a run detail ──────────────────────────────────────────────────────
    const openRun = async (id: string) => {
        try {
            setDetailLoading(true);
            setSelectedRun(null);
            setExpandedRows(new Set());
            const res = await axios.get(`${PAY_RUNS_URL}/${id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.data.success) {
                const run: PayRun = res.data.data;
                setSelectedRun(run);
                setEditableLines(buildEditableLines(run.lines));
            }
        } catch {
            toast.error('Failed to load pay run detail.');
        } finally {
            setDetailLoading(false);
        }
    };

    // ── Create run ─────────────────────────────────────────────────────────────
    const handleCreate = async () => {
        try {
            setIsCreating(true);
            const res = await axios.post(PAY_RUNS_URL, {
                taxYearLabel: newYear,
                taxMonth: Number(newMonth),
            }, { headers: { Authorization: `Bearer ${token}` } });
            if (res.data.success) {
                toast.success(res.data.message ?? 'Pay run created.');
                const created: PayRun = res.data.data;
                // Refresh list and open the new run
                await fetchRuns(filterYear);
                openRun(created.id);
            }
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data?.message ?? 'Create failed.')
                : 'Create failed.';
            toast.error(msg);
        } finally {
            setIsCreating(false);
        }
    };

    // ── Save lines ─────────────────────────────────────────────────────────────
    const handleSave = async () => {
        if (!selectedRun) return;
        try {
            setIsSaving(true);
            const payload = {
                lines: editableLines.map((l) => ({
                    employeeUserId: l.employeeUserId,
                    gross: parseFloat(l.gross) || 0,
                    deductionLines: l.deductionLines,
                    note: l.note || undefined,
                })),
            };
            const res = await axios.put(`${PAY_RUNS_URL}/${selectedRun.id}`, payload, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.data.success) {
                toast.success(res.data.message ?? 'Pay run saved.');
                // Reload the detail so server-computed values are reflected
                openRun(selectedRun.id);
            }
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data?.message ?? 'Save failed.')
                : 'Save failed.';
            toast.error(msg);
        } finally {
            setIsSaving(false);
        }
    };

    // ── Finalize / Void ────────────────────────────────────────────────────────
    const handleAction = async () => {
        if (!selectedRun || !confirmAction) return;
        try {
            setIsActioning(true);
            const res = await axios.post(`${PAY_RUNS_URL}/${selectedRun.id}/${confirmAction}`, {}, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.data.success) {
                toast.success(res.data.message ?? `Run ${confirmAction}d.`);
                setConfirmAction(null);
                // Reload detail + list
                openRun(selectedRun.id);
                fetchRuns(filterYear);
            }
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data?.message ?? `${confirmAction} failed.`)
                : `${confirmAction} failed.`;
            toast.error(msg);
            setConfirmAction(null);
        } finally {
            setIsActioning(false);
        }
    };

    // ── Line editors ───────────────────────────────────────────────────────────
    const updateLine = (idx: number, patch: Partial<EditableLine>) => {
        setEditableLines((prev) => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
    };

    const addDeduction = (lineIdx: number) => {
        updateLine(lineIdx, {
            deductionLines: [
                ...editableLines[lineIdx].deductionLines,
                { label: '', amount: 0 },
            ],
        });
    };

    const updateDeduction = (lineIdx: number, dIdx: number, patch: Partial<DeductionLine>) => {
        const newDeds = editableLines[lineIdx].deductionLines.map((d, i) =>
            i === dIdx ? { ...d, ...patch } : d
        );
        updateLine(lineIdx, { deductionLines: newDeds });
    };

    const removeDeduction = (lineIdx: number, dIdx: number) => {
        const newDeds = editableLines[lineIdx].deductionLines.filter((_, i) => i !== dIdx);
        updateLine(lineIdx, { deductionLines: newDeds });
    };

    const toggleExpand = (idx: number) => {
        setExpandedRows((prev) => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx); else next.add(idx);
            return next;
        });
    };

    const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const totalNet = (run: PayRun) =>
        run.lines.reduce((s, l) => s + (l.net ?? 0), 0);

    const isDraft = selectedRun?.status === 'DRAFT';
    const isFinalized = selectedRun?.status === 'FINALIZED';

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            {/* ── Header ── */}
            <PageHeader title="Pay Runs" />

            {/* ── Create run ── */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">New Pay Run</h2>
                <div className="flex flex-wrap items-end gap-3">
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Tax Year</label>
                        <select
                            value={newYear}
                            onChange={(e) => setNewYear(e.target.value)}
                            className="border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600"
                        >
                            {TAX_YEARS.map((y) => (
                                <option key={y.value} value={y.value}>{y.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Month</label>
                        <select
                            value={newMonth}
                            onChange={(e) => setNewMonth(e.target.value)}
                            className="border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600"
                        >
                            {MONTH_NAMES.map((name, i) => (
                                <option key={i + 1} value={String(i + 1)}>{name}</option>
                            ))}
                        </select>
                    </div>
                    <Button
                        onClick={handleCreate}
                        disabled={isCreating}
                        leftIcon={<CirclePlusIcon size={14} />}
                    >
                        {isCreating ? 'Creating…' : 'Create DRAFT'}
                    </Button>
                </div>
            </div>

            {/* ── List ── */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
                    <span className="text-sm font-semibold text-gray-700">Filter by tax year:</span>
                    <select
                        value={filterYear}
                        onChange={(e) => setFilterYear(e.target.value)}
                        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600"
                    >
                        {TAX_YEARS.map((y) => (
                            <option key={y.value} value={y.value}>{y.label}</option>
                        ))}
                    </select>
                </div>

                {listLoading ? (
                    <div className="py-10">
                        <LoaderSpinner />
                    </div>
                ) : (
                    <div className="overflow-x-auto border border-border rounded-control">
                        <table className="w-full text-sm border-collapse">
                            <thead className="bg-gray-100 text-xs uppercase text-body">
                                <tr>
                                    <th className="px-4 py-3 text-left border-b border-border">#</th>
                                    <th className="px-4 py-3 text-left border-b border-border">Tax Year</th>
                                    <th className="px-4 py-3 text-left border-b border-border">Month</th>
                                    <th className="px-4 py-3 text-left border-b border-border">Period</th>
                                    <th className="px-4 py-3 text-left border-b border-border">Status</th>
                                    <th className="px-4 py-3 text-right border-b border-border">Total Net</th>
                                    <th className="px-4 py-3 text-center border-b border-border">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {runs.length === 0 ? (
                                    <NoRecords colSpan={7} message={`No pay runs found for ${filterYear}.`} />
                                ) : (
                                    runs.map((run, idx) => (
                                        <tr
                                            key={run.id}
                                            className={`border-b border-border hover:bg-gray-50 transition-colors ${selectedRun?.id === run.id ? 'bg-purple-50' : ''}`}
                                        >
                                            <td className="px-4 py-3 text-gray-500">{idx + 1}</td>
                                            <td className="px-4 py-3 font-medium text-gray-900">{run.taxYearLabel}</td>
                                            <td className="px-4 py-3 text-gray-700">{MONTH_NAMES[(run.taxMonth ?? 1) - 1]}</td>
                                            <td className="px-4 py-3 text-gray-500 text-xs">
                                                {run.periodStart ? run.periodStart.slice(0, 10) : '—'} – {run.periodEnd ? run.periodEnd.slice(0, 10) : '—'}
                                            </td>
                                            <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                                            <td className="px-4 py-3 text-right font-mono text-gray-800">
                                                {fmt(totalNet(run))}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <Button
                                                    variant="link"
                                                    size="sm"
                                                    onClick={() => openRun(run.id)}
                                                >
                                                    Open
                                                </Button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── Detail / editor ── */}
            {detailLoading && (
                <div className="py-10">
                    <LoaderSpinner />
                </div>
            )}

            {selectedRun && !detailLoading && (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    {/* Run header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50">
                        <div className="flex items-center gap-3">
                            <span className="font-semibold text-gray-900">
                                {selectedRun.taxYearLabel} — {MONTH_NAMES[(selectedRun.taxMonth ?? 1) - 1]}
                            </span>
                            <StatusBadge status={selectedRun.status} />
                        </div>
                        <div className="flex items-center gap-2">
                            {isDraft && (
                                <>
                                    <Button
                                        onClick={handleSave}
                                        disabled={isSaving}
                                    >
                                        {isSaving ? 'Saving…' : 'Save'}
                                    </Button>
                                    <Button
                                        variant="success"
                                        onClick={() => setConfirmAction('finalize')}
                                    >
                                        Finalize
                                    </Button>
                                </>
                            )}
                            {isFinalized && (
                                <Button
                                    variant="danger"
                                    onClick={() => setConfirmAction('void')}
                                >
                                    Void
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                onClick={() => setSelectedRun(null)}
                                className="text-gray-500 hover:text-gray-800 text-sm underline"
                            >
                                Close
                            </Button>
                        </div>
                    </div>

                    {/* Lines table */}
                    <div className="overflow-x-auto border border-border rounded-control">
                        <table className="w-full text-sm border-collapse">
                            <thead className="bg-gray-100 text-xs uppercase text-body">
                                <tr>
                                    <th className="px-4 py-3 text-left border-b border-border">Employee</th>
                                    <th className="px-4 py-3 text-right border-b border-border">Gross</th>
                                    <th className="px-4 py-3 text-right border-b border-border">Deductions</th>
                                    <th className="px-4 py-3 text-right border-b border-border">Net</th>
                                    <th className="px-4 py-3 text-left border-b border-border">Note</th>
                                    {isDraft && <th className="px-4 py-3 text-center border-b border-border">Deduction Lines</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {editableLines.map((line, idx) => {
                                    const net = lineNet(line);
                                    const deductionSum = line.deductionLines.reduce((s, d) => s + (d.amount || 0), 0);
                                    const expanded = expandedRows.has(idx);

                                    return (
                                        <React.Fragment key={`line-${idx}`}>
                                            <tr className="border-b border-border hover:bg-gray-50">
                                                <td className="px-4 py-3 font-medium text-indigo-600">
                                                    {line.employeeName}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    {isDraft ? (
                                                        <input
                                                            type="number"
                                                            value={line.gross}
                                                            onChange={(e) => updateLine(idx, { gross: e.target.value })}
                                                            className="border border-gray-300 rounded px-2 py-1 text-right w-28 text-sm focus:outline-none focus:ring-1 focus:ring-purple-600"
                                                            min="0"
                                                            step="0.01"
                                                        />
                                                    ) : (
                                                        <span className="font-mono">{fmt(parseFloat(line.gross) || 0)}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono text-danger">
                                                    {fmt(deductionSum)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono font-semibold text-success">
                                                    {fmt(net)}
                                                </td>
                                                <td className="px-4 py-3">
                                                    {isDraft ? (
                                                        <input
                                                            type="text"
                                                            value={line.note}
                                                            onChange={(e) => updateLine(idx, { note: e.target.value })}
                                                            placeholder="Optional note"
                                                            className="border border-gray-300 rounded px-2 py-1 text-sm w-40 focus:outline-none focus:ring-1 focus:ring-purple-600"
                                                        />
                                                    ) : (
                                                        <span className="text-gray-500">{line.note || '—'}</span>
                                                    )}
                                                </td>
                                                {isDraft && (
                                                    <td className="px-4 py-3 text-center">
                                                        <Button
                                                            type="button"
                                                            variant="link"
                                                            size="sm"
                                                            onClick={() => toggleExpand(idx)}
                                                            leftIcon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                            className="mx-auto"
                                                        >
                                                            {line.deductionLines.length} deduction{line.deductionLines.length !== 1 ? 's' : ''}
                                                        </Button>
                                                    </td>
                                                )}
                                            </tr>

                                            {/* Expanded deduction sub-editor */}
                                            {isDraft && expanded && (
                                                <tr key={`ded-${idx}`} className="border-b border-border">
                                                    <td colSpan={6} className="px-8 py-3 bg-purple-50">
                                                        <div className="space-y-2">
                                                            <div className="text-xs font-semibold text-gray-600 uppercase mb-2">
                                                                Deduction lines for {line.employeeName}
                                                            </div>
                                                            {line.deductionLines.map((d, dIdx) => (
                                                                <div key={dIdx} className="flex items-center gap-2">
                                                                    <input
                                                                        type="text"
                                                                        value={d.label}
                                                                        onChange={(e) => updateDeduction(idx, dIdx, { label: e.target.value })}
                                                                        placeholder="Label (e.g. PAYE)"
                                                                        className="border border-gray-300 rounded px-2 py-1 text-sm flex-1 focus:outline-none focus:ring-1 focus:ring-purple-600"
                                                                    />
                                                                    <input
                                                                        type="number"
                                                                        value={d.amount}
                                                                        onChange={(e) => updateDeduction(idx, dIdx, { amount: parseFloat(e.target.value) || 0 })}
                                                                        placeholder="Amount"
                                                                        className="border border-gray-300 rounded px-2 py-1 text-sm w-28 text-right focus:outline-none focus:ring-1 focus:ring-purple-600"
                                                                        min="0"
                                                                        step="0.01"
                                                                    />
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={() => removeDeduction(idx, dIdx)}
                                                                        aria-label="Remove deduction"
                                                                        title="Remove deduction"
                                                                        className="text-danger hover:text-danger"
                                                                    >
                                                                        <Trash2Icon size={14} />
                                                                    </Button>
                                                                </div>
                                                            ))}
                                                            <Button
                                                                type="button"
                                                                variant="link"
                                                                size="sm"
                                                                onClick={() => addDeduction(idx)}
                                                                leftIcon={<CirclePlusIcon size={13} />}
                                                                className="mt-1"
                                                            >
                                                                Add deduction
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}

                                {editableLines.length === 0 && (
                                    <NoRecords colSpan={isDraft ? 6 : 5} message="No employee lines in this run." />
                                )}

                                {/* Totals row */}
                                {editableLines.length > 0 && (
                                    <tr className="bg-gray-50 font-semibold text-sm">
                                        <td className="px-4 py-3 text-gray-700">Totals</td>
                                        <td className="px-4 py-3 text-right font-mono">
                                            {fmt(editableLines.reduce((s, l) => s + (parseFloat(l.gross) || 0), 0))}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-danger">
                                            {fmt(editableLines.reduce((s, l) => s + l.deductionLines.reduce((ds, d) => ds + (d.amount || 0), 0), 0))}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-success">
                                            {fmt(editableLines.reduce((s, l) => s + lineNet(l), 0))}
                                        </td>
                                        <td colSpan={isDraft ? 2 : 1} />
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Confirm dialog ── */}
            {confirmAction && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2 capitalize">
                            {confirmAction} pay run?
                        </h3>
                        <p className="text-sm text-gray-600 mb-6">
                            {confirmAction === 'finalize'
                                ? 'Finalizing locks the run and posts payroll journal entries. This cannot be undone.'
                                : 'Voiding this run will mark it as cancelled. Any associated salary settlements must be reversed separately.'}
                        </p>
                        <div className="flex justify-end gap-3">
                            <Button
                                variant="white"
                                onClick={() => setConfirmAction(null)}
                                disabled={isActioning}
                            >
                                Cancel
                            </Button>
                            {confirmAction === 'finalize' ? (
                                <Button
                                    variant="success"
                                    onClick={handleAction}
                                    disabled={isActioning}
                                >
                                    {isActioning ? 'Please wait…' : `Yes, ${confirmAction}`}
                                </Button>
                            ) : (
                                <Button
                                    variant="danger"
                                    onClick={handleAction}
                                    disabled={isActioning}
                                >
                                    {isActioning ? 'Please wait…' : `Yes, ${confirmAction}`}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PayRuns;
