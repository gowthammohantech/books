import type { RootState } from "@store/index";
import { hasPermission } from "@utils/hasPermission";
import { CirclePlusIcon, Edit, Link, Trash2Icon } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import ActiveFilterBanner, { type ActiveFilter } from "@components/admin/ActiveFilterBanner";
import ExpenseFormModal from "./ExpenseFormModal";
import Constants from "@constants/api";
import axios from "axios";
import type { ExpenseListShape } from "@models/expense";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import type { Action } from "@components/admin/tableActions";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import { toast } from "sonner";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import { useCurrencyFormatter } from "@hooks/useCurrencyFormatter";
import useDateFormatter from "@hooks/useDateFormatter";
import InvoiceStatusBadge from "@components/admin/InvoiceStatusBadge";
import { useQuery } from "@tanstack/react-query";
import { fetchModuleHierarchy, fetchCustomFieldsByModule } from "@api/customFieldTypeApi";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button, FormField, Select } from "@components/ui";

interface Pagination {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

interface ExpenseResponse {
    success: boolean;
    message: string;
    data: {
        expenses: ExpenseListShape[]
        pagination: Pagination
    }
}

interface FilterParams {
    search?: string;
    limit?: number;
    page?: number;
    supplierId?: string;
    // Report drill-down filters (seeded from the URL).
    startDate?: string;
    endDate?: string;
    paymentStatus?: string;
    expenseCategoryId?: string;
}

interface SupplierOption {
    id: string;
    supplier_name: string;
}

// Helper to safely extract custom field values using the fieldSlug
const extractCustomFieldValue = (expense: ExpenseListShape | any, fieldSlug: string) => {
    if (!expense.customFields) return '-';
    if (typeof expense.customFields === 'object') {
        const value = expense.customFields[fieldSlug];

        if (Array.isArray(value)) {
            return value.length > 0 ? value.join(', ') : '-';
        }

        return value !== undefined && value !== null && String(value).trim() !== '' ? value : '-';
    }
    return '-';
};

const ExpenseList: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const { format } = useCurrencyFormatter();
    const { formatDate } = useDateFormatter();
    const navigate = useNavigate();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [expenses, setExpenses] = useState<ExpenseListShape[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [searchParams, setSearchParams] = useSearchParams();
    const [filterParams, setFilterParams] = useState<FilterParams>(() => {
        const init: FilterParams = {};
        const sd = searchParams.get('startDate'); if (sd) init.startDate = sd;
        const ed = searchParams.get('endDate'); if (ed) init.endDate = ed;
        const ps = searchParams.get('paymentStatus'); if (ps) init.paymentStatus = ps;
        const cat = searchParams.get('expenseCategoryId'); if (cat) init.expenseCategoryId = cat;
        return init;
    });
    const activeFilters: ActiveFilter[] = [
        ...(filterParams.startDate ? [{ label: 'From', value: filterParams.startDate }] : []),
        ...(filterParams.endDate ? [{ label: 'To', value: filterParams.endDate }] : []),
        ...(filterParams.paymentStatus ? [{ label: 'Status', value: filterParams.paymentStatus }] : []),
        ...(filterParams.expenseCategoryId ? [{ label: 'Category', value: 'selected' }] : []),
    ];
    const clearDrillFilters = () => {
        setSearchParams({});
        setFilterParams({});
    };
    const { search = '', limit = 10, page = 1, supplierId: supplierIdFilter = '' } = filterParams;
    const [isLoading, setIsLoading] = useState(false);
    const [supplierFilterOptions, setSupplierFilterOptions] = useState<SupplierOption[]>([]);

    const [itemToEdit, setEditingItem] = useState<ExpenseListShape | null>(null);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteItem, setDeletingItem] = useState<ExpenseListShape | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // --- DYNAMIC CUSTOM FIELDS FETCHING (Inlined) ---
    // 1. Fetch Module Hierarchy & Find Module ID for 'expenses'
    const { data: moduleHierarchyResponse, isLoading: isModulesLoading } = useQuery({
        queryKey: ['moduleHierarchy'],
        queryFn: () => fetchModuleHierarchy(token!),
        refetchOnMount: false,
        enabled: !!token,
        staleTime: 1000 * 60 * 60
    });

    const expensesModuleId = useMemo(() => {
        if (!moduleHierarchyResponse?.data) return null;
        for (const mod of moduleHierarchyResponse.data) {
            if (mod.moduleSlug === 'expenses') return mod.id;
            if (mod.children) {
                const child = mod.children.find((c: any) => c.moduleSlug === 'expenses');
                if (child) return child.id;
            }
        }
        return null;
    }, [moduleHierarchyResponse]);

    // 2. Fetch Custom Fields specifically for the expenses module
    const { data: customFieldsResponse, isLoading: isCustomFieldsLoading } = useQuery({
        queryKey: ['customFields', expensesModuleId],
        queryFn: () => fetchCustomFieldsByModule(token!, expensesModuleId!),
        refetchOnMount: false,
        enabled: !!token && !!expensesModuleId
    });

    // 3. Filter to only include fields marked "showInTable"
    const tableCustomFields = useMemo(() => {
        return customFieldsResponse?.data?.fields?.filter((f: any) => f.showInTable) || [];
    }, [customFieldsResponse]);

    // 4. Construct Dynamic Table Headers
    const baseHeaders = ['#', 'Expense ID', 'Amount', 'Expense Date', 'Vendor', 'Payment Status', 'Created On'];
    const dynamicHeaders = tableCustomFields.map((f: any) => f.labelName);
    const tableHeaders = [...baseHeaders, ...dynamicHeaders, 'Actions'];

    // Unified loading state
    const isPageLoading = isLoading || isModulesLoading || isCustomFieldsLoading;
    // ------------------------------------------------

    useEffect(() => {
        fetchExpenses();
    }, [filterParams, token]);

    useEffect(() => {
        const fetchSupplierFilterOptions = async () => {
            try {
                const response = await axios.get(Constants.GET_SUPPLIERS_URL, {
                    params: { limit: 100, page: 1 },
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.data?.data?.suppliers) {
                    setSupplierFilterOptions(response.data.data.suppliers);
                }
            } catch (error) {
                console.error("Failed to fetch suppliers for filter", error);
            }
        }
        if (token) fetchSupplierFilterOptions();
    }, [token]);

    const fetchExpenses = async () => {
        try {
            setIsLoading(true);
            const params: FilterParams = { ...filterParams };
            if (!params.supplierId) delete params.supplierId;
            const response = await axios.get<ExpenseResponse>(Constants.FETCH_EXPENSES_FOR_LIST_URL, {
                params,
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data.success && response.data.data.expenses) {
                setExpenses(response.data.data.expenses);
                setPagination(response.data.data.pagination);
            }
        } catch (error) {
            console.error("Failed to fetch expenses", error);
        } finally {
            setIsLoading(false);
        }
    }

    const handleCreateClick = () => {
        setIsModalOpen(true);
        setEditingItem(null);
    };

    const handleSuccess = () => {
        setIsModalOpen(false);
        fetchExpenses();
    }

    const handleFilterChange = (key: string, value: string | number) => {
        setFilterParams({ ...filterParams, [key]: value });
    }

    const handleEditClick = (item: ExpenseListShape) => {
        setEditingItem({ ...item });
        setIsModalOpen(true);
    }

    const handleDeleteClick = (item: ExpenseListShape) => {
        setDeletingItem({ ...item });
        setDeleteModalOpen(true);
    }

    const handleDelete = async () => {
        try {
            setIsDeleting(true);
            const response = await axios.delete(`${Constants.DELETE_EXPENSE_URL}/${deleteItem?.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data.success) {
                toast.success(response.data.message);
                setDeleteModalOpen(false);
                fetchExpenses();
            } else {
                toast.error(response.data.message);
            }
        } catch (error) {
            toast.error('Something went wrong');
        } finally {
            setIsDeleting(false);
        }
    }

    const handleAttachmentClick = (item: ExpenseListShape) => {
        if (item.attachment) {
            window.open(item.attachment, '_blank');
        } else {
            toast.error('No attachment found');
        }
    }

    // Permission gating for Edit/Delete is handled per-action by TableRow via `requirePermission`.
    const tableActions: Action<ExpenseListShape>[] = [
        {
            label: 'Edit',
            icon: <Edit size={14} />,
            primary: true,
            requirePermission: { moduleSlug: 'expenses', action: 'edit' },
            onClick: (item: ExpenseListShape) => { handleEditClick(item) }
        },
        {
            label: 'Delete',
            icon: <Trash2Icon size={14} />,
            primary: true,
            variant: 'danger',
            requirePermission: { moduleSlug: 'expenses', action: 'delete' },
            onClick: (item: ExpenseListShape) => { handleDeleteClick(item) }
        },
        {
            label: 'View Attachment',
            icon: <Link size={14} />,
            onClick: (item: ExpenseListShape) => { handleAttachmentClick(item) }
        }
    ];
    // "View Attachment" is always present (ungated), so the Actions column never disappears.

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Expenses">
                {hasPermission(permissions, 'expenses', 'create') &&
                    <Button onClick={() => { handleCreateClick(); }} leftIcon={<CirclePlusIcon size={14} />}>
                        New Expense
                    </Button>
                }
            </PageHeader>

            <ActiveFilterBanner filters={activeFilters} onClear={clearDrillFilters} />

            {/* Search Input & PageLength */}
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2 flex-1 mr-2">
                    <FormField
                        type="text"
                        placeholder="Search..."
                        value={search}
                        onChange={(e) => handleFilterChange('search', e.target.value)}
                        containerClassName="w-full md:w-64"
                    />
                    <Select
                        value={supplierIdFilter}
                        onChange={(e) => handleFilterChange('supplierId', e.target.value)}
                        options={[
                            { value: '', label: 'All Vendors' },
                            ...supplierFilterOptions.map((s) => ({ value: s.id, label: s.supplier_name })),
                        ]}
                    />
                </div>
                <Select
                    value={limit}
                    onChange={(e) => handleFilterChange('limit', parseInt(e.target.value))}
                    options={[10, 25, 50].map((num) => ({ value: num, label: `${num} / page` }))}
                />
            </div>

            <Table headers={tableHeaders}>
                {!isPageLoading && expenses && expenses.map((expense, index) => (
                    <TableRow
                        key={expense.id}
                        row={expense}
                        index={(page - 1) * limit + index + 1}
                        columns={[
                            <span className="text-indigo-600 font-medium">{expense.expenseId}</span>,
                            <span className="font-semibold text-gray-700">{format(expense.amount)}</span>,
                            formatDate(expense.expenseDate, systemSettings?.dateFormat.format || 'd-m-Y'),
                            <span className="text-gray-700">{expense.supplier?.name ?? '—'}</span>,
                            <InvoiceStatusBadge status={expense.paymentStatus} />,
                            formatDate(expense.createdAt, systemSettings?.dateFormat.format || 'd-m-Y'),

                            ...tableCustomFields.map((f: any) => (
                                <span key={f.id} className="text-gray-600 font-medium">
                                    {extractCustomFieldValue(expense, f.fieldSlug || f.id)}
                                </span>
                            ))
                        ]}
                        actions={tableActions}
                        onRowClick={(item) => navigate(`/admin/expenses/view/${item.id}`)}
                    />
                ))}

                {!isPageLoading && expenses && expenses.length === 0 && (
                    <tr>
                        <td colSpan={tableHeaders.length} className="text-center text-gray-500 py-6 font-medium">No Records Found</td>
                    </tr>
                )}

                {isPageLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-6 text-gray-950 font-semibold" colSpan={tableHeaders.length}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}

            </Table>

            {/* Pagination Component */}
            {!isPageLoading && pagination.totalPages > 1 && (
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
            )}

            {/* Expense Form Modal */}
            {isModalOpen &&
                <ExpenseFormModal
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
                title="Delete Expense"
                message="Are you sure you want to delete this expense?"
                isDeleting={isDeleting}
            ></DeleteConfirmationModal>
        </div>
    );
};

export default ExpenseList;