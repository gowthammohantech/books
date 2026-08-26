import { useCallback, useEffect, useState } from "react";
import axios, { AxiosError } from "axios";
import { toast } from "sonner";
import { useSelector } from "react-redux";
import { Edit, Trash2, CirclePlusIcon } from "lucide-react";

import Constants from "../../../constants/api";
import type { RootState } from "../../../store";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import Modal from "@components/admin/Modal";
import InputField from "@components/admin/InputField";
import SubmitButton from "@components/admin/SubmitButton";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import NoRecords from "@components/admin/NoRecords";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import PermissionGuard from "@components/admin/PermissionGuard";
import { Button, Card, Badge } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";
import { hasPermission } from "@utils/hasPermission";
import type { LeaveType, LeaveAllocation } from "@models/timeTracking";

const MODULE_SLUG = "time-tracking-others";

/** Extract a human-readable server error message from an axios error. */
const serverMessage = (error: unknown, fallback: string): string => {
    const ax = error as AxiosError<{ message?: string; error?: string }>;
    return ax.response?.data?.message || ax.response?.data?.error || fallback;
};

interface StaffUser {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
}

// ── Leave-type form ──────────────────────────────────────────────────────────

interface FormErrors {
    name?: string;
    defaultAllocationDays?: string;
}

interface IForm {
    id?: string;
    name: string;
    paid: boolean;
    defaultAllocationDays: string;
    isActive: boolean;
}

const emptyForm = (): IForm => ({ name: "", paid: true, defaultAllocationDays: "0", isActive: true });

// ── Allocation editing ───────────────────────────────────────────────────────

/** A row in the allocations editor: one per active leave type for the picked employee/year. */
interface AllocationRow {
    leaveTypeId: string;
    leaveTypeName: string;
    allocationId?: string;
    allocated: string;
    carriedOver: string;
}

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear - 2 + i);

const LeaveTypes: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const canEdit = hasPermission(permissions, MODULE_SLUG, "edit");
    const canDelete = hasPermission(permissions, MODULE_SLUG, "delete");
    const canManageAllocations = hasPermission(permissions, MODULE_SLUG, "edit") || hasPermission(permissions, MODULE_SLUG, "create");
    const authHeaders = { Authorization: `Bearer ${token}` };

    // --- Leave types ---
    const [types, setTypes] = useState<LeaveType[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [form, setForm] = useState<IForm>(emptyForm());
    const [showModal, setShowModal] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [formErrors, setFormErrors] = useState<FormErrors>({});
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<LeaveType | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // --- Allocations ---
    const [staff, setStaff] = useState<StaffUser[]>([]);
    const [employeeId, setEmployeeId] = useState<string>("");
    const [year, setYear] = useState<number>(currentYear);
    const [allocRows, setAllocRows] = useState<AllocationRow[]>([]);
    const [loadingAlloc, setLoadingAlloc] = useState(false);
    const [savingAllocId, setSavingAllocId] = useState<string | null>(null);

    const fetchTypes = useCallback(async () => {
        try {
            setIsLoading(true);
            const res = await axios.get(Constants.LEAVE_TYPES_URL, { headers: authHeaders });
            setTypes((res.data?.data?.leaveTypes ?? []) as LeaveType[]);
        } catch (error) {
            toast.error(serverMessage(error, "Failed to fetch leave types."));
        } finally {
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    const fetchStaff = useCallback(async () => {
        try {
            const res = await axios.get(Constants.FETCH_STAFF_FOR_LIST_URL, {
                params: { user_type: 3, limit: 200, page: 1 },
                headers: authHeaders,
            });
            setStaff((res.data?.data?.users ?? []) as StaffUser[]);
        } catch {
            // silently ignore — picker just stays empty
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    useEffect(() => {
        fetchTypes();
        fetchStaff();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Build/refresh the allocation editor rows for the chosen employee + year.
    const fetchAllocations = useCallback(async () => {
        if (!employeeId) {
            setAllocRows([]);
            return;
        }
        try {
            setLoadingAlloc(true);
            const res = await axios.get(Constants.LEAVE_ALLOCATIONS_URL, {
                params: { employeeUserId: employeeId, year },
                headers: authHeaders,
            });
            const existing = (res.data?.data?.allocations ?? []) as LeaveAllocation[];
            const byType = new Map(existing.map((a) => [a.leaveTypeId, a]));
            const rows: AllocationRow[] = types
                .filter((t) => t.isActive)
                .map((t) => {
                    const a = byType.get(t.id);
                    return {
                        leaveTypeId: t.id,
                        leaveTypeName: t.name,
                        allocationId: a?.id,
                        allocated: a != null ? String(a.allocatedDays) : String(t.defaultAllocationDays),
                        carriedOver: a != null ? String(a.carriedOverDays) : "0",
                    };
                });
            setAllocRows(rows);
        } catch (error) {
            toast.error(serverMessage(error, "Failed to load allocations."));
            setAllocRows([]);
        } finally {
            setLoadingAlloc(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [employeeId, year, types, token]);

    useEffect(() => {
        fetchAllocations();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [employeeId, year, types]);

    // ── Leave-type CRUD ──────────────────────────────────────────────────────

    const openCreate = () => {
        setForm(emptyForm());
        setIsEditMode(false);
        setFormErrors({});
        setShowModal(true);
    };

    const openEdit = (item: LeaveType) => {
        setForm({
            id: item.id,
            name: item.name,
            paid: item.paid,
            defaultAllocationDays: String(item.defaultAllocationDays),
            isActive: item.isActive,
        });
        setIsEditMode(true);
        setFormErrors({});
        setShowModal(true);
    };

    const validate = (): boolean => {
        const errors: FormErrors = {};
        if (!form.name.trim()) errors.name = "Name is required.";
        if (form.defaultAllocationDays === "" || isNaN(Number(form.defaultAllocationDays)) || Number(form.defaultAllocationDays) < 0) {
            errors.defaultAllocationDays = "Enter a valid number of days.";
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
                name: form.name.trim(),
                paid: form.paid,
                defaultAllocationDays: Number(form.defaultAllocationDays),
                isActive: form.isActive,
            };
            if (isEditMode && form.id) {
                await axios.put(Constants.LEAVE_TYPE_URL(form.id), payload, { headers: authHeaders });
                toast.success("Leave type updated successfully.");
            } else {
                await axios.post(Constants.LEAVE_TYPES_URL, payload, { headers: authHeaders });
                toast.success("Leave type created successfully.");
            }
            setShowModal(false);
            fetchTypes();
        } catch (error) {
            const ax = error as AxiosError<{ errors?: FormErrors }>;
            if (ax.response?.data?.errors) {
                setFormErrors(ax.response.data.errors);
            } else {
                toast.error(serverMessage(error, "Failed to save leave type."));
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteClick = (item: LeaveType) => {
        setItemToDelete(item);
        setDeleteModalOpen(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            setIsDeleting(true);
            await axios.delete(Constants.LEAVE_TYPE_URL(itemToDelete.id), { headers: authHeaders });
            toast.success("Leave type deleted successfully.");
            setDeleteModalOpen(false);
            fetchTypes();
        } catch (error) {
            toast.error(serverMessage(error, "Failed to delete leave type."));
        } finally {
            setIsDeleting(false);
        }
    };

    // ── Allocations ──────────────────────────────────────────────────────────

    const updateRow = (leaveTypeId: string, changes: Partial<AllocationRow>) => {
        setAllocRows((prev) => prev.map((r) => (r.leaveTypeId === leaveTypeId ? { ...r, ...changes } : r)));
    };

    const saveAllocation = async (row: AllocationRow) => {
        if (!employeeId) {
            toast.error("Select an employee first.");
            return;
        }
        const allocated = Number(row.allocated);
        const carriedOver = Number(row.carriedOver);
        if (row.allocated === "" || isNaN(allocated) || allocated < 0) {
            toast.error("Allocated must be a valid number.");
            return;
        }
        if (row.carriedOver === "" || isNaN(carriedOver) || carriedOver < 0) {
            toast.error("Carried over must be a valid number.");
            return;
        }
        try {
            setSavingAllocId(row.leaveTypeId);
            if (row.allocationId) {
                await axios.put(
                    Constants.LEAVE_ALLOCATION_URL(row.allocationId),
                    { allocatedDays: allocated, carriedOverDays: carriedOver },
                    { headers: authHeaders },
                );
            } else {
                await axios.post(
                    Constants.LEAVE_ALLOCATIONS_URL,
                    { employeeUserId: employeeId, leaveTypeId: row.leaveTypeId, year, allocatedDays: allocated, carriedOverDays: carriedOver },
                    { headers: authHeaders },
                );
            }
            toast.success("Allocation saved.");
            fetchAllocations();
        } catch (error) {
            toast.error(serverMessage(error, "Failed to save allocation."));
        } finally {
            setSavingAllocId(null);
        }
    };

    const staffOptions = staff.map((s) => ({
        id: s.id,
        name: `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim() || s.email,
    }));

    const tableActions = [
        ...(canEdit
            ? [{ label: "Edit", icon: <Edit size={14} />, onClick: (item: LeaveType) => openEdit(item) }]
            : []),
        ...(canDelete
            ? [{ label: "Delete", icon: <Trash2 size={14} />, onClick: (item: LeaveType) => handleDeleteClick(item) }]
            : []),
    ];

    const tableHeaders = ["#", "Name", "Paid", "Default Days", "Active", "Actions"];

    return (
        <div className="space-y-6">
            <PageHeader title="Leave Types & Allocations">
                <PermissionGuard moduleSlug={MODULE_SLUG} action="create">
                    <Button onClick={openCreate} leftIcon={<CirclePlusIcon size={14} />}>
                        Add Leave Type
                    </Button>
                </PermissionGuard>
            </PageHeader>

            {/* ── Leave types ─────────────────────────────────────────────── */}
            <Card title="Leave Types">
                <Table headers={tableHeaders}>
                    {!isLoading && types.length > 0 &&
                        types.map((item, index) => (
                            <TableRow
                                key={item.id}
                                row={item}
                                index={index + 1}
                                columns={[
                                    <span className="font-medium text-gray-900">{item.name}</span>,
                                    item.paid ? <Badge color="success">Paid</Badge> : <Badge color="gray">Unpaid</Badge>,
                                    item.defaultAllocationDays,
                                    item.isActive ? <Badge color="info">Active</Badge> : <Badge color="gray">Inactive</Badge>,
                                ]}
                                actions={tableActions}
                            />
                        ))
                    }
                    {!isLoading && types.length === 0 && (
                        <NoRecords colSpan={6} message="No leave types found." />
                    )}
                    {isLoading && (
                        <tr key="loader"><td colSpan={6} className="text-center py-4"><LoaderSpinner /></td></tr>
                    )}
                </Table>
            </Card>

            {/* ── Allocations ─────────────────────────────────────────────── */}
            <Card title="Employee Allocations">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-gray-200 pb-4 mb-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                        <select
                            value={employeeId}
                            onChange={(e) => setEmployeeId(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-950 bg-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                        >
                            <option value="">Select employee…</option>
                            {staffOptions.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                        <select
                            value={year}
                            onChange={(e) => setYear(Number(e.target.value))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-950 bg-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                        >
                            {YEARS.map((y) => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {!employeeId ? (
                    <p className="py-4 text-center text-sm font-medium text-gray-500">
                        Select an employee to view and edit allocations.
                    </p>
                ) : loadingAlloc ? (
                    <div className="py-6 text-center"><LoaderSpinner /></div>
                ) : allocRows.length === 0 ? (
                    <p className="py-4 text-center text-sm font-medium text-gray-500">
                        No active leave types to allocate.
                    </p>
                ) : (
                    <div className="overflow-x-auto border border-border rounded-control">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-100 text-xs uppercase text-body">
                                <tr>
                                    <th className="px-4 py-3 text-left border-b border-border">Leave Type</th>
                                    <th className="px-4 py-3 text-left border-b border-border">Allocated</th>
                                    <th className="px-4 py-3 text-left border-b border-border">Carried Over</th>
                                    {canManageAllocations && <th className="px-4 py-3 text-right border-b border-border">Actions</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {allocRows.map((row) => (
                                    <tr key={row.leaveTypeId} className="border-b border-border hover:bg-gray-50">
                                        <td className="px-4 py-3 font-medium text-gray-900">{row.leaveTypeName}</td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="number"
                                                step="0.5"
                                                min="0"
                                                value={row.allocated}
                                                disabled={!canManageAllocations || savingAllocId === row.leaveTypeId}
                                                onChange={(e) => updateRow(row.leaveTypeId, { allocated: e.target.value })}
                                                className="w-28 px-2 py-1 border border-gray-300 rounded-md text-xs text-gray-950 focus:outline-none focus:ring-2 focus:ring-purple-600"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="number"
                                                step="0.5"
                                                min="0"
                                                value={row.carriedOver}
                                                disabled={!canManageAllocations || savingAllocId === row.leaveTypeId}
                                                onChange={(e) => updateRow(row.leaveTypeId, { carriedOver: e.target.value })}
                                                className="w-28 px-2 py-1 border border-gray-300 rounded-md text-xs text-gray-950 focus:outline-none focus:ring-2 focus:ring-purple-600"
                                            />
                                        </td>
                                        {canManageAllocations && (
                                            <td className="px-4 py-3 text-right">
                                                <Button
                                                    size="sm"
                                                    isLoading={savingAllocId === row.leaveTypeId}
                                                    disabled={savingAllocId === row.leaveTypeId}
                                                    onClick={() => saveAllocation(row)}
                                                >
                                                    Save
                                                </Button>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* ── Leave-type add/edit modal ───────────────────────────────── */}
            <Modal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                title={isEditMode ? "Edit Leave Type" : "Add New Leave Type"}
                size="md"
            >
                <form onSubmit={handleSubmit} className="space-y-4">
                    <InputField
                        id="name"
                        label="Name"
                        placeholder="e.g., Annual Leave"
                        required
                        value={form.name}
                        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                        error={formErrors.name}
                    />
                    <InputField
                        id="defaultAllocationDays"
                        label="Default Allocation Days"
                        type="number"
                        placeholder="0"
                        required
                        value={form.defaultAllocationDays}
                        onChange={(e) => setForm((prev) => ({ ...prev, defaultAllocationDays: e.target.value }))}
                        error={formErrors.defaultAllocationDays}
                    />
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="paid"
                            checked={form.paid}
                            onChange={(e) => setForm((prev) => ({ ...prev, paid: e.target.checked }))}
                            className="h-4 w-4 text-purple-600 border-gray-300 rounded"
                        />
                        <label htmlFor="paid" className="text-sm font-medium text-gray-700">
                            Paid leave (deducts from balance)
                        </label>
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="isActive"
                            checked={form.isActive}
                            onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                            className="h-4 w-4 text-purple-600 border-gray-300 rounded"
                        />
                        <label htmlFor="isActive" className="text-sm font-medium text-gray-700">Active</label>
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
                title="Delete Leave Type"
                message="Are you sure you want to delete this leave type?"
            />
        </div>
    );
};

export default LeaveTypes;
