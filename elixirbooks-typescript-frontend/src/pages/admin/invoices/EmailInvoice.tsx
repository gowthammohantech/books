import QuillEditor from "@components/admin/QuillEditor";
import Constants from "@constants/api";
import { useCurrencyFormatter } from "@hooks/useCurrencyFormatter";
import { useCurrencies } from "@hooks/useCurrencies";
import useDateFormatter from "@hooks/useDateFormatter";
import type { InvoiceData } from "@models/invoice";
import type { RootState } from "@store/index";
import axios from "axios";
import { Send } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button } from "@components/ui";
import { resolvePublicDocumentLink } from "@utils/publicDocumentLink";
interface SMTPSettings {
    from: string;
    fromName: string;
    host: string;
    port: number;
    username: string;
}

interface EmailFormData {
    invoiceId: string;
    to: string;
    cc: string | null;
    subject: string;
    htmlContent: string;
}

const EmailInvoice: React.FC = () => {
    const { token, user } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector(
        (state: RootState) => state.systemSettings
    );
    const { invoiceId } = useParams<{ invoiceId: string }>();
    const [searchParams] = useSearchParams();
    const isReminder = searchParams.get("mode") === "reminder";
    const { formatDate } = useDateFormatter();
    const { locale } = useCurrencyFormatter();
    const { resolveCurrency } = useCurrencies();
    // Show the document's amount in the document's OWN currency (fallback: company default).
    const formatDocAmount = (amount: number, code?: string | null) =>
        `${resolveCurrency(code).symbol}${Number(amount).toLocaleString(locale, { maximumFractionDigits: 2 })}`;
    const [invoiceDetails, setInvoiceDetails] = useState<InvoiceData | null>(
        null
    );
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editorContent, setEditorContent] = useState("");
    const [formData, setFormData] = useState<EmailFormData>({
        invoiceId: invoiceId || "",
        to: "",
        cc: null,
        subject: "",
        htmlContent: "",
    });

    const [emailSettings, setEmailSettings] = useState<SMTPSettings>({
        from: "",
        fromName: "",
        host: "",
        port: 0,
        username: "",
    });

    // fetch email settings
    useEffect(() => {
        const fetchEmailSettings = async () => {
            try {
                const response = await axios.get(Constants.GET_EMAIL_SETTINGS_URL, {
                    params: { userId: user?.id },
                    headers: { Authorization: `Bearer ${token}` },
                });

                const data = response.data.data;
                if (data) {
                    if (data.smtp_status) {
                        setEmailSettings({
                            from: data.smtpFromEmail,
                            fromName: data.smtpFromName,
                            host: data.smtpHost,
                            port: data.smtpPort,
                            username: data.smtpUsername,
                        });
                    } else if (data.node_status) {
                        setEmailSettings({
                            from: data.nodeFromEmail,
                            fromName: data.nodeFromName,
                            host: data.nodeHost,
                            port: data.nodePort,
                            username: data.nodeUsername,
                        });
                    } else if (data.resend_status) {
                        setEmailSettings({
                            from: data.resendFromEmail,
                            fromName: data.resendFromName,
                            host: "smtp.resend.com",
                            port: 465,
                            username: "resend",
                        });
                    }
                }
            } catch (error) {
                console.error("Error fetching email settings:", error);
            }
        };

        fetchEmailSettings();
    }, [token, user]);

    // fetch invoice details
    useEffect(() => {
        const fetchInvoiceDetails = async () => {
            try {
                const response = await axios.get(
                    `${Constants.FETCH_INVOICE_FOR_EDIT_URL}/${invoiceId}`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    }
                );
                const responseData = response.data.data;
                if (responseData) {
                    setInvoiceDetails(responseData);
                }
            } catch (error) {
                console.error("Error fetching invoice details:", error);
            }
        };

        if (invoiceId && token) {
            fetchInvoiceDetails();
        }
    }, [invoiceId, token]);

    // Prefill subject + body ONCE when the invoice arrives. Prefer the active
    // "Invoice Generated" email template (merge fields resolved server-side);
    // fall back to a built-in default when no template is active. The ref guard
    // ensures we don't clobber the user's edits on subsequent renders.
    const prefilled = useRef(false);
    useEffect(() => {
        if (!invoiceDetails || prefilled.current) return;
        let cancelled = false;

        // viewInvoiceLink is null when the public link couldn't be resolved
        // (see resolvePublicDocumentLink) — the body must never embed a
        // token-less/admin URL, so the link sentence/button are omitted.
        const buildFallback = (viewInvoiceLink: string | null) => {
            const customerName = invoiceDetails.billTo?.name ?? "Customer";
            const invoiceNo = invoiceDetails.invoiceNumber ?? "";
            const invoiceDate = formatDate(invoiceDetails.invoiceDate);
            const dueDate = invoiceDetails.dueDate ? formatDate(invoiceDetails.dueDate) : "";
            const totalAmount = formatDocAmount(invoiceDetails.TotalAmount ?? 0, invoiceDetails.currencyCode);
            const companyName = systemSettings?.company.companyName ?? "";
            const linkSentence = viewInvoiceLink
                ? `<p style="font-family:Arial,sans-serif;font-size:16px;color:#333;line-height:1.5;margin:0 0 12px 0">You can view, print, and download it as a PDF from the link below.</p>`
                : "";
            const linkButton = viewInvoiceLink
                ? `<p style="text-align:center;margin:0 0 12px 0"><a href="${viewInvoiceLink}" style="display:inline-block;padding:10px 20px;background-color:#4191f2;color:#fff;text-decoration:none;border-radius:4px;font-family:Arial,sans-serif;font-size:16px;">View Invoice</a></p>`
                : "";
            const html = `<h2 style="font-family:Arial,sans-serif;background-color:#4191f2;font-size:24px;text-align:center;padding:8px;color:#fff;margin:0 0 12px 0">Invoice #${invoiceNo}</h2><p style="font-family:Arial,sans-serif;font-size:16px;color:#333;line-height:1.5;margin:0 0 8px 0">Dear ${customerName},</p><p style="font-family:Arial,sans-serif;font-size:16px;color:#333;line-height:1.5;margin:0 0 8px 0">Thank you for your business. Your invoice <strong>#${invoiceNo}</strong> is ready.</p>${linkSentence}<p style="font-family:Arial,sans-serif;font-size:14px;text-transform:uppercase;color:#555;text-align:center;margin:0 0 4px 0">Amount Due</p><p style="font-family:Arial,sans-serif;font-size:32px;font-weight:700;color:#d61915;text-align:center;margin:0 0 12px 0">${totalAmount}</p>${linkButton}<p style="font-family:Arial,sans-serif;font-size:16px;color:#333;line-height:1.5;margin:0 0 4px 0"><strong>Invoice Date:</strong> ${invoiceDate}</p><p style="font-family:Arial,sans-serif;font-size:16px;color:#333;line-height:1.5;margin:0 0 12px 0"><strong>Due Date:</strong> ${dueDate}</p><p style="font-family:Arial,sans-serif;font-size:16px;color:#333;line-height:1.5;margin:0 0 8px 0">Regards,</p><p style="font-family:Arial,sans-serif;font-size:16px;color:#333;line-height:1.5;margin:0">The ${companyName} Team</p>`;
            return { subject: `Invoice #${invoiceNo} from ${emailSettings.fromName || systemSettings?.company.companyName || "Company"}`, html };
        };

        const buildReminderFallback = (viewInvoiceLink: string | null) => {
            const customerName = invoiceDetails.billTo?.name ?? "Customer";
            const invoiceNo = invoiceDetails.invoiceNumber ?? "";
            const dueDate = invoiceDetails.dueDate ? formatDate(invoiceDetails.dueDate) : "";
            const totalAmount = formatDocAmount(invoiceDetails.TotalAmount ?? 0, invoiceDetails.currencyCode);
            const companyName = systemSettings?.company.companyName ?? "";
            const linkButton = viewInvoiceLink
                ? `<p style="text-align:center;margin:0 0 12px 0"><a href="${viewInvoiceLink}" style="display:inline-block;padding:10px 20px;background-color:#4191f2;color:#fff;text-decoration:none;border-radius:4px;font-family:Arial,sans-serif;font-size:16px;">View &amp; Pay Invoice</a></p>`
                : "";
            const html = `<h2 style="font-family:Arial,sans-serif;background-color:#d61915;font-size:22px;text-align:center;padding:8px;color:#fff;margin:0 0 12px 0">Payment Reminder — Invoice #${invoiceNo}</h2><p style="font-family:Arial,sans-serif;font-size:16px;color:#333;line-height:1.5;margin:0 0 8px 0">Dear ${customerName},</p><p style="font-family:Arial,sans-serif;font-size:16px;color:#333;line-height:1.5;margin:0 0 8px 0">This is a friendly reminder that invoice <strong>#${invoiceNo}</strong>${dueDate ? ` was due on <strong>${dueDate}</strong>` : ""} and remains outstanding.</p><p style="font-family:Arial,sans-serif;font-size:14px;text-transform:uppercase;color:#555;text-align:center;margin:0 0 4px 0">Amount Due</p><p style="font-family:Arial,sans-serif;font-size:32px;font-weight:700;color:#d61915;text-align:center;margin:0 0 12px 0">${totalAmount}</p>${linkButton}<p style="font-family:Arial,sans-serif;font-size:16px;color:#333;line-height:1.5;margin:0 0 8px 0">If you have already made this payment, please disregard this message. Otherwise, we would appreciate prompt settlement.</p><p style="font-family:Arial,sans-serif;font-size:16px;color:#333;line-height:1.5;margin:0 0 8px 0">Regards,</p><p style="font-family:Arial,sans-serif;font-size:16px;color:#333;line-height:1.5;margin:0">The ${companyName} Team</p>`;
            return { subject: `Payment reminder: Invoice #${invoiceNo}`, html };
        };

        // Fallback/reminder bodies must link the PUBLIC share page, never the
        // admin app (customers have no login). Enable the public link
        // server-side (idempotent — same mechanism as EditInvoice.tsx's
        // "PUBLIC LINK" section and the email-template resolver) and resolve
        // its token to a share URL, once per prefill pass.
        const getViewInvoiceLink = () => resolvePublicDocumentLink({
            adminBaseUrl: Constants.ENABLE_PUBLIC_LINK_URL,
            routeSegment: "invoice",
            documentId: invoiceDetails.id,
            authToken: token,
            publicBaseUrl: systemSettings?.company.publicBaseUrl,
            existingToken: invoiceDetails.publicViewToken,
            existingEnabled: invoiceDetails.publicViewEnabled,
        });

        (async () => {
            let subject = "";
            let html = "";
            // Reminder mode uses a dedicated reminder body and skips the generic
            // "invoice generated" template resolution.
            if (isReminder) {
                const viewInvoiceLink = await getViewInvoiceLink();
                if (cancelled) return;
                if (!viewInvoiceLink) {
                    toast.error("Couldn't generate the public invoice link. Add the link manually before sending.");
                }
                const rb = buildReminderFallback(viewInvoiceLink);
                subject = rb.subject;
                html = rb.html;
            } else {
                try {
                    const res = await axios.get(
                        `${Constants.RESOLVE_EMAIL_TEMPLATE_URL}/invoice/${invoiceDetails.id}`,
                        { headers: { Authorization: `Bearer ${token}` } },
                    );
                    const d = res.data?.data;
                    if (d?.hasTemplate) {
                        subject = d.subject;
                        html = d.html;
                    }
                } catch {
                    /* fall through to built-in default */
                }
            }
            if (!html) {
                const viewInvoiceLink = await getViewInvoiceLink();
                if (cancelled) return;
                if (!viewInvoiceLink) {
                    toast.error("Couldn't generate the public invoice link. Add the link manually before sending.");
                }
                const fb = buildFallback(viewInvoiceLink);
                subject = fb.subject;
                html = fb.html;
            }
            if (cancelled) return;
            prefilled.current = true;
            setEditorContent(html);
            setFormData((prev) => ({
                ...prev,
                to: invoiceDetails.billTo?.email ?? "",
                subject,
                htmlContent: html,
            }));
        })();

        return () => { cancelled = true; };
    }, [invoiceDetails, emailSettings, token, formatDocAmount, formatDate, systemSettings, isReminder]);

    // keep formData.htmlContent in sync with editor
    useEffect(() => {
        setFormData((prev) => ({ ...prev, htmlContent: editorContent }));
    }, [editorContent]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        try {
            setIsSubmitting(true);
            const response = await axios.post(
                Constants.SEND_INVOICE_MAIL_URL,
                formData,
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );
            toast.success(response.data.message);
        } catch (error) {
            toast.error("Something went wrong");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <PageHeader
                title={`${isReminder ? "Send Reminder to " : "Email To "}${invoiceDetails?.billTo?.name || "Customer"}`}
            >
                <Button type="button" variant="white">
                    Cancel
                </Button>
                <Button
                    type="submit"
                    form="email-invoice-form"
                    variant="primary"
                    isLoading={isSubmitting}
                    disabled={isSubmitting}
                    leftIcon={<Send size={16} />}
                >
                    {isSubmitting ? "Sending..." : "Send"}
                </Button>
            </PageHeader>
            <div className="space-y-4">
                <form id="email-invoice-form" onSubmit={handleSubmit}>
                    {/* card */}
                    <div className="border border-border rounded-card bg-white shadow-card">
                        {/* from */}
                        <div className="p-4 flex items-center gap-4">
                            <label className="w-32 text-heading font-medium">From</label>
                            <input
                                type="email"
                                value={emailSettings.from}
                                disabled
                                className="flex-1 border border-border rounded-control p-2 bg-surface text-body"
                            />
                        </div>

                        {/* to */}
                        <div className="p-4 flex items-center gap-4">
                            <label className="w-32 text-heading font-medium">To</label>
                            <input
                                type="email"
                                value={invoiceDetails?.billTo?.email || ""}
                                placeholder="customer@email.com"
                                disabled
                                className="flex-1 border border-border rounded-control p-2 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600"
                            />
                        </div>

                        {/* subject */}
                        <div className="p-4 flex items-center gap-4">
                            <label className="w-32 text-heading font-medium">Subject</label>
                            <input
                                type="text"
                                value={formData.subject}
                                onChange={(e) =>
                                    setFormData({ ...formData, subject: e.target.value })
                                }
                                className="flex-1 border border-border rounded-control p-2 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600"
                            />
                        </div>

                        {/* editor */}
                        <div className="p-4">
                            <QuillEditor value={formData.htmlContent} onChange={(html) => {
                                setEditorContent(html);
                                setFormData((prev) => ({ ...prev, htmlContent: html }));
                            }} />
                        </div>
                    </div>

                </form>
            </div>
        </>
    );
};

export default EmailInvoice;
