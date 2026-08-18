import type { RootState } from "@store/index";
import { hasPermission } from "@utils/hasPermission";
import { CirclePlusIcon, Edit, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useSelector } from "react-redux";
import Constants from "@constants/api";
import axios from "axios";
import type { ExpenseCategoryShape } from "@models/expense";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import type { PermissionAction } from "@models/permissions";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import { toast } from "sonner";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import useDateFormatter from "@hooks/useDateFormatter";
import type { Pagination } from "@models/common";
import ExpenseCategoryFormModal from "./ExpenseCategoryFormModal";
import Switch from "@components/admin/Switch";
import { useQuery } from "@tanstack/react-query";
import { fetchExpenseCategories } from "@api/expenseCategoryApi";
import { useDebounce } from "@hooks/useDebounce";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button, FormField, Select } from "@components/ui";

export interface ExpenseCategoryResponse {
    success: boolean;
    message: string;
    data: {
        categories: ExpenseCategoryShape[]
        pagination: Pagination
    }
}
interface FilterParams {
    search?: string;
    limit?: number;
    page?: number;
}
const ExpenseCategoryList: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const { formatDate } = useDateFormatter();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [filterParams, setFilterParams] = useState<FilterParams>({});
    const { search = '', limit = 10, page = 1 } = filterParams;
    const debouncedSearch = useDebounce(search, 500);
    const [itemToEdit, setEditingItem] = useState<ExpenseCategoryShape | null>(null);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteItem, setDeletingItem] = useState<ExpenseCategoryShape | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);


    const handleCreateClick = () => {
        setIsModalOpen(true);
        setEditingItem(null);
    };

    const handleSuccess = () => {
        setIsModalOpen(false);
        refetch();
    }

    const handleFilterChange = (key: string, value: string | number) => {
        setFilterParams({ ...filterParams, [key]: value });
    }

    const handleEditClick = (item: ExpenseCategoryShape) => {
        setEditingItem({ ...item });
        setIsModalOpen(true);
    }

    const handleDeleteClick = (item: ExpenseCategoryShape) => {
        setDeletingItem({ ...item });
        setDeleteModalOpen(true);
    }

    const handleDelete = async () => {
        try {
            setIsDeleting(true);
            const response = await axios.delete(`${Constants.DELETE_EXPENSE_CATEGORY_URL}/${deleteItem?.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data.success) {
                toast.success(response.data.message);
                setDeleteModalOpen(false);
                refetch();
            } else {
                toast.error(response.data.message);
            }
        } catch (error) {
            toast.error('Something went wrong');
        } finally {
            setIsDeleting(false);
        }
    }

    const handleStatusChange = async (item: ExpenseCategoryShape) => {
        try {
            const formData = {
                status: !item.status,
                title: item.title,
                description: item.description
            };
            await axios.put(`${Constants.UPDATE_EXPENSE_CATEGORY_URL}/${item.id}`, formData, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            toast.success('Status updated successfully');
            refetch();
        } catch (error) {
            toast.error('Something went wrong');
        }
    }

    const { data, isLoading, refetch } = useQuery({
        queryKey: ['expenseCategories', { debouncedSearch, limit, page }],
        queryFn: () => fetchExpenseCategories(token!, { debouncedSearch, limit, page }),
        refetchOnMount: false,
        staleTime: 1000 * 60 * 5,
        enabled: !!token
    });

    const expenseCategories = data?.categories || [];
    const pagination = data?.pagination || { total: 0, page: 1, limit: 10, totalPages: 1 };
    const tableActions = [
        {
            label: 'Edit',
            icon: <Edit size={14} />,
            onClick: (item: ExpenseCategoryShape) => { handleEditClick(item) }
        },
        {
            label: 'Delete',
            icon: <Trash2Icon size={14} />,
            onClick: (item: ExpenseCategoryShape) => { handleDeleteClick(item) }
        }
    ];
    const tableHeaders = ['#', 'Title', 'Description', 'Status', 'Created On', 'Actions'];
    const restrictedActions = ['edit', 'delete'];
    const allowedActions = tableActions.filter((action) => {
        let actionaLabel = action.label.toLowerCase();
        if (restrictedActions.includes(actionaLabel)) {
            const actionKey = actionaLabel.toLowerCase() as PermissionAction;
            return hasPermission(permissions, 'expenses', actionKey);
        }
        return true;
    });

    if (allowedActions.length === 0) tableHeaders.pop();

    // Calculate pagination display text
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Expense Categories">
                {hasPermission(permissions, 'expenses', 'create') &&
                    <Button onClick={() => { handleCreateClick(); }} leftIcon={<CirclePlusIcon size={14} />}>
                        New Expense Category
                    </Button>
                }
            </PageHeader>

            {/* Search Input & PageLength */}
            <div className="flex justify-between items-center">
                <FormField
                    type="text"
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => handleFilterChange('search', e.target.value)}
                    containerClassName="w-full md:w-64"
                />
                <Select
                    value={limit}
                    onChange={(e) => handleFilterChange('limit', parseInt(e.target.value))}
                    options={[10, 25, 50].map((num) => ({ value: num, label: `${num} / page` }))}
                />
            </div>

            <Table headers={tableHeaders}>
                {!isLoading && expenseCategories && expenseCategories.map((category, index) => (
                    <TableRow
                        key={category.id}
                        row={category}
                        index={index + 1}
                        columns={[
                            <span className="text-indigo-600">{category.title}</span>,
                            category.description && category.description.length > 50 ? `${category.description.substring(0, 50)}...` : category.description,
                            <div>
                                <Switch name={`status-${category.id}`} checked={category.status} onChange={() => handleStatusChange(category)} />
                            </div>,
                            formatDate(category.createdAt, systemSettings?.dateFormat.format || 'd-m-Y'),
                        ]}
                        actions={allowedActions && allowedActions.length > 0 ? allowedActions : undefined}
                    />
                ))}

                {!isLoading && expenseCategories && expenseCategories.length === 0 && (
                    <tr>
                        <td colSpan={8} className="text-center text-gray-800  py-2 font-semibold">No Records Found</td>
                    </tr>
                )}

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
                onChange={(_, newPage) => handleFilterChange('page', newPage)}
                paginationVariant="outlined"
                paginationShape="rounded"
            />

            {/* Expense Form Modal */}
            {isModalOpen &&
                <ExpenseCategoryFormModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    onSuccess={() => handleSuccess()}
                    editItem={itemToEdit || undefined}
                />
            }

            <DeleteConfirmationModal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={handleDelete}
                title="Delete Expense Category"
                message="Are you sure you want to delete this expense category?"
                isDeleting={isDeleting}
            ></DeleteConfirmationModal>
        </div>
    );
};

export default ExpenseCategoryList;