import type { RootState } from "@store/index";
import { CirclePlusIcon, Edit, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import Constants from "@constants/api";
import axios from "axios";
import type { PayrollProfile } from "@models/payroll";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import { toast } from "sonner";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import Modal from "@components/admin/Modal";
import SubmitButton from "@components/admin/SubmitButton";
import Switch from "@components/admin/Switch";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button } from "@components/ui";

const PAYROLL_PROFILES_URL = `${Constants.API_BASE_URL}/admin/payroll/profiles`;

interface StaffUser {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
}

interface ProfileFormData {
    employeeUserId: string;
    defaultGross: string;
    isActive: boolean;
}

const emptyForm = (): ProfileFormData => ({
    employeeUserId: '',
    defaultGross: '',
    isActive: true,
});

const PayrollProfiles: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);

    const [profiles, setProfiles] = useState<PayrollProfile[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Staff users for dropdown
    const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
    const [staffLoading, setStaffLoading] = useState(false);

    // Create / Edit modal
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [itemToEdit, setItemToEdit] = useState<PayrollProfile | null>(null);
    const [formData, setFormData] = useState<ProfileFormData>(emptyForm());
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [isSaving, setIsSaving] = useState(false);

    // Delete modal
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteItem, setDeleteItem] = useState<PayrollProfile | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        fetchProfiles();
        fetchStaffUsers();
    }, []);

    const fetchProfiles = async () => {
        try {
            setIsLoading(true);
            const response = await axios.get(PAYROLL_PROFILES_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data.success) {
                setProfiles(response.data.data ?? []);
            }
        } catch {
            toast.error('Failed to fetch payroll profiles.');
        } finally {
            setIsLoading(false);
        }
    };

    const fetchStaffUsers = async () => {
        try {
            setStaffLoading(true);
            // #36: the Employee dropdown must list THIS tenant's staff (user_type=3,
            // tenant-scoped), which is exactly what the payroll create guard
            // (assertTenantEmployee) accepts. The old /admin/user/type/1 source
            // returned owners across all tenants → "Employee not found". The
            // tenant-scoped /admin/staff endpoint returns { data: { users: [...] } }.
            const res = await axios.get(Constants.FETCH_STAFF_FOR_LIST_URL, {
                params: { user_type: 3, limit: 200, page: 1 },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = (res.data?.data?.users ?? []) as StaffUser[];
            setStaffUsers(data);
        } catch {
            // silently ignore
        } finally {
            setStaffLoading(false);
        }
    };

    const handleCreateClick = () => {
        setItemToEdit(null);
        setFormData(emptyForm());
        setFormErrors({});
        setIsModalOpen(true);
    };

    const handleEditClick = (item: PayrollProfile) => {
        setItemToEdit(item);
        setFormData({
            employeeUserId: item.employeeUserId,
            defaultGross: item.defaultGross !== null ? String(item.defaultGross) : '',
            isActive: item.isActive,
        });
        setFormErrors({});
        setIsModalOpen(true);
    };

    const handleDeleteClick = (item: PayrollProfile) => {
        setDeleteItem(item);
        setDeleteModalOpen(true);
    };

    const validate = (): boolean => {
        const errors: { [key: string]: string } = {};
        if (!itemToEdit && !formData.employeeUserId) {
            errors.employeeUserId = 'Employee is required.';
        }
        if (formData.defaultGross !== '' && isNaN(Number(formData.defaultGross))) {
            errors.defaultGross = 'Default gross must be a number.';
        }
        if (formData.defaultGross !== '' && Number(formData.defaultGross) < 0) {
            errors.defaultGross = 'Default gross cannot be negative.';
        }
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validate()) return;
        try {
            setIsSaving(true);
            const payload = {
                employeeUserId: formData.employeeUserId,
                defaultGross: formData.defaultGross !== '' ? Number(formData.defaultGross) : null,
                isActive: formData.isActive,
            };
            if (itemToEdit) {
                const response = await axios.put(`${PAYROLL_PROFILES_URL}/${itemToEdit.id}`, payload, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.data.success) {
                    toast.success(response.data.message ?? 'Profile updated.');
                }
            } else {
                const response = await axios.post(PAYROLL_PROFILES_URL, payload, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.data.success) {
                    toast.success(response.data.message ?? 'Profile created.');
                }
            }
            setIsModalOpen(false);
            fetchProfiles();
        } catch (err) {
            // #36: surface the server's real reason (e.g. "Employee not found in
            // your workspace.") and any per-field errors instead of swallowing it.
            if (axios.isAxiosError(err)) {
                const data = err.response?.data as
                    | { message?: string; error?: string; errors?: Record<string, string> }
                    | undefined;
                if (data?.errors && typeof data.errors === 'object') {
                    setFormErrors((prev) => ({ ...prev, ...data.errors }));
                }
                toast.error(data?.message ?? data?.error ?? 'Failed to save profile.');
            } else {
                toast.error('Failed to save profile.');
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteItem) return;
        try {
            setIsDeleting(true);
            const response = await axios.delete(`${PAYROLL_PROFILES_URL}/${deleteItem.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data.success) {
                toast.success(response.data.message ?? 'Profile deleted.');
                setDeleteModalOpen(false);
                fetchProfiles();
            } else {
                toast.error(response.data.message ?? 'Delete failed.');
            }
        } catch {
            toast.error('Something went wrong.');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleActiveToggle = async (item: PayrollProfile) => {
        try {
            setProfiles((prev) =>
                prev.map((p) => (p.id === item.id ? { ...p, isActive: !p.isActive } : p))
            );
            await axios.put(
                `${PAYROLL_PROFILES_URL}/${item.id}`,
                { isActive: !item.isActive },
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            toast.success('Status updated.');
        } catch {
            // revert optimistic update
            setProfiles((prev) =>
                prev.map((p) => (p.id === item.id ? { ...p, isActive: item.isActive } : p))
            );
            toast.error('Something went wrong.');
        }
    };

    const getEmployeeName = (profile: PayrollProfile): string => {
        if (profile.employee) {
            const name = `${profile.employee.firstName ?? ''} ${profile.employee.lastName ?? ''}`.trim();
            return name || profile.employee.email || profile.employeeUserId;
        }
        return profile.employeeUserId;
    };

    const tableHeaders = ['#', 'Employee', 'Default Gross', 'Pay Frequency', 'Active', 'Actions'];

    const tableActions = [
        {
            label: 'Edit',
            icon: <Edit size={14} />,
            onClick: (item: PayrollProfile) => handleEditClick(item),
        },
        {
            label: 'Delete',
            icon: <Trash2Icon size={14} />,
            onClick: (item: PayrollProfile) => handleDeleteClick(item),
        },
    ];

    return (
        <div className="space-y-4">
            <PageHeader title="Payroll Profiles">
                <Button onClick={handleCreateClick} leftIcon={<CirclePlusIcon size={14} />}>
                    New Profile
                </Button>
            </PageHeader>

            <Table headers={tableHeaders}>
                {!isLoading && profiles.map((profile, index) => (
                    <TableRow
                        key={profile.id}
                        row={profile}
                        index={index + 1}
                        columns={[
                            <span className="text-indigo-600">{getEmployeeName(profile)}</span>,
                            profile.defaultGross !== null
                                ? profile.defaultGross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                : <span className="text-gray-400">—</span>,
                            profile.payFrequency,
                            <Switch
                                name={`active-${profile.id}`}
                                checked={profile.isActive}
                                onChange={() => handleActiveToggle(profile)}
                            />,
                        ]}
                        actions={tableActions}
                    />
                ))}

                {!isLoading && profiles.length === 0 && (
                    <tr>
                        <td colSpan={6} className="text-center text-gray-800 py-2 font-semibold">No Records Found</td>
                    </tr>
                )}

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-gray-950 font-semibold" colSpan={6}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}
            </Table>

            {/* Create / Edit Modal */}
            {isModalOpen && (
                <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={itemToEdit ? 'Edit Payroll Profile' : 'New Payroll Profile'} size="xl">
                    <form onSubmit={handleFormSubmit}>
                        {/* Employee — shown only on create */}
                        {!itemToEdit && (
                            <div className="grid grid-cols-1">
                                <label htmlFor="employeeUserId" className="text-red-500">Employee *</label>
                                <select
                                    id="employeeUserId"
                                    name="employeeUserId"
                                    value={formData.employeeUserId}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, employeeUserId: e.target.value }))}
                                    disabled={staffLoading}
                                    className="border border-gray-300 mt-1 rounded-md px-4 py-2 w-full text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600"
                                >
                                    <option value="">— Select employee —</option>
                                    {staffUsers.map((u) => (
                                        <option key={u.id} value={u.id}>
                                            {`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email}
                                        </option>
                                    ))}
                                </select>
                                {formErrors.employeeUserId && (
                                    <span className="text-red-500 text-sm">{formErrors.employeeUserId}</span>
                                )}
                            </div>
                        )}

                        {/* Default Gross */}
                        <div className="grid grid-cols-1 mt-4">
                            <label htmlFor="defaultGross" className="text-gray-700">Default Gross</label>
                            <input
                                type="number"
                                id="defaultGross"
                                name="defaultGross"
                                value={formData.defaultGross}
                                onChange={(e) => setFormData((prev) => ({ ...prev, defaultGross: e.target.value }))}
                                placeholder="e.g. 5000.00"
                                className="border border-gray-300 mt-1 rounded-md px-4 py-2 w-full text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600"
                            />
                            {formErrors.defaultGross && (
                                <span className="text-red-500 text-sm">{formErrors.defaultGross}</span>
                            )}
                        </div>

                        {/* Active */}
                        <div className="flex flex-row mt-4 gap-6 items-center">
                            <label htmlFor="isActive" className="text-red-500">Active *</label>
                            <Switch
                                name="isActive"
                                checked={formData.isActive}
                                onChange={(e) => setFormData((prev) => ({ ...prev, isActive: e.target.checked }))}
                                disabled={false}
                                className="mt-4"
                            />
                        </div>

                        <div className="flex justify-end mt-4">
                            <Button variant="white" onClick={() => setIsModalOpen(false)} className="mr-2">
                                Cancel
                            </Button>
                            <SubmitButton isDisabled={isSaving} onClick={() => {}} isLoading={isSaving} mode={itemToEdit ? 'edit' : 'create'} />
                        </div>
                    </form>
                </Modal>
            )}

            <DeleteConfirmationModal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={handleDelete}
                title="Delete Payroll Profile"
                message="Are you sure you want to delete this payroll profile?"
                isDeleting={isDeleting}
            />
        </div>
    );
};

export default PayrollProfiles;
