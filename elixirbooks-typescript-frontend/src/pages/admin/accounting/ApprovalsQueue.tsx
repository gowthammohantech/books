import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle, XCircle } from "lucide-react";

import type { RootState } from "@store/index";
import Constants from "@constants/api";
import Modal from "@components/admin/Modal";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import NoRecords from "@components/admin/NoRecords";
import { Button } from "@components/ui";
import useDateFormatter from "@hooks/useDateFormatter";
import { PageHeader } from "@/context/PageHeaderContext";

// ---- types ------------------------------------------------------------------

interface PendingDoc {
    id: string;
    invoiceNumber?: string;
    expenseNumber?: string;
    purchaseNumber?: string;
    referenceNumber?: string;
    amount?: number | string;
    TotalAmount?: number | string;
    date?: string;
}

interface PendingApprovals {
    invoices: PendingDoc[];
    expenses: PendingDoc[];
    purchases: PendingDoc[];
}

type DocType = "invoices" | "expenses" | "purchases";

// ---- helpers ----------------------------------------------------------------

const docLabel = (type: DocType) => {
    if (type === "invoices") return "Invoice";
    if (type === "expenses") return "Expense";
    return "Purchase";
};

const baseUrl = (type: DocType) => {
    if (type === "invoices") return `${Constants.API_BASE_URL}/admin/invoices`;
    if (type === "expenses") return `${Constants.API_BASE_URL}/admin/expenses`;
    return `${Constants.API_BASE_URL}/admin/purchases`;
};

const getDocNumber = (doc: PendingDoc): string =>
    doc.invoiceNumber ?? doc.expenseNumber ?? doc.purchaseNumber ?? doc.referenceNumber ?? doc.id;

const getDocAmount = (doc: PendingDoc): string => {
    const raw = doc.amount ?? doc.TotalAmount;
    if (raw == null) return "—";
    return Number(raw).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ---- section table ----------------------------------------------------------

interface SectionTableProps {
    type: DocType;
    docs: PendingDoc[];
    onApprove: (type: DocType, doc: PendingDoc) => void;
    onReject: (type: DocType, doc: PendingDoc) => void;
    actionLoadingId: string | null;
    formatDate: (date: Date | string | number | null | undefined) => string;
}

const SectionTable = ({ type, docs, onApprove, onReject, actionLoadingId, formatDate }: SectionTableProps) => {
    const label = docLabel(type);

    return (
        <div className="bg-white rounded-lg border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-700">
                    {label}s
                    <span className="ml-2 text-xs font-normal text-gray-400">({docs.length} pending)</span>
                </h2>
            </div>
            <div className="overflow-x-auto border border-border rounded-control">
                <table className="w-full text-sm border-collapse">
                    <thead className="bg-gray-100 text-xs uppercase text-body">
                        <tr>
                            <th className="px-4 py-3 text-left border-b border-border">#</th>
                            <th className="px-4 py-3 text-left border-b border-border">{label} No.</th>
                            <th className="px-4 py-3 text-left border-b border-border">Date</th>
                            <th className="px-4 py-3 text-right border-b border-border">Amount</th>
                            <th className="px-4 py-3 text-center border-b border-border">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {docs.length === 0 ? (
                            <NoRecords colSpan={5} message={`No pending ${label.toLowerCase()} approvals.`} />
                        ) : (
                            docs.map((doc, idx) => {
                                const isActing = actionLoadingId === doc.id;
                                return (
                                    <tr key={doc.id} className="border-b border-border hover:bg-gray-50">
                                        <td className="px-4 py-3 text-gray-500">{idx + 1}</td>
                                        <td className="px-4 py-3 text-indigo-600 font-medium">{getDocNumber(doc)}</td>
                                        <td className="px-4 py-3 text-gray-700">{formatDate(doc.date)}</td>
                                        <td className="px-4 py-3 text-right text-gray-800">{getDocAmount(doc)}</td>
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <Button
                                                    variant="success"
                                                    size="sm"
                                                    disabled={isActing}
                                                    onClick={() => onApprove(type, doc)}
                                                    leftIcon={<CheckCircle size={12} />}
                                                >
                                                    Approve
                                                </Button>
                                                <Button
                                                    variant="danger"
                                                    size="sm"
                                                    disabled={isActing}
                                                    onClick={() => onReject(type, doc)}
                                                    leftIcon={<XCircle size={12} />}
                                                >
                                                    Reject
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// ---- main component ---------------------------------------------------------

const ApprovalsQueue: React.FC = () => {
    const { formatDate } = useDateFormatter();
    const { token } = useSelector((state: RootState) => state.auth);
    const authHeaders = { Authorization: `Bearer ${token}` };

    const [approvals, setApprovals] = useState<PendingApprovals>({ invoices: [], expenses: [], purchases: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

    // Reject modal
    const [rejectModal, setRejectModal] = useState<{ open: boolean; type: DocType; doc: PendingDoc | null }>({
        open: false,
        type: "invoices",
        doc: null,
    });
    const [rejectReason, setRejectReason] = useState("");
    const [isRejecting, setIsRejecting] = useState(false);

    const fetchApprovals = async () => {
        try {
            setIsLoading(true);
            const resp = await axios.get(Constants.FETCH_PENDING_APPROVALS_URL, { headers: authHeaders });
            const data = resp.data?.data ?? {};
            setApprovals({
                invoices: data.invoices ?? [],
                expenses: data.expenses ?? [],
                purchases: data.purchases ?? [],
            });
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
            toast.error(msg ?? "Failed to load pending approvals.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchApprovals();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleApprove = async (type: DocType, doc: PendingDoc) => {
        try {
            setActionLoadingId(doc.id);
            await axios.post(`${baseUrl(type)}/${doc.id}/approve`, {}, { headers: authHeaders });
            toast.success(`${docLabel(type)} approved successfully.`);
            await fetchApprovals();
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
            toast.error(msg ?? `Failed to approve ${docLabel(type).toLowerCase()}.`);
        } finally {
            setActionLoadingId(null);
        }
    };

    const openRejectModal = (type: DocType, doc: PendingDoc) => {
        setRejectModal({ open: true, type, doc });
        setRejectReason("");
    };

    const closeRejectModal = () => {
        setRejectModal((prev) => ({ ...prev, open: false, doc: null }));
        setRejectReason("");
    };

    const handleRejectConfirm = async () => {
        if (!rejectModal.doc) return;
        const { type, doc } = rejectModal;
        try {
            setIsRejecting(true);
            await axios.post(`${baseUrl(type)}/${doc.id}/reject`, { reason: rejectReason }, { headers: authHeaders });
            toast.success(`${docLabel(type)} rejected.`);
            closeRejectModal();
            await fetchApprovals();
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
            toast.error(msg ?? `Failed to reject ${docLabel(type).toLowerCase()}.`);
        } finally {
            setIsRejecting(false);
        }
    };

    const totalPending = approvals.invoices.length + approvals.expenses.length + approvals.purchases.length;

    return (
        <div className="space-y-4">
            <PageHeader
                title={
                    <span className="flex flex-col">
                        <span>Approvals Queue</span>
                        {!isLoading && (
                            <span className="text-xs font-normal text-gray-500">
                                {totalPending === 0
                                    ? "No pending approvals."
                                    : `${totalPending} document${totalPending !== 1 ? "s" : ""} awaiting approval`}
                            </span>
                        )}
                    </span>
                }
            />

            {isLoading ? (
                <div className="flex justify-center py-12">
                    <LoaderSpinner />
                </div>
            ) : (
                <div className="space-y-4">
                    {(["invoices", "expenses", "purchases"] as DocType[]).map((type) => (
                        <SectionTable
                            key={type}
                            type={type}
                            docs={approvals[type]}
                            onApprove={handleApprove}
                            onReject={openRejectModal}
                            actionLoadingId={actionLoadingId}
                            formatDate={formatDate}
                        />
                    ))}
                </div>
            )}

            {/* Reject Modal */}
            <Modal
                isOpen={rejectModal.open}
                onClose={closeRejectModal}
                title={`Reject ${rejectModal.doc ? docLabel(rejectModal.type) : ""}`}
                size="md"
            >
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                        Optionally provide a reason for rejection. This will be recorded against the document.
                    </p>
                    <div>
                        <label htmlFor="rejectReason" className="block text-sm font-medium text-gray-700 mb-1">
                            Reason
                        </label>
                        <textarea
                            id="rejectReason"
                            rows={4}
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Enter rejection reason (optional)"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-950 focus:outline-none focus:ring-2 focus:ring-purple-600 resize-none"
                        />
                    </div>
                    <div className="flex justify-end gap-3 pt-1">
                        <Button
                            variant="white"
                            onClick={closeRejectModal}
                            disabled={isRejecting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            onClick={handleRejectConfirm}
                            disabled={isRejecting}
                        >
                            {isRejecting ? (
                                <>
                                    <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                                    Rejecting...
                                </>
                            ) : (
                                <>
                                    <XCircle size={14} />
                                    Confirm Reject
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ApprovalsQueue;
