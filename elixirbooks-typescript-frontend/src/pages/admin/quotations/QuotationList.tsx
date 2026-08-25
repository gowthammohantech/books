import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import ProfileCard from "@components/admin/ProfileImage";
import StatusBadge from "@components/admin/StatusBadge";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import type { Action } from "@components/admin/tableActions";
import Constants from "@constants/api";
import useDateFormatter from "@hooks/useDateFormatter";
import type { RootState } from "@store/index";
import { hasPermission } from "@utils/hasPermission";
import axios from "axios";
import { CheckCircle2, CirclePlusIcon, Edit, LucideEye, MailIcon, ReceiptIcon, Trash2Icon, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button } from "@components/ui";

interface Quotation {
    id: string;
    quotationId: string;
    quotationDate: string;
    referenceNo: string;
    name: string;
    status: string;
    createdAt: string;
    paymentTerms: string;
    taxableAmount: number;
    totalDiscount: number;
    vat: number;
    TotalAmount: number;
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
    signature?: {
        id: string;
        name: string;
    };
    invoiceId: string | null;
}

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

const QuotationList: React.FC = () => {
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    const [itemToDelete, setItemToDelete] = useState<Quotation | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const { formatDate } = useDateFormatter();
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);
    const [itemToupdateStatus, setItemToupdateStatus] = useState<Quotation | null>(null);
    const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

    const handleNewQuotationClick = () => {
        navigate("/admin/quotations/new");
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

    const fetchQuotations = async () => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.GET_QUOTATIONS_FOR_LIST_URL, {
                params: { search, limit, page },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            let data = response.data.data;
            if (data.quotations.length > 0) {
                setQuotations(data.quotations);
            } else {
                setQuotations([]);
            }

            if (data.pagination) {
                setPagination(data.pagination);
            }
        } catch (error) {
            console.error("Error fetching quotations:", error);
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        fetchQuotations();
    }, [search, limit, page, token]);

    const handlePageChange = (page: number) => {
        setSearchParams({
            search: search || '',
            limit: limit ? String(limit) : '10',
            page: String(page)
        });
    }

    const tableHeaders = ["#", "Quotation ID", "Customer", "Created On", "Status", "Actions"];
    // Permission gating is handled per-action by TableRow via `requirePermission`.
    // Status-based visibility (and the convert-once rule) is still applied here per-row.
    const getTableActions = (item: Quotation): Action<Quotation>[] => {
        const actions: Array<Action<Quotation> & { slug: string; hideWhen?: string[] }> = [
            {
                label: 'Edit',
                slug: 'edit',
                icon: <Edit size={14} />,
                primary: true,
                requirePermission: { moduleSlug: 'quotations', action: 'edit' },
                onClick: (item: Quotation) => { handleEditClick(item) }
            },
            {
                label: 'Delete',
                slug: 'delete',
                icon: <Trash2Icon size={14} />,
                primary: true,
                variant: 'danger',
                requirePermission: { moduleSlug: 'quotations', action: 'delete' },
                onClick: (item: Quotation) => { handleDeleteClick(item) }
            },
            {
                label: 'Convert to Invoice',
                slug: 'convert-to-invoice',
                icon: <ReceiptIcon size={14} />,
                onClick: (item: Quotation) => { handleConvertToInvoiceClick(item) }
            },
            {
                label: 'Mark as Accepted',
                slug: 'mark-as-accepted',
                icon: <CheckCircle2 size={14} />,
                onClick: (item: Quotation) => { handleMarkAsAcceptedClick(item) },
                hideWhen: ['accepted', 'declined']
            },
            {
                label: 'Mark as Declined',
                slug: 'mark-as-declined',
                icon: <XCircle size={14} />,
                onClick: (item: Quotation) => { handleMarkAsDeclinedClick(item) },
                hideWhen: ['accepted', 'declined']
            },
            {
                label: 'Send Email',
                slug: 'send-email',
                icon: <MailIcon size={14} />,
                onClick: (item: Quotation) => { handleSendMailClick(item) }
            },
            {
                label: 'View',
                slug: 'view',
                icon: <LucideEye size={14} />,
                onClick: (item: Quotation) => { handleViewClick(item) }
            }
        ];

        return actions.filter((action) => {
            //hide if slug convert-to-invoice & already converted to invoice
            if (action.slug === 'convert-to-invoice' && item.invoiceId) return false;
            //hide when not allowed by status
            if (action.hideWhen?.includes(item.status)) {
                return false;
            }
            return true;
        });
    }
    const handleMarkAsAcceptedClick = async (item: Quotation) => {
        const updatedItem = { ...item, status: 'accepted' };
        setItemToupdateStatus(updatedItem);
        setIsStatusModalOpen(true);
    }
    const handleMarkAsDeclinedClick = async (item: Quotation) => {
        const updatedItem = { ...item, status: 'declined' };
        setItemToupdateStatus(updatedItem);
        setIsStatusModalOpen(true);
    }
    const handleSendMailClick = (item: Quotation) => {
        navigate(`/admin/quotations/email/${item.id}`);
    }
    const handleViewClick = (item: Quotation) => {
        navigate(`/admin/view-quotation/${item.id}`);
    }
    const handleStatusUpdate = async () => {
        if (!itemToupdateStatus) return;
        try {
            setIsUpdatingStatus(true);
            await axios.patch(`${Constants.UPDATE_QUOTATION_STATUS_URL}/${itemToupdateStatus.id}`, { status: itemToupdateStatus.status }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Status updated successfully');
            setIsStatusModalOpen(false);
            await fetchQuotations();
        } catch (error) {
            toast.error('Something went wrong');
        } finally {
            setIsUpdatingStatus(false);
        }
    }
    const handleEditClick = (item: Quotation) => {
        navigate(`/admin/quotations/edit/${item.id}`);
    }
    const handleDeleteClick = (item: Quotation) => {
        setItemToDelete(item);
        setShowDeleteModal(true);
    }

    const handleConvertToInvoiceClick = async (item: Quotation) => {
        try {
            await axios.post(`${Constants.CONVERT_QUOTATION_TO_INVOICE_URL}/${item.id}`,
                {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            await fetchQuotations();
            toast.success('Quotation converted to invoice successfully');
        } catch (error) {
            toast.error('Failed to convert quotation to invoice.');
        }
    }
    const confirmDelete = async () => {
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_QUOTATION_URL}/${itemToDelete?.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Quotation deleted successfully');
            setShowDeleteModal(false);
            await fetchQuotations();
        } catch (error) {
            console.error('Failed to delete quotation:', error);
        } finally {
            setIsDeleting(false);
        }
    }

    // Calculate pagination display text
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Quotations">
                {hasPermission(permissions, 'quotations', 'create') && (
                    <Button
                        onClick={handleNewQuotationClick}
                        leftIcon={<CirclePlusIcon size={14} />}>
                        New Quotation
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
            {/* Quotation Table */}
            <Table headers={tableHeaders}>
                {!isLoading && quotations && quotations.map((quotation, index) => (
                    <TableRow
                        key={quotation.id}
                        index={(page - 1) * limit + index + 1}
                        row={quotation}
                        columns={[
                            <span className="text-indigo-600">{quotation.quotationId}</span>,
                            <ProfileCard
                                imageUrl={quotation.billTo?.image}
                                name={quotation.billTo?.name}
                                email={quotation.billTo?.email}
                            />,
                            <span className="font-semibold text-gray-950 ">{formatDate(quotation.createdAt, systemSettings?.dateFormat.format || 'd-m-Y')}</span>,
                            <StatusBadge status={quotation.status} />,
                        ]}
                        actions={getTableActions(quotation)}
                        onRowClick={(item) => navigate(`/admin/view-quotation/${item.id}`)}
                    />
                ))}
                {!isLoading && quotations.length === 0 && (
                    <tr key="no-quotations">
                        <td className="text-center py-2 text-gray-950  font-semibold" colSpan={6}>
                            No Quotations Found
                        </td>
                    </tr>
                )}
                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-gray-950  font-semibold" colSpan={6}>
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
            {/* Delete Quotation */}
            <DeleteConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={confirmDelete}
                isDeleting={isDeleting}
                title="Confirm Deletion"
                message="Are you sure you want to delete this quotation?"
            >
            </DeleteConfirmationModal>

            {/* Status Update Modal */}
            <DeleteConfirmationModal
                isOpen={isStatusModalOpen}
                onClose={() => setIsStatusModalOpen(false)}
                onConfirm={handleStatusUpdate}
                isDeleting={isUpdatingStatus}
                title={itemToupdateStatus?.status === 'accepted' ? 'Accept Quotation' : 'Decline Quotation'}
                message={itemToupdateStatus?.status === 'accepted' ? 'Are you sure you want to accept this quotation?' : 'Are you sure you want to decline this quotation?'}
            >
            </DeleteConfirmationModal>
        </div>
    );
};

export default QuotationList;