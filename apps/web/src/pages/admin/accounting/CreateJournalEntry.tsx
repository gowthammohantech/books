import api from '@lib/apiClient';
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import type { RootState } from "@store/index";
import Constants from "@constants/api";
import type { Account } from "@models/accounting";
import { Button, Badge } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";
import DateInput from "@components/admin/DateInput";
import { ymdStringToDate, dateToYmdString } from "@utils/converters";

interface LineDraft {
    accountId: string;
    debit: string;
    credit: string;
    description: string;
}

const emptyLine = (): LineDraft => ({ accountId: "", debit: "", credit: "", description: "" });

const today = (): string => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
};

const CreateJournalEntry: React.FC = () => {
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [entryDate, setEntryDate] = useState<string>(today());
    const [description, setDescription] = useState<string>("");
    const [reference, setReference] = useState<string>("");
    const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const resp = await api.get(Constants.GET_ACCOUNTS_URL);
                setAccounts(resp.data?.data?.accounts ?? []);
            } catch (err) {
                console.error("Failed to load accounts:", err);
                toast.error("Failed to load accounts");
            }
        })();
    }, [token]);

    const totalDebit = useMemo(() => lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0), [lines]);
    const totalCredit = useMemo(() => lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0), [lines]);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;
    const hasMinLines = lines.length >= 2;
    const allAccountsSelected = lines.every((l) => !!l.accountId);
    const canSave = isBalanced && hasMinLines && allAccountsSelected && !submitting;

    const updateLine = (idx: number, patch: Partial<LineDraft>) => {
        setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    };

    const addLine = () => setLines((prev) => [...prev, emptyLine()]);

    const removeLine = (idx: number) => {
        setLines((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx)));
    };

    const handleSave = async () => {
        if (!canSave) return;
        try {
            setSubmitting(true);
            const payload = {
                entryDate,
                description: description || null,
                reference: reference || null,
                lines: lines.map((l) => ({
                    accountId: l.accountId,
                    debit: parseFloat(l.debit) || 0,
                    credit: parseFloat(l.credit) || 0,
                    description: l.description || null,
                })),
            };
            await api.post(Constants.CREATE_JOURNAL_ENTRY_URL, payload);
            toast.success("Journal entry created");
            navigate("/accounting/journal-entries");
        } catch (err) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data as { message?: string } | undefined)?.message
                : null;
            console.error("Save failed:", err);
            toast.error(msg ?? "Failed to create journal entry");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-5">
            <PageHeader title="New Journal Entry" />

            <div className="bg-card rounded-md border border-gray-100 p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <DateInput
                            label="Entry Date"
                            isRequired
                            value={ymdStringToDate(entryDate)}
                            onChange={(date) => setEntryDate(dateToYmdString(date))}
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-gray-700 mb-1">Reference</label>
                        <input
                            type="text"
                            value={reference}
                            onChange={(e) => setReference(e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                            placeholder="e.g. INV-001"
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-gray-700 mb-1">Description</label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                        />
                    </div>
                </div>

                <div>
                    <div className="flex justify-between items-center mb-2">
                        <h2 className="text-lg font-semibold text-gray-800">Lines</h2>
                        <Button size="sm" onClick={addLine} leftIcon={<Plus size={14} />}>
                            Add Line
                        </Button>
                    </div>
                    <table className="w-full text-sm border-collapse">
                        <thead className="bg-gray-100">
                            <tr>
                                <th className="text-left px-2 py-2">Account</th>
                                <th className="text-right px-2 py-2 w-32">Debit</th>
                                <th className="text-right px-2 py-2 w-32">Credit</th>
                                <th className="text-left px-2 py-2">Description</th>
                                <th className="w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map((line, idx) => (
                                <tr key={idx} className="border-b">
                                    <td className="px-2 py-1">
                                        <select
                                            value={line.accountId}
                                            onChange={(e) => updateLine(idx, { accountId: e.target.value })}
                                            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                                        >
                                            <option value="">— Select account —</option>
                                            {accounts.map((a) => (
                                                <option key={a.id} value={a.id}>{a.code} – {a.name} ({a.accountType})</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="px-2 py-1">
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={line.debit}
                                            onChange={(e) => updateLine(idx, { debit: e.target.value, credit: e.target.value ? "" : line.credit })}
                                            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm text-right"
                                        />
                                    </td>
                                    <td className="px-2 py-1">
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={line.credit}
                                            onChange={(e) => updateLine(idx, { credit: e.target.value, debit: e.target.value ? "" : line.debit })}
                                            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm text-right"
                                        />
                                    </td>
                                    <td className="px-2 py-1">
                                        <input
                                            type="text"
                                            value={line.description}
                                            onChange={(e) => updateLine(idx, { description: e.target.value })}
                                            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                                        />
                                    </td>
                                    <td className="px-2 py-1 text-center">
                                        <button
                                            type="button"
                                            disabled={lines.length <= 2}
                                            onClick={() => removeLine(idx)}
                                            className="text-destructive hover:text-destructive disabled:text-gray-300"
                                            title={lines.length <= 2 ? "At least 2 lines required" : "Remove line"}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            <tr className="bg-gray-50 font-medium">
                                <td className="px-2 py-2 text-right">Totals:</td>
                                <td className="px-2 py-2 text-right">{totalDebit.toFixed(2)}</td>
                                <td className="px-2 py-2 text-right">{totalCredit.toFixed(2)}</td>
                                <td className="px-2 py-2" colSpan={2}>
                                    <Badge color={isBalanced ? "success" : "danger"}>
                                        {isBalanced ? "Balanced" : `Unbalanced (Δ ${(totalDebit - totalCredit).toFixed(2)})`}
                                    </Badge>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <Button
                        variant="white"
                        onClick={() => navigate("/accounting/journal-entries")}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={!canSave}
                        title={!canSave ? "Fill in all lines and ensure debits equal credits" : ""}
                    >
                        {submitting ? "Saving…" : "Save Journal Entry"}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default CreateJournalEntry;
