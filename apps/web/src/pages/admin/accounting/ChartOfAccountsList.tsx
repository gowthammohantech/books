import api from '@lib/apiClient';
import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CirclePlusIcon, Edit, Trash2Icon } from "lucide-react";

import Constants from "@constants/api";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import NoRecords from "@components/admin/NoRecords";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import ExportButton from "@components/admin/ExportButton";
import { Button, Badge, type BadgeColor, EmptyStateHero } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";
import type { Account, AccountType } from "@models/accounting";

import { LIST_EMPTY_STATES } from "@constants/listEmptyStates";
const ACCOUNT_TYPES: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];

const typeBadgeColor = (t: AccountType): BadgeColor => {
    switch (t) {
        case "ASSET": return "info";
        case "LIABILITY": return "danger";
        case "EQUITY": return "primary";
        case "INCOME": return "success";
        case "EXPENSE": return "warning";
        default: return "gray";
    }
};

interface FormState {
    code: string;
    name: string;
    accountType: AccountType;
    parentId: string;
    description: string;
}

const emptyForm: FormState = { code: "", name: "", accountType: "ASSET", parentId: "", description: "" };

const ChartOfAccountsList: React.FC = () => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSeeding, setIsSeeding] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [submitting, setSubmitting] = useState(false);
    const [deleteItem, setDeleteItem] = useState<Account | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [filterType, setFilterType] = useState<string>("");

    const fetchAccounts = async () => {
        try {
            setIsLoading(true);
            const params: Record<string, string> = {};
            if (filterType) params.accountType = filterType;
            const resp = await api.get(Constants.GET_ACCOUNTS_URL, {
                params
});
            setAccounts(resp.data?.data?.accounts ?? []);
        } catch (err) {
            console.error("Failed to fetch accounts:", err);
            toast.error("Failed to fetch accounts");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAccounts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterType]);

    const handleSeed = async () => {
        if (isSeeding) return;
        try {
            setIsSeeding(true);
            const resp = await api.post(
                Constants.SEED_DEFAULT_ACCOUNTS_URL,
                {}
            );
            toast.success(resp.data?.message ?? "Seeded default chart");
            await fetchAccounts();
        } catch (err) {
            console.error("Seed failed:", err);
            toast.error("Failed to seed default chart");
        } finally {
            setIsSeeding(false);
        }
    };

    const openCreate = () => {
        setForm(emptyForm);
        setEditingId(null);
        setShowModal(true);
    };

    const openEdit = (row: Account) => {
        setForm({
            code: row.code,
            name: row.name,
            accountType: row.accountType,
            parentId: row.parentId ?? "",
            description: row.description ?? ""
        });
        setEditingId(row.id);
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.code || !form.name || !form.accountType) {
            toast.error("Code, name, and type are required");
            return;
        }
        try {
            setSubmitting(true);
            const payload = {
                code: form.code,
                name: form.name,
                accountType: form.accountType,
                parentId: form.parentId || null,
                description: form.description || null
            };
            if (editingId) {
                await api.put(
                    `${Constants.UPDATE_ACCOUNT_URL}/${editingId}`,
                    payload
                );
                toast.success("Account updated");
            } else {
                await api.post(Constants.CREATE_ACCOUNT_URL, payload);
                toast.success("Account created");
            }
            setShowModal(false);
            await fetchAccounts();
        } catch (err) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data as { message?: string } | undefined)?.message
                : null;
            console.error("Save failed:", err);
            toast.error(msg ?? "Failed to save account");
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteItem) return;
        try {
            setIsDeleting(true);
            await api.delete(`${Constants.DELETE_ACCOUNT_URL}/${deleteItem.id}`);
            toast.success("Account deleted");
            setDeleteItem(null);
            await fetchAccounts();
        } catch (err) {
            console.error("Delete failed:", err);
            toast.error("Failed to delete account");
        } finally {
            setIsDeleting(false);
        }
    };

    const tableActions = [
        { label: "Edit", icon: <Edit size={14} />, onClick: (row: Account) => openEdit(row) },
        { label: "Delete", icon: <Trash2Icon size={14} />, onClick: (row: Account) => setDeleteItem(row) },
    ];

    const headers = ["#", "Code", "Name", "Type", "Parent", "Actions"];

    /**
     * Nothing here and nothing asked for, so this list has never held a
     * record rather than having been filtered down to none.
     */
    const isFirstRun = !isLoading && accounts.length === 0;

    return (
        <div className="space-y-4">
            <PageHeader title="Chart of Accounts">
                <ExportButton
                    url={Constants.EXPORT_CHART_OF_ACCOUNTS_URL}
                    filename="chart-of-accounts.csv"
                />
                {accounts.length === 0 && !isLoading && (
                    <Button
                        variant="white"
                        onClick={handleSeed}
                        disabled={isSeeding}
                    >
                        {isSeeding ? "Seeding…" : "Seed Defaults"}
                    </Button>
                )}
                <Button onClick={openCreate} leftIcon={<CirclePlusIcon size={16} />}>
                    Add Account
                </Button>
            </PageHeader>
            {isFirstRun ? (
                <EmptyStateHero
                    {...LIST_EMPTY_STATES.chartOfAccounts}
                    action={<Button size="lg" leftIcon={<CirclePlusIcon size={16} />} onClick={openCreate}>
                        {LIST_EMPTY_STATES.chartOfAccounts.cta}
                    </Button>}
                />
            ) : (
                <>

                <div className="flex items-center gap-3">
                    <label className="text-sm text-gray-700">Filter:</label>
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="border border-gray-300 px-3 py-2 rounded-md bg-white text-gray-800 text-sm"
                    >
                        <option value="">All types</option>
                        {ACCOUNT_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                        ))}
                    </select>
                </div>

                <Table headers={headers}>
                    {!isLoading && accounts.map((row, idx) => (
                        <TableRow
                            key={row.id}
                            index={idx + 1}
                            row={row}
                            columns={[
                                <span className="font-mono">{row.code}</span>,
                                row.name,
                                <Badge color={typeBadgeColor(row.accountType)}>{row.accountType}</Badge>,
                                row.parent ? `${row.parent.code} – ${row.parent.name}` : "—",
                            ]}
                            actions={tableActions}
                            onRowClick={(item) => openEdit(item)}
                        />
                    ))}
                    {!isLoading && accounts.length === 0 && (
                        <NoRecords art="folder" colSpan={6} message="No accounts found. Click 'Seed Defaults' to install the standard chart." />
                    )}
                    {isLoading && (
                        <tr>
                            <td className="text-center py-2" colSpan={6}><LoaderSpinner /></td>
                        </tr>
                    )}
                </Table>
                </>
            )}


            {showModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setShowModal(false)}>
                    <div className="bg-white rounded-md p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold mb-4">{editingId ? "Edit Account" : "Add Account"}</h3>
                        <form onSubmit={handleSubmit} className="space-y-3">
                            <div>
                                <label className="block text-sm text-gray-700 mb-1">Code *</label>
                                <input
                                    type="text"
                                    value={form.code}
                                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                                    required
                                    disabled={!!editingId}
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-700 mb-1">Name *</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-700 mb-1">Type *</label>
                                <select
                                    value={form.accountType}
                                    onChange={(e) => setForm({ ...form, accountType: e.target.value as AccountType })}
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                                    required
                                >
                                    {ACCOUNT_TYPES.map((t) => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-700 mb-1">Parent</label>
                                <select
                                    value={form.parentId}
                                    onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                                >
                                    <option value="">— None —</option>
                                    {accounts
                                        .filter((a) => a.accountType === form.accountType && a.id !== editingId)
                                        .map((a) => (
                                            <option key={a.id} value={a.id}>{a.code} – {a.name}</option>
                                        ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-700 mb-1">Description</label>
                                <textarea
                                    value={form.description}
                                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                                    rows={2}
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <Button variant="white" onClick={() => setShowModal(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={submitting}>
                                    {submitting ? "Saving…" : "Save"}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <DeleteConfirmationModal
                isOpen={!!deleteItem}
                onClose={() => setDeleteItem(null)}
                onConfirm={handleDelete}
                isDeleting={isDeleting}
                title="Delete Account"
                message={`Are you sure you want to delete account ${deleteItem?.code} – ${deleteItem?.name}?`}
            />
        </div>
    );
};

export default ChartOfAccountsList;
