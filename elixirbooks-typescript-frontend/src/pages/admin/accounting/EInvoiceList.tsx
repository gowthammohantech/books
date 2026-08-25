import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import axios from "axios";
import { toast } from "sonner";
import { Ban } from "lucide-react";

import type { RootState } from "@store/index";
import Constants from "@constants/api";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import NoRecords from "@components/admin/NoRecords";
import { Badge, type BadgeColor } from "@components/ui";
import useDateFormatter from "@hooks/useDateFormatter";
import { PageHeader } from "@/context/PageHeaderContext";

type EInvoiceStatus = "PENDING" | "GENERATED" | "CANCELLED" | "FAILED";

interface EInvoiceRow {
    id: string;
    irn: string | null;
    ackNo: string | null;
    ackDate: string | null;
    status: EInvoiceStatus;
    provider: string;
    errorMessage: string | null;
    invoice: { id: string; invoiceNumber: string | null; totalAmount: number | string } | null;
    createdAt: string;
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
    { value: "", label: "All statuses" },
    { value: "PENDING", label: "Pending" },
    { value: "GENERATED", label: "Generated" },
    { value: "CANCELLED", label: "Cancelled" },
    { value: "FAILED", label: "Failed" },
];

const truncate = (s: string | null, n = 16): string => {
    if (!s) return "—";
    return s.length > n ? `${s.slice(0, n)}…` : s;
};

const StatusBadge = ({ status }: { status: EInvoiceStatus }) => {
    const palette: Record<EInvoiceStatus, BadgeColor> = {
        PENDING: "warning",
        GENERATED: "success",
        CANCELLED: "gray",
        FAILED: "danger",
    };
    return <Badge color={palette[status]}>{status}</Badge>;
};

const EInvoiceList: React.FC = () => {
    const { formatDate } = useDateFormatter();
    const { token } = useSelector((state: RootState) => state.auth);
    const [rows, setRows] = useState<EInvoiceRow[]>([]);
    const [statusFilter, setStatusFilter] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const limit = 20;

    const fetchRows = async () => {
        try {
            setIsLoading(true);
            const params = new URLSearchParams({ page: String(page), limit: String(limit) });
            if (statusFilter) params.set("status", statusFilter);
            const resp = await axios.get(`${Constants.GET_E_INVOICES_URL}?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setRows(resp.data?.data?.eInvoices ?? []);
            setTotal(resp.data?.data?.pagination?.total ?? 0);
            setTotalPages(resp.data?.data?.pagination?.totalPages ?? 1);
        } catch (err) {
            console.error("Failed to fetch e-invoices:", err);
            toast.error("Failed to fetch e-invoices");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchRows();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, page]);

    const handleCancel = async (row: EInvoiceRow) => {
        if (row.status !== "GENERATED") {
            toast.error("Only GENERATED records can be cancelled");
            return;
        }
        const reason = window.prompt("Reason for cancellation?");
        if (reason === null) return;
        try {
            await axios.post(
                `${Constants.CANCEL_E_INVOICE_URL}/${row.id}/cancel`,
                { reason },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success("IRN cancelled");
            await fetchRows();
        } catch (err) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data as { message?: string } | undefined)?.message
                : null;
            toast.error(msg ?? "Failed to cancel IRN");
        }
    };

    const buildActions = (row: EInvoiceRow) => {
        const actions: Array<{ label: string; icon: React.ReactNode; onClick: (r: EInvoiceRow) => void }> = [];
        if (row.status === "GENERATED") {
            actions.push({
                label: "Cancel IRN",
                icon: <Ban size={14} />,
                onClick: (r) => handleCancel(r),
            });
        }
        return actions;
    };

    const headers = ["#", "Invoice", "IRN", "Status", "ACK No", "ACK Date", "Provider", "Created", "Actions"];

    return (
        <div className="space-y-4">
            <PageHeader title="E-Invoices (IRN)" />

            <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Status:</label>
                <select
                    value={statusFilter}
                    onChange={(e) => {
                        setStatusFilter(e.target.value);
                        setPage(1);
                    }}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                    {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
            </div>

            <Table headers={headers}>
                {!isLoading && rows.map((row, idx) => (
                    <TableRow
                        key={row.id}
                        index={(page - 1) * limit + idx + 1}
                        row={row}
                        columns={[
                            <span className="font-medium">{row.invoice?.invoiceNumber ?? truncate(row.invoice?.id ?? "", 8)}</span>,
                            <code className="text-xs bg-gray-100 px-2 py-0.5 rounded" title={row.irn ?? ""}>
                                {truncate(row.irn, 16)}
                            </code>,
                            <StatusBadge status={row.status} />,
                            row.ackNo ?? "—",
                            formatDate(row.ackDate),
                            <span className="text-xs uppercase tracking-wide text-gray-500">{row.provider}</span>,
                            formatDate(row.createdAt),
                        ]}
                        actions={buildActions(row)}
                    />
                ))}
                {!isLoading && rows.length === 0 && (
                    <NoRecords colSpan={headers.length} message="No e-invoice records yet. Generate an IRN from an invoice." />
                )}
                {isLoading && (
                    <tr>
                        <td className="text-center py-2" colSpan={headers.length}><LoaderSpinner /></td>
                    </tr>
                )}
            </Table>

            {total > 0 && totalPages > 1 && (
                <div className="flex justify-between items-center text-sm text-gray-600 pt-2">
                    <div>
                        Page {page} of {totalPages} ({total} records)
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page <= 1}
                            className="px-3 py-1 border rounded disabled:opacity-40"
                        >
                            Prev
                        </button>
                        <button
                            type="button"
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages}
                            className="px-3 py-1 border rounded disabled:opacity-40"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EInvoiceList;
