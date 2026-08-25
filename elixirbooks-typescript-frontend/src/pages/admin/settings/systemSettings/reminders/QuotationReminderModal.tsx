import Modal from "@components/admin/Modal";
import QuillEditor, { type QuillEditorRef } from "@components/admin/QuillEditor";
import SubmitButton from "@components/admin/SubmitButton";
import Switch from "@components/admin/Switch";
import Constants from "@constants/api";
import type { RootState } from "@store/index";
import axios from "axios";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "sonner";
import { Badge, Button, FormField, Select, fieldControlClasses } from "@components/ui";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    editingReminder?: any;
    onSuccess: () => void;
}
interface QuotationFormData {
    name: string;
    days: string;
    timing: string;
    reference: string;
    enableReminder: boolean;
    remindTo: string;
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
}
interface Placeholder {
    key: string;
    label: string;
    description: string;
    category: string;
}
const QuotationReminderModal: React.FC<Props> = ({ isOpen, onClose, editingReminder, onSuccess }) => {

    const prepareInitialFormData = () => ({
        name: "",
        days: "",
        timing: "before",
        reference: "expiryDate",
        enableReminder: false,
        remindTo: "",
        cc: [],
        bcc: [],
        subject: "Your quotation %QuotationNumber% is about to expire",
        body: "<p>Dear %CustomerName%,</p><p>This is a friendly reminder that your quotation <strong>%QuotationNumber%</strong> is approaching its expiry date.</p><p>----------------------------------------------------------------------------------------</p><p><strong>Quotation Date:</strong> %QuotationDate%</p><p><strong>Expiry Date:</strong> %ExpiryDate%</p><p><strong>Total Amount:</strong> %Total%</p><p>----------------------------------------------------------------------------------------</p><p>Please review the quotation and confirm before it expires.</p><p>If you have any questions or need assistance, feel free to contact us.</p><p>Best regards,</p><p>%CompanyName%</p>"
    });

    const { token } = useSelector((state: RootState) => state.auth);
    const [quotationFormData, setQuotationFormData] = useState<QuotationFormData>(prepareInitialFormData());
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
    const [selectedPlaceholder, setSelectedPlaceholder] = useState("");
    const purchaseQuillEditorRef = useRef<QuillEditorRef>(null);
    const [ccInput, setCcInput] = useState("");
    const [bccInput, setBccInput] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (editingReminder) {
            setQuotationFormData({
                name: editingReminder.name || "",
                days: String(editingReminder.remindDays || ""),
                timing: editingReminder.remindTiming || "before",
                reference: editingReminder.remindEvent || "expiryDate",
                enableReminder: editingReminder.isEnabled || false,
                remindTo: editingReminder.emailConfig?.remindTo || "",
                cc: editingReminder.emailConfig?.cc || [],
                bcc: editingReminder.emailConfig?.bcc || [],
                subject: editingReminder.emailConfig?.subject || "",
                body: editingReminder.emailConfig?.body || "",
            });
            setFormErrors({});
        } else {
            setQuotationFormData(prepareInitialFormData());
            setFormErrors({});
        }
    }, [editingReminder, isOpen]);


    useEffect(() => {
        const fetchPlaceholders = async () => {
            try {
                const response = await axios.get(Constants.FETCH_QUOTATION_PLACEHOLDERS_URL, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (response.data.success && response.data.data && response.data.data.placeholders) {
                    const placeholderData = Array.isArray(response.data.data.placeholders)
                        ? response.data.data.placeholders
                        : [];
                    setPlaceholders(placeholderData);
                }
            } catch (error: any) {
                console.error("Error fetching placeholders:", error);
            }
        };

        fetchPlaceholders();
    }, []);
    const handlePurchaseInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setQuotationFormData((prev) => ({ ...prev, [name]: value }));
    }

    const handleManualPlaceholderSelect = (placeholderKey: string, target: "subject" | "body") => {
        const formattedPlaceholder = `%${placeholderKey}%`;

        if (target === "subject") {
            setQuotationFormData((prev) => ({
                ...prev,
                subject: prev.subject + formattedPlaceholder,
            }));
        } else {
            // Insert at cursor position in Quill editor
            if (purchaseQuillEditorRef.current) {
                purchaseQuillEditorRef.current.insertText(formattedPlaceholder);
            } else {
                // Fallback: append to end if ref not available
                setQuotationFormData((prev) => ({
                    ...prev,
                    body: prev.body + formattedPlaceholder,
                }));
            }
        }
        setSelectedPlaceholder("");
    };

    const addCCEmail = () => {
        if (isValidEmail(ccInput)) {
            if (quotationFormData.cc.includes(ccInput)) {
                setFormErrors(prev => ({ ...prev, cc: "This email is already added" }));
                return;
            }
            if (quotationFormData.cc.length >= 3) {
                setFormErrors(prev => ({ ...prev, cc: "You can add up to 3 emails" }));
                return;
            }
            setFormErrors(prev => ({ ...prev, cc: "" }));
            setCcInput("");
            setQuotationFormData(prev => ({ ...prev, cc: [...prev.cc, ccInput] }));
        } else {
            setFormErrors(prev => ({ ...prev, cc: "Please enter a valid email address" }));
        }
    }
    const addBCCEmail = () => {
        if (isValidEmail(bccInput)) {
            if (quotationFormData.bcc.includes(bccInput)) {
                setFormErrors(prev => ({ ...prev, bcc: "This email is already added" }));
                return;
            }
            if (quotationFormData.bcc.length >= 3) {
                setFormErrors(prev => ({ ...prev, bcc: "You can add up to 3 emails" }));
                return;
            }
            setFormErrors(prev => ({ ...prev, bcc: "" }));
            setBccInput("");
            setQuotationFormData(prev => ({ ...prev, bcc: [...prev.bcc, bccInput] }));
        } else {
            setFormErrors(prev => ({ ...prev, bcc: "Please enter a valid email address" }));
        }
    }
    const handleRemoveCc = (email: string) => {
        setQuotationFormData(prev => ({
            ...prev,
            cc: prev.cc.filter(e => e !== email),
        }));
    }
    const handleRemoveBcc = (email: string) => {
        setQuotationFormData(prev => ({
            ...prev,
            bcc: prev.bcc.filter(e => e !== email),
        }));
    }
    const isValidEmail = (email: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email.trim());
    }
    const handleQuotationBodyChange = (body: string) => {
        setQuotationFormData(prev => ({ ...prev, body }));
    }
    const validated = () => {
        const newErrors: { [key: string]: string } = {};
        if (!quotationFormData.name) {
            newErrors.name = "Name is required";
        } else if (quotationFormData.name.length < 3 || quotationFormData.name.length > 50) {
            newErrors.name = "Name must be between 3 and 50 characters";
        }
        if (!quotationFormData.days) {
            newErrors.days = "Days is required";
        }
        if (!quotationFormData.remindTo) {
            newErrors.remindTo = "Remind To is required";
        }
        if (!quotationFormData.subject) {
            newErrors.subject = "Subject is required";
        } else if (quotationFormData.subject.length < 3 || quotationFormData.subject.length > 100) {
            newErrors.subject = "Subject must be between 3 and 100 characters";
        }
        if (!quotationFormData.body) {
            newErrors.body = "Body is required";
        }
        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }
    const handlePurchaseReminderSave = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validated()) return false;
        const payload = {
            name: quotationFormData.name,
            remindDays: Number(quotationFormData.days),
            remindTiming: quotationFormData.timing,
            remindEvent: 'expiry_date',
            isEnabled: quotationFormData.enableReminder,
            emailConfig: {
                remindTo: quotationFormData.remindTo,
                cc: quotationFormData.cc,
                bcc: quotationFormData.bcc,
                subject: quotationFormData.subject,
                body: quotationFormData.body
            },
            type: 'automatic_quotation'
        }
        try {
            setIsSubmitting(true);
            if (editingReminder) {
                await axios.put(`${Constants.UPDATE_QUOTATION_REMINDER_URL}/${editingReminder.id}`, payload, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                toast.success('Quotation reminder updated successfully.');
            } else {
                await axios.post(Constants.CREATE_NEW_QUOTATION_REMINDER_URL, payload, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                toast.success('Quotation reminder created successfully.');
            }
            onClose();
            onSuccess();
        } catch (error) {
            toast.error('Failed to create quotation reminder.');
        } finally {
            setIsSubmitting(false);
        }
    }
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={editingReminder ? 'Edit Quotation Reminder' : 'Create Quotation Reminder'} size="4xl">
            <form onSubmit={handlePurchaseReminderSave} className="space-y-6">
                {/* Name and Enable Reminder on same row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                        label="Name"
                        id="name"
                        name="name"
                        type="text"
                        value={quotationFormData.name}
                        onChange={handlePurchaseInputChange}
                        placeholder="Reminder Name"
                        error={formErrors.name}
                    />

                    <div className="flex items-center mt-6 space-x-2">
                        <Switch
                            name="enableReminder"
                            checked={quotationFormData.enableReminder}
                            onChange={(e) =>
                                setQuotationFormData((prev) => ({
                                    ...prev,
                                    enableReminder: e.target.checked,
                                }))
                            }
                        />
                        <label htmlFor="enableReminder" className="text-sm text-body">
                            Enable this reminder
                        </label>
                        {formErrors.enableReminder && (
                            <p className="text-xs text-danger mt-1">
                                {formErrors.enableReminder}
                            </p>
                        )}
                    </div>
                </div>

                {/* Reminder Days + Type */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField label="Remind" error={formErrors.days}>
                        {(field) => (
                            <div className="flex items-center gap-2">
                                <input
                                    id={field.id}
                                    aria-invalid={field['aria-invalid']}
                                    aria-describedby={field['aria-describedby']}
                                    type="number"
                                    name="days"
                                    value={quotationFormData.days}
                                    onChange={handlePurchaseInputChange}
                                    placeholder="0"
                                    className={`w-24 ${fieldControlClasses(Boolean(formErrors.days))}`}
                                />
                                <span className="text-sm text-body">day(s)</span>
                                <p className="text-sm text-body">before expiry date</p>
                            </div>
                        )}
                    </FormField>

                    <Select
                        label="Remind To"
                        id="remindTo"
                        name="remindTo"
                        value={quotationFormData.remindTo}
                        onChange={(e) =>
                            setQuotationFormData((prev) => ({
                                ...prev,
                                remindTo: e.target.value,
                            }))
                        }
                        error={formErrors.remindTo}
                        options={[
                            { value: '', label: 'Select recipient' },
                            { value: 'customer', label: 'Customer' },
                            { value: 'customer-and-copy-me', label: 'Customer and copy me' },
                        ]}
                    />
                </div>

                {/* Cc */}
                <FormField label="Cc" error={formErrors.cc}>
                    {(field) => (
                        <>
                            <div className="flex gap-2">
                                <input
                                    id={field.id}
                                    aria-invalid={field['aria-invalid']}
                                    aria-describedby={field['aria-describedby']}
                                    type="email"
                                    value={ccInput}
                                    onChange={(e) => setCcInput(e.target.value)}
                                    placeholder="Enter email"
                                    className={`flex-1 ${fieldControlClasses(Boolean(formErrors.cc))}`}
                                />
                                <Button type="button" onClick={addCCEmail}>
                                    Add
                                </Button>
                            </div>
                            {quotationFormData.cc.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {quotationFormData.cc.map((email, index) => (
                                        <Badge key={index} color="info" className="gap-1">
                                            {email}
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveCc(email)}
                                                className="hover:opacity-70"
                                            >
                                                <X size={14} />
                                            </button>
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </FormField>

                {/* Bcc */}
                <FormField label="Bcc" error={formErrors.bcc}>
                    {(field) => (
                        <>
                            <div className="flex gap-2">
                                <input
                                    id={field.id}
                                    aria-invalid={field['aria-invalid']}
                                    aria-describedby={field['aria-describedby']}
                                    type="email"
                                    value={bccInput}
                                    onChange={(e) => setBccInput(e.target.value)}
                                    placeholder="Enter email"
                                    className={`flex-1 ${fieldControlClasses(Boolean(formErrors.bcc))}`}
                                />
                                <Button type="button" onClick={addBCCEmail}>
                                    Add
                                </Button>
                            </div>
                            {quotationFormData.bcc.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {quotationFormData.bcc.map((email, index) => (
                                        <Badge key={index} color="info" className="gap-1">
                                            {email}
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveBcc(email)}
                                                className="hover:opacity-70"
                                            >
                                                <X size={14} />
                                            </button>
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </FormField>

                {/* Subject + Placeholder */}
                <div>
                    <div className="flex justify-between items-center mb-1">
                        <label className="block text-sm font-medium text-heading">Subject</label>
                        <Select
                            containerClassName="w-56"
                            className="text-sm"
                            value={selectedPlaceholder}
                            onChange={(e) => {
                                if (e.target.value) {
                                    const formattedPlaceholder = `%${e.target.value}%`;
                                    setQuotationFormData((prev) => ({
                                        ...prev,
                                        subject: prev.subject + formattedPlaceholder,
                                    }));
                                    setSelectedPlaceholder("");
                                }
                            }}
                            options={[
                                { value: '', label: 'Insert Placeholder' },
                                ...(Array.isArray(placeholders)
                                    ? placeholders.map((placeholder) => ({ value: placeholder.key, label: placeholder.label }))
                                    : []),
                            ]}
                        />
                    </div>
                    <FormField
                        id="subject"
                        name="subject"
                        type="text"
                        value={quotationFormData.subject}
                        onChange={handlePurchaseInputChange}
                        error={formErrors.subject}
                    />
                </div>

                {/* Body */}
                <div>
                    <div className="flex justify-between items-center mb-1">
                        <label className="block text-sm font-medium text-heading">Body</label>
                        <Select
                            containerClassName="w-56"
                            className="text-sm"
                            value={selectedPlaceholder}
                            onChange={(e) => {
                                if (e.target.value) handleManualPlaceholderSelect(e.target.value, "body");
                            }}
                            options={[
                                { value: '', label: 'Insert Placeholder' },
                                ...(Array.isArray(placeholders)
                                    ? placeholders.map((placeholder) => ({ value: placeholder.key, label: placeholder.label }))
                                    : []),
                            ]}
                        />
                    </div>
                    <div className="border border-border rounded-control">
                        <QuillEditor
                            ref={purchaseQuillEditorRef}
                            value={quotationFormData.body}
                            onChange={handleQuotationBodyChange}
                            height="300px"
                        />
                    </div>
                    {formErrors.body && <p className="text-xs text-danger mt-1">{formErrors.body}</p>}
                </div>

                {/* Buttons */}
                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                    <Button
                        type="button"
                        variant="white"
                        onClick={() => {
                            onClose();
                        }}
                    >
                        Cancel
                    </Button>
                    <SubmitButton isLoading={isSubmitting} mode={editingReminder ? "edit" : "create"}>
                    </SubmitButton>
                </div>
            </form>
        </Modal>
    );
}
export default QuotationReminderModal;
