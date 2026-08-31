import Modal from "@components/admin/Modal";
import SubmitButton from "@components/admin/SubmitButton";
import { Button, FormField, fieldControlClasses } from "@components/ui";
import Constants from "@constants/api";
import { useCurrencies } from "@hooks/useCurrencies";
import type { RootState } from "@store/index";
import axios, { AxiosError } from "axios";
import type React from "react";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "sonner";

interface PurchaseEmailModalProps {
    isOpen: boolean;
    onClose: () => void;
    purchaseId: string;
    purchaseNumber?: string;
    supplierEmail?: string;
    totalAmount?: number;
    currencyCode?: string | null;
}

interface EmailFormData {
    to: string;
    cc: string;
    subject: string;
    htmlContent: string;
}

const PurchaseEmailModal: React.FC<PurchaseEmailModalProps> = ({
    isOpen,
    onClose,
    purchaseId,
    purchaseNumber,
    supplierEmail,
    totalAmount,
    currencyCode,
}) => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { formatMoney } = useCurrencies();
    const [isSaving, setIsSaving] = useState(false);
    const [formData, setFormData] = useState<EmailFormData>({
        to: '',
        cc: '',
        subject: '',
        htmlContent: '',
    });

    useEffect(() => {
        if (isOpen) {
            const subject = purchaseNumber
                ? `Purchase ${purchaseNumber}`
                : 'Your Purchase';
            const totalLine = totalAmount != null
                ? `<p>Total Amount: <strong>${formatMoney(totalAmount, currencyCode ?? undefined)}</strong></p>`
                : '';
            const htmlContent = `<p>Dear Supplier,</p>
<p>Please find attached the details for ${subject}.</p>
${totalLine}
<p>Thank you for your business.</p>`;

            setFormData({
                to: supplierEmail ?? '',
                cc: '',
                subject,
                htmlContent,
            });
        }
    }, [isOpen, purchaseNumber, supplierEmail, totalAmount, currencyCode]);

    const handleChange = (field: keyof EmailFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async () => {
        if (!formData.to.trim()) {
            toast.error('Recipient email is required.');
            return;
        }
        if (!formData.subject.trim()) {
            toast.error('Subject is required.');
            return;
        }
        if (!formData.htmlContent.trim()) {
            toast.error('Email body is required.');
            return;
        }

        try {
            setIsSaving(true);
            await axios.post(
                Constants.SEND_PURCHASE_MAIL_URL,
                {
                    purchaseId,
                    to: formData.to.trim(),
                    cc: formData.cc.trim() || undefined,
                    subject: formData.subject.trim(),
                    htmlContent: formData.htmlContent,
                    sendAttachment: false,
                },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success('Purchase email sent successfully.');
            onClose();
        } catch (error) {
            const axiosError = error as AxiosError as any;
            const msg = axiosError?.response?.data?.message || 'Failed to send email.';
            toast.error(msg);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Send Purchase Email" size="2xl">
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-4">
                {/* To */}
                <FormField
                    id="emailTo"
                    label="To"
                    required
                    type="email"
                    value={formData.to}
                    onChange={(e) => handleChange('to', e.target.value)}
                    placeholder="supplier@example.com"
                />

                {/* CC */}
                <FormField
                    id="emailCc"
                    label="CC (optional)"
                    type="text"
                    value={formData.cc}
                    onChange={(e) => handleChange('cc', e.target.value)}
                    placeholder="cc@example.com"
                />

                {/* Subject */}
                <FormField
                    id="emailSubject"
                    label="Subject"
                    required
                    type="text"
                    value={formData.subject}
                    onChange={(e) => handleChange('subject', e.target.value)}
                />

                {/* Body */}
                <FormField id="emailBody" label="Email Body" required helper="HTML is supported.">
                    {(field) => (
                        <textarea
                            id={field.id}
                            required={field.required}
                            aria-invalid={field['aria-invalid']}
                            aria-describedby={field['aria-describedby']}
                            rows={8}
                            value={formData.htmlContent}
                            onChange={(e) => handleChange('htmlContent', e.target.value)}
                            className={`${fieldControlClasses()} font-mono text-xs`}
                        />
                    )}
                </FormField>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="white" onClick={onClose}>
                        Cancel
                    </Button>
                    <SubmitButton isDisabled={isSaving} isLoading={isSaving} mode="create">Send Email</SubmitButton>
                </div>
            </form>
        </Modal>
    );
};

export default PurchaseEmailModal;
