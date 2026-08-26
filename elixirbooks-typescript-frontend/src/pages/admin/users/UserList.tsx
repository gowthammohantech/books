import { CirclePlusIcon, Edit, Trash2Icon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
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
import useDateFormatter from "@hooks/useDateFormatter";
import StaffForm from "./StaffForm";
import type { StaffList } from "@models/staff";
import type { PermissionAction } from "@models/permissions";
import { hasPermission } from "@utils/hasPermission";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import ProfileCard from "@components/admin/ProfileImage";
import { Button } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

const UserList: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [staffs, setStaffs] = useState<StaffList[]>([]);
    const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [isStaffModalOpen, setStaffModalOpen] = useState<boolean>(false);
    const [isDeleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
    const [editItem, setEditItem] = useState<StaffList | null>(null);
    const [deleteItem, setDeleteItem] = useState<StaffList | null>(null);
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const { formatDate } = useDateFormatter();
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const handleCreateClick = () => {
        // setFormData(initialFormData);
        setEditItem(null);
        // setFormErrors({});
        setStaffModalOpen(true);
    };

    useEffect(() => {
        fetchStaffs(search, limit, page);
    }, [search, limit, page]);

    const fetchStaffs = async (search?: string, limit?: number, page?: number) => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.FETCH_STAFF_FOR_LIST_URL, {
                params: { search, limit, page },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setStaffs(response.data.data.users || []);
            setPagination(response.data.data.pagination);
        } catch (error) {
            toast.error("Failed to fetch users.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleEditClick = (item: StaffList) => {
        setEditItem(item);
        setStaffModalOpen(true);
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

    const handleDeleteClick = async (item: StaffList) => {
        setDeleteItem(item);
        setDeleteModalOpen(true);
    }

    const handleSuccess = () => {
        fetchStaffs(search, limit, page);
        setStaffModalOpen(false);
    }
    const handleConfirmDelete = async () => {
        if (deleteItem) {
            try {
                await axios.delete(`${Constants.DELETE_STAFF_URL}/${deleteItem.id}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                toast.success("User deleted successfully.");
                fetchStaffs(search, limit, page);
                setDeleteModalOpen(false);
            } catch (error) {
                console.error("Error deleting user:", error);
                toast.error("Failed to delete user.");
            }
        }
    }

    const tableActions = [
        {
            label: 'Edit',
            icon: <Edit size={14} />,
            onClick: (item: StaffList) => { handleEditClick(item) },
            isDisabled: (item: StaffList) => item.user_type === 1,
        },
        {
            label: 'Delete',
            icon: <Trash2Icon size={14} />,
            onClick: (item: StaffList) => { handleDeleteClick(item) },
            isDisabled: (item: StaffList) => item.user_type === 1,
        }
    ];
    const tableHeaders = ['#', 'User Name', 'Phone', 'Role', 'Created On', 'Actions'];
    const restrictedActions = ["edit", "delete"];
    const allowedActions = tableActions.filter((action) => {
        const actionKey = action.label.toLowerCase() as PermissionAction;
        if (!restrictedActions.includes(actionKey)) {
            return true;
        }
        return hasPermission(permissions, "roles-permissions", actionKey);
    });

    if (allowedActions.length === 0) {
        tableHeaders.pop();
    }
    // Calculate pagination display text
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Users">
                {hasPermission(permissions, "roles-permissions", "create") &&
                    <Button
                        onClick={() => { handleCreateClick(); }}
                        variant="primary"
                        leftIcon={<CirclePlusIcon size={14} />}
                    >
                        New User
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
                    className="border border-gray-300 rounded-md px-4 py-2 w-full md:w-64  text-gray-950 focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
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
                {!isLoading && staffs && staffs.map((staff: any, index: number) => (
                    <TableRow
                        key={staff.id}
                        index={index + 1}
                        row={staff}
                        columns={[
                            <ProfileCard
                                imageUrl={staff.profileImage}
                                name={staff.firstName + ' ' + staff.lastName}
                                email={staff.email}
                            />,
                            staff.phone,
                            staff.roleName,
                            formatDate(staff.createdAt, systemSettings?.dateFormat.format || 'd-y-m'),
                        ]}
                        actions={allowedActions.length > 0 ? allowedActions : undefined}
                    >

                    </TableRow>
                ))}
                {!isLoading && !staffs.length &&
                    <tr>
                        <td colSpan={tableHeaders.length} className="text-center text-gray-950  py-2 font-semibold">No Users Found</td>
                    </tr>
                }

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-gray-950  font-semibold" colSpan={tableHeaders.length}>
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

            {/* Staff Form */}
            <StaffForm
                isOpen={isStaffModalOpen}
                onClose={() => setStaffModalOpen(false)}
                onSuccess={() => handleSuccess()}
                editItem={editItem || undefined}
            />
            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={handleConfirmDelete}
                title="Delete User"
                message="Are you sure you want to delete this user? This action cannot be undone."
            />
        </div>
    );
}

export default UserList;