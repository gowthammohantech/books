import FullPageLoader from "@components/admin/FullPageLoader";
import QuillEditor from "@components/admin/QuillEditor";
import Constants from "@constants/api";
import { useCurrencyFormatter } from "@hooks/useCurrencyFormatter";
import { useCurrencies } from "@hooks/useCurrencies";
import useDateFormatter from "@hooks/useDateFormatter";
import type { RootState } from "@store/index";
import axios from "axios";
import { Loader2, Send, Settings } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/context/PageHeaderContext";
import { resolvePublicDocumentLink } from "@utils/publicDocumentLink";

interface SMTPSettings {
    from: string;
    fromName: string;
    host: string;
    port: number;
    username: string;
}

interface QuotationData {
    id: string;
    quotationId: string;
    quotationDate: string;
    TotalAmount: number;
    currencyCode?: string | null;
    billTo: {
        name: string;
        email: string;
        phone: string;
    };
}

interface EmailFormData {
    quotationId: string;
    to: string;
    cc: string | null;
    subject: string;
    htmlContent: string;
    status: string;
}

const EmailQuotation: React.FC = () => {
    const navigate = useNavigate();
    const { token, user } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { locale } = useCurrencyFormatter();
    const { resolveCurrency } = useCurrencies();
    const { formatDate } = useDateFormatter();
    // Show the document's amount in the document's OWN currency (fallback: company default).
    const formatDocAmount = (amount: number, code?: string | null) =>
        `${resolveCurrency(code).symbol}${Number(amount).toLocaleString(locale, { maximumFractionDigits: 2 })}`;

    const { id: quotationId } = useParams<{ id: string }>();
    const [quotationDetails, setQuotationDetails] = useState<QuotationData | null>(null);
    const [emailSettings, setEmailSettings] = useState<SMTPSettings>({
        from: "",
        fromName: "",
        host: "",
        port: 0,
        username: "",
    });

    const [isSMTPNotConfigured, setIsSMTPNotConfigured] = useState(false);
    const [isFetchingEmailSettings, setIsFetchingEmailSettings] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editorContent, setEditorContent] = useState("");
    const [formData, setFormData] = useState<EmailFormData>({
        quotationId: quotationId || "",
        to: "",
        cc: null,
        subject: "",
        htmlContent: "",
        status: "sent",
    });

    // fetch email settings
    useEffect(() => {
        const fetchEmailSettings = async () => {
            try {
                setIsFetchingEmailSettings(true);
                const response = await axios.get(Constants.GET_EMAIL_SETTINGS_URL, {
                    params: { userId: user?.id },
                    headers: { Authorization: `Bearer ${token}` },
                });

                const data = response.data.data;
                if (data) {
                    const settings = data.smtp_status
                        ? {
                            from: data.smtpFromEmail,
                            fromName: data.smtpFromName,
                            host: data.smtpHost,
                            port: data.smtpPort,
                            username: data.smtpUsername,
                        }
                        : data.node_status
                            ? {
                                from: data.nodeFromEmail,
                                fromName: data.nodeFromName,
                                host: data.nodeHost,
                                port: data.nodePort,
                                username: data.nodeUsername,
                            }
                            : data.resend_status
                                ? {
                                    from: data.resendFromEmail,
                                    fromName: data.resendFromName,
                                    host: "smtp.resend.com",
                                    port: 465,
                                    username: "resend",
                                }
                                : null;

                    if (settings) setEmailSettings(settings);

                    // Resend only needs a from address + API key; SMTP/Node need full host/credentials.
                    const configured = data.resend_status
                        ? Boolean(data.resendFromEmail && data.resendApiKey)
                        : Boolean(
                            settings &&
                            settings.from &&
                            settings.fromName &&
                            settings.host &&
                            settings.port &&
                            settings.username,
                        );
                    if (!configured) {
                        setIsSMTPNotConfigured(true);
                    }
                } else {
                    setIsSMTPNotConfigured(true);
                }
            } catch (error) {
                console.error("Error fetching email settings:", error);
                setIsSMTPNotConfigured(true);
            } finally {
                setIsFetchingEmailSettings(false);
            }
        };

        fetchEmailSettings();
    }, [token, user]);

    // fetch quotation details
    useEffect(() => {
        const fetchQuotationDetails = async () => {
            try {
                const response = await axios.get(
                    `${Constants.FETCH_QUOTATION_DETAILS_URL}/${quotationId}`,
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                setQuotationDetails(response.data.data);
            } catch (error) {
                console.error("Error fetching quotation details:", error);
            }
        };

        if (quotationId && token) fetchQuotationDetails();
    }, [quotationId, token]);

    // Prefill subject + body ONCE when the quotation arrives. Prefer the active
    // "New Quotation Created" template (merge fields resolved server-side); fall
    // back to a built-in default when no template is active.
    const prefilled = useRef(false);
    useEffect(() => {
        if (!quotationDetails || prefilled.current) return;
        let cancelled = false;

        // viewQuotationLink is null when the public link couldn't be resolved
        // (see resolvePublicDocumentLink) — the body must never embed a
        // token-less/admin URL, so the button is omitted in that case.
        const buildFallback = (viewQuotationLink: string | null) => {
            const customerName = quotationDetails.billTo?.name ?? "Customer";
            const quotationNo = quotationDetails.quotationId ?? "";
            const quotationDate = formatDate(quotationDetails.quotationDate);
            const totalAmount = formatDocAmount(quotationDetails.TotalAmount ?? 0, quotationDetails.currencyCode);
            const companyName = systemSettings?.company.companyName ?? "";
            const linkButton = viewQuotationLink
                ? `<p style="text-align:center;margin:0 0 12px 0"><a href="${viewQuotationLink}" style="display:inline-block;padding:10px 20px;background-color:#4191f2;color:#fff;text-decoration:none;border-radius:4px;">View Quotation</a></p>`
                : "";
            const html = `<h2 style="font-family:Arial,sans-serif;background-color:#4191f2;font-size:24px;text-align:center;padding:8px;color:#fff;margin:0 0 12px 0">Quotation #${quotationNo}</h2><p style="font-family:Arial,sans-serif;font-size:16px;color:#333;">Dear ${customerName},</p><p style="font-family:Arial,sans-serif;font-size:16px;color:#333;">We appreciate your interest in our services. Please find below the details of your quotation for your review.</p><br><p style="font-family:Arial,sans-serif;font-size:14px;text-transform:uppercase;color:#555;text-align:center;margin:0 0 4px 0">Total Amount</p><p style="font-family:Arial,sans-serif;font-size:32px;font-weight:700;color:#d61915;text-align:center;margin:0 0 12px 0">${totalAmount}</p>${linkButton}<p style="font-family:Arial,sans-serif;font-size:16px;color:#333;"><strong>Quotation Date:</strong> ${quotationDate}</p><p style="font-family:Arial,sans-serif;font-size:16px;color:#333;">Should you have any questions or require adjustments, please don’t hesitate to reach out. We look forward to working with you.</p><p style="font-family:Arial,sans-serif;font-size:16px;color:#333;">Warm regards,<br/>The ${companyName} Team</p>`;
            return { subject: `Quotation #${quotationNo} from ${companyName || "Company"}`, html };
        };

        (async () => {
            let subject = "";
            let html = "";
            try {
                const res = await axios.get(
                    `${Constants.RESOLVE_EMAIL_TEMPLATE_URL}/quotation/${quotationDetails.id}`,
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
            if (!html) {
                // Fallback body must link the PUBLIC share page, never the admin
                // app (customers have no login). Enable the public link
                // server-side (idempotent — same mechanism as the invoice
                // equivalent / email-template resolver) and resolve its token.
                const viewQuotationLink = await resolvePublicDocumentLink({
                    adminBaseUrl: Constants.ENABLE_QUOTATION_PUBLIC_LINK_URL,
                    routeSegment: "quotation",
                    documentId: quotationDetails.id,
                    authToken: token,
                    publicBaseUrl: systemSettings?.company.publicBaseUrl,
                });
                if (cancelled) return;
                if (!viewQuotationLink) {
                    toast.error("Couldn't generate the public quotation link. Add the link manually before sending.");
                }
                const fb = buildFallback(viewQuotationLink);
                subject = fb.subject;
                html = fb.html;
            }
            if (cancelled) return;
            prefilled.current = true;
            setEditorContent(html);
            setFormData({
                quotationId: quotationDetails.id,
                to: quotationDetails.billTo?.email ?? "",
                cc: null,
                subject,
                htmlContent: html,
                status: "sent",
            });
        })();

        return () => { cancelled = true; };
    }, [quotationDetails, emailSettings, token, formatDate, formatDocAmount, systemSettings]);

    useEffect(() => {
        setFormData((prev) => ({ ...prev, htmlContent: editorContent }));
    }, [editorContent]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        try {
            setIsSubmitting(true);
            const response = await axios.post(Constants.SEND_QUOTATION_MAIL_URL, formData, {
                headers: { Authorization: `Bearer ${token}` },
            });
            toast.success(response.data.message);
        } catch (error) {
            toast.error("Failed to send quotation.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isFetchingEmailSettings) return <FullPageLoader />;

    if (isSMTPNotConfigured) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] bg-gray-50 rounded-lg border border-gray-200">
                <Settings className="w-16 h-16 text-gray-400 mb-4" />
                <h2 className="text-xl font-semibold text-gray-700 mb-2">SMTP Not Configured</h2>
                <p className="text-gray-500 mb-4 text-center">
                    You need to configure your SMTP or NodeMailer settings before sending quotations.
                </p>
                <button
                    onClick={() => navigate("/admin/settings/email-settings")}
                    className="px-6 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 flex items-center gap-2"
                >
                    <Settings size={18} /> Configure Email Settings
                </button>
            </div>
        );
    }

    return (
        <>
            <PageHeader
                title={`Email Quotation to ${quotationDetails?.billTo?.name || "Customer"}`}
            >
                <button
                    type="button"
                    onClick={() => navigate(-1)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    form="email-quotation-form"
                    className="px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md shadow-sm hover:bg-gray-800 focus:outline-none flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                    disabled={isSubmitting}
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 size={16} className="animate-spin" /> Sending...
                        </>
                    ) : (
                        <>
                            <Send size={16} /> Send
                        </>
                    )}
                </button>
            </PageHeader>

            <form id="email-quotation-form" onSubmit={handleSubmit} className="space-y-4">
                <div className="border border-border rounded-card bg-white shadow-card">
                    {/* From */}
                    <div className="p-4 flex items-center gap-4">
                        <label className="w-32 text-gray-600 font-medium">From</label>
                        <input
                            type="email"
                            value={emailSettings.from}
                            disabled
                            className="flex-1 border border-gray-200 rounded-md p-2 bg-gray-100 text-gray-700"
                        />
                    </div>

                    {/* To */}
                    <div className="p-4 flex items-center gap-4">
                        <label className="w-32 text-gray-600 font-medium">To</label>
                        <input
                            type="email"
                            value={quotationDetails?.billTo?.email || ""}
                            placeholder="customer@email.com"
                            disabled
                            className="flex-1 border border-gray-200 rounded-md p-2 bg-gray-50 text-gray-700"
                        />
                    </div>

                    {/* Subject */}
                    <div className="p-4 flex items-center gap-4">
                        <label className="w-32 text-gray-600 font-medium">Subject</label>
                        <input
                            type="text"
                            value={formData.subject}
                            onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                            className="flex-1 border border-gray-200 rounded-md p-2 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600"
                        />
                    </div>

                    {/* Quill Editor */}
                    <div className="p-4">
                        <QuillEditor
                            value={formData.htmlContent}
                            onChange={(html) => setEditorContent(html)}
                        />
                    </div>
                </div>

            </form>
        </>
    );
};

export default EmailQuotation;
