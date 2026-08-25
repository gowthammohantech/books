import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import InvoiceStatusBadge from "@components/admin/InvoiceStatusBadge";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import ProfileCard from "@components/admin/ProfileImage";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import Constants from "@constants/api";
import { useCurrencies } from "@hooks/useCurrencies";
import useDateFormatter from "@hooks/useDateFormatter";
import type { Pagination } from "@models/common";
import type { Action } from "@components/admin/tableActions";
import type { RootState } from "@store/index";
import { hasPermission } from "@utils/hasPermission";
import axios from "axios";
import { CirclePlusIcon, Edit, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button } from "@components/ui";

interface DeliveryChallanList {
    id: string;
    challanNumber: string;
    challanDate: string;
    name: string;
    status: string;
    createdAt: string;
    paymentTerms: string;
    taxableAmount: number;
    totalDiscount: number;
    vat: number;
    totalAmount: number;
    paidAmount: number | null;
    payment_method: string;
    billFrom: string;
    billTo: {
        id: string;
        name: string;
        email: string;
        phone: string;
        image: string | null;
        billingAddress?: {
            name: string;
            addressLine1: string;
            addressLine2: string;
            city: string;
            state: string;
            country: string;
            pincode: string;
        }
    };
    notes: string;
    sign_type: string;
    currencyCode?: string | null;
    signature?: {
        id: string;
        name: string;

    };
}

const DeliveryChallanList: React.FC = () => {
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const [deliveryChallans, setDeliveryChallans] = useState<DeliveryChallanList[]>([]);
    const [itemToDelete, setItemToDelete] = useState<DeliveryChallanList | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const { formatDate } = useDateFormatter();
    const { formatMoney } = useCurrencies();
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);
    const handleNewDeliveryChallanClick = () => {
        navigate("/admin/delivery-challans/new");
    }

    const handleSearch = (value: string) => {
        setSearchParams({
            search: value,
            limit: String(limit),
            page: String(page)
        });
    }

    const handlePageLengthChange = (value: number) => {
        setSearchParams({
            search,
            limit: String(value),
            page: String(page)
        });
    }

    const fetchDeliveryChallans = async () => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.FETCH_DELIVERY_CHALLAN_FOR_LIST_URL, {
                params: { search, limit, page },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            let data = response.data.data;
            if (data.deliveryChallans.length > 0) {
                setDeliveryChallans(data.deliveryChallans);
            } else {
                setDeliveryChallans([]);
            }

            if (data.pagination) {
                setPagination(data.pagination);
            }
        } catch (error) {
            console.error("Error fetching credit notes:", error);
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        fetchDeliveryChallans();
    }, [search, limit, page, token]);

    const handlePageChange = (page: number) => {
        setSearchParams({
            search: search || '',
            limit: limit ? String(limit) : '10',
            page: String(page)
        });
    }

    // Permission gating for Edit/Delete is handled per-action by TableRow via `requirePermission`.
    const tableActions: Action<DeliveryChallanList>[] = [
        {
            label: 'Edit',
            icon: <Edit size={14} />,
            primary: true,
            requirePermission: { moduleSlug: 'delivery-challans', action: 'edit' },
            onClick: (item: DeliveryChallanList) => { handleEditClick(item) }
        },
        {
            label: 'Delete',
            icon: <Trash2Icon size={14} />,
            primary: true,
            variant: 'danger',
            requirePermission: { moduleSlug: 'delivery-challans', action: 'delete' },
            onClick: (item: DeliveryChallanList) => { handleDeleteClick(item) }
        },
    ];

    const tableHeaders = ["#", "Challan ID", "Customer", "Amount", "Created On", "Status", "Actions"];
    const handleEditClick = (item: DeliveryChallanList) => {
        navigate(`/admin/delivery-challans/edit/${item.id}`);
    }
    const handleDeleteClick = (item: DeliveryChallanList) => {
        setItemToDelete(item);
        setShowDeleteModal(true);
    }

    const confirmDelete = async () => {
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_DELIVERY_CHALLAN_URL}/${itemToDelete?.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Delivery Challan deleted successfully');
            setShowDeleteModal(false);
            await fetchDeliveryChallans();
        } catch (error) {
            console.error('Failed to delete delivery challan:', error);
        } finally {
            setIsDeleting(false);
        }
    }

    // Calculate pagination display text
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Delivery Challans">
                {hasPermission(permissions, 'delivery-challans', 'create') && (
                    <Button
                        onClick={handleNewDeliveryChallanClick}
                        leftIcon={<CirclePlusIcon size={14} />}>
                        New Delivery Challan
                    </Button>
                )}
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
            {/* Invoice Table */}
            <Table headers={tableHeaders}>
                {!isLoading && deliveryChallans && deliveryChallans.map((challan, index) => (
                    <TableRow
                        key={challan.id}
                        index={(page - 1) * limit + index + 1}
                        row={challan}
                        columns={[
                            <span className="text-indigo-600">{challan.challanNumber}</span>,
                            <ProfileCard
                                imageUrl={challan.billTo?.image}
                                name={challan.billTo?.name}
                                email={challan.billTo?.email}
                            />,
                            <span className="font-semibold text-gray-950 ">{formatMoney(challan.totalAmount, challan.currencyCode)}</span>,
                            <span className="font-semibold text-gray-950 ">{formatDate(challan.createdAt as string, systemSettings?.dateFormat.format || 'd-m-Y')}</span>,
                            <InvoiceStatusBadge status={challan.status} />
                        ]}
                        actions={tableActions}
                        onRowClick={(item) => navigate(`/admin/delivery-challans/view/${item.id}`)}
                    />
                ))}
                {!isLoading && deliveryChallans && deliveryChallans.length === 0 && (
                    <tr key="no-quotations">
                        <td className="text-center py-2 text-gray-950  font-semibold" colSpan={10}>
                            No Delivery Challans Found
                        </td>
                    </tr>
                )}

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-gray-950  font-semibold" colSpan={7}>
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
            {/* Delete Invoice */}
            <DeleteConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={confirmDelete}
                isDeleting={isDeleting}
                title="Confirm Deletion"
                message="Are you sure you want to delete this delivery challan?"
            >
            </DeleteConfirmationModal>
        </div>
    );
};

export default DeliveryChallanList;