import Constants from "@constants/api";
import type { InvoiceData } from "@models/invoice";
import type { InvoicePaymentDetails } from "@models/invoice-payment";
import type { RootState } from "@store/index";
import Cookies from "js-cookie";
import { hasPermission } from "@utils/hasPermission";
import { deriveInvoiceDisplayStatus, DISPLAY_STATUS_META } from "@utils/invoiceStatus";
import { useCurrencies } from "@hooks/useCurrencies";
import { useLineItemCustomFields } from "@hooks/useLineItemCustomFields";
import type { LineCustomField } from "@lib/lineCustomFields";
import axios from "axios";
import {
    BadgeDollarSignIcon,
    BellIcon,
    CheckCircle2,
    ChevronDown,
    CirclePlusIcon,
    CopyIcon,
    FileMinus2,
    Landmark,
    MailIcon,
    RefreshCwIcon,
    Send,
    Trash2,
    Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { toast } from "sonner";
import InvoiceTemplateA from "@pages/admin/invoices/InvoiceTemplateA";
import InvoiceTemplateB from "@pages/admin/invoices/InvoiceTemplateB";
import InvoiceTemplateA5Landscape from "@pages/admin/invoices/InvoiceTemplateA5Landscape";
import InvoicePaymentModal from "@pages/admin/invoices/InvoicePaymentModal";
import AddBankTransactionModal from "./AddBankTransactionModal";
import InvoiceStatusBadge from "@components/admin/InvoiceStatusBadge";
import PrintMenu from "@components/print/PrintMenu";
import { Button } from "@components/ui";

interface InvoiceActionToolbarProps {
    invoiceId: string;
    status: string;
    invoiceType?: "INVOICE" | "PROFORMA";
    convertedAt?: string | null;
    invoiceNumber?: string;
    dueDate?: string | Date | null;
    totalAmount?: number | null;
    totalPaid?: number | null;
    /** Pre-loaded details used for the PDF/print template. Edit screen omits it (fetched on demand). */
    printData?: InvoiceData | null;
    /** The form Save/Update button (Edit screen, drafts only) or an Edit button (View screen). */
    primary?: React.ReactNode;
    /** Called after any action that mutates the invoice, so the host can refresh. */
    onChanged?: () => void;
}

// --- small dropdown (closes on outside click / item click) -----------------
const Dropdown: React.FC<{ label: string; icon: React.ReactNode; children: React.ReactNode }> = ({
    label,
    icon,
    children,
}) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);
    return (
        <div className="relative" ref={ref}>
            <Button
                type="button"
                variant="white"
                size="sm"
                onClick={() => setOpen((o) => !o)}
                leftIcon={icon}
                rightIcon={<ChevronDown size={14} />}
            >
                {label}
            </Button>
            {open && (
                <div
                    className="absolute z-30 mt-1 min-w-[210px] rounded-card border border-border bg-white py-1 shadow-dropdown"
                    onClick={() => setOpen(false)}
                >
                    {children}
                </div>
            )}
        </div>
    );
};

const MenuItem: React.FC<{ onClick: () => void; icon: React.ReactNode; children: React.ReactNode }> = ({
    onClick,
    icon,
    children,
}) => (
    <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClick}
        leftIcon={icon}
        className="w-full justify-start! font-normal! text-left"
    >
        {children}
    </Button>
);

const InvoiceActionToolbar: React.FC<InvoiceActionToolbarProps> = ({
    invoiceId,
    status,
    invoiceType = "INVOICE",
    convertedAt,
    invoiceNumber,
    dueDate,
    totalAmount,
    totalPaid,
    printData,
    primary,
    onChanged,
}) => {
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const { formatMoney } = useCurrencies();
    // Derive currency code from printData when available so summary amounts match the template.
    const currencyCode = (printData as any)?.currencyCode ?? undefined;
    const fmt = (n: number) => formatMoney(n, currencyCode);

    const canEdit = hasPermission(permissions, "invoices", "edit");
    const canCreate = hasPermission(permissions, "invoices", "create");
    const { fields: lineFields } = useLineItemCustomFields(token, "invoices");

    const [busy, setBusy] = useState<string | null>(null);
    const [paymentItem, setPaymentItem] = useState<InvoicePaymentDetails | null>(null);
    const [isPaymentOpen, setIsPaymentOpen] = useState(false);
    const [isBankTxnOpen, setIsBankTxnOpen] = useState(false);

    // --- PDF / print -------------------------------------------------------
    const [details, setDetails] = useState<InvoiceData | null>(printData ?? null);
    const wantPrintRef = useRef(false);
    const printRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (printData) setDetails(printData);
    }, [printData]);

    let templateNo = Number(systemSettings?.invoiceTemplate?.default_invoice_template || 1);
    if (templateNo > 3) templateNo = 1;
    const TEMPLATE_COMPONENTS: Record<number, React.FC<{ invoiceData: any; lineFields?: LineCustomField[] }>> = {
        1: InvoiceTemplateA,
        2: InvoiceTemplateB,
        3: InvoiceTemplateA5Landscape,
    };
    const SelectedTemplate = TEMPLATE_COMPONENTS[templateNo] ?? InvoiceTemplateA;

    // Template 3 is a fixed A5-landscape sheet; 1/2 keep the browser default.
    const PAGE_STYLES: Record<number, string> = {
        3: `@page { size: A5 landscape; margin: 5mm; } .page-break { page-break-before: always; }`,
    };
    const triggerPrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: invoiceNumber ? `Invoice-${invoiceNumber}` : "Invoice",
        pageStyle: PAGE_STYLES[templateNo]
            ?? `@page { size: auto; margin: 5mm 5mm 2mm 2mm; } @page:first { margin: 2mm; } .page-break { page-break-before: always; }`,
    });

    useEffect(() => {
        if (wantPrintRef.current && details) {
            wantPrintRef.current = false;
            setTimeout(() => triggerPrint(), 50);
        }
    }, [details, triggerPrint]);

    const handleSavePdf = async () => {
        if (details) {
            triggerPrint();
            return;
        }
        // Use Redux token; fall back to cookie for page-refresh cases where
        // the store may not yet be hydrated (FETCH_INVOICE_DETAILS route IS protected).
        const authToken = token || Cookies.get("authToken") || "";
        try {
            setBusy("pdf");
            const res = await axios.get(`${Constants.FETCH_INVOICE_DETAILS_NO_AUTH_URL}/${invoiceId}`, {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (res.data?.data) {
                wantPrintRef.current = true;
                setDetails(res.data.data);
            } else {
                toast.error("Could not load invoice for PDF");
            }
        } catch {
            toast.error("Could not load invoice for PDF");
        } finally {
            setBusy(null);
        }
    };

    // Surface the backend's actual error (message / error / validation errors[])
    // verbatim, mirroring InvoicePaymentModal, so e.g. a 409 reason is readable.
    const backendError = (e: any): string => {
        const data = e?.response?.data;
        return (
            data?.message ||
            data?.error ||
            (Array.isArray(data?.errors)
                ? data.errors.map((x: any) => x.msg || x.message).filter(Boolean).join(", ")
                : "")
        );
    };

    // --- status changes ----------------------------------------------------
    // Only display-only statuses (DRAFT/SENT/OVERDUE/UNPAID) may be set here.
    // PAID/PARTIALLY_PAID are server-derived and CANCELLED requires deleting the
    // invoice — the backend rejects those with 409, so the UI never offers them.
    const setStatus = async (newStatus: string, label: string) => {
        try {
            setBusy(newStatus);
            await axios.post(
                Constants.UPDATE_INVOICE_STATUS_URL,
                { invoiceId, status: newStatus },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success(label);
            onChanged?.();
        } catch (e: any) {
            toast.error(backendError(e) || "Failed to update status");
        } finally {
            setBusy(null);
        }
    };

    const handleMarkSent = async () => {
        try {
            setBusy("sent");
            await axios.post(
                `${Constants.MARK_INVOICE_SENT_URL}/${invoiceId}/mark-sent`,
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success("Invoice marked as sent");
            onChanged?.();
        } catch (e: any) {
            toast.error(e?.response?.data?.message || "Failed to mark as sent");
        } finally {
            setBusy(null);
        }
    };

    // Cancelling an invoice is done by deleting it (backend rejects a CANCELLED
    // status update with 409 and instructs to delete/void instead). Reuses the
    // same DELETE endpoint the invoice list already calls.
    const handleDelete = async () => {
        if (
            !window.confirm(
                "Delete this invoice? This permanently removes it and excludes it from receivables. This cannot be undone.",
            )
        )
            return;
        try {
            setBusy("DELETE");
            await axios.delete(`${Constants.DELETE_INVOICE_URL}/${invoiceId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            toast.success("Invoice deleted");
            navigate("/admin/invoices");
        } catch (e: any) {
            toast.error(backendError(e) || "Failed to delete invoice");
        } finally {
            setBusy(null);
        }
    };

    const handleMarkDraft = async () => {
        if (!window.confirm("Move this invoice back to Draft? It will become editable again.")) return;
        await setStatus("DRAFT", "Invoice moved to draft");
    };

    const handleConvert = async () => {
        if (!window.confirm("Convert this proforma to a final invoice?")) return;
        try {
            setBusy("convert");
            const res = await axios.post(
                `${Constants.CONVERT_PROFORMA_TO_INVOICE_URL}/${invoiceId}/convert-to-invoice`,
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            const newId = res.data?.data?.invoice?.id;
            toast.success("Proforma converted to invoice");
            if (newId) navigate(`/admin/invoices/edit-invoice/${newId}`);
            else onChanged?.();
        } catch {
            toast.error("Conversion failed");
        } finally {
            setBusy(null);
        }
    };

    // --- payment -----------------------------------------------------------
    const handleRecordPayment = async () => {
        try {
            setBusy("payment");
            const res = await axios.get(`${Constants.FETCH_INVOICE_PAYMENT_DETAILS_URL}/${invoiceId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.data?.data) {
                setPaymentItem(res.data.data);
                setIsPaymentOpen(true);
            }
        } catch {
            toast.error("Could not load payment details");
        } finally {
            setBusy(null);
        }
    };

    // --- navigation --------------------------------------------------------
    const goEmail = () => navigate(`/admin/invoices/email/${invoiceId}`);
    const goReminder = () => navigate(`/admin/invoices/email/${invoiceId}?mode=reminder`);
    const goDuplicate = () => navigate(`/admin/invoices/create-invoice?copyFromId=${invoiceId}`);
    const goNewInvoice = () => navigate(`/admin/invoices/create-invoice`);
    const goCreditNote = () => navigate(`/admin/credit-notes/new?invoiceId=${invoiceId}`);

    // --- status predicates -------------------------------------------------
    const s = (status || "").toUpperCase();
    const balanceDue = Number(totalAmount ?? 0) - Number(totalPaid ?? 0);
    const isConverted = !!convertedAt;
    const isCancelled = s === "CANCELLED";
    const isPaid = s === "PAID" || (Number(totalAmount ?? 0) > 0 && balanceDue <= 0);
    const isDraft = s === "DRAFT";
    const isOpen = !isDraft && !isPaid && !isCancelled; // SENT / PARTIALLY_PAID / legacy

    const hasPayments = Number(totalPaid ?? 0) > 0;
    const canRecordPayment = canEdit && isOpen;
    const canMarkSent = canEdit && isDraft && !isConverted;
    // Sent / Delayed / legacy unpaid (no payments yet) can be reverted to draft so
    // they become editable again. Partially or fully paid invoices cannot.
    const canMarkDraft = canEdit && !isConverted && !isDraft && !isCancelled && !isPaid && !hasPayments;
    const canDelete = canEdit && isOpen;
    const canConvert = invoiceType === "PROFORMA" && !isConverted;

    return (
        <div className="sticky top-0 z-20 -mx-4 px-4 py-3 mb-4 bg-white/95 backdrop-blur border-b border-border">
            <div className="flex flex-wrap items-center gap-2">
                {/* Status + primary (Save / Edit) */}
                <InvoiceStatusBadge
                    status={status}
                    dueDate={dueDate}
                    totalAmount={totalAmount}
                    totalPaid={totalPaid}
                />
                {primary}

                {/* Workflow actions */}
                {canRecordPayment && (
                    <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={handleRecordPayment}
                        disabled={busy === "payment"}
                        isLoading={busy === "payment"}
                        leftIcon={<BadgeDollarSignIcon size={15} />}
                    >
                        Record Payment
                    </Button>
                )}
                {canMarkSent && (
                    <Button
                        type="button"
                        variant="white"
                        size="sm"
                        onClick={handleMarkSent}
                        disabled={busy === "sent"}
                        isLoading={busy === "sent"}
                        leftIcon={<CheckCircle2 size={15} />}
                    >
                        Mark Sent
                    </Button>
                )}
                {canMarkDraft && (
                    <Button
                        type="button"
                        variant="white"
                        size="sm"
                        onClick={handleMarkDraft}
                        disabled={busy === "DRAFT"}
                        isLoading={busy === "DRAFT"}
                        leftIcon={<Undo2 size={15} />}
                    >
                        Mark Draft
                    </Button>
                )}
                {canConvert && (
                    <Button
                        type="button"
                        variant="white"
                        size="sm"
                        onClick={handleConvert}
                        disabled={busy === "convert"}
                        isLoading={busy === "convert"}
                        leftIcon={<RefreshCwIcon size={15} />}
                    >
                        Convert to Invoice
                    </Button>
                )}

                <span className="mx-1 h-5 w-px bg-border hidden sm:inline-block" />

                {/* Send group */}
                <Dropdown label="Send" icon={<Send size={15} />}>
                    <MenuItem onClick={goEmail} icon={<MailIcon size={15} />}>Send Email</MenuItem>
                    <MenuItem onClick={goReminder} icon={<BellIcon size={15} />}>Send Payment Reminder</MenuItem>
                </Dropdown>

                <PrintMenu
                    normalPrint={handleSavePdf}
                    docType="INVOICE"
                    data={details}
                    systemSettings={systemSettings}
                    documentTitle={invoiceNumber ? `Invoice-${invoiceNumber}` : "Invoice"}
                />

                {/* More group */}
                <Dropdown label="More" icon={<CirclePlusIcon size={15} />}>
                    {canCreate && (
                        <MenuItem onClick={goDuplicate} icon={<CopyIcon size={15} />}>Duplicate this invoice</MenuItem>
                    )}
                    <MenuItem onClick={goCreditNote} icon={<FileMinus2 size={15} />}>Add credit note</MenuItem>
                    <MenuItem onClick={() => setIsBankTxnOpen(true)} icon={<Landmark size={15} />}>Add bank transaction</MenuItem>
                    {canCreate && (
                        <MenuItem onClick={goNewInvoice} icon={<CirclePlusIcon size={15} />}>New invoice</MenuItem>
                    )}
                </Dropdown>

                {/* Delete — kept separate */}
                {canDelete && (
                    <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={handleDelete}
                        disabled={busy === "DELETE"}
                        isLoading={busy === "DELETE"}
                        leftIcon={<Trash2 size={15} />}
                        className="ml-auto"
                    >
                        Delete
                    </Button>
                )}
            </div>

            {/* Paid / Remaining summary strip — visible only when total is set */}
            {Number(totalAmount ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 px-1 text-sm">
                    {/* Status badge derived from live values */}
                    {(() => {
                        const ds = deriveInvoiceDisplayStatus({
                            status,
                            dueDate,
                            totalAmount,
                            totalPaid,
                        });
                        const meta = DISPLAY_STATUS_META[ds];
                        return (
                            <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-control text-xs font-semibold ${
                                    meta?.classes ?? 'bg-surface text-body'
                                }`}
                            >
                                {meta?.label ?? status}
                            </span>
                        );
                    })()}
                    <span className="text-body">
                        Total:{' '}
                        <span className="font-semibold text-heading">{fmt(Number(totalAmount ?? 0))}</span>
                    </span>
                    <span className="text-body">
                        Paid:{' '}
                        <span className="font-semibold text-success">{fmt(Number(totalPaid ?? 0))}</span>
                    </span>
                    <span className="text-body">
                        Remaining:{' '}
                        <span
                            className={`font-semibold ${
                                balanceDue <= 0 ? 'text-success' : 'text-danger'
                            }`}
                        >
                            {fmt(Math.max(0, balanceDue))}
                        </span>
                    </span>
                </div>
            )}

            {/* Off-screen printable template for Save PDF (kept rendered, not display:none). */}
            <div aria-hidden style={{ position: "fixed", left: "-100000px", top: 0, width: "1000px" }}>
                <div ref={printRef}>{details ? <SelectedTemplate invoiceData={details as any} lineFields={lineFields} /> : null}</div>
            </div>

            {/* Payment modal */}
            {paymentItem && (
                <InvoicePaymentModal
                    isOpen={isPaymentOpen}
                    onClose={() => setIsPaymentOpen(false)}
                    invoiceItem={paymentItem}
                    onSuccess={() => {
                        setIsPaymentOpen(false);
                        onChanged?.();
                    }}
                />
            )}

            {/* Bank transaction modal */}
            <AddBankTransactionModal
                isOpen={isBankTxnOpen}
                onClose={() => setIsBankTxnOpen(false)}
                defaultType="RECEIPT"
                defaultAmount={balanceDue > 0 ? balanceDue : null}
                defaultRemarks={invoiceNumber ? `Payment received for Invoice #${invoiceNumber}` : ""}
                defaultReferenceNo={invoiceNumber ? `INV-${invoiceNumber}` : ""}
            />
        </div>
    );
};

export default InvoiceActionToolbar;
