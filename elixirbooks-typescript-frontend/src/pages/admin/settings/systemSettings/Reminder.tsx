import { useState, useEffect, useRef } from "react";
import { Edit, MoreVertical, Plus, Info, X, Trash2 } from "lucide-react";
import Constants from "@constants/api";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import axios from "axios";
import { toast } from "sonner";
import SubmitButton from "@components/admin/SubmitButton";
import QuillEditor from "@components/admin/QuillEditor";
import type { QuillEditorRef } from "@components/admin/QuillEditor";
import QuotationReminderModal from "./reminders/QuotationReminderModal";
import QuotationReminderList from "./reminders/QuotationReminderList";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import { Button, Card, FormField, Select, Badge, fieldControlClasses } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";

interface ManualReminder {
    id: string;
    name: string;
    description: string;
}

interface AutomatedReminder {
    id: string;
    name: string;
    type: string;
    remindDays: number;
    remindTiming: string;
    remindEvent: string;
    isEnabled: boolean;
    formattedTiming: string;
    emailConfig: {
        remindTo?: string;
        fromEmail?: string;
        cc: string[];
        bcc: string[];
        subject: string;
        body: string;
    };
    emailSummary?: {
        from?: string;
        cc: string[];
        bcc: string[];
        subject: string;
    };
    createdBy?: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    };
    status: string;
    createdAt: string;
    updatedAt: string;
}

interface Placeholder {
    key: string;
    label: string;
    description: string;
    category: string;
}

interface ReminderFormData {
    name: string;
    days: string;
    timing: "after" | "before" | "duedate";
    reference: "due date";
    enableReminder: boolean;
    remindTo: string;
    from: string;
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
}

const Reminder = () => {
    const { token } = useSelector((state: RootState) => state.auth);

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isManualModalOpen, setIsManualModalOpen] = useState(false);
    const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
    const [isQuotationModalOpen, setIsQuotationModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [editingReminderId, setEditingReminderId] = useState<string | null>(
        null
    );
    const [itemToDelete, setItemToDelete] = useState<AutomatedReminder | null>(null);
    const [isDeleteModelOpen, setIsDeleteModelOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const [editingQuotationReminder, setEditingQuotationReminder] = useState<
        AutomatedReminder | null
    >(null);
    const [openActionDropdown, setOpenActionDropdown] = useState<string | null>(
        null
    );
    const [selectedManualReminder, setSelectedManualReminder] =
        useState<ManualReminder | null>(null);

    // Email input states
    const [ccInput, setCcInput] = useState("");
    const [bccInput, setBccInput] = useState("");

    // Placeholder states
    const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
    const [selectedPlaceholder, setSelectedPlaceholder] = useState("");

    // Refs for Quill editors
    const quillEditorRef = useRef<QuillEditorRef>(null);
    const manualQuillEditorRef = useRef<QuillEditorRef>(null);
    const purchaseQuillEditorRef = useRef<QuillEditorRef>(null);

    // Form data for automated reminders
    const [formData, setFormData] = useState<ReminderFormData>({
        name: "",
        days: "",
        timing: "after",
        reference: "due date",
        enableReminder: true,
        remindTo: "",
        from: "",
        cc: [],
        bcc: [],
        subject: "Payment of %Balance% is outstanding for %InvoiceNumber%",
        body: `<p>Dear %CustomerName%,</p><p>This is to remind you about the payment details for the below invoice.</p><p>----------------------------------------------------------------------------------------</p><p><strong>Invoice# : %InvoiceNumber%</strong></p><p>Due Date :   %DueDate%</p><p>----------------------------------------------------------------------------------------</p><p>Overdue By    :  %OverdueDays%</p><p>Amount           :  %Balance%</p><p>----------------------------------------------------------------------------------------</p><p>View your invoice and take the easy way out by making an <a href="#" target="_blank">online payment</a>.</p><p>If you have already paid, please accept our apologies and kindly ignore this payment reminder.</p><p>Regards,</p>`,
    });

    // Form data for manual reminders
    const [manualFormData, setManualFormData] = useState({
        from: "",
        cc: [] as string[],
        bcc: [] as string[],
        subject: "Payment of %Balance% is outstanding for %InvoiceNumber%",
        body: `<p>Dear %CustomerName%,</p><p>You might have missed the payment date and the invoice is now overdue by %OverdueDays% days.</p><p>----------------------------------------------------------------------------------------</p><p><strong>Invoice# : %InvoiceNumber%</strong></p><p>Dated : %InvoiceDate%</p><p>----------------------------------------------------------------------------------------</p><p>Due Date : %DueDate%</p><p>Amount : %Balance%</p><p>----------------------------------------------------------------------------------------</p><p>Not to worry at all ! View your invoice and take the easy way out by making an <a href="#" target="_blank">online payment</a>.</p><p>If you have already paid, please accept our apologies and kindly ignore this payment reminder.</p><p>Regards,</p><p>%UserName%</p><p>%CompanyName%</p>`,
    });

    // Form data for purchase reminders
    const [purchaseFormData, setPurchaseFormData] = useState<ReminderFormData>({
        name: "",
        days: "",
        timing: "after",
        reference: "due date",
        enableReminder: true,
        remindTo: "",
        from: "",
        cc: [],
        bcc: [],
        subject: "Purchase Order Reminder - %PurchaseOrderNumber%",
        body: `<p>Dear %SupplierName%,</p><p>This is a reminder regarding your purchase order.</p><p>----------------------------------------------------------------------------------------</p><p><strong>Purchase Order# : %PurchaseOrderNumber%</strong></p><p>Order Date : %OrderDate%</p><p>----------------------------------------------------------------------------------------</p><p>Expected Delivery : %ExpectedDeliveryDate%</p><p>Total Amount : %TotalAmount%</p><p>----------------------------------------------------------------------------------------</p><p>Please ensure timely delivery as per the agreed schedule.</p><p>Regards,</p>`,
    });

    // Manual Reminders Data
    const [manualReminders] = useState<ManualReminder[]>([
        {
            id: "1",
            name: "Reminder For Overdue Invoices",
            description:
                "You can send this reminder to your customers manually, from an overdue invoice's details page.",
        },
        {
            id: "2",
            name: "Reminder For Sent Invoices",
            description:
                "You can send this reminder to your customers manually, from a sent (but not overdue) details page.",
        },
        {
            id: "3",
            name: "Reminder For Purchase Orders",
            description:
                "You can send this reminder to your suppliers manually, from a purchase order's details page.",
        },
    ]);

    // Automated Reminders Data
    const [automatedReminders, setAutomatedReminders] = useState<
        AutomatedReminder[]
    >([]);

    // Calculate reminder counts
    const reminderCounts = {
        before: automatedReminders.filter(
            (r) => r.remindTiming === "before" && r.remindEvent === "due_date" && r.type === "automatic"
        ).length,
        after: automatedReminders.filter(
            (r) => r.remindTiming === "after" && r.remindEvent === "due_date" && r.type === "automatic"
        ).length,
        duedate: automatedReminders.filter(
            (r) => r.remindTiming === "duedate" && r.remindEvent === "due_date" && r.type === "automatic"
        ).length,
    };

    // Calculate purchase reminder counts
    const purchaseReminderCounts = {
        before: automatedReminders.filter(
            (r) => r.remindTiming === "before" && r.type === "automatic_Purchase"
        ).length,
        after: automatedReminders.filter(
            (r) => r.remindTiming === "after" && r.type === "automatic_Purchase"
        ).length,
        duedate: automatedReminders.filter(
            (r) => r.remindTiming === "duedate" && r.type === "automatic_Purchase"
        ).length,
    };

    // Check if we can create more reminders
    const canCreateReminder =
        reminderCounts.before < 5 ||
        reminderCounts.after < 5 ||
        reminderCounts.duedate < 1;

    // Fetch reminders and placeholders from API
    useEffect(() => {
        fetchReminders();
        fetchPlaceholders();
    }, []);

    const fetchPlaceholders = async () => {
        try {
            const response = await axios.get(Constants.PLACE_HOLDER_API_URL, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (response.data.success && response.data.data && response.data.data.placeholders) {
                // Ensure data is an array
                const placeholderData = Array.isArray(response.data.data.placeholders)
                    ? response.data.data.placeholders
                    : [];
                setPlaceholders(placeholderData);
            }
        } catch (error: any) {
            console.error("Error fetching placeholders:", error);
            // Don't show error toast for placeholders as it's not critical
        }
    };

    const fetchReminders = async () => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.FETCH_REMINDERS_URL, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (response.data.success) {
                setAutomatedReminders(response.data.data.reminders);
            }
        } catch (error: any) {
            console.error("Error fetching reminders:", error);
            toast.error(error.response?.data?.message || "Failed to fetch reminders");
        } finally {
            setIsLoading(false);
        }
    };

    const toggleStatus = (id: string) => {
        setAutomatedReminders((prev) =>
            prev.map((reminder) =>
                reminder.id === id
                    ? { ...reminder, isEnabled: !reminder.isEnabled }
                    : reminder
            )
        );
    };

    // Toggle action dropdown
    const toggleActionDropdown = (id: string) => {
        setOpenActionDropdown(openActionDropdown === id ? null : id);
    };

    // Handle edit reminder
    const handleEditReminder = (reminder: AutomatedReminder) => {
        setEditingReminderId(reminder.id);

        // Check if it's a purchase reminder
        if (reminder.type === "automatic_Purchase") {
            // Open purchase modal with purchase form data
            setPurchaseFormData({
                name: reminder.name,
                days: reminder.remindDays.toString(),
                timing: reminder.remindTiming as "after" | "before" | "duedate",
                reference: "due date",
                enableReminder: reminder.isEnabled,
                remindTo: reminder.emailConfig.remindTo || "",
                from: reminder.emailConfig.fromEmail || "",
                cc: reminder.emailConfig.cc || [],
                bcc: reminder.emailConfig.bcc || [],
                subject: reminder.emailConfig.subject,
                body: reminder.emailConfig.body,
            });
            setIsPurchaseModalOpen(true);
        } else {
            // Open regular modal with regular form data
            setFormData({
                name: reminder.name,
                days: reminder.remindDays.toString(),
                timing: reminder.remindTiming as "after" | "before" | "duedate",
                reference: "due date",
                enableReminder: reminder.isEnabled,
                remindTo: reminder.emailConfig.remindTo
                    ? `me (${reminder.emailConfig.remindTo})`
                    : "",
                from: reminder.emailConfig.fromEmail || "",
                cc: reminder.emailConfig.cc || [],
                bcc: reminder.emailConfig.bcc || [],
                subject: reminder.emailConfig.subject,
                body: reminder.emailConfig.body,
            });
            setIsModalOpen(true);
        }
        setOpenActionDropdown(null);
    };

    // Handle delete reminder
    const handleDeleteReminder = async (id: string) => {
        const reminder = automatedReminders.find((r) => r.id === id);
        setItemToDelete(reminder as AutomatedReminder);
        setIsDeleteModelOpen(true);
    };
    const handleDeleteConfirmation = async () => {
        if (itemToDelete) {
            try {
                setIsDeleting(true);
                const id = itemToDelete.id;
                await axios.delete(`${Constants.DELETE_REMINDER_URL}/${id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                toast.success("Reminder deleted successfully");
                fetchReminders();
                setOpenActionDropdown(null);
            } catch (error) {
                toast.error("Failed to delete reminder");
            } finally {
                setIsDeleting(false);
                setIsDeleteModelOpen(false);
            }
        } else {
            toast.error("Failed to delete reminder");
        }
    };

    // Handle manual reminder click
    const handleManualReminderClick = (reminder: ManualReminder) => {
        setSelectedManualReminder(reminder);

        // Set different body content based on reminder type
        let bodyContent = "";
        let subjectContent = "";

        if (reminder.id === "2") {
            // Reminder For Sent Invoices
            subjectContent = "Payment Reminder - Invoice %InvoiceNumber%";
            bodyContent = `<p>Dear %CustomerName%,</p><p>The due date for your invoice is fast approaching.</p><p>----------------------------------------------------------------------------------------</p><p><strong>Invoice# : %InvoiceNumber%</strong></p><p>Dated : %InvoiceDate%</p><p>----------------------------------------------------------------------------------------</p><p>Due Date : %DueDate%</p><p>Amount : %Balance%</p><p>----------------------------------------------------------------------------------------</p><p>View your invoice and take the easy way out by making an <a href="#" target="_blank">online payment</a>.</p><p>If you have already paid, please accept our apologies and kindly ignore this payment reminder.</p><p>Regards,</p><p>%UserName%</p><p>%CompanyName%</p>`;
        } else if (reminder.id === "3") {
            // Reminder For Purchase Orders
            subjectContent = "Purchase Order Reminder - %PurchaseOrderNumber%";
            bodyContent = `<p>Dear %SupplierName%,</p><p>This is a reminder regarding your purchase order.</p><p>----------------------------------------------------------------------------------------</p><p><strong>Purchase Order# : %PurchaseOrderNumber%</strong></p><p>Order Date : %OrderDate%</p><p>----------------------------------------------------------------------------------------</p><p>Expected Delivery : %ExpectedDeliveryDate%</p><p>Total Amount : %TotalAmount%</p><p>----------------------------------------------------------------------------------------</p><p>Please ensure timely delivery as per the agreed schedule.</p><p>If you have any questions or concerns, please contact us immediately.</p><p>Regards,</p><p>%UserName%</p><p>%CompanyName%</p>`;
        } else {
            // Reminder For Overdue Invoices (default)
            subjectContent = "Overdue Payment Reminder - Invoice %InvoiceNumber%";
            bodyContent = `<p>Dear %CustomerName%,</p><p>You might have missed the payment date and the invoice is now overdue by %OverdueDays% days.</p><p>----------------------------------------------------------------------------------------</p><p><strong>Invoice# : %InvoiceNumber%</strong></p><p>Dated : %InvoiceDate%</p><p>----------------------------------------------------------------------------------------</p><p>Due Date : %DueDate%</p><p>Amount : %Balance%</p><p>----------------------------------------------------------------------------------------</p><p>Not to worry at all ! View your invoice and take the easy way out by making an <a href="#" target="_blank">online payment</a>.</p><p>If you have already paid, please accept our apologies and kindly ignore this payment reminder.</p><p>Regards,</p><p>%UserName%</p><p>%CompanyName%</p>`;
        }

        setManualFormData((prev) => ({
            ...prev,
            subject: subjectContent,
            body: bodyContent,
        }));

        setIsManualModalOpen(true);
    };

    // Handle manual form input changes
    const handleManualInputChange = (
        e: React.ChangeEvent<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >
    ) => {
        const { name, value } = e.target;
        setManualFormData((prev) => ({ ...prev, [name]: value }));
    };

    // Handle manual body change
    const handleManualBodyChange = (content: string) => {
        setManualFormData((prev) => ({ ...prev, body: content }));
    };

    // Handle purchase form input changes
    const handlePurchaseInputChange = (
        e: React.ChangeEvent<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >
    ) => {
        const { name, value, type } = e.target;
        if (type === "checkbox") {
            const checked = (e.target as HTMLInputElement).checked;
            setPurchaseFormData((prev) => ({ ...prev, [name]: checked }));
        } else {
            // If timing is changed to "duedate", automatically set days to 0
            if (name === "timing" && value === "duedate") {
                setPurchaseFormData((prev) => ({ ...prev, [name]: value, days: "0" }));
            } else {
                setPurchaseFormData((prev) => ({ ...prev, [name]: value }));
            }
        }
    };

    // Handle purchase body change
    const handlePurchaseBodyChange = (content: string) => {
        setPurchaseFormData((prev) => ({ ...prev, body: content }));
    };

    // Handle manual reminder save
    const handleManualReminderSave = async () => {
        // Validate required fields
        if (!manualFormData.from || !manualFormData.from.trim()) {
            toast.error("Please enter a 'From' email address");
            return;
        }

        if (!isValidEmail(manualFormData.from)) {
            toast.error("Please enter a valid 'From' email address");
            return;
        }

        if (!manualFormData.subject || !manualFormData.subject.trim()) {
            toast.error("Please enter a subject");
            return;
        }

        if (!manualFormData.body || !manualFormData.body.trim()) {
            toast.error("Please enter a message body");
            return;
        }

        setIsSubmitting(true);

        try {
            const payload = {
                type: "manual",
                name: selectedManualReminder?.name || "Manual Reminder",
                emailConfig: {
                    fromEmail: manualFormData.from,
                    cc: manualFormData.cc,
                    bcc: manualFormData.bcc,
                    subject: manualFormData.subject,
                    body: manualFormData.body,
                },
            };

            await axios.post(Constants.CREATE_REMINDER_URL, payload, {
                headers: { Authorization: `Bearer ${token}` },
            });

            toast.success("Manual reminder template saved successfully");
            setIsManualModalOpen(false);

            // Reset manual form
            setManualFormData({
                from: "",
                cc: [],
                bcc: [],
                subject: "Payment of %Balance% is outstanding for %InvoiceNumber%",
                body: `<p>Dear %CustomerName%,</p><p>You might have missed the payment date and the invoice is now overdue by %OverdueDays% days.</p><p>----------------------------------------------------------------------------------------</p><p><strong>Invoice# : %InvoiceNumber%</strong></p><p>Dated : %InvoiceDate%</p><p>----------------------------------------------------------------------------------------</p><p>Due Date : %DueDate%</p><p>Amount : %Balance%</p><p>----------------------------------------------------------------------------------------</p><p>Not to worry at all ! View your invoice and take the easy way out by making an <a href="#" target="_blank">online payment</a>.</p><p>If you have already paid, please accept our apologies and kindly ignore this payment reminder.</p><p>Regards,</p><p>%UserName%</p><p>%CompanyName%</p>`,
            });
            setCcInput("");
            setBccInput("");
        } catch (error: any) {
            console.error("Error saving manual reminder:", error);
            toast.error(
                error.response?.data?.message ||
                "Failed to save manual reminder template"
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    // Handle purchase reminder save
    const handlePurchaseReminderSave = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        // Validate days field
        if (!purchaseFormData.days || purchaseFormData.days.trim() === "") {
            toast.error("Please enter the number of days");
            return;
        }

        const daysNumber = parseInt(purchaseFormData.days);
        if (isNaN(daysNumber) || daysNumber < 0) {
            toast.error("Please enter a valid number of days");
            return;
        }

        // Check purchase reminder limits (only for new reminders, not when editing)
        if (!editingReminderId) {
            if (purchaseFormData.timing === "before" && purchaseReminderCounts.before >= 5) {
                toast.error("Maximum limit reached: You can only create 5 'before' purchase reminders");
                return;
            }
            if (purchaseFormData.timing === "after" && purchaseReminderCounts.after >= 5) {
                toast.error("Maximum limit reached: You can only create 5 'after' purchase reminders");
                return;
            }
            if (purchaseFormData.timing === "duedate" && purchaseReminderCounts.duedate >= 1) {
                toast.error("Maximum limit reached: You can only create 1 'due date' purchase reminder");
                return;
            }
        } else {
            // When editing, check if changing timing would exceed limits
            const currentReminder = automatedReminders.find(r => r.id === editingReminderId);
            if (currentReminder && currentReminder.remindTiming !== purchaseFormData.timing) {
                // User is changing the timing, check new timing limits
                if (purchaseFormData.timing === "before" && purchaseReminderCounts.before >= 5) {
                    toast.error("Maximum limit reached: You can only have 5 'before' purchase reminders");
                    return;
                }
                if (purchaseFormData.timing === "after" && purchaseReminderCounts.after >= 5) {
                    toast.error("Maximum limit reached: You can only have 5 'after' purchase reminders");
                    return;
                }
                if (purchaseFormData.timing === "duedate" && purchaseReminderCounts.duedate >= 1) {
                    toast.error("Maximum limit reached: You can only have 1 'due date' purchase reminder");
                    return;
                }
            }
        }

        setIsSubmitting(true);

        try {
            const extractEmail = (value: string): string => {
                const match = value.match(/\(([^)]+)\)/);
                return match ? match[1] : value;
            };

            const payload = {
                name: purchaseFormData.name,
                type: "automatic_Purchase",
                isEnabled: purchaseFormData.enableReminder,
                remindDays: daysNumber,
                remindTiming: purchaseFormData.timing,
                emailConfig: {
                    remindTo: extractEmail(purchaseFormData.remindTo),
                    fromEmail: purchaseFormData.from,
                    cc: purchaseFormData.cc,
                    bcc: purchaseFormData.bcc,
                    subject: purchaseFormData.subject,
                    body: purchaseFormData.body,
                },
            };

            if (editingReminderId) {
                // Update existing purchase reminder
                await axios.put(
                    `${Constants.UPDATE_REMINDER_URL}/${editingReminderId}`,
                    payload,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    }
                );
                toast.success("Purchase reminder updated successfully");
            } else {
                // Create new purchase reminder
                await axios.post(Constants.CREATE_REMINDER_URL, payload, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                toast.success("Purchase reminder created successfully");
            }

            setIsPurchaseModalOpen(false);
            setEditingReminderId(null);

            // Reset form
            setPurchaseFormData({
                name: "",
                days: "",
                timing: "after",
                reference: "due date",
                enableReminder: true,
                remindTo: "",
                from: "",
                cc: [],
                bcc: [],
                subject: "Purchase Order Reminder - %PurchaseOrderNumber%",
                body: `<p>Dear %SupplierName%,</p><p>This is a reminder regarding your purchase order.</p><p>----------------------------------------------------------------------------------------</p><p><strong>Purchase Order# : %PurchaseOrderNumber%</strong></p><p>Order Date : %OrderDate%</p><p>----------------------------------------------------------------------------------------</p><p>Expected Delivery : %ExpectedDeliveryDate%</p><p>Total Amount : %TotalAmount%</p><p>----------------------------------------------------------------------------------------</p><p>Please ensure timely delivery as per the agreed schedule.</p><p>Regards,</p>`,
            });
            setCcInput("");
            setBccInput("");

            // Refresh reminders list
            fetchReminders();
        } catch (error: any) {
            console.error("Error creating purchase reminder:", error);
            toast.error(
                error.response?.data?.message || "Failed to create purchase reminder"
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    // Email validation
    const isValidEmail = (email: string): boolean => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email.trim());
    };

    // Handle adding CC email
    const handleAddCc = () => {
        const trimmedEmail = ccInput.trim();
        if (!trimmedEmail) return;

        if (!isValidEmail(trimmedEmail)) {
            toast.error("Please enter a valid email address");
            return;
        }

        if (formData.cc.includes(trimmedEmail)) {
            toast.error("This email is already added");
            return;
        }

        setFormData((prev) => ({ ...prev, cc: [...prev.cc, trimmedEmail] }));
        setCcInput("");
    };

    // Handle removing CC email
    const handleRemoveCc = (email: string) => {
        setFormData((prev) => ({
            ...prev,
            cc: prev.cc.filter((e) => e !== email),
        }));
    };

    // Handle adding BCC email
    const handleAddBcc = () => {
        const trimmedEmail = bccInput.trim();
        if (!trimmedEmail) return;

        if (!isValidEmail(trimmedEmail)) {
            toast.error("Please enter a valid email address");
            return;
        }

        if (formData.bcc.includes(trimmedEmail)) {
            toast.error("This email is already added");
            return;
        }

        setFormData((prev) => ({ ...prev, bcc: [...prev.bcc, trimmedEmail] }));
        setBccInput("");
    };

    // Handle removing BCC email
    const handleRemoveBcc = (email: string) => {
        setFormData((prev) => ({
            ...prev,
            bcc: prev.bcc.filter((e) => e !== email),
        }));
    };

    // Handle input changes
    const handleInputChange = (
        e: React.ChangeEvent<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >
    ) => {
        const { name, value, type } = e.target;
        if (type === "checkbox") {
            const checked = (e.target as HTMLInputElement).checked;
            setFormData((prev) => ({ ...prev, [name]: checked }));
        } else {
            // If timing is changed to "duedate", automatically set days to 0
            if (name === "timing" && value === "duedate") {
                setFormData((prev) => ({ ...prev, [name]: value, days: "0" }));
            } else {
                setFormData((prev) => ({ ...prev, [name]: value }));
            }
        }
    };

    // Handle rich text editor change
    const handleBodyChange = (content: string) => {
        setFormData((prev) => ({ ...prev, body: content }));
    };

    // Handle placeholder selection for automated reminders
    const handlePlaceholderSelect = (placeholderKey: string, target: "subject" | "body") => {
        const formattedPlaceholder = `%${placeholderKey}%`;

        if (target === "subject") {
            setFormData((prev) => ({
                ...prev,
                subject: prev.subject + formattedPlaceholder,
            }));
        } else {
            // Insert at cursor position in Quill editor
            if (quillEditorRef.current) {
                quillEditorRef.current.insertText(formattedPlaceholder);
            } else {
                // Fallback: append to end if ref not available
                setFormData((prev) => ({
                    ...prev,
                    body: prev.body + formattedPlaceholder,
                }));
            }
        }
        setSelectedPlaceholder("");
    };

    // Handle placeholder selection for manual reminders
    const handleManualPlaceholderSelect = (placeholderKey: string, target: "subject" | "body") => {
        const formattedPlaceholder = `%${placeholderKey}%`;

        if (target === "subject") {
            setManualFormData((prev) => ({
                ...prev,
                subject: prev.subject + formattedPlaceholder,
            }));
        } else {
            // Insert at cursor position in Quill editor
            if (manualQuillEditorRef.current) {
                manualQuillEditorRef.current.insertText(formattedPlaceholder);
            } else {
                // Fallback: append to end if ref not available
                setManualFormData((prev) => ({
                    ...prev,
                    body: prev.body + formattedPlaceholder,
                }));
            }
        }
        setSelectedPlaceholder("");
    };

    // Handle modal close - reset form and editing state
    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingReminderId(null);

        // Reset form to initial state
        setFormData({
            name: "",
            days: "",
            timing: "after",
            reference: "due date",
            enableReminder: true,
            remindTo: "",
            from: "",
            cc: [],
            bcc: [],
            subject: "Payment of %Balance% is outstanding for %InvoiceNumber%",
            body: `<p>Dear %CustomerName%,</p><p>This is to remind you about the payment details for the below invoice.</p><p>----------------------------------------------------------------------------------------</p><p><strong>Invoice# : %InvoiceNumber%</strong></p><p>Due Date :   %DueDate%</p><p>----------------------------------------------------------------------------------------</p><p>Overdue By    :  %OverdueDays%</p><p>Amount           :  %Balance%</p><p>----------------------------------------------------------------------------------------</p><p>View your invoice and take the easy way out by making an <a href="#" target="_blank">online payment</a>.</p><p>If you have already paid, please accept our apologies and kindly ignore this payment reminder.</p><p>Regards,</p>`,
        });

        setCcInput("");
        setBccInput("");
    };

    // Handle modal open - set default timing to first available option
    const handleOpenModal = () => {
        // Reset editing state and form data
        setEditingReminderId(null);

        let defaultTiming: "after" | "before" | "duedate" = "after";

        if (reminderCounts.after >= 5) {
            if (reminderCounts.before < 5) {
                defaultTiming = "before";
            } else if (reminderCounts.duedate < 1) {
                defaultTiming = "duedate";
            }
        }

        // Reset form to initial state
        setFormData({
            name: "",
            days: "",
            timing: defaultTiming,
            reference: "due date",
            enableReminder: true,
            remindTo: "",
            from: "",
            cc: [],
            bcc: [],
            subject: "Payment of %Balance% is outstanding for %InvoiceNumber%",
            body: `<p>Dear %CustomerName%,</p><p>This is to remind you about the payment details for the below invoice.</p><p>----------------------------------------------------------------------------------------</p><p><strong>Invoice# : %InvoiceNumber%</strong></p><p>Due Date :   %DueDate%</p><p>----------------------------------------------------------------------------------------</p><p>Overdue By    :  %OverdueDays%</p><p>Amount           :  %Balance%</p><p>----------------------------------------------------------------------------------------</p><p>View your invoice and take the easy way out by making an <a href="#" target="_blank">online payment</a>.</p><p>If you have already paid, please accept our apologies and kindly ignore this payment reminder.</p><p>Regards,</p>`,
        });

        setCcInput("");
        setBccInput("");
        setIsModalOpen(true);
    };

    // Handle purchase modal open
    const handleOpenPurchaseModal = () => {
        setPurchaseFormData({
            name: "",
            days: "",
            timing: "after",
            reference: "due date",
            enableReminder: true,
            remindTo: "",
            from: "",
            cc: [],
            bcc: [],
            subject: "Purchase Order Reminder - %PurchaseOrderNumber%",
            body: `<p>Dear %SupplierName%,</p><p>This is a reminder regarding your purchase order.</p><p>----------------------------------------------------------------------------------------</p><p><strong>Purchase Order# : %PurchaseOrderNumber%</strong></p><p>Order Date : %OrderDate%</p><p>----------------------------------------------------------------------------------------</p><p>Expected Delivery : %ExpectedDeliveryDate%</p><p>Total Amount : %TotalAmount%</p><p>----------------------------------------------------------------------------------------</p><p>Please ensure timely delivery as per the agreed schedule.</p><p>Regards,</p>`,
        });

        setCcInput("");
        setBccInput("");
        setIsPurchaseModalOpen(true);
    };

    // Handle form submission
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        // Validate days field
        if (!formData.days || formData.days.trim() === "") {
            toast.error("Please enter the number of days");
            return;
        }

        const daysNumber = parseInt(formData.days);
        if (isNaN(daysNumber) || daysNumber < 0) {
            toast.error("Please enter a valid number of days");
            return;
        }

        // Check reminder limits (only for new reminders, not when editing)
        if (!editingReminderId) {
            if (formData.timing === "before" && reminderCounts.before >= 5) {
                toast.error(
                    "Maximum limit reached: You can only create 5 'before' reminders"
                );
                return;
            }
            if (formData.timing === "after" && reminderCounts.after >= 5) {
                toast.error(
                    "Maximum limit reached: You can only create 5 'after' reminders"
                );
                return;
            }
            if (formData.timing === "duedate" && reminderCounts.duedate >= 1) {
                toast.error(
                    "Maximum limit reached: You can only create 1 'due date' reminder"
                );
                return;
            }
        } else {
            // When editing, check if changing timing would exceed limits
            const currentReminder = automatedReminders.find(r => r.id === editingReminderId);
            if (currentReminder && currentReminder.remindTiming !== formData.timing) {
                // User is changing the timing, check new timing limits
                if (formData.timing === "before" && reminderCounts.before >= 5) {
                    toast.error(
                        "Maximum limit reached: You can only have 5 'before' reminders"
                    );
                    return;
                }
                if (formData.timing === "after" && reminderCounts.after >= 5) {
                    toast.error(
                        "Maximum limit reached: You can only have 5 'after' reminders"
                    );
                    return;
                }
                if (formData.timing === "duedate" && reminderCounts.duedate >= 1) {
                    toast.error(
                        "Maximum limit reached: You can only have 1 'due date' reminder"
                    );
                    return;
                }
            }
        }

        setIsSubmitting(true);

        try {
            // Extract email from "me (email@example.com)" format
            const extractEmail = (value: string): string => {
                const match = value.match(/\(([^)]+)\)/);
                return match ? match[1] : value;
            };

            const payload = {
                name: formData.name,
                type: "automatic",
                isEnabled: formData.enableReminder,
                remindDays: daysNumber,
                remindTiming: formData.timing,
                emailConfig: {
                    remindTo: extractEmail(formData.remindTo),
                    fromEmail: formData.from,
                    cc: formData.cc,
                    bcc: formData.bcc,
                    subject: formData.subject,
                    body: formData.body,
                },
            };

            if (editingReminderId) {
                // Update existing reminder
                await axios.put(
                    `${Constants.UPDATE_REMINDER_URL}/${editingReminderId}`,
                    payload,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    }
                );
                toast.success("Reminder updated successfully");
            } else {
                // Create new reminder
                await axios.post(Constants.CREATE_REMINDER_URL, payload, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                toast.success("Automated reminder created successfully");
            }

            // Close modal and reset form
            handleCloseModal();

            // Refresh reminders list
            fetchReminders();
        } catch (error: any) {
            console.error("Error creating reminder:", error);
            toast.error(
                error.response?.data?.message || "Failed to create automated reminder"
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    const sectionHeaderClass = "flex items-center gap-2 px-5 py-4 border-b border-border text-lg font-semibold text-heading";

    return (
        <div className="min-h-screen bg-surface">
            <PageHeader title="Reminders" />
            {/* QuotationReminderList */}
            <QuotationReminderList
                reminders={automatedReminders}
                onSuccess={() => fetchReminders()}
                isEditing={(id: string) => { setIsQuotationModalOpen(true); setEditingQuotationReminder(automatedReminders.find(r => r.id === id) || null) }}
                onDelete={(id: string) => handleDeleteReminder(id)}
            />
            {/* Quoation Reminder Modal */}
            <QuotationReminderModal
                isOpen={isQuotationModalOpen}
                editingReminder={editingQuotationReminder}
                onClose={() => setIsQuotationModalOpen(false)}
                onSuccess={() => fetchReminders()}
            >
            </QuotationReminderModal>
            {/* Delete Reminder Modal */}
            <DeleteConfirmationModal
                isOpen={isDeleteModelOpen}
                onClose={() => setIsDeleteModelOpen(false)}
                onConfirm={handleDeleteConfirmation}
                isDeleting={isDeleting}
                title="Delete Reminder Confirmation"
                message="Are you sure you want to delete this reminder?"
            ></DeleteConfirmationModal>
            {/* Content */}
            <div className="max-w-7xl mx-auto p-6 space-y-8">
                {/* Manual Reminders Section */}
                <Card
                    padded={false}
                    header={<div className={sectionHeaderClass}>Manual Reminders</div>}
                >
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-surface border-b border-border">
                                    <th className="px-6 py-3 text-left text-xs font-medium text-body uppercase tracking-wider">
                                        Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-body uppercase tracking-wider">
                                        Description
                                    </th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-body uppercase tracking-wider">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-border">
                                {manualReminders.map((reminder) => (
                                    <tr
                                        key={reminder.id}
                                        className="hover:bg-surface transition-colors"
                                    >
                                        <td className="px-6 py-4">
                                            <button
                                                onClick={() => handleManualReminderClick(reminder)}
                                                className="text-info hover:opacity-80 hover:underline font-medium text-left"
                                            >
                                                {reminder.name}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-body">
                                            {reminder.description}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleManualReminderClick(reminder)}
                                                title="Edit"
                                            >
                                                <Edit size={16} />
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>

                {/* Automated Reminders Section */}
                <Card
                    padded={false}
                    header={<div className={sectionHeaderClass}>Automated Reminders</div>}
                >
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-surface border-b border-border">
                                    <th className="px-6 py-3 text-left text-xs font-medium text-body uppercase tracking-wider">
                                        Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-body uppercase tracking-wider">
                                        Schedule
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-body uppercase tracking-wider">
                                        Status
                                    </th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-body uppercase tracking-wider">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-border">
                                {isLoading ? (
                                    <tr>
                                        <td
                                            colSpan={4}
                                            className="px-6 py-8 text-center text-body"
                                        >
                                            Loading reminders...
                                        </td>
                                    </tr>
                                ) : (
                                    <>
                                        {/* Payment Expected Category */}
                                        {automatedReminders.filter(
                                            (r) => r.remindEvent === "expected_payment_date"
                                        ).length > 0 && (
                                                <>
                                                    <tr className="bg-surface">
                                                        <td
                                                            colSpan={4}
                                                            className="px-6 py-3 text-sm font-medium text-heading"
                                                        >
                                                            Reminders Based on Expected Payment Date
                                                        </td>
                                                    </tr>
                                                    {automatedReminders
                                                        .filter(
                                                            (r) => r.remindEvent === "expected_payment_date"
                                                        )
                                                        .map((reminder) => (
                                                            <tr
                                                                key={reminder.id}
                                                                className="hover:bg-surface transition-colors"
                                                            >
                                                                <td className="px-6 py-4">
                                                                    <div className="flex items-center gap-2">
                                                                        <a
                                                                            href="#"
                                                                            className={`hover:underline font-medium ${reminder.type === "automatic_Purchase"
                                                                                ? "text-success hover:opacity-80"
                                                                                : "text-info hover:opacity-80"
                                                                                }`}
                                                                        >
                                                                            {reminder.name}
                                                                        </a>
                                                                        <button
                                                                            className="text-body hover:text-heading"
                                                                            title="Info"
                                                                        >
                                                                            <Info size={16} />
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-4 text-sm text-body">
                                                                    {reminder.remindTiming === "duedate" || reminder.remindDays === 0
                                                                        ? "Due date"
                                                                        : `${reminder.remindDays} day(s) ${reminder.remindTiming.charAt(0).toUpperCase() +
                                                                        reminder.remindTiming.slice(1)
                                                                        }`}
                                                                </td>
                                                                <td className="px-6 py-4">
                                                                    <button
                                                                        onClick={() => toggleStatus(reminder.id)}
                                                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${reminder.isEnabled
                                                                            ? "bg-purple-600"
                                                                            : "bg-border"
                                                                            }`}
                                                                    >
                                                                        <span
                                                                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${reminder.isEnabled
                                                                                ? "translate-x-6"
                                                                                : "translate-x-1"
                                                                                }`}
                                                                        />
                                                                    </button>
                                                                </td>
                                                                <td className="px-6 py-4 text-right">
                                                                    <div className="relative">
                                                                        <Button
                                                                            type="button"
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                toggleActionDropdown(reminder.id);
                                                                            }}
                                                                        >
                                                                            <MoreVertical size={18} />
                                                                        </Button>

                                                                        {openActionDropdown === reminder.id && (
                                                                            <div className="absolute right-0 mt-2 w-40 bg-white rounded-card shadow-dropdown border border-border py-1 z-10">
                                                                                <button
                                                                                    onClick={() =>
                                                                                        handleEditReminder(reminder)
                                                                                    }
                                                                                    className="w-full px-4 py-2.5 text-left text-sm text-heading hover:bg-primary-soft hover:text-primary flex items-center gap-3 transition-colors"
                                                                                >
                                                                                    <Edit size={16} />
                                                                                    Edit
                                                                                </button>
                                                                                <button
                                                                                    onClick={() =>
                                                                                        handleDeleteReminder(reminder.id)
                                                                                    }
                                                                                    className="w-full px-4 py-2.5 text-left text-sm text-danger hover:bg-danger-soft flex items-center gap-3 transition-colors"
                                                                                >
                                                                                    <Trash2 size={16} />
                                                                                    Delete
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                </>
                                            )}

                                        {/* Due Date Category */}
                                        {automatedReminders.filter(
                                            (r) => r.remindEvent === "due_date"
                                        ).length > 0 && (
                                                <>
                                                    {/* <tr className="bg-gray-50">
                          <td
                            colSpan={4}
                            className="px-6 py-3 text-sm font-medium text-gray-700"
                          >
                            Reminders Based on Due Date
                          </td>
                        </tr> */}
                                                    {automatedReminders
                                                        .filter((r) => r.remindEvent === "due_date")
                                                        .map((reminder) => (
                                                            <tr
                                                                key={reminder.id}
                                                                className="hover:bg-surface transition-colors"
                                                            >
                                                                <td className="px-6 py-4">
                                                                    <a
                                                                        href="#"
                                                                        className={`hover:underline font-medium ${reminder.type === "automatic_Purchase"
                                                                            ? "text-success hover:opacity-80"
                                                                            : "text-info hover:opacity-80"
                                                                            }`}
                                                                    >
                                                                        {reminder.name}
                                                                    </a>
                                                                </td>
                                                                <td className="px-6 py-4 text-sm text-body">
                                                                    {reminder.remindTiming === "duedate" || reminder.remindDays === 0
                                                                        ? "Due date"
                                                                        : `${reminder.remindDays} day(s) ${reminder.remindTiming.charAt(0).toUpperCase() +
                                                                        reminder.remindTiming.slice(1)
                                                                        }`}
                                                                </td>
                                                                <td className="px-6 py-4">
                                                                    <button
                                                                        onClick={() => toggleStatus(reminder.id)}
                                                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${reminder.isEnabled
                                                                            ? "bg-purple-600"
                                                                            : "bg-border"
                                                                            }`}
                                                                    >
                                                                        <span
                                                                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${reminder.isEnabled
                                                                                ? "translate-x-6"
                                                                                : "translate-x-1"
                                                                                }`}
                                                                        />
                                                                    </button>
                                                                </td>
                                                                <td className="px-6 py-4 text-right">
                                                                    <div className="relative">
                                                                        <Button
                                                                            type="button"
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                toggleActionDropdown(reminder.id);
                                                                            }}
                                                                        >
                                                                            <MoreVertical size={18} />
                                                                        </Button>

                                                                        {openActionDropdown === reminder.id && (
                                                                            <div className="absolute right-0 mt-2 w-40 bg-white rounded-card shadow-dropdown border border-border py-1 z-10">
                                                                                <button
                                                                                    onClick={() =>
                                                                                        handleEditReminder(reminder)
                                                                                    }
                                                                                    className="w-full px-4 py-2.5 text-left text-sm text-heading hover:bg-primary-soft hover:text-primary flex items-center gap-3 transition-colors"
                                                                                >
                                                                                    <Edit size={16} />
                                                                                    Edit
                                                                                </button>
                                                                                <button
                                                                                    onClick={() =>
                                                                                        handleDeleteReminder(reminder.id)
                                                                                    }
                                                                                    className="w-full px-4 py-2.5 text-left text-sm text-danger hover:bg-danger-soft flex items-center gap-3 transition-colors"
                                                                                >
                                                                                    <Trash2 size={16} />
                                                                                    Delete
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                </>
                                            )}

                                        {automatedReminders.length === 0 && (
                                            <tr>
                                                <td
                                                    colSpan={4}
                                                    className="px-6 py-8 text-center text-body"
                                                >
                                                    No automated reminders found. Click "New Reminder" to
                                                    create one.
                                                </td>
                                            </tr>
                                        )}
                                    </>
                                )}

                                {/* New Reminder Button Row */}
                                {canCreateReminder && (
                                    <tr className="hover:bg-surface transition-colors">
                                        <td colSpan={4} className="px-6 py-4">
                                            <div className="flex items-center gap-4">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    leftIcon={<Plus size={18} />}
                                                    onClick={handleOpenModal}
                                                    className="text-info hover:text-info"
                                                >
                                                    New Reminder
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    leftIcon={<Plus size={18} />}
                                                    onClick={handleOpenPurchaseModal}
                                                    className="text-success hover:text-success"
                                                >
                                                    Purchase Reminder
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    leftIcon={<Plus size={18} />}
                                                    onClick={() => { setEditingQuotationReminder(null); setIsQuotationModalOpen(true); }}
                                                    className="text-purple-600 hover:text-purple-700"
                                                >
                                                    Quotation Reminder
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                )}

                                {/* Message when all reminder slots are full */}
                                {!canCreateReminder && (
                                    <tr>
                                        <td
                                            colSpan={4}
                                            className="px-6 py-4 text-center text-body text-sm"
                                        >
                                            Maximum reminder limit reached. You have created 5 before
                                            reminders, 5 after reminders, and 1 due date reminder.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
                        {/* Background overlay */}
                        <div
                            className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
                            onClick={handleCloseModal}
                        ></div>

                        {/* Modal panel */}
                        <div className="relative inline-block align-bottom bg-white rounded-card border border-border text-left overflow-hidden shadow-dropdown transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full z-50">
                            {/* Modal Header */}
                            <div className="px-6 py-4 border-b border-border">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-semibold text-heading">
                                        {editingReminderId
                                            ? "Edit Reminder"
                                            : "New Automated Reminder"}
                                    </h3>
                                    <button
                                        onClick={handleCloseModal}
                                        className="text-body hover:text-heading transition-colors"
                                    >
                                        <X size={24} />
                                    </button>
                                </div>
                            </div>

                            {/* Modal Body */}
                            <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6">
                                {/* Name Field */}
                                <FormField
                                    label="Name"
                                    required
                                    name="name"
                                    type="text"
                                    value={formData.name}
                                    onChange={handleInputChange}
                                />

                                {/* Remind Section */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-medium text-heading">
                                            Remind
                                        </label>
                                        <span className="text-xs text-body">
                                            Limits: After ({reminderCounts.after}/5) | Before (
                                            {reminderCounts.before}/5) | Due Date (
                                            {reminderCounts.duedate}/1)
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <FormField
                                            name="days"
                                            type="text"
                                            value={formData.days}
                                            onChange={handleInputChange}
                                            placeholder="0"
                                            required
                                            containerClassName="w-24"
                                        />
                                        <span className="text-sm text-body">day(s)</span>
                                        <Select
                                            name="timing"
                                            value={formData.timing}
                                            onChange={handleInputChange}
                                            containerClassName="flex-1"
                                            options={[
                                                {
                                                    value: "after",
                                                    label: `after (${reminderCounts.after >= 5 ? "5/5" : `${reminderCounts.after}/5`})`,
                                                    disabled: reminderCounts.after >= 5,
                                                },
                                                {
                                                    value: "before",
                                                    label: `before (${reminderCounts.before >= 5 ? "5/5" : `${reminderCounts.before}/5`})`,
                                                    disabled: reminderCounts.before >= 5,
                                                },
                                                { value: "duedate", label: "due date" },
                                            ]}
                                        />
                                    </div>
                                </div>

                                {/* Enable Reminder Checkbox */}
                                <div className="flex items-center">
                                    <input
                                        type="checkbox"
                                        name="enableReminder"
                                        checked={formData.enableReminder}
                                        onChange={handleInputChange}
                                        className="h-4 w-4 text-purple-600 focus:ring-purple-600 border-border rounded"
                                    />
                                    <label className="ml-2 block text-sm text-heading">
                                        Enable this reminder
                                    </label>
                                </div>

                                {/* Remind To Field */}
                                <Select
                                    label="Remind"
                                    name="remindTo"
                                    value={formData.remindTo}
                                    onChange={handleInputChange}
                                    required
                                    placeholder="Select recipient"
                                    options={[
                                        { value: "customer", label: "customer" },
                                        { value: "customer and copy me", label: "customer and copy me" },
                                    ]}
                                />

                                {/* From Field */}
                                <FormField
                                    label="From"
                                    required
                                    name="from"
                                    type="email"
                                    value={formData.from}
                                    onChange={handleInputChange}
                                    placeholder="Enter sender email address"
                                    helper="This email address will be used as the from address while sending. Other users can choose their email address if they wish to change it."
                                />

                                {/* Cc Field */}
                                <div>
                                    <label className="block text-sm font-medium text-heading mb-2">
                                        Cc
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="email"
                                            value={ccInput}
                                            onChange={(e) => setCcInput(e.target.value)}
                                            onKeyPress={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    handleAddCc();
                                                }
                                            }}
                                            placeholder="Enter email address"
                                            className={`flex-1 ${fieldControlClasses(false)}`}
                                        />
                                        <Button type="button" variant="primary" size="sm" onClick={handleAddCc}>
                                            Add
                                        </Button>
                                    </div>
                                    {formData.cc.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {formData.cc.map((email, index) => (
                                                <Badge key={index} color="info" variant="soft" className="gap-1">
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
                                </div>

                                {/* Bcc Field */}
                                <div>
                                    <label className="block text-sm font-medium text-heading mb-2">
                                        Bcc
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="email"
                                            value={bccInput}
                                            onChange={(e) => setBccInput(e.target.value)}
                                            onKeyPress={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    handleAddBcc();
                                                }
                                            }}
                                            placeholder="Enter email address"
                                            className={`flex-1 ${fieldControlClasses(false)}`}
                                        />
                                        <Button type="button" variant="primary" size="sm" onClick={handleAddBcc}>
                                            Add
                                        </Button>
                                    </div>
                                    {formData.bcc.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {formData.bcc.map((email, index) => (
                                                <Badge key={index} color="info" variant="soft" className="gap-1">
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
                                </div>

                                {/* Subject Field */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-medium text-heading">
                                            Subject
                                        </label>
                                        <div className="relative">
                                            <select
                                                value={selectedPlaceholder}
                                                onChange={(e) => {
                                                    if (e.target.value) {
                                                        handlePlaceholderSelect(e.target.value, "subject");
                                                    }
                                                }}
                                                className="text-sm text-purple-600 border border-purple-600 rounded-control px-2 py-1 hover:bg-purple-600 hover:text-white cursor-pointer"
                                            >
                                                <option value="">Insert Placeholder</option>
                                                {Array.isArray(placeholders) && placeholders.map((placeholder, index) => (
                                                    <option key={index} value={placeholder.key}>
                                                        {placeholder.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <input
                                        type="text"
                                        name="subject"
                                        value={formData.subject}
                                        onChange={handleInputChange}
                                        className={fieldControlClasses(false)}
                                        required
                                    />
                                </div>

                                {/* Body Field */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-medium text-heading">
                                            Body
                                        </label>
                                        <div className="relative">
                                            <select
                                                value={selectedPlaceholder}
                                                onChange={(e) => {
                                                    if (e.target.value) {
                                                        handlePlaceholderSelect(e.target.value, "body");
                                                    }
                                                }}
                                                className="text-sm text-purple-600 border border-purple-600 rounded-control px-2 py-1 hover:bg-purple-600 hover:text-white cursor-pointer"
                                            >
                                                <option value="">Insert Placeholder</option>
                                                {Array.isArray(placeholders) && placeholders.map((placeholder, index) => (
                                                    <option key={index} value={placeholder.key}>
                                                        {placeholder.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="border border-border rounded-control overflow-hidden">
                                        <QuillEditor
                                            ref={quillEditorRef}
                                            value={formData.body}
                                            onChange={handleBodyChange}
                                            height="300px"
                                        />
                                    </div>
                                </div>

                                {/* Modal Footer */}
                                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                                    <Button
                                        type="button"
                                        variant="white"
                                        onClick={handleCloseModal}
                                    >
                                        Cancel
                                    </Button>
                                    <SubmitButton
                                        isLoading={isSubmitting}
                                        mode={editingReminderId ? "edit" : "create"}
                                    >
                                        {editingReminderId ? "Update" : "Save"}
                                    </SubmitButton>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* Manual Reminder Modal */}
            {isManualModalOpen && selectedManualReminder && (
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
                        {/* Background overlay */}
                        <div
                            className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
                            onClick={() => setIsManualModalOpen(false)}
                        ></div>

                        {/* Modal panel */}
                        <div className="relative inline-block align-bottom bg-white rounded-card border border-border text-left overflow-hidden shadow-dropdown transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full z-50">
                            {/* Modal Header */}
                            <div className="px-6 py-4 border-b border-border">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-semibold text-heading">
                                        {selectedManualReminder.name}
                                    </h3>
                                    <button
                                        onClick={() => setIsManualModalOpen(false)}
                                        className="text-body hover:text-heading transition-colors"
                                    >
                                        <X size={24} />
                                    </button>
                                </div>
                            </div>

                            {/* Modal Body */}
                            <div className="px-6 py-6 space-y-6">
                                {/* From Field */}
                                <FormField
                                    label="From"
                                    name="from"
                                    type="email"
                                    value={manualFormData.from}
                                    onChange={handleManualInputChange}
                                    placeholder="Enter sender email address"
                                    helper="This email address will be used as the from address while sending. Other users can choose their email address if they wish to change it."
                                />

                                {/* Cc Field */}
                                <div>
                                    <label className="block text-sm font-medium text-heading mb-2">
                                        Cc
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="email"
                                            value={ccInput}
                                            onChange={(e) => setCcInput(e.target.value)}
                                            onKeyPress={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    if (ccInput.trim() && isValidEmail(ccInput)) {
                                                        setManualFormData((prev) => ({
                                                            ...prev,
                                                            cc: [...prev.cc, ccInput.trim()],
                                                        }));
                                                        setCcInput("");
                                                    } else {
                                                        toast.error("Please enter a valid email address");
                                                    }
                                                }
                                            }}
                                            placeholder="Enter email address"
                                            className={`flex-1 ${fieldControlClasses(false)}`}
                                        />
                                        <Button
                                            type="button"
                                            variant="primary"
                                            size="sm"
                                            onClick={() => {
                                                if (ccInput.trim() && isValidEmail(ccInput)) {
                                                    setManualFormData((prev) => ({
                                                        ...prev,
                                                        cc: [...prev.cc, ccInput.trim()],
                                                    }));
                                                    setCcInput("");
                                                } else {
                                                    toast.error("Please enter a valid email address");
                                                }
                                            }}
                                        >
                                            Add
                                        </Button>
                                    </div>
                                    {manualFormData.cc.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {manualFormData.cc.map((email, index) => (
                                                <Badge key={index} color="info" variant="soft" className="gap-1">
                                                    {email}
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setManualFormData((prev) => ({
                                                                ...prev,
                                                                cc: prev.cc.filter((e) => e !== email),
                                                            }));
                                                        }}
                                                        className="hover:opacity-70"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Bcc Field */}
                                <div>
                                    <label className="block text-sm font-medium text-heading mb-2">
                                        Bcc
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="email"
                                            value={bccInput}
                                            onChange={(e) => setBccInput(e.target.value)}
                                            onKeyPress={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    if (bccInput.trim() && isValidEmail(bccInput)) {
                                                        setManualFormData((prev) => ({
                                                            ...prev,
                                                            bcc: [...prev.bcc, bccInput.trim()],
                                                        }));
                                                        setBccInput("");
                                                    } else {
                                                        toast.error("Please enter a valid email address");
                                                    }
                                                }
                                            }}
                                            placeholder="Enter email address"
                                            className={`flex-1 ${fieldControlClasses(false)}`}
                                        />
                                        <Button
                                            type="button"
                                            variant="primary"
                                            size="sm"
                                            onClick={() => {
                                                if (bccInput.trim() && isValidEmail(bccInput)) {
                                                    setManualFormData((prev) => ({
                                                        ...prev,
                                                        bcc: [...prev.bcc, bccInput.trim()],
                                                    }));
                                                    setBccInput("");
                                                } else {
                                                    toast.error("Please enter a valid email address");
                                                }
                                            }}
                                        >
                                            Add
                                        </Button>
                                    </div>
                                    {manualFormData.bcc.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {manualFormData.bcc.map((email, index) => (
                                                <Badge key={index} color="info" variant="soft" className="gap-1">
                                                    {email}
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setManualFormData((prev) => ({
                                                                ...prev,
                                                                bcc: prev.bcc.filter((e) => e !== email),
                                                            }));
                                                        }}
                                                        className="hover:opacity-70"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Subject Field */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-medium text-heading">
                                            Subject
                                        </label>
                                        <div className="relative">
                                            <select
                                                value={selectedPlaceholder}
                                                onChange={(e) => {
                                                    if (e.target.value) {
                                                        handleManualPlaceholderSelect(e.target.value, "subject");
                                                    }
                                                }}
                                                className="text-sm text-purple-600 border border-purple-600 rounded-control px-2 py-1 hover:bg-purple-600 hover:text-white cursor-pointer"
                                            >
                                                <option value="">Insert Placeholder</option>
                                                {Array.isArray(placeholders) && placeholders.map((placeholder, index) => (
                                                    <option key={index} value={placeholder.key}>
                                                        {placeholder.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <input
                                        type="text"
                                        name="subject"
                                        value={manualFormData.subject}
                                        onChange={handleManualInputChange}
                                        className={fieldControlClasses(false)}
                                    />
                                </div>

                                {/* Body Field */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-medium text-heading">
                                            Normal Text
                                        </label>
                                        <div className="relative">
                                            <select
                                                value={selectedPlaceholder}
                                                onChange={(e) => {
                                                    if (e.target.value) {
                                                        handleManualPlaceholderSelect(e.target.value, "body");
                                                    }
                                                }}
                                                className="text-sm text-purple-600 border border-purple-600 rounded-control px-2 py-1 hover:bg-purple-600 hover:text-white cursor-pointer"
                                            >
                                                <option value="">Insert Placeholder</option>
                                                {Array.isArray(placeholders) && placeholders.map((placeholder, index) => (
                                                    <option key={index} value={placeholder.key}>
                                                        {placeholder.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="border border-border rounded-control overflow-hidden">
                                        <QuillEditor
                                            ref={manualQuillEditorRef}
                                            value={manualFormData.body}
                                            onChange={handleManualBodyChange}
                                            height="300px"
                                        />
                                    </div>
                                </div>

                                {/* Modal Footer */}
                                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                                    <Button
                                        type="button"
                                        variant="white"
                                        onClick={() => {
                                            setIsManualModalOpen(false);
                                            setSelectedManualReminder(null);
                                        }}
                                        disabled={isSubmitting}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="primary"
                                        onClick={handleManualReminderSave}
                                        disabled={isSubmitting}
                                        isLoading={isSubmitting}
                                    >
                                        {isSubmitting ? "Saving..." : "Save"}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Purchase Reminder Modal - Similar to Automated Reminder Modal */}
            {isPurchaseModalOpen && (
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
                        <div
                            className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
                            onClick={() => setIsPurchaseModalOpen(false)}
                        ></div>

                        <div className="relative inline-block align-bottom bg-white rounded-card border border-border text-left overflow-hidden shadow-dropdown transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full z-50">
                            <div className="px-6 py-4 border-b border-border">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-semibold text-heading">
                                        {editingReminderId ? "Edit Purchase Reminder" : "New Purchase Reminder"}
                                    </h3>
                                    <button
                                        onClick={() => {
                                            setIsPurchaseModalOpen(false);
                                            setEditingReminderId(null);
                                        }}
                                        className="text-body hover:text-heading transition-colors"
                                    >
                                        <X size={24} />
                                    </button>
                                </div>
                            </div>

                            <form onSubmit={handlePurchaseReminderSave} className="px-6 py-6 space-y-6">
                                <FormField
                                    label="Name"
                                    required
                                    name="name"
                                    type="text"
                                    value={purchaseFormData.name}
                                    onChange={handlePurchaseInputChange}
                                />

                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-medium text-heading">
                                            Remind
                                        </label>
                                        <span className="text-xs text-body">
                                            Limits: After ({purchaseReminderCounts.after}/5) | Before ({purchaseReminderCounts.before}/5) | Due Date ({purchaseReminderCounts.duedate}/1)
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <FormField
                                            name="days"
                                            type="text"
                                            value={purchaseFormData.days}
                                            onChange={handlePurchaseInputChange}
                                            placeholder="0"
                                            required
                                            containerClassName="w-24"
                                        />
                                        <span className="text-sm text-body">day(s)</span>
                                        <Select
                                            name="timing"
                                            value={purchaseFormData.timing}
                                            onChange={handlePurchaseInputChange}
                                            containerClassName="flex-1"
                                            options={[
                                                {
                                                    value: "after",
                                                    label: `after (${purchaseReminderCounts.after >= 5 ? "5/5" : `${purchaseReminderCounts.after}/5`})`,
                                                    disabled: purchaseReminderCounts.after >= 5,
                                                },
                                                {
                                                    value: "before",
                                                    label: `before (${purchaseReminderCounts.before >= 5 ? "5/5" : `${purchaseReminderCounts.before}/5`})`,
                                                    disabled: purchaseReminderCounts.before >= 5,
                                                },
                                                { value: "duedate", label: "due date" },
                                            ]}
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center">
                                    <input
                                        type="checkbox"
                                        name="enableReminder"
                                        checked={purchaseFormData.enableReminder}
                                        onChange={handlePurchaseInputChange}
                                        className="h-4 w-4 text-purple-600 focus:ring-purple-600 border-border rounded"
                                    />
                                    <label className="ml-2 block text-sm text-heading">
                                        Enable this reminder
                                    </label>
                                </div>

                                {/* Remind To Field */}
                                <Select
                                    label="Remind"
                                    name="remindTo"
                                    value={purchaseFormData.remindTo}
                                    onChange={handlePurchaseInputChange}
                                    required
                                    placeholder="Select recipient"
                                    options={[
                                        { value: "customer", label: "customer" },
                                        { value: "customer and copy me", label: "customer and copy me" },
                                    ]}
                                />

                                {/* From Field */}
                                <FormField
                                    label="From"
                                    required
                                    name="from"
                                    type="email"
                                    value={purchaseFormData.from}
                                    onChange={handlePurchaseInputChange}
                                    placeholder="Enter sender email address"
                                    helper="This email address will be used as the from address while sending. Other users can choose their email address if they wish to change it."
                                />

                                {/* Cc Field */}
                                <div>
                                    <label className="block text-sm font-medium text-heading mb-2">
                                        Cc
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="email"
                                            value={ccInput}
                                            onChange={(e) => setCcInput(e.target.value)}
                                            onKeyPress={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    if (ccInput.trim() && isValidEmail(ccInput)) {
                                                        setPurchaseFormData((prev) => ({
                                                            ...prev,
                                                            cc: [...prev.cc, ccInput.trim()],
                                                        }));
                                                        setCcInput("");
                                                    } else {
                                                        toast.error("Please enter a valid email address");
                                                    }
                                                }
                                            }}
                                            placeholder="Enter email address"
                                            className={`flex-1 ${fieldControlClasses(false)}`}
                                        />
                                        <Button
                                            type="button"
                                            variant="primary"
                                            size="sm"
                                            onClick={() => {
                                                if (ccInput.trim() && isValidEmail(ccInput)) {
                                                    setPurchaseFormData((prev) => ({
                                                        ...prev,
                                                        cc: [...prev.cc, ccInput.trim()],
                                                    }));
                                                    setCcInput("");
                                                } else {
                                                    toast.error("Please enter a valid email address");
                                                }
                                            }}
                                        >
                                            Add
                                        </Button>
                                    </div>
                                    {purchaseFormData.cc.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {purchaseFormData.cc.map((email, index) => (
                                                <Badge key={index} color="info" variant="soft" className="gap-1">
                                                    {email}
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setPurchaseFormData((prev) => ({
                                                                ...prev,
                                                                cc: prev.cc.filter((e) => e !== email),
                                                            }));
                                                        }}
                                                        className="hover:opacity-70"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Bcc Field */}
                                <div>
                                    <label className="block text-sm font-medium text-heading mb-2">
                                        Bcc
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="email"
                                            value={bccInput}
                                            onChange={(e) => setBccInput(e.target.value)}
                                            onKeyPress={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    if (bccInput.trim() && isValidEmail(bccInput)) {
                                                        setPurchaseFormData((prev) => ({
                                                            ...prev,
                                                            bcc: [...prev.bcc, bccInput.trim()],
                                                        }));
                                                        setBccInput("");
                                                    } else {
                                                        toast.error("Please enter a valid email address");
                                                    }
                                                }
                                            }}
                                            placeholder="Enter email address"
                                            className={`flex-1 ${fieldControlClasses(false)}`}
                                        />
                                        <Button
                                            type="button"
                                            variant="primary"
                                            size="sm"
                                            onClick={() => {
                                                if (bccInput.trim() && isValidEmail(bccInput)) {
                                                    setPurchaseFormData((prev) => ({
                                                        ...prev,
                                                        bcc: [...prev.bcc, bccInput.trim()],
                                                    }));
                                                    setBccInput("");
                                                } else {
                                                    toast.error("Please enter a valid email address");
                                                }
                                            }}
                                        >
                                            Add
                                        </Button>
                                    </div>
                                    {purchaseFormData.bcc.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {purchaseFormData.bcc.map((email, index) => (
                                                <Badge key={index} color="info" variant="soft" className="gap-1">
                                                    {email}
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setPurchaseFormData((prev) => ({
                                                                ...prev,
                                                                bcc: prev.bcc.filter((e) => e !== email),
                                                            }));
                                                        }}
                                                        className="hover:opacity-70"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Subject Field */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-medium text-heading">
                                            Subject
                                        </label>
                                        <div className="relative">
                                            <select
                                                value={selectedPlaceholder}
                                                onChange={(e) => {
                                                    if (e.target.value) {
                                                        const formattedPlaceholder = `%${e.target.value}%`;
                                                        setPurchaseFormData((prev) => ({
                                                            ...prev,
                                                            subject: prev.subject + formattedPlaceholder,
                                                        }));
                                                        setSelectedPlaceholder("");
                                                    }
                                                }}
                                                className="text-sm text-purple-600 border border-purple-600 rounded-control px-2 py-1 hover:bg-purple-600 hover:text-white cursor-pointer"
                                            >
                                                <option value="">Insert Placeholder</option>
                                                {Array.isArray(placeholders) && placeholders.map((placeholder, index) => (
                                                    <option key={index} value={placeholder.key}>
                                                        {placeholder.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <input
                                        type="text"
                                        name="subject"
                                        value={purchaseFormData.subject}
                                        onChange={handlePurchaseInputChange}
                                        className={fieldControlClasses(false)}
                                        required
                                    />
                                </div>

                                {/* Body Field */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-medium text-heading">
                                            Body
                                        </label>
                                        <div className="relative">
                                            <select
                                                value={selectedPlaceholder}
                                                onChange={(e) => {
                                                    if (e.target.value) {
                                                        const formattedPlaceholder = `%${e.target.value}%`;
                                                        if (purchaseQuillEditorRef.current) {
                                                            purchaseQuillEditorRef.current.insertText(formattedPlaceholder);
                                                        } else {
                                                            setPurchaseFormData((prev) => ({
                                                                ...prev,
                                                                body: prev.body + formattedPlaceholder,
                                                            }));
                                                        }
                                                        setSelectedPlaceholder("");
                                                    }
                                                }}
                                                className="text-sm text-purple-600 border border-purple-600 rounded-control px-2 py-1 hover:bg-purple-600 hover:text-white cursor-pointer"
                                            >
                                                <option value="">Insert Placeholder</option>
                                                {Array.isArray(placeholders) && placeholders.map((placeholder, index) => (
                                                    <option key={index} value={placeholder.key}>
                                                        {placeholder.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="border border-border rounded-control overflow-hidden">
                                        <QuillEditor
                                            ref={purchaseQuillEditorRef}
                                            value={purchaseFormData.body}
                                            onChange={handlePurchaseBodyChange}
                                            height="300px"
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                                    <Button
                                        type="button"
                                        variant="white"
                                        onClick={() => {
                                            setIsPurchaseModalOpen(false);
                                            setEditingReminderId(null);
                                        }}
                                    >
                                        Cancel
                                    </Button>
                                    <SubmitButton
                                        isLoading={isSubmitting}
                                        mode={editingReminderId ? "edit" : "create"}
                                    >
                                        {editingReminderId ? "Update" : "Save"}
                                    </SubmitButton>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}


        </div>
    );
};

export default Reminder;
