import api from '@lib/apiClient';
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Constants from "../../../constants/api";
import type { AxiosError } from 'axios';
import Table from "../../../components/admin/Table";
import PaginationWrapper from "../../../components/admin/PaginationWrapper";
import { Edit, Trash2, CirclePlusIcon } from "lucide-react";
import { toast } from "sonner";
import Modal from "../../../components/admin/Modal";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import TableRow from "@components/admin/TableRow";
import type { Action } from "@components/admin/tableActions";
import SubmitButton from "@components/admin/SubmitButton";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import InputField from "@components/admin/InputField";
import { Badge, Button, Checkbox, PageSizeSelect, Select, Switch, EmptyStateRow, EmptyStateHero } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";
import { invalidateCostCenters, type CostCenterType } from "@hooks/useCostCenters";

import { LIST_EMPTY_STATES } from "@constants/listEmptyStates";
interface ICostCenter {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    type: CostCenterType;
    isActive: boolean;
    parentId?: string | null;
    parent?: { id: string; code: string; name: string } | null;
    numberPrefix?: string | null;
    nextNumber?: number;
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
    numberPrefix?: string;
    nextNumber?: string;
}

interface IForm {
    id?: string;
    code: string;
    name: string;
    description: string;
    type: CostCenterType;
    isActive: boolean;
    parentId: string;
    numberPrefix: string;
    nextNumber: string;
}

const emptyForm = (): IForm => ({
    code: "",
    name: "",
    description: "",
    type: "BOTH",
    isActive: true,
    parentId: "",
    numberPrefix: "",
    nextNumber: "1"
});

const TYPE_OPTIONS: { value: CostCenterType; label: string }[] = [
    { value: "BOTH", label: "Both — earns revenue and absorbs cost" },
    { value: "PROFIT", label: "Profit center — earns revenue" },
    { value: "COST", label: "Cost center — absorbs cost only" },
];

const TYPE_BADGE: Record<CostCenterType, { label: string; color: "success" | "warning" | "gray" }> = {
    PROFIT: { label: "Profit", color: "success" },
    COST: { label: "Cost", color: "warning" },
    BOTH: { label: "Both", color: "gray" }
};

/** Mirrors NUMBER_PREFIX_RE in the backend controller: must not end in a digit,
 *  or `SAL1` + `000001` parses back as 1000001 through the trailing-digit regex
 *  every numbering helper uses. */
const PREFIX_RE = /^[A-Z0-9][A-Z0-9._/-]*[^0-9]$/;

const CostCenters: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();

    const [items, setItems] = useState<ICostCenter[]>([]);
    const [allCenters, setAllCenters] = useState<ICostCenter[]>([]);
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
    const authHeaders = {};

    const fetchItems = async (s?: string, l?: number, p?: number) => {
        try {
            setIsLoading(true);
            const response = await api.get(Constants.FETCH_COST_CENTERS_URL, {
                // includeInactive: the master must still list a centre after its
                // Active switch is turned off, or it becomes unreachable.
                params: { search: s, limit: l, page: p, includeInactive: true },
                headers: authHeaders
            });
            setItems(response.data.data || []);
            if (response.data.pagination) setPagination(response.data.pagination);
        } catch {
            toast.error("Failed to fetch profit centers.");
        } finally {
            setIsLoading(false);
        }
    };

    /** Full list for the Parent dropdown — the parent may be on another page. */
    const fetchAllCenters = async () => {
        try {
            const response = await api.get(Constants.FETCH_COST_CENTERS_URL, {
                params: { all: 1, includeInactive: true },
                headers: authHeaders
            });
            setAllCenters(response.data.data || []);
        } catch {
            /* the parent dropdown just stays empty; not worth a toast */
        }
    };

    useEffect(() => { fetchItems(search, limit, page); }, [search, limit, page]);
    useEffect(() => { fetchAllCenters(); }, []);

    /** Refresh both this page and the cache the document-form pickers read. */
    const refreshAll = () => {
        fetchItems(search, limit, page);
        fetchAllCenters();
        invalidateCostCenters();
    };

    const handleSearch = (keyword: string) => setSearchParams({ search: keyword, limit: String(limit), page: "1" });
    const handlePageLengthChange = (newLimit: number) => setSearchParams({ search, limit: String(newLimit), page: "1" });
    const handlePageChange = (newPage: number) => setSearchParams({ search, limit: String(limit), page: String(newPage) });

    const openCreate = () => { setForm(emptyForm()); setIsEditMode(false); setFormErrors({}); setShowModal(true); };

    const openEdit = (item: ICostCenter) => {
        setForm({
            id: item.id,
            code: item.code,
            name: item.name,
            description: item.description ?? "",
            type: item.type ?? "BOTH",
            isActive: item.isActive,
            parentId: item.parentId ?? "",
            numberPrefix: item.numberPrefix ?? "",
            nextNumber: String(item.nextNumber ?? 1)
        });
        setIsEditMode(true);
        setFormErrors({});
        setShowModal(true);
    };

    const validate = (): boolean => {
        const errors: FormErrors = {};
        if (!form.code.trim()) errors.code = "Code is required.";
        if (!form.name.trim()) errors.name = "Name is required.";

        // Validate what we actually SEND (uppercased), not the raw keystrokes —
        // otherwise typing "sal-" fails against an uppercase-only pattern.
        const prefix = form.numberPrefix.trim().toUpperCase();
        if (prefix && !PREFIX_RE.test(prefix)) {
            errors.numberPrefix = "Use A-Z, 0-9, dot, dash, slash or underscore, and don't end with a digit (e.g. SAL-).";
        }

        const next = Number(form.nextNumber);
        if (form.nextNumber.trim() && (!Number.isInteger(next) || next < 1)) {
            errors.nextNumber = "Must be a whole number of 1 or more.";
        }
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validate()) return;
        try {
            setIsSaving(true);
            const payload = {
                code: form.code.trim(),
                name: form.name.trim(),
                description: form.description.trim() || null,
                type: form.type,
                isActive: form.isActive,
                parentId: form.parentId || null,
                numberPrefix: form.numberPrefix.trim().toUpperCase() || null,
                nextNumber: Number(form.nextNumber) || 1
            };
            if (isEditMode && form.id) {
                await api.put(`${Constants.UPDATE_COST_CENTER_URL}/${form.id}`, payload, { headers: authHeaders });
                toast.success("Profit center updated successfully.");
            } else {
                await api.post(Constants.CREATE_COST_CENTER_URL, payload, { headers: authHeaders });
                toast.success("Profit center created successfully.");
            }
            setShowModal(false);
            refreshAll();
        } catch (error) {
            const axiosError = error as AxiosError<{ errors?: FormErrors; message?: string }>;
            if (axiosError.response?.data?.errors) {
                setFormErrors(axiosError.response.data.errors);
            } else {
                // The API returns a single explanatory message for conflicts
                // (duplicate code, duplicate prefix, circular parent) — show it
                // rather than a generic failure the user can't act on.
                toast.error(axiosError.response?.data?.message ?? "Failed to save profit center.");
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
            await api.delete(`${Constants.DELETE_COST_CENTER_URL}/${itemToDelete.id}`, { headers: authHeaders });
            toast.success("Profit center deleted successfully.");
            refreshAll();
            setDeleteModalOpen(false);
        } catch (error) {
            const axiosError = error as AxiosError<{ message?: string }>;
            toast.error(axiosError.response?.data?.message ?? "Failed to delete profit center.");
        } finally {
            setIsDeleting(false);
        }
    };

    const updateActive = async (item: ICostCenter) => {
        try {
            await api.put(
                `${Constants.UPDATE_COST_CENTER_URL}/${item.id}`,
                { isActive: !item.isActive },
                { headers: authHeaders }
            );
            toast.success("Status updated successfully.");
            refreshAll();
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

    const tableHeaders = ["#", "Code", "Name", "Type", "Parent", "Numbering", "Active", "Actions"];

    // A centre cannot be its own parent. Deeper cycles are rejected server-side,
    // where the whole tree is visible.
    const parentOptions = allCenters.filter((c) => c.id !== form.id);

    const prefixPreview = form.numberPrefix.trim()
        ? `${form.numberPrefix.trim().toUpperCase()}${String(Number(form.nextNumber) || 1).padStart(6, "0")}`
        : null;

    /**
     * Nothing here and nothing asked for, so this list has never held a
     * record rather than having been filtered down to none.
     */
    const isFirstRun = !isLoading && items.length === 0 && !search;

    return (
        <div className="space-y-4">
            <PageHeader title="Profit Centers">
                <Button onClick={openCreate} leftIcon={<CirclePlusIcon size={14} />}>
                    New Profit Center
                </Button>
            </PageHeader>
            {isFirstRun ? (
                <EmptyStateHero
                    {...LIST_EMPTY_STATES.costCenters}
                    action={<Button size="lg" leftIcon={<CirclePlusIcon size={16} />} onClick={openCreate}>
                        {LIST_EMPTY_STATES.costCenters.cta}
                    </Button>}
                />
            ) : (
                <>

                <div className="flex flex-col md:flex-row justify-between gap-4">
                    <input
                        type="text"
                        placeholder="Search profit centers..."
                        value={search}
                        onChange={(e) => handleSearch(e.target.value)}
                        className="border border-gray-300 rounded-md px-4 py-2 w-full md:w-64 text-gray-950 focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <PageSizeSelect value={limit} onChange={handlePageLengthChange} />
                </div>

                <Table headers={tableHeaders}>
                    {!isLoading && items.length > 0 &&
                        items.map((item, index) => (
                            <TableRow
                                key={item.id}
                                row={item}
                                index={index + 1}
                                columns={[
                                    <span className="text-primary font-mono">{item.code}</span>,
                                    item.name,
                                    <Badge color={TYPE_BADGE[item.type ?? "BOTH"].color}>
                                        {TYPE_BADGE[item.type ?? "BOTH"].label}
                                    </Badge>,
                                    item.parent ? (
                                        <span className="text-gray-700">{item.parent.code}</span>
                                    ) : (
                                        <span className="text-gray-600">—</span>
                                    ),
                                    item.numberPrefix ? (
                                        <span className="font-mono text-xs text-gray-700">
                                            {item.numberPrefix}
                                            {String(item.nextNumber ?? 1).padStart(6, "0")}
                                        </span>
                                    ) : (
                                        <span className="text-gray-600 text-xs">Shared sequence</span>
                                    ),
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
                        <EmptyStateRow colSpan={8} art="analysis" title="No Profit Centers Found" />
                    )}
                    {isLoading && (
                        <tr key="loader"><td className="text-center py-2 font-semibold" colSpan={8}><LoaderSpinner /></td></tr>
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
                </>
            )}


            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={isEditMode ? "Edit Profit Center" : "Add New Profit Center"} size="md">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <InputField
                            id="code"
                            label="Code"
                            placeholder="e.g., SALES"
                            required
                            value={form.code}
                            onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                            error={formErrors.code}
                        />
                        <InputField
                            id="name"
                            label="Name"
                            placeholder="e.g., Sales Department"
                            required
                            value={form.name}
                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                            error={formErrors.name}
                        />
                    </div>

                    <InputField
                        id="description"
                        label="Description"
                        placeholder="Optional"
                        value={form.description}
                        onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Select
                            id="type"
                            label="Type"
                            value={form.type}
                            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as CostCenterType }))}
                            options={TYPE_OPTIONS}
                        />
                        <Select
                            id="parentId"
                            label="Parent"
                            helper="Roll this centre up into a division."
                            value={form.parentId}
                            onChange={(e) => setForm((prev) => ({ ...prev, parentId: e.target.value }))}
                        >
                            <option value="">No parent (top level)</option>
                            {parentOptions.map((c) => (
                                <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                            ))}
                        </Select>
                    </div>

                    <div className="rounded-md border border-gray-200 p-3 space-y-3">
                        <p className="text-sm font-medium text-gray-700">Document numbering</p>
                        <p className="text-xs text-gray-700">
                            Give this centre its own document prefix and its invoices will be numbered
                            in their own series. Leave the prefix blank to keep using the shared
                            company-wide sequence.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <InputField
                                id="numberPrefix"
                                label="Document prefix"
                                placeholder="e.g., SAL-"
                                value={form.numberPrefix}
                                onChange={(e) => setForm((prev) => ({ ...prev, numberPrefix: e.target.value }))}
                                error={formErrors.numberPrefix}
                            />
                            <InputField
                                id="nextNumber"
                                label="Next number"
                                type="number"
                                placeholder="1"
                                value={form.nextNumber}
                                onChange={(e) => setForm((prev) => ({ ...prev, nextNumber: e.target.value }))}
                                error={formErrors.nextNumber}
                            />
                        </div>
                        {prefixPreview && (
                            <p className="text-xs text-gray-700">
                                Next invoice for this centre: <span className="font-mono text-primary">{prefixPreview}</span>
                            </p>
                        )}
                        {isEditMode && (
                            <p className="text-xs text-amber-700">
                                The next number can only move forward — rewinding it would re-issue
                                numbers already printed on issued documents.
                            </p>
                        )}
                    </div>

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
                title="Delete Profit Center"
                message="Are you sure you want to delete this profit center? Documents already tagged to it keep reporting under it."
            />
        </div>
    );
};

export default CostCenters;
