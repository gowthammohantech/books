import { useEffect, useState } from "react";
import axios, { AxiosError } from "axios";
import { toast } from "sonner";
import { useSelector } from "react-redux";
import { Edit, Trash2, CirclePlusIcon } from "lucide-react";

import Constants from "../../../constants/api";
import type { RootState } from "../../../store";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import Modal from "@components/admin/Modal";
import DateInput from "@components/admin/DateInput";
import InputField from "@components/admin/InputField";
import SubmitButton from "@components/admin/SubmitButton";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import PermissionGuard from "@components/admin/PermissionGuard";
import { Button, Badge } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";
import useDateFormatter from "@hooks/useDateFormatter";
import { hasPermission } from "@utils/hasPermission";
import type { Holiday } from "@models/timeTracking";

const MODULE_SLUG = "time-tracking-others";

interface FormErrors {
    name?: string;
    date?: string;
}

interface IForm {
    id?: string;
    name: string;
    date: Date | null;
    recurringYearly: boolean;
}

const emptyForm = (): IForm => ({ name: "", date: null, recurringYearly: false });

/** Extract a human-readable server error message from an axios error. */
const serverMessage = (error: unknown, fallback: string): string => {
    const ax = error as AxiosError<{ message?: string; error?: string }>;
    return ax.response?.data?.message || ax.response?.data?.error || fallback;
};

/** Convert a Date to a UTC date-only ISO string (yyyy-mm-dd) for the API. */
const toDateOnly = (d: Date | null): string | null => {
    if (!d) return null;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
};

const toDate = (v: string | null | undefined): Date | null => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
};

const Holidays: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const canEdit = hasPermission(permissions, MODULE_SLUG, "edit");
    const canDelete = hasPermission(permissions, MODULE_SLUG, "delete");
    const { formatDate } = useDateFormatter();
    const authHeaders = { Authorization: `Bearer ${token}` };

    const [items, setItems] = useState<Holiday[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [form, setForm] = useState<IForm>(emptyForm());
    const [showModal, setShowModal] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [formErrors, setFormErrors] = useState<FormErrors>({});
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<Holiday | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const fetchItems = async () => {
        try {
            setIsLoading(true);
            const res = await axios.get(Constants.HOLIDAYS_URL, { headers: authHeaders });
            setItems((res.data?.data?.holidays ?? []) as Holiday[]);
        } catch (error) {
            toast.error(serverMessage(error, "Failed to fetch holidays."));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchItems();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const openCreate = () => {
        setForm(emptyForm());
        setIsEditMode(false);
        setFormErrors({});
        setShowModal(true);
    };

    const openEdit = (item: Holiday) => {
        setForm({ id: item.id, name: item.name, date: toDate(item.date), recurringYearly: item.recurringYearly });
        setIsEditMode(true);
        setFormErrors({});
        setShowModal(true);
    };

    const validate = (): boolean => {
        const errors: FormErrors = {};
        if (!form.name.trim()) errors.name = "Name is required.";
        if (!form.date) errors.date = "Date is required.";
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validate()) return;
        try {
            setIsSaving(true);
            const payload = {
                name: form.name.trim(),
                date: toDateOnly(form.date),
                recurringYearly: form.recurringYearly,
            };
            if (isEditMode && form.id) {
                await axios.put(Constants.HOLIDAY_URL(form.id), payload, { headers: authHeaders });
                toast.success("Holiday updated successfully.");
            } else {
                await axios.post(Constants.HOLIDAYS_URL, payload, { headers: authHeaders });
                toast.success("Holiday created successfully.");
            }
            setShowModal(false);
            fetchItems();
        } catch (error) {
            const ax = error as AxiosError<{ errors?: FormErrors }>;
            if (ax.response?.data?.errors) {
                setFormErrors(ax.response.data.errors);
            } else {
                toast.error(serverMessage(error, "Failed to save holiday."));
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteClick = (item: Holiday) => {
        setItemToDelete(item);
        setDeleteModalOpen(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            setIsDeleting(true);
            await axios.delete(Constants.HOLIDAY_URL(itemToDelete.id), { headers: authHeaders });
            toast.success("Holiday deleted successfully.");
            setDeleteModalOpen(false);
            fetchItems();
        } catch (error) {
            toast.error(serverMessage(error, "Failed to delete holiday."));
        } finally {
            setIsDeleting(false);
        }
    };

    const tableActions = [
        ...(canEdit
            ? [{ label: "Edit", icon: <Edit size={14} />, onClick: (item: Holiday) => openEdit(item) }]
            : []),
        ...(canDelete
            ? [{ label: "Delete", icon: <Trash2 size={14} />, onClick: (item: Holiday) => handleDeleteClick(item) }]
            : []),
    ];

    const tableHeaders = ["#", "Name", "Date", "Recurring", "Actions"];

    return (
        <div className="space-y-4">
            <PageHeader title="Holidays">
                <PermissionGuard moduleSlug={MODULE_SLUG} action="create">
                    <Button onClick={openCreate} leftIcon={<CirclePlusIcon size={14} />}>
                        Add Holiday
                    </Button>
                </PermissionGuard>
            </PageHeader>

            <Table headers={tableHeaders}>
                {!isLoading && items.length > 0 &&
                    items.map((item, index) => (
                        <TableRow
                            key={item.id}
                            row={item}
                            index={index + 1}
                            columns={[
                                <span className="font-medium text-gray-900">{item.name}</span>,
                                formatDate(item.date),
                                item.recurringYearly ? (
                                    <Badge color="indigo">Yearly</Badge>
                                ) : (
                                    <Badge color="gray">One-off</Badge>
                                ),
                            ]}
                            actions={tableActions}
                        />
                    ))
                }
                {!isLoading && items.length === 0 && (
                    <tr><td className="text-center py-4 font-semibold text-gray-500" colSpan={5}>No Holidays Found</td></tr>
                )}
                {isLoading && (
                    <tr key="loader"><td className="text-center py-2 font-semibold" colSpan={5}><LoaderSpinner /></td></tr>
                )}
            </Table>

            <Modal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                title={isEditMode ? "Edit Holiday" : "Add New Holiday"}
                size="md"
            >
                <form onSubmit={handleSubmit} className="space-y-4">
                    <InputField
                        id="name"
                        label="Name"
                        placeholder="e.g., New Year's Day"
                        required
                        value={form.name}
                        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                        error={formErrors.name}
                    />
                    <div>
                        <DateInput
                            label="Date"
                            isRequired
                            value={form.date}
                            onChange={(date) => setForm((prev) => ({ ...prev, date }))}
                        />
                        {formErrors.date && <p className="mt-1 text-sm text-red-500">{formErrors.date}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="recurringYearly"
                            checked={form.recurringYearly}
                            onChange={(e) => setForm((prev) => ({ ...prev, recurringYearly: e.target.checked }))}
                            className="h-4 w-4 text-purple-600 border-gray-300 rounded"
                        />
                        <label htmlFor="recurringYearly" className="text-sm font-medium text-gray-700">
                            Recurs every year
                        </label>
                    </div>
                    <div className="flex justify-end pt-2 space-x-2">
                        <Button variant="white" onClick={() => setShowModal(false)}>Cancel</Button>
                        <SubmitButton isDisabled={isSaving} isLoading={isSaving} mode={isEditMode ? "edit" : "create"} />
                    </div>
                </form>
            </Modal>

            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={confirmDelete}
                isDeleting={isDeleting}
                title="Delete Holiday"
                message="Are you sure you want to delete this holiday?"
            />
        </div>
    );
};

export default Holidays;
