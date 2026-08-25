import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Constants from "../../../constants/api";
import axios, { AxiosError } from "axios";
import Table from "../../../components/admin/Table";
import PaginationWrapper from "../../../components/admin/PaginationWrapper";
import { Edit, Trash2, CirclePlusIcon } from "lucide-react";
import { toast } from "sonner";
import Modal from "../../../components/admin/Modal";
import { useSelector } from "react-redux";
import type { RootState } from "../../../store";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import TableRow from "@components/admin/TableRow";
import type { Action } from "@components/admin/tableActions";
import SubmitButton from "@components/admin/SubmitButton";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import InputField from "@components/admin/InputField";
import { Button, Checkbox, Switch } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";

interface ICostCenter {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
}

interface Pagination {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

interface FormErrors {
    code?: string;
    name?: string;
}

interface IForm {
    id?: string;
    code: string;
    name: string;
    isActive: boolean;
}

const emptyForm = (): IForm => ({ code: "", name: "", isActive: true });

const CostCenters: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const [searchParams, setSearchParams] = useSearchParams();

    const [items, setItems] = useState<ICostCenter[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [form, setForm] = useState<IForm>(emptyForm());
    const [showModal, setShowModal] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [formErrors, setFormErrors] = useState<FormErrors>({});
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<ICostCenter | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const search = searchParams.get("search") || "";
    const limit = Number(searchParams.get("limit") || 10);
    const page = Number(searchParams.get("page") || 1);
    const authHeaders = { Authorization: `Bearer ${token}` };

    const fetchItems = async (s?: string, l?: number, p?: number) => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.FETCH_COST_CENTERS_URL, {
                params: { search: s, limit: l, page: p },
                headers: authHeaders,
            });
            setItems(response.data.data || []);
            if (response.data.pagination) setPagination(response.data.pagination);
        } catch {
            toast.error("Failed to fetch cost centers.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchItems(search, limit, page); }, [search, limit, page]);

    const handleSearch = (keyword: string) => setSearchParams({ search: keyword, limit: String(limit), page: "1" });
    const handlePageLengthChange = (newLimit: number) => setSearchParams({ search, limit: String(newLimit), page: "1" });
    const handlePageChange = (newPage: number) => setSearchParams({ search, limit: String(limit), page: String(newPage) });

    const openCreate = () => { setForm(emptyForm()); setIsEditMode(false); setFormErrors({}); setShowModal(true); };

    const openEdit = (item: ICostCenter) => {
        setForm({ id: item.id, code: item.code, name: item.name, isActive: item.isActive });
        setIsEditMode(true);
        setFormErrors({});
        setShowModal(true);
    };

    const validate = (): boolean => {
        const errors: FormErrors = {};
        if (!form.code.trim()) errors.code = "Code is required.";
        if (!form.name.trim()) errors.name = "Name is required.";
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validate()) return;
        try {
            setIsSaving(true);
            const payload = { code: form.code, name: form.name, isActive: form.isActive };
            if (isEditMode && form.id) {
                await axios.put(`${Constants.UPDATE_COST_CENTER_URL}/${form.id}`, payload, { headers: authHeaders });
                toast.success("Cost center updated successfully.");
            } else {
                await axios.post(Constants.CREATE_COST_CENTER_URL, payload, { headers: authHeaders });
                toast.success("Cost center created successfully.");
            }
            setShowModal(false);
            fetchItems(search, limit, page);
        } catch (error) {
            const axiosError = error as AxiosError<{ errors: FormErrors }>;
            if (axiosError.response?.data?.errors) {
                setFormErrors(axiosError.response.data.errors);
            } else {
                toast.error("Failed to save cost center.");
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteClick = (item: ICostCenter) => { setItemToDelete(item); setDeleteModalOpen(true); };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_COST_CENTER_URL}/${itemToDelete.id}`, { headers: authHeaders });
            toast.success("Cost center deleted successfully.");
            fetchItems(search, limit, page);
            setDeleteModalOpen(false);
        } catch {
            toast.error("Failed to delete cost center.");
        } finally {
            setIsDeleting(false);
        }
    };

    const updateActive = async (item: ICostCenter) => {
        try {
            await axios.put(`${Constants.UPDATE_COST_CENTER_URL}/${item.id}`, { ...item, isActive: !item.isActive }, { headers: authHeaders });
            toast.success("Status updated successfully.");
            fetchItems(search, limit, page);
        } catch {
            toast.error("Failed to update status.");
        }
    };

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    const tableActions: Action<ICostCenter>[] = [
        { label: "Edit", icon: <Edit size={14} />, primary: true, onClick: (item: ICostCenter) => openEdit(item) },
        { label: "Delete", icon: <Trash2 size={14} />, primary: true, variant: "danger", onClick: (item: ICostCenter) => handleDeleteClick(item) },
    ];

    const tableHeaders = ["#", "Code", "Name", "Active", "Actions"];

    return (
        <div className="space-y-4">
            <PageHeader title="Cost Centers">
                <Button onClick={openCreate} leftIcon={<CirclePlusIcon size={14} />}>
                    New Cost Center
                </Button>
            </PageHeader>

            <div className="flex flex-col md:flex-row justify-between gap-4">
                <input
                    type="text"
                    placeholder="Search cost centers..."
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="border border-gray-300 rounded-md px-4 py-2 w-full md:w-64 text-gray-950 focus:outline-none focus:ring-2 focus:ring-purple-600"
                />
                <select
                    value={limit}
                    onChange={(e) => handlePageLengthChange(Number(e.target.value))}
                    className="border border-gray-300 px-3 py-2 rounded-md bg-white text-gray-950 focus:outline-none focus:ring-2 focus:ring-purple-600"
                >
                    {[10, 25, 50].map((num) => (
                        <option key={num} value={num}>{num} / page</option>
                    ))}
                </select>
            </div>

            <Table headers={tableHeaders}>
                {!isLoading && items.length > 0 &&
                    items.map((item, index) => (
                        <TableRow
                            key={item.id}
                            row={item}
                            index={index + 1}
                            columns={[
                                <span className="text-indigo-600 font-mono">{item.code}</span>,
                                item.name,
                                <Switch
                                    checked={item.isActive}
                                    onChange={() => updateActive(item)}
                                    aria-label={`Toggle ${item.name} active status`}
                                />,
                            ]}
                            actions={tableActions}
                            onRowClick={(item) => openEdit(item)}
                        />
                    ))
                }
                {!isLoading && items.length === 0 && (
                    <tr><td className="text-center py-4 font-semibold text-gray-500" colSpan={5}>No Cost Centers Found</td></tr>
                )}
                {isLoading && (
                    <tr key="loader"><td className="text-center py-2 font-semibold" colSpan={5}><LoaderSpinner /></td></tr>
                )}
            </Table>

            <PaginationWrapper
                count={pagination.totalPages}
                page={page}
                from={from}
                to={to}
                total={pagination.total}
                onChange={(_, newPage) => handlePageChange(newPage)}
                paginationVariant="outlined"
                paginationShape="rounded"
            />

            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={isEditMode ? "Edit Cost Center" : "Add New Cost Center"} size="md">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <InputField
                        id="code"
                        label="Code"
                        placeholder="e.g., CC-001"
                        required
                        value={form.code}
                        onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                        error={formErrors.code}
                    />
                    <InputField
                        id="name"
                        label="Name"
                        placeholder="e.g., Operations"
                        required
                        value={form.name}
                        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                        error={formErrors.name}
                    />
                    <Checkbox
                        id="isActive"
                        checked={form.isActive}
                        onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                        label={<span className="text-sm font-medium text-gray-700">Active</span>}
                    />
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
                title="Delete Cost Center"
                message="Are you sure you want to delete this cost center?"
            />
        </div>
    );
};

export default CostCenters;
