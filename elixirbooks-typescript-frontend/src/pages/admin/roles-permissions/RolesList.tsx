import { CirclePlusIcon, EditIcon, ShieldUser, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Table from "@components/admin/Table";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import Constants from "@constants/api";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import axios from "axios";
import TableRow from "@components/admin/TableRow";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import Modal from "@components/admin/Modal";
import useDateFormatter from "@hooks/useDateFormatter";
import { hasPermission } from "@utils/hasPermission";
import PermissionGuard from "@components/admin/PermissionGuard";
import type { PermissionAction } from "@models/permissions";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import SubmitButton from "@components/admin/SubmitButton";
import { Button } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

interface RoleList {
    id: number;
    roleName: string;
    status: boolean;
    createdAt: string;
}

interface RoleFormData {
    roleName: string;
}

const initialFormData: RoleFormData = {
    roleName: '',
}
const RolesList: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [roles, setRoles] = useState<RoleList[]>([]);
    const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [isRoleModalOpen, setRoleModalOpen] = useState<boolean>(false);
    const [formData, setFormData] = useState<RoleFormData>(initialFormData);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [isDeleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
    const [editItem, setEditItem] = useState<RoleList | null>(null);
    const [deleteItem, setDeleteItem] = useState<RoleList | null>(null);
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const { formatDate } = useDateFormatter();
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);
    const navigate = useNavigate();

    const handleCreateClick = () => {
        setFormData(initialFormData);
        setEditItem(null);
        setFormErrors({});
        setRoleModalOpen(true);
    };

    useEffect(() => {
        fetchRoles(search, limit, page);
    }, [search, limit, page]);

    const fetchRoles = async (search?: string, limit?: number, page?: number) => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.FETCH_ROLES_FOR_LIST_URL, {
                params: { search, limit, page },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setRoles(response.data.data.roles || []);
            setPagination(response.data.data.pagination);
        } catch (error) {
            toast.error("Failed to fetch roles.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleEditClick = (item: RoleList) => {
        setFormData(item);
        setEditItem(item);
        setFormErrors({});
        setRoleModalOpen(true);
    }
    const handleSearch = (keyword: string) => {
        setSearchParams({ search: keyword, limit: String(limit), page: '1' });
    };

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ search, limit: String(newLimit), page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ search, limit: String(limit), page: String(newPage) });
    };

    const handleDeleteClick = async (item: RoleList) => {
        setDeleteItem(item);
        setDeleteModalOpen(true);
    }

    const handleConfirmDelete = async () => {
        if (deleteItem) {
            try {
                setIsDeleting(true);
                await axios.delete(`${Constants.DELETE_ROLE_URL}/${deleteItem.id}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                toast.success("Role deleted successfully.");
                fetchRoles(search, limit, page);
                setDeleteModalOpen(false);
            } catch (error) {
                console.error("Error deleting role:", error);
                toast.error("Failed to delete role.");
            } finally {
                setIsDeleting(false);
            }
        }
    }

    const validateForm = () => {
        const errors: { [key: string]: string } = {};
        const { roleName } = formData;
        if (!roleName.trim()) {
            errors.roleName = 'Role name is required.';
        } else if (roleName.length < 3 || roleName.length > 50) {
            errors.roleName = 'Name must be between 3-50 characters.';
        }
        setFormErrors(errors);
        return !Object.keys(errors).length;
    }
    const handleRoleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setFormErrors({});
        if (!validateForm()) return;
        try {
            setIsSaving(true);
            if (editItem) {
                await axios.put(`${Constants.UPDATE_ROLE_URL}/${editItem.id}`, formData, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } else {
                await axios.post(Constants.CREATE_ROLE_URL, formData, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            }
            if (editItem) {
                toast.success('Role updated successfully.');
            } else {
                toast.success('Role created successfully.');
            }
            fetchRoles(search, limit, page);
            setRoleModalOpen(false);
        } catch (error) {
            toast.error('Failed to create role.');
        } finally {
            setIsSaving(false);
        }
    }

    const handlePermissionsClick = (item: RoleList) => {
        navigate(`/admin/roles/permissions/${item.id}`);
    }
    // Calculate pagination display text
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    const tableHeaders = ['#', 'Role Name', 'Created On', 'Actions'];
    const restrictedActions: PermissionAction[] = ['edit', 'delete'];
    const allowedActions = restrictedActions.filter((action) => hasPermission(permissions, 'roles-permissions', action));
    if (allowedActions.length === 0) {
        tableHeaders.pop();
    }
    return (
        <div className="space-y-4">
            <PageHeader title="Roles">
                {hasPermission(permissions, 'roles-permissions', 'create') &&
                    <Button
                        onClick={() => { handleCreateClick(); }}
                        variant="primary"
                        leftIcon={<CirclePlusIcon size={14} />}
                    >
                        New Role
                    </Button>
                }
            </PageHeader>
            {/* Search Input & PageLength */}
            <div className="flex justify-between items-center">
                <input
                    type="text"
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="border border-gray-300 rounded-md px-4 py-2 w-full md:w-64  text-gray-950  focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                />
                <select
                    value={limit}
                    onChange={(e) => handlePageLengthChange(Number(e.target.value))}
                    className="border border-gray-300 px-3 py-2 rounded-md bg-white  text-gray-950  focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                >
                    {[10, 25, 50].map((num) => (
                        <option className="text-gray-950 " key={num} value={num}>{num} / page</option>
                    ))}
                </select>
            </div>
            {/* Table */}
            <Table headers={tableHeaders}>
                {!isLoading && roles && roles.map((role: any, index: number) => (
                    <TableRow
                        key={role.id}
                        index={index + 1}
                        row={role}
                        columns={[
                            <span className="text-indigo-600">{role.roleName}</span>,
                            formatDate(role.createdAt, systemSettings?.dateFormat.format || "d-y-m"),
                            allowedActions.length > 0 ? (
                                <div className="flex gap-3">
                                    <PermissionGuard moduleSlug="roles-permissions" action="edit">
                                        <Button
                                            onClick={() => handleEditClick(role)}
                                            variant="white"
                                            leftIcon={<EditIcon size={16} />}
                                        >
                                            Edit Role
                                        </Button>
                                    </PermissionGuard>
                                    <PermissionGuard moduleSlug="roles-permissions" action="delete">
                                        <Button
                                            onClick={() => handleDeleteClick(role)}
                                            variant="white"
                                            leftIcon={<Trash2 size={16} />}
                                        >
                                            Delete Role
                                        </Button>
                                    </PermissionGuard>
                                    <PermissionGuard moduleSlug="roles-permissions" action="edit">
                                        <Button
                                            onClick={() => handlePermissionsClick(role)}
                                            variant="white"
                                            leftIcon={<ShieldUser size={16} />}
                                        >
                                            Permissions
                                        </Button>
                                    </PermissionGuard>
                                </div>
                            ) : null,
                        ].filter(Boolean)}
                    />
                ))}

                {!isLoading && !roles.length &&
                    <tr>
                        <td colSpan={8} className="text-center text-gray-950  py-2 font-semibold">No Roles Found</td>
                    </tr>
                }

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-gray-950  font-semibold" colSpan={8}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}
            </Table>

            {/* Pagination Component */}
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

            {/* Role Modal */}
            <Modal isOpen={isRoleModalOpen} onClose={() => setRoleModalOpen(false)} title={editItem ? 'Edit Role' : 'New Role'}>
                <form onSubmit={handleRoleFormSubmit}>
                    <div className="flex">
                        <div className="w-full mr-4">
                            <label className="block text-gray-600 font-semibold mb-2">Role Name <em className="text-red-500 text-sm">*</em></label>
                            <input
                                type="text"
                                value={formData.roleName}
                                onChange={(e) => setFormData({ ...formData, roleName: e.target.value })}
                                className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"
                            />
                            {formErrors.roleName && <span className="text-red-500 text-sm">{formErrors.roleName}</span>}
                        </div>
                    </div>
                    {/* submit */}
                    <div className="flex justify-end mt-4">
                        <Button
                            type="button"
                            variant="white"
                            onClick={() => setRoleModalOpen(false)}
                            className="mr-2"
                        >
                            Cancel
                        </Button>
                        <SubmitButton isDisabled={isSaving} isLoading={isSaving} mode={editItem ? "edit" : "create"} />
                    </div>
                </form>
            </Modal>
            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={handleConfirmDelete}
                isDeleting={isDeleting}
                title="Delete Role"
                message="Are you sure you want to delete this role? This action cannot be undone."
            />
        </div>
    );
}

export default RolesList;