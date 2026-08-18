import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "axios";
import { toast } from "sonner";
import { CirclePlusIcon, Eye, Trash2Icon } from "lucide-react";

import type { RootState } from "@store/index";
import Constants from "@constants/api";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import type { Action } from "@components/admin/tableActions";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import ActiveFilterBanner, { type ActiveFilter } from "@components/admin/ActiveFilterBanner";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import NoRecords from "@components/admin/NoRecords";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import ExportButton from "@components/admin/ExportButton";
import { Button } from "@components/ui";
import useDateFormatter from "@hooks/useDateFormatter";
import { PageHeader } from "@/context/PageHeaderContext";
import type { JournalEntryRow } from "@models/accounting";

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

const formatNumber = (n: number): string => Number(n ?? 0).toFixed(2);

const JournalEntryList: React.FC = () => {
    const { formatDate } = useDateFormatter();
    const [searchParams, setSearchParams] = useSearchParams();
    const { token } = useSelector((state: RootState) => state.auth);
    const [entries, setEntries] = useState<JournalEntryRow[]>([]);
    const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [isLoading, setIsLoading] = useState(false);
    const [viewing, setViewing] = useState<JournalEntryRow | null>(null);
    const [viewingDetail, setViewingDetail] = useState<any>(null);
    const [deleteItem, setDeleteItem] = useState<JournalEntryRow | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const limit = Number(searchParams.get("limit") || 10);
    const page = Number(searchParams.get("page") || 1);
    // Report drill-down filters (arrive via URL from Trial Balance / Budget Variance).
    const fromDate = searchParams.get("from") || "";
    const toDate = searchParams.get("to") || "";
    const accountId = searchParams.get("accountId") || "";
    const drillParams: Record<string, string> = {
        ...(fromDate ? { from: fromDate } : {}),
        ...(toDate ? { to: toDate } : {}),
        ...(accountId ? { accountId } : {}),
    };
    const activeFilters: ActiveFilter[] = [
        ...(fromDate ? [{ label: "From", value: fromDate }] : []),
        ...(toDate ? [{ label: "To", value: toDate }] : []),
        ...(accountId ? [{ label: "Account", value: "selected" }] : []),
    ];
    const clearDrillFilters = () => setSearchParams({});

    const fetchEntries = async () => {
        try {
            setIsLoading(true);
            const resp = await axios.get(Constants.GET_JOURNAL_ENTRIES_URL, {
                params: { page, limit, ...drillParams },
                headers: { Authorization: `Bearer ${token}` },
            });
            setEntries(resp.data?.data?.journalEntries ?? []);
            setPagination(resp.data?.data?.pagination ?? { total: 0, page: 1, limit: 10, totalPages: 1 });
        } catch (err) {
            console.error("Failed to fetch journal entries:", err);
            toast.error("Failed to fetch journal entries");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchEntries();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, limit, fromDate, toDate, accountId]);

    const handleView = async (row: JournalEntryRow) => {
        setViewing(row);
        setViewingDetail(null);
        try {
            const resp = await axios.get(`${Constants.GET_JOURNAL_ENTRY_URL}/${row.id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setViewingDetail(resp.data?.data?.journalEntry ?? null);
        } catch (err) {
            console.error("Failed to fetch journal entry:", err);
            toast.error("Failed to fetch journal entry");
        }
    };

    const handleDelete = async () => {
        if (!deleteItem) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_JOURNAL_ENTRY_URL}/${deleteItem.id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            toast.success("Journal entry deleted");
            setDeleteItem(null);
            await fetchEntries();
        } catch (err) {
            console.error("Delete failed:", err);
            toast.error("Failed to delete entry");
        } finally {
            setIsDeleting(false);
        }
    };

    const tableActions: Action<JournalEntryRow>[] = [
        { label: "View", icon: <Eye size={14} />, onClick: (row: JournalEntryRow) => { void handleView(row); } },
        { label: "Delete", icon: <Trash2Icon size={14} />, primary: true, variant: "danger", onClick: (row: JournalEntryRow) => setDeleteItem(row) },
    ];

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ limit: String(newLimit), page: "1", ...drillParams });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ limit: String(limit), page: String(newPage), ...drillParams });
    };

    const headers = ["#", "Entry #", "Date", "Description", "Total Debit", "Total Credit", "Lines", "Actions"];
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Journal Entries">
                <ExportButton
                    url={Constants.EXPORT_JOURNAL_ENTRIES_URL}
                    filename="journal-entries.csv"
                />
                <Link
                    to="/admin/accounting/journal-entries/new"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-purple-600 text-white text-sm font-medium hover:bg-purple-700"
                >
                    <CirclePlusIcon size={16} /> Add Journal Entry
                </Link>
            </PageHeader>

            <ActiveFilterBanner filters={activeFilters} onClear={clearDrillFilters} />

            <div className="flex justify-end items-center">
                <select
                    value={limit}
                    onChange={(e) => handlePageLengthChange(Number(e.target.value))}
                    className="border border-gray-300 px-3 py-2 rounded-md bg-white text-gray-800 text-sm"
                >
                    {[10, 25, 50].map((num) => (
                        <option key={num} value={num}>{num} / page</option>
                    ))}
                </select>
            </div>

            <Table headers={headers}>
                {!isLoading && entries.map((row, idx) => (
                    <TableRow
                        key={row.id}
                        index={(page - 1) * limit + idx + 1}
                        row={row}
                        columns={[
                            <span className="font-mono">{row.entryNumber ?? "—"}</span>,
                            formatDate(row.entryDate),
                            row.description ?? "—",
                            formatNumber(row.totalDebit),
                            formatNumber(row.totalCredit),
                            row.lineCount,
                        ]}
                        actions={tableActions}
                        onRowClick={(item) => { void handleView(item); }}
                    />
                ))}
                {!isLoading && entries.length === 0 && (
                    <NoRecords colSpan={8} message="No journal entries yet." />
                )}
                {isLoading && (
                    <tr>
                        <td className="text-center py-2" colSpan={8}><LoaderSpinner /></td>
                    </tr>
                )}
            </Table>

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

            {viewing && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setViewing(null)}>
                    <div className="bg-white rounded-md p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold mb-3">Journal Entry {viewing.entryNumber}</h3>
                        {!viewingDetail && <LoaderSpinner />}
                        {viewingDetail && (
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div><span className="text-gray-500">Date:</span> {formatDate(viewingDetail.entryDate)}</div>
                                    <div><span className="text-gray-500">Reference:</span> {viewingDetail.reference ?? "—"}</div>
                                    <div className="col-span-2"><span className="text-gray-500">Description:</span> {viewingDetail.description ?? "—"}</div>
                                </div>
                                <table className="w-full text-sm border-collapse">
                                    <thead className="bg-gray-100">
                                        <tr>
                                            <th className="text-left px-2 py-1">Account</th>
                                            <th className="text-right px-2 py-1">Debit</th>
                                            <th className="text-right px-2 py-1">Credit</th>
                                            <th className="text-left px-2 py-1">Description</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(viewingDetail.lines ?? []).map((l: any) => (
                                            <tr key={l.id} className="border-b">
                                                <td className="px-2 py-1">{l.account?.code} – {l.account?.name}</td>
                                                <td className="px-2 py-1 text-right">{Number(l.debit ?? 0).toFixed(2)}</td>
                                                <td className="px-2 py-1 text-right">{Number(l.credit ?? 0).toFixed(2)}</td>
                                                <td className="px-2 py-1">{l.description ?? "—"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        <div className="text-right mt-4">
                            <Button variant="white" size="sm" onClick={() => setViewing(null)}>Close</Button>
                        </div>
                    </div>
                </div>
            )}

            <DeleteConfirmationModal
                isOpen={!!deleteItem}
                onClose={() => setDeleteItem(null)}
                onConfirm={handleDelete}
                isDeleting={isDeleting}
                title="Delete Journal Entry"
                message={`Are you sure you want to delete ${deleteItem?.entryNumber ?? "this entry"}?`}
            />
        </div>
    );
};

export default JournalEntryList;
