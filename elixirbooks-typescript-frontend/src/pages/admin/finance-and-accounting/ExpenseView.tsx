import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "axios";
import type { RootState } from "@store/index";
import Constants from "@constants/api";
import { hasPermission } from "@utils/hasPermission";
import useDateFormatter from "@hooks/useDateFormatter";
import { useCurrencies } from "@hooks/useCurrencies";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import InvoiceStatusBadge from "@components/admin/InvoiceStatusBadge";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button, Card } from "@components/ui";
import ExpenseFormModal from "./ExpenseFormModal";

// Shape returned by GET /api/admin/expenses/:id (expenseController.getExpenseById).
// Envelope: response.data.data
interface ExpenseDetail {
    id: string;
    expenseId: string | null;
    referenceNo: string | null;
    amount: number | string | null;
    currencyCode: string | null;
    expenseDate: string | null;
    sourceType: string | null;
    expenseCategory: { id: string; name: string | null } | null;
    paymentMode: { id: string; name: string | null } | null;
    bank: { id: string; bankName: string | null; accountNumber: string | null } | null;
    supplier: { id: string; name: string | null } | null;
    paymentStatus: string;
    description: string | null;
    attachment: string | null;
    createdBy: { id: string; name: string | null } | null;
    customFields?: Record<string, unknown>;
    createdAt?: string;
    updatedAt?: string;
}

const dash = (v: unknown) =>
    v === null || v === undefined || String(v).trim() === "" ? "—" : String(v);

const isImage = (url: string) => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
const isPdf = (url: string) => /\.pdf(\?|$)/i.test(url);

const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-body">{label}</div>
        <div className="text-sm text-heading">{children}</div>
    </div>
);

const ExpenseView: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const { formatDate } = useDateFormatter();
    const { formatMoney } = useCurrencies();

    const [expense, setExpense] = useState<ExpenseDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);

    const fetchExpense = useCallback(async (expenseId: string) => {
        try {
            setIsLoading(true);
            setNotFound(false);
            const response = await axios.get(`${Constants.GET_EXPENSE_URL}/${expenseId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (response.data?.success && response.data?.data) {
                setExpense(response.data.data);
            } else {
                setNotFound(true);
            }
        } catch (error) {
            setNotFound(true);
        } finally {
            setIsLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (id) fetchExpense(id);
    }, [id, fetchExpense]);

    const handleEditSuccess = () => {
        setIsEditOpen(false);
        if (id) fetchExpense(id);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <LoaderSpinner />
            </div>
        );
    }

    if (notFound || !expense) {
        return (
            <>
                <PageHeader title="Expense">
                    <Button variant="secondary" onClick={() => navigate("/admin/expenses")}>
                        Back
                    </Button>
                </PageHeader>
                <Card>
                    <div className="text-center text-body py-10 font-medium">
                        Expense not found.
                    </div>
                </Card>
            </>
        );
    }

    const titleLabel = expense.expenseId || expense.referenceNo || expense.id;
    const dateFmt = systemSettings?.dateFormat.format || "d-m-Y";
    const attachment = expense.attachment;

    return (
        <>
            <PageHeader title={`Expense ${titleLabel}`}>
                {hasPermission(permissions, "expenses", "edit") && (
                    <Button onClick={() => setIsEditOpen(true)}>Edit</Button>
                )}
                <Button variant="secondary" onClick={() => navigate("/admin/expenses")}>
                    Back
                </Button>
            </PageHeader>

            <div className="space-y-4">
                {/* Details */}
                <Card title="Expense Details">
                    <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-body">
                                Amount
                            </div>
                            <div className="text-3xl font-bold text-heading">
                                {formatMoney(Number(expense.amount ?? 0), expense.currencyCode ?? undefined)}
                            </div>
                        </div>
                        <div>
                            <InvoiceStatusBadge status={expense.paymentStatus} />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        <DetailRow label="Expense ID">{dash(expense.expenseId)}</DetailRow>
                        <DetailRow label="Reference No">{dash(expense.referenceNo)}</DetailRow>
                        <DetailRow label="Date">
                            {expense.expenseDate ? formatDate(expense.expenseDate, dateFmt) : "—"}
                        </DetailRow>
                        <DetailRow label="Category">{dash(expense.expenseCategory?.name)}</DetailRow>
                        <DetailRow label="Payment Mode">
                            {expense.paymentMode?.name ? (
                                <>
                                    {expense.paymentMode.name}
                                    {expense.bank && (
                                        <div className="text-xs text-body mt-0.5">
                                            {dash(expense.bank.bankName)}
                                            {expense.bank.accountNumber
                                                ? ` · ${expense.bank.accountNumber}`
                                                : ""}
                                        </div>
                                    )}
                                </>
                            ) : (
                                "—"
                            )}
                        </DetailRow>
                        <DetailRow label="Supplier">{dash(expense.supplier?.name)}</DetailRow>
                        <DetailRow label="Source Type">{dash(expense.sourceType)}</DetailRow>
                        <DetailRow label="Created By">{dash(expense.createdBy?.name)}</DetailRow>
                    </div>

                    <div className="mt-6 space-y-1">
                        <div className="text-xs font-semibold uppercase tracking-wide text-body">
                            Description
                        </div>
                        <div className="text-sm text-heading whitespace-pre-wrap">
                            {dash(expense.description)}
                        </div>
                    </div>
                </Card>

                {/* Attachment */}
                <Card title="Attachment">
                    {!attachment ? (
                        <div className="text-sm text-body">No attachment</div>
                    ) : isImage(attachment) ? (
                        <div className="space-y-3">
                            <img
                                src={attachment}
                                alt="Expense attachment"
                                className="max-w-full sm:max-w-md rounded-control border border-border"
                            />
                            <a
                                href={attachment}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block text-sm font-medium text-indigo-600 hover:underline"
                            >
                                Open in new tab / Download
                            </a>
                        </div>
                    ) : isPdf(attachment) ? (
                        <div className="space-y-3">
                            <iframe
                                src={attachment}
                                title="Expense attachment"
                                className="w-full h-[600px] rounded-control border border-border"
                            />
                            <a
                                href={attachment}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block text-sm font-medium text-indigo-600 hover:underline"
                            >
                                Download
                            </a>
                        </div>
                    ) : (
                        <Button
                            variant="secondary"
                            onClick={() => window.open(attachment, "_blank")}
                        >
                            Download / Open attachment
                        </Button>
                    )}
                </Card>
            </div>

            {/* Edit modal hosted on this page, pre-filled with the fetched expense */}
            {isEditOpen && (
                <ExpenseFormModal
                    isOpen={isEditOpen}
                    onClose={() => setIsEditOpen(false)}
                    onSuccess={handleEditSuccess}
                    editItem={expense}
                />
            )}
        </>
    );
};

export default ExpenseView;
