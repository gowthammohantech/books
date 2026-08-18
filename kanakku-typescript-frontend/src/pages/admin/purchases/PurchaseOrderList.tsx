import { useEffect, useState, useMemo, type FC } from "react";
import { CirclePlusIcon, Edit, Trash2Icon } from "lucide-react";
import Table from '@components/admin/Table';
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { useSelector } from "react-redux";
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import TableRow from '@components/admin/TableRow';
import type { Action } from '@components/admin/tableActions';
import { toast } from "sonner";
import PaginationWrapper from '@components/admin/PaginationWrapper';
import StatusBadge from '@components/admin/StatusBadge';
import PaymentModeBadge from '@components/admin/PaymentModeBadge';
import DeleteConfirmationModal from '@components/admin/DeleteConfirmationModal';
import { hasPermission } from "@utils/hasPermission";
import { useCurrencies } from "@hooks/useCurrencies";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import useDateFormatter from "@hooks/useDateFormatter";
import ProfileCard from "@components/admin/ProfileImage";
import { useQuery } from "@tanstack/react-query";
import { fetchModuleHierarchy, fetchCustomFieldsByModule } from "@api/customFieldTypeApi";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button, FormField, Select } from "@components/ui";

interface PurchaseOrder {
    id: string;
    purchaseOrderId: string;
    purchaseOrderDate: string;
    billFrom: string;
    billTo?: {
        id: string;
        name: string;
        email: string;
        phone: string;
        profileImage: string;
    };
    TotalAmount: number;
    convertedToPurchase: boolean;
    payment_mode: string;
    status: string;
    createdAt: string;
    currencyCode?: string | null;
    customFields?: Record<string, any>; // <-- Added to support dynamic custom fields
}

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// Helper to safely extract custom field values using the fieldSlug
const extractCustomFieldValue = (po: PurchaseOrder | any, fieldSlug: string) => {
    if (!po.customFields) return '-';
    if (typeof po.customFields === 'object') {
        const value = po.customFields[fieldSlug];

        if (Array.isArray(value)) {
            return value.length > 0 ? value.join(', ') : '-';
        }

        return value !== undefined && value !== null && String(value).trim() !== '' ? value : '-';
    }
    return '-';
};

const PurchaseOrderList: FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const navigate = useNavigate();
    const { formatMoney } = useCurrencies();
    const { formatDate } = useDateFormatter();

    // State for the list of purchase orders and pagination
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
    const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });

    // State for the delete confirmation modal
    const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
    const [itemToDelete, setItemToDelete] = useState<PurchaseOrder | null>(null);

    // Using URL search parameters to manage state for search, limit, and page
    const [searchParams, setSearchParams] = useSearchParams();
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);

    // --- DYNAMIC CUSTOM FIELDS FETCHING (Inlined) ---
    const { data: moduleHierarchyResponse, isLoading: isModulesLoading } = useQuery({
        queryKey: ['moduleHierarchy'],
        queryFn: () => fetchModuleHierarchy(token!),
        refetchOnMount: false,
        enabled: !!token,
        staleTime: 1000 * 60 * 60
    });

    const poModuleId = useMemo(() => {
        if (!moduleHierarchyResponse?.data) return null;
        for (const mod of moduleHierarchyResponse.data) {
            // Checking both variations of the slug just in case
            if (mod.moduleSlug === 'purchase-orders' || mod.moduleSlug === 'purchase-order') return mod.id;
            if (mod.children) {
                const child = mod.children.find((c: any) => c.moduleSlug === 'purchase-orders' || c.moduleSlug === 'purchase-order');
                if (child) return child.id;
            }
        }
        return null;
    }, [moduleHierarchyResponse]);

    const { data: customFieldsResponse, isLoading: isCustomFieldsLoading } = useQuery({
        queryKey: ['customFields', poModuleId],
        queryFn: () => fetchCustomFieldsByModule(token!, poModuleId!),
        refetchOnMount: false,
        enabled: !!token && !!poModuleId
    });

    const tableCustomFields = useMemo(() => {
        return customFieldsResponse?.data?.fields?.filter((f: any) => f.showInTable) || [];
    }, [customFieldsResponse]);

    // Unified loading state
    const isPageLoading = isLoading || isModulesLoading || isCustomFieldsLoading;
    // ------------------------------------------------

    // Handlers for updating URL search parameters
    const handleSearch = (keyword: string) => {
        setSearchParams({ search: keyword, limit: String(limit), page: '1' });
    };

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ search, limit: String(newLimit), page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ search, limit: String(limit), page: String(newPage) });
    };

    // Handler to navigate to the 'new purchase order' page
    const handleNewPoClick = () => {
        navigate("/admin/purchase-orders/new");
    };

    // Fetch purchase orders whenever search, limit, or page changes
    useEffect(() => {
        fetchPurchaseOrders(search, limit, page);
    }, [search, limit, page, token]);

    const fetchPurchaseOrders = async (searchParam?: string, limitParam?: number, pageParam?: number) => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.FETCH_PURCHASE_ORDERS_URL, {
                params: { search: searchParam, limit: limitParam, page: pageParam },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            //set nextPurchaseOrderId to sessionStorage
            if (response.data.data.nextPurchaseOrderId) sessionStorage.setItem('nextPurchaseOrderId', response.data.data.nextPurchaseOrderId);
            setPurchaseOrders(response.data.data.purchaseOrders ?? []);
            setPagination(response.data.data.pagination ?? { total: 0, page: 1, limit: 10, totalPages: 1 });
        } catch (error) {
            console.error('Error fetching purchase orders:', error);
            toast.error('Failed to fetch purchase orders.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleEditClick = (item: PurchaseOrder) => {
        navigate(`/admin/purchase-orders/edit/${item.id}`);
    };

    const handleDeleteClick = (item: PurchaseOrder) => {
        setItemToDelete(item);
        setShowDeleteModal(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_PURCHASE_ORDER_URL}/${itemToDelete.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Purchase order deleted successfully');
            fetchPurchaseOrders(search, limit, page);
            setShowDeleteModal(false);
            setItemToDelete(null);
        } catch (error) {
            console.error('Failed to delete purchase order:', error);
            toast.error('Failed to delete purchase order.');
        } finally {
            setIsDeleting(false);
        }
    };

    // Edit/Delete render as inline primary buttons; permission gating handled per-action by TableRow via `requirePermission`.
    // Convert to Purchase now lives inside the read-only PO view (no kebab here).
    const getTableActions = (_item: PurchaseOrder): Action<PurchaseOrder>[] => {
        const tableActions: Array<Action<PurchaseOrder> & { hide?: boolean }> = [
            {
                label: 'Edit',
                icon: <Edit size={14} />,
                primary: true,
                requirePermission: { moduleSlug: 'purchase-order', action: 'edit' },
                onClick: (item: PurchaseOrder) => { handleEditClick(item) }
            },
            {
                label: 'Delete',
                icon: <Trash2Icon size={14} />,
                primary: true,
                variant: 'danger',
                requirePermission: { moduleSlug: 'purchase-order', action: 'delete' },
                onClick: (item: PurchaseOrder) => { handleDeleteClick(item) }
            }
        ];

        return tableActions.filter((action) => !action.hide);
    }

    // Construct Dynamic Table Headers
    const baseHeaders = ["#", "Order Number", "Order Date", "Supplier", "Amount", "Payment Mode", "Created On", "Status"];
    const dynamicHeaders = tableCustomFields.map((f: any) => f.labelName);
    const tableHeaders = [...baseHeaders, ...dynamicHeaders, "Action"];

    // Calculate pagination display text
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Purchase Orders">
                {hasPermission(permissions, 'purchase-orders', 'create') &&
                    <Button
                        onClick={handleNewPoClick}
                        leftIcon={<CirclePlusIcon size={14} />}>
                        New Purchase Order
                    </Button>
                }
            </PageHeader>

            {/* Search Input & PageLength */}
            <div className="flex justify-between items-center">
                <FormField
                    type="text"
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                    containerClassName="w-full md:w-64"
                />
                <Select
                    value={limit}
                    onChange={(e) => handlePageLengthChange(Number(e.target.value))}
                    options={[10, 25, 50].map((num) => ({ value: num, label: `${num} / page` }))}
                />
            </div>

            <Table headers={tableHeaders}>
                {!isPageLoading && purchaseOrders && purchaseOrders.map((purchaseOrder, index) => (
                    <TableRow
                        key={purchaseOrder.id}
                        index={(page - 1) * limit + index + 1}
                        row={purchaseOrder}
                        columns={[
                            <span className="text-indigo-600">{purchaseOrder.purchaseOrderId}</span>,
                            formatDate(purchaseOrder.purchaseOrderDate, systemSettings?.dateFormat.format || 'd-m-Y'),
                            <ProfileCard
                                imageUrl={purchaseOrder.billTo?.profileImage}
                                name={purchaseOrder.billTo?.name || ""}
                            />,
                            formatMoney(purchaseOrder.TotalAmount, purchaseOrder.currencyCode),
                            <PaymentModeBadge mode={purchaseOrder.payment_mode || "cash"} />,
                            formatDate(purchaseOrder.createdAt, systemSettings?.dateFormat.format || 'd-m-Y'),
                            <StatusBadge status={purchaseOrder.status} />,

                            // Inject dynamic custom field columns
                            ...tableCustomFields.map((f: any) => (
                                <span key={f.id} className="text-gray-600 font-medium">
                                    {extractCustomFieldValue(purchaseOrder, f.fieldSlug || f.id)}
                                </span>
                            ))
                        ]}
                        actions={getTableActions(purchaseOrder)}
                        onRowClick={(item) => navigate(`/admin/purchase-orders/view/${item.id}`)}
                    />
                ))}

                {!isPageLoading && purchaseOrders.length === 0 && (
                    <tr>
                        <td colSpan={tableHeaders.length} className="text-center py-4 text-gray-950  font-semibold">
                            No purchase orders found
                        </td>
                    </tr>
                )}

                {isPageLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-6 text-gray-950  font-semibold" colSpan={tableHeaders.length}>
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
                    onChange={(_, newPage) => handlePageChange(newPage)}
                    paginationVariant="outlined"
                    paginationShape="rounded"
                />
            )}

            <DeleteConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={confirmDelete}
                isDeleting={isDeleting}
                title="Confirm Deletion"
                message={`Are you sure you want to delete the purchase order ${itemToDelete?.purchaseOrderId}? This action cannot be undone.`}
            >
            </DeleteConfirmationModal>
        </div>
    );
}

export default PurchaseOrderList;