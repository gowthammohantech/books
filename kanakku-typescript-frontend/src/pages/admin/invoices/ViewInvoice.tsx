import { useEffect, useState, useCallback } from "react";
import InvoiceTemplateA from "./InvoiceTemplateA";
import { useNavigate, useParams } from "react-router-dom";
import Constants from "@constants/api";
import axios from "axios";
import Cookies from "js-cookie";
import type { InvoiceData } from "@models/invoice";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import InvoiceTemplateB from "./InvoiceTemplateB";
import InvoiceTemplateA5Landscape from "./InvoiceTemplateA5Landscape";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import InvoiceActionToolbar from "@components/admin/invoice/InvoiceActionToolbar";
import { isInvoiceEditable } from "@utils/invoiceStatus";
import PaymentHistoryPanel from "@components/admin/invoice/PaymentHistoryPanel";
import InvoiceActivityTimeline from "@components/admin/invoice/InvoiceActivityTimeline";
import { useInvoicePayments } from "@hooks/useInvoicePayments";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button } from "@components/ui";
import { useLineItemCustomFields } from "@hooks/useLineItemCustomFields";
import type { LineCustomField } from "@lib/lineCustomFields";

const ViewInvoice: React.FC = () => {
    const { id: invoiceId } = useParams<{ id: string }>();
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { token: reduxToken } = useSelector((state: RootState) => state.auth);
    const [isFetching, setIsFetching] = useState(true);
    const [invoiceDetails, setInvoiceDetails] = useState<InvoiceData | null>(null);
    const navigate = useNavigate();

    // Live payment summary so the toolbar + templates show up-to-date paid/remaining.
    const { summary, refetch: refetchPayments } = useInvoicePayments(invoiceId ?? "");
    const { fields: lineFields } = useLineItemCustomFields(reduxToken, "invoices");

    const fetchInvoiceDetails = useCallback(async () => {
        if (!invoiceId) return;
        // Use Redux token; fall back to cookie for page-refresh cases where
        // the store may not yet be hydrated (FETCH_INVOICE_DETAILS route IS protected).
        const token = reduxToken || Cookies.get("authToken") || "";
        try {
            setIsFetching(true);
            const response = await axios.get(`${Constants.FETCH_INVOICE_DETAILS_NO_AUTH_URL}/${invoiceId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (response.data.data) {
                setInvoiceDetails(response.data.data);
            }
        } catch (error) {
            console.error("Error fetching invoice details:", error);
        } finally {
            setIsFetching(false);
        }
    }, [invoiceId, reduxToken]);

    const handleChanged = useCallback(() => {
        fetchInvoiceDetails();
        refetchPayments();
    }, [fetchInvoiceDetails, refetchPayments]);

    useEffect(() => {
        fetchInvoiceDetails();
    }, [fetchInvoiceDetails]);

    let template = Number(systemSettings?.invoiceTemplate.default_invoice_template || 1);
    if (template > 3) template = 1;

    if (isFetching) {
        return (
            <div className="p-6 space-y-4 flex items-center justify-center h-screen">
                <LoaderSpinner />
            </div>
        );
    }

    const templates: Record<number, React.FC<{ invoiceData: any; lineFields?: LineCustomField[] }>> = {
        1: InvoiceTemplateA,
        2: InvoiceTemplateB,
        3: InvoiceTemplateA5Landscape,
    };
    const SelectedTemplate = templates[template] || InvoiceTemplateA;

    // Augment invoiceData with live paid amount so template Amount Paid / Balance Due lines work.
    const invoiceDataWithPaid = invoiceDetails
        ? { ...invoiceDetails, totalPaid: summary.paid }
        : null;

    return (
        <div className="px-4">
            <PageHeader
                title={
                    invoiceDetails?.invoiceNumber
                        ? `Invoice ${invoiceDetails.invoiceNumber}`
                        : "Invoice"
                }
            >
                {invoiceDetails && isInvoiceEditable(invoiceDetails.status) && (
                    <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => navigate(`/admin/invoices/edit-invoice/${invoiceDetails.id}`)}
                    >
                        Edit Invoice
                    </Button>
                )}
                <Button
                    type="button"
                    variant="white"
                    size="sm"
                    onClick={() => navigate("/admin/invoices")}
                >
                    Back
                </Button>
            </PageHeader>

            {/* Action / summary bar — the toolbar renders its own sticky full-width
                bar (no extra card wrapper, which double-bordered + broke its -mx-4). */}
            {invoiceDetails && (
                <InvoiceActionToolbar
                    invoiceId={invoiceDetails.id}
                    status={invoiceDetails.status}
                    invoiceType={(invoiceDetails as any).invoiceType}
                    convertedAt={(invoiceDetails as any).convertedAt}
                    invoiceNumber={invoiceDetails.invoiceNumber}
                    dueDate={invoiceDetails.dueDate}
                    totalAmount={Number(invoiceDetails.TotalAmount ?? 0)}
                    totalPaid={summary.paid}
                    printData={invoiceDataWithPaid as any}
                    onChanged={handleChanged}
                />
            )}

            <div>
                {invoiceDataWithPaid ? (
                    <SelectedTemplate invoiceData={invoiceDataWithPaid} lineFields={lineFields} />
                ) : (
                    <p>Loading invoice…</p>
                )}
            </div>

            {invoiceId && (
                <PaymentHistoryPanel invoiceId={invoiceId} onChanged={handleChanged} />
            )}

            {invoiceId && (
                <InvoiceActivityTimeline invoiceId={invoiceId} />
            )}
        </div>
    );
};

export default ViewInvoice;
