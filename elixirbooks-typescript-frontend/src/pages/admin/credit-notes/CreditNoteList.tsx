import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import InvoiceStatusBadge from "@components/admin/InvoiceStatusBadge";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import NoRecords from "@components/admin/NoRecords";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import ProfileCard from "@components/admin/ProfileImage";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import type { Action } from "@components/admin/tableActions";
import Constants from "@constants/api";
import { useCurrencies } from "@hooks/useCurrencies";
import useDateFormatter from "@hooks/useDateFormatter";
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

interface Invoice {
    id: string;
    creditNoteNumber: string;
    invoiceDate: string;
    dueDate: string | null;
    referenceNo: string;
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

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

const CreditNoteList: React.FC = () => {
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [itemToDelete, setItemToDelete] = useState<Invoice | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const { formatDate } = useDateFormatter();
    const { formatMoney } = useCurrencies();
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);
    const handleNewCreditNoteClick = () => {
        navigate("/admin/credit-notes/new");
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

    const fetchInvoices = async () => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.CREDIT_NOTE_LIST_URL, {
                params: { search, limit, page },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            let data = response.data.data;
            if (data.creditNotes.length > 0) {
                setInvoices(data.creditNotes);
            } else {
                setInvoices([]);
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
        fetchInvoices();
    }, [search, limit, page, token]);

    const handlePageChange = (page: number) => {
        setSearchParams({
            search: search || '',
            limit: limit ? String(limit) : '10',
            page: String(page)
        });
    }

    // Permission gating is handled per-action by TableRow via `requirePermission`.
    const tableActions: Action<Invoice>[] = [
        {
            label: 'Edit',
            icon: <Edit size={14} />,
            primary: true,
            requirePermission: { moduleSlug: 'credit-notes', action: 'edit' },
            onClick: (item: Invoice) => { handleEditClick(item) }
        },
        {
            label: 'Delete',
            icon: <Trash2Icon size={14} />,
            primary: true,
            variant: 'danger',
            requirePermission: { moduleSlug: 'credit-notes', action: 'delete' },
            onClick: (item: Invoice) => { handleDeleteClick(item) }
        }
    ];

    const canEdit = hasPermission(permissions, 'credit-notes', 'edit');
    const canDelete = hasPermission(permissions, 'credit-notes', 'delete');
    const tableHeaders = ["#", "Credit Note ID", "Customer", "Amount", "Created On", "Status", "Actions"];
    if (!canEdit && !canDelete) {
        tableHeaders.pop();
    }

    const handleEditClick = (item: Invoice) => {
        navigate(`/admin/credit-notes/edit/${item.id}`);
    }
    const handleDeleteClick = (item: Invoice) => {
        setItemToDelete(item);
        setShowDeleteModal(true);
    }

    const confirmDelete = async () => {
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_CREDIT_NOTE_URL}/${itemToDelete?.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Credit note deleted successfully');
            setShowDeleteModal(false);
            await fetchInvoices();
        } catch (error) {
            console.error('Failed to delete credit note:', error);
        } finally {
            setIsDeleting(false);
        }
    }

    // Calculate pagination display text
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Credit Notes">
                {hasPermission(permissions, 'credit-notes', 'create') &&
                    <Button
                        onClick={handleNewCreditNoteClick}
                        leftIcon={<CirclePlusIcon size={14} />}>
                        New Credit Note
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
            {/* Invoice Table */}
            <Table headers={tableHeaders}>
                {!isLoading && invoices && invoices.map((invoice, index) => (
                    <TableRow
                        key={invoice.id}
                        index={(page - 1) * limit + index + 1} // Correct index for pagination
                        row={invoice}
                        columns={[
                            <span className="text-indigo-600">{invoice.creditNoteNumber}</span>,
                            <ProfileCard
                                imageUrl={invoice.billTo?.image}
                                name={invoice.billTo?.name}
                                email={invoice.billTo?.email}
                            />,
                            <span className="font-semibold text-gray-950 ">{formatMoney(invoice.totalAmount, invoice.currencyCode)}</span>,
                            <span className="font-semibold text-gray-950 ">{formatDate(invoice.createdAt, systemSettings?.dateFormat.format || 'd-m-Y')}</span>,
                            <InvoiceStatusBadge status={invoice.status} />
                        ]}
                        actions={canEdit || canDelete ? tableActions : undefined}
                        onRowClick={(item) => navigate(`/admin/credit-notes/view/${item.id}`)}
                    />
                ))}
                {!isLoading && invoices && invoices.length === 0 && (
                    <NoRecords colSpan={7} message="No credit notes found" />
                )}

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-1 text-gray-950  font-semibold" colSpan={7}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}

            </Table>

            {/* Pagination Component */}
            {!isLoading && pagination.totalPages > 1 && (
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
            {/* Delete Invoice */}
            <DeleteConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={confirmDelete}
                isDeleting={isDeleting}
                title="Confirm Deletion"
                message="Are you sure you want to delete this credit note?"
            >
            </DeleteConfirmationModal>
        </div>
    );
};

export default CreditNoteList;