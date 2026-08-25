import { useEffect, useState, type FC } from 'react';
import { CirclePlusIcon, Trash2Icon } from 'lucide-react';
import Table from '@components/admin/Table';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import TableRow from '@components/admin/TableRow';
import type { Action } from '@components/admin/tableActions';
import { toast } from "sonner";
import PaginationWrapper from '@components/admin/PaginationWrapper';
import PaymentFormModal from '@pages/admin/purchases/PaymentFormModal';
import PaymentModeBadge from '@components/admin/PaymentModeBadge';
import DeleteConfirmationModal from '@components/admin/DeleteConfirmationModal';
import { useCurrencyFormatter } from '@hooks/useCurrencyFormatter';
import { useCurrencies } from '@hooks/useCurrencies';
import { hasPermission } from '@utils/hasPermission';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import useDateFormatter from '@hooks/useDateFormatter';
import ProfileCard from '@components/admin/ProfileImage';
import type { Pagination } from '@models/common';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button, FormField, Select } from '@components/ui';

// --- INTERFACES ---

interface SupplierPayment {
    id: string;
    paymentId: string;
    referenceNumber: string;
    paymentDate: any;
    amount: number;
    paidAmount: number;
    dueAmount: number;
    currencyCode?: string | null;
    notes: string;
    supplier: {
        id: string;
        name: string;
        email: string;
        phone: string;
        profileImage: string;
    };
    purchase: {
        id: string;
        purchaseId: string;
        totalAmount: number;
        purchaseDate: string;
    };
    paymentMode: string;
    attachment: string | null;
}

const SupplierPayments: FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const { locale } = useCurrencyFormatter();
    const { resolveCurrency } = useCurrencies();
    const { formatDate } = useDateFormatter();
    // Show each payment's amount in ITS OWN (the purchase's) currency.
    const formatPaymentAmount = (amount: number, code?: string | null) =>
        `${resolveCurrency(code).symbol}${Number(amount).toLocaleString(locale, { maximumFractionDigits: 2 })}`;
    // State for data and lists
    const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });

    // State for modals and editing
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState<boolean>(false);
    const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
    const [itemToDelete, setItemToDelete] = useState<SupplierPayment | null>(null);

    // Search and pagination params from URL
    const [searchParams, setSearchParams] = useSearchParams();
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);

    useEffect(() => {
        fetchSupplierPayments(search, limit, page);
    }, [search, limit, page, token]);

    const fetchSupplierPayments = async (search?: string, limit?: number, page?: number) => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.GET_SUPPLIER_PAYMENTS_URL, {
                params: { search, limit, page },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setSupplierPayments(response.data.data.payments ?? []);
            setPagination(response.data.data.pagination ?? { total: 0, page: 1, limit: 10, totalPages: 1 });
        } catch (error) {
            console.error('Error fetching supplier payments:', error);
            toast.error('Failed to fetch supplier payments.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleNewPaymentClick = () => {
        setIsPaymentModalOpen(true);
    };

    const handleDeleteClick = (item: SupplierPayment) => {
        setItemToDelete(item);
        setShowDeleteModal(true);
    };

    const handlePaymentConfirm = () => {
        setIsPaymentModalOpen(false);
        fetchSupplierPayments(search, limit, page);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_SUPPLIER_PAYMENT_URL}/${itemToDelete.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Payment deleted successfully');
            await fetchSupplierPayments(search, limit, page);
            setShowDeleteModal(false);
            setItemToDelete(null);
        } catch (error) {
            console.error('Failed to delete payment:', error);
            toast.error('Failed to delete payment.');
        } finally {
            setIsDeleting(false);
        }
    };

    // Delete renders as an inline primary button; permission gating handled per-action by TableRow via `requirePermission`.
    const tableActions: Action<SupplierPayment>[] = [
        {
            label: 'Delete',
            icon: <Trash2Icon size={14} />,
            primary: true,
            variant: 'danger',
            requirePermission: { moduleSlug: 'supplier-payments', action: 'delete' },
            onClick: handleDeleteClick
        }
    ];

    const canDelete = hasPermission(permissions, 'supplier-payments', 'delete');

    const tableHeaders = ["#", "Supplier", "Payment ID", "Purchase ID", "Payment Date", "Amount", "Payment Mode", "Action"];
    if (!canDelete) {
        tableHeaders.pop();
    }
    const handleSearch = (keyword: string) => setSearchParams({ search: keyword, limit: String(limit), page: '1' });
    const handlePageLengthChange = (newLimit: number) => setSearchParams({ search, limit: String(newLimit), page: '1' });
    const handlePageChange = (newPage: number) => setSearchParams({ search, limit: String(limit), page: String(newPage) });

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Supplier Payments">
                {hasPermission(permissions, 'supplier-payments', 'create') && (
                    <Button
                        onClick={handleNewPaymentClick}
                        leftIcon={<CirclePlusIcon size={14} />}>
                        New Payment
                    </Button>
                )}
            </PageHeader>

            {/* Search and Filter Section */}
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

            {/* Payments Table */}
            <Table headers={tableHeaders}>
                {!isLoading && supplierPayments.map((payment, index) => (
                    <TableRow
                        key={payment.id}
                        index={from + index}
                        row={payment}
                        columns={[
                            <ProfileCard
                                imageUrl={payment?.supplier?.profileImage}
                                name={payment?.supplier?.name ?? ""}
                            />,
                            <span className='text-indigo-600'>{payment.paymentId}</span>,
                            payment.purchase?.purchaseId ?? '-',
                            formatDate(payment.paymentDate, systemSettings?.dateFormat.format || 'd-m-Y'),
                            formatPaymentAmount(payment.paidAmount, payment.currencyCode),
                            <PaymentModeBadge mode={payment.paymentMode ?? 'Petty Cash'} />,
                        ]}
                        actions={canDelete ? tableActions : undefined}
                    />
                ))}
                {!isLoading && supplierPayments.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-4 text-heading font-semibold">No supplier payments found</td></tr>
                )}

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-heading font-semibold" colSpan={7}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}
            </Table>

            <PaginationWrapper count={pagination.totalPages} page={page} from={from} to={to} total={pagination.total} onChange={(_, newPage) => handlePageChange(newPage)} />

            {/* Modals */}
            {isPaymentModalOpen && (
                <PaymentFormModal
                    isOpen={isPaymentModalOpen}
                    onClose={() => setIsPaymentModalOpen(false)}
                    onConfirm={handlePaymentConfirm}
                />
            )}

            <DeleteConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={confirmDelete}
                isDeleting={isDeleting}
                title="Confirm Deletion"
                message="Are you sure you want to delete the payment?"
            >

            </DeleteConfirmationModal>
        </div>
    );
};

export default SupplierPayments;