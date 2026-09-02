import api from '@lib/apiClient';
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import ExportButton from "@components/admin/ExportButton";
import InvoiceStatusBadge from "@components/admin/InvoiceStatusBadge";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import type { Action } from "@components/admin/tableActions";
import Constants from "@constants/api";
import type { RootState } from "@store/index";

import { CirclePlusIcon, Edit, Trash2Icon } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import ActiveFilterBanner, { type ActiveFilter } from "@components/admin/ActiveFilterBanner";
import { useCostCenters } from "@hooks/useCostCenters";
import { toast } from "sonner";
import { hasPermission } from "@utils/hasPermission";
import useDateFormatter from "@hooks/useDateFormatter";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import { useCurrencies } from "@hooks/useCurrencies";
import ProfileCard from "@components/admin/ProfileImage";
import NoRecords from "@components/admin/NoRecords";
import { useQuery } from "@tanstack/react-query";
import { fetchModuleHierarchy, fetchCustomFieldsByModule } from "@api/customFieldTypeApi";
import { PageHeader } from "@/context/PageHeaderContext";
import { Badge, Button, FormField, PageSizeSelect, Select, EmptyStateHero } from "@components/ui";
import { setTenantValue } from "@utils/tenantStorage";

import { LIST_EMPTY_STATES } from "@constants/listEmptyStates";
interface Invoice {
    id: string;
    invoiceNumber: string;
    costCenterId?: string | null;
    costCenter?: { id: string; code: string; name: string } | null;
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
    TotalAmount: number;
    totalPaid: number | null;
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
    signature?: {
        id: string;
        name: string;
    };
    customFields?: Record<string, any>;
    invoiceType?: 'INVOICE' | 'PROFORMA';
    convertedAt?: string | null;
    currencyCode?: string | null;
}

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// Helper to safely extract custom field values using the fieldSlug (e.g. "age")
const extractCustomFieldValue = (invoice: Invoice, fieldSlug: string) => {
    if (!invoice.customFields) return '-';
    if (typeof invoice.customFields === 'object') {
        const value = invoice.customFields[fieldSlug];
        return value !== undefined && value !== null && value !== '' ? value : '-';
    }
    return '-';
};

const InvoiceList: React.FC = () => {
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const { formatDate } = useDateFormatter();
    const { formatMoney } = useCurrencies();

    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [itemToDelete, setItemToDelete] = useState<Invoice | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });

    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const invoiceTypeFilterRaw = searchParams.get('invoiceType') || 'all';
    const invoiceTypeFilter: 'all' | 'INVOICE' | 'PROFORMA' =
        invoiceTypeFilterRaw === 'INVOICE' || invoiceTypeFilterRaw === 'PROFORMA'
            ? invoiceTypeFilterRaw
            : 'all';

    // Report drill-down filters (arrive via URL from the accounting reports).
    // Preserved across search/pagination so the filtered view stays put.
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';
    const statusFilter = searchParams.get('status') || '';
    const customerId = searchParams.get('customerId') || '';
    const dueStartDate = searchParams.get('dueStartDate') || '';
    const dueEndDate = searchParams.get('dueEndDate') || '';
    const costCenterId = searchParams.get('costCenterId') || '';
    const { options: costCenterOptions } = useCostCenters('sales');
    const drillParams: Record<string, string> = {
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(customerId ? { customerId } : {}),
        ...(dueStartDate ? { dueStartDate } : {}),
        ...(dueEndDate ? { dueEndDate } : {}),
        ...(costCenterId ? { costCenterId } : {}),
    };
    const activeFilters: ActiveFilter[] = [
        ...(startDate ? [{ label: 'From', value: startDate }] : []),
        ...(endDate ? [{ label: 'To', value: endDate }] : []),
        ...(statusFilter ? [{ label: 'Status', value: statusFilter }] : []),
        ...(customerId ? [{ label: 'Customer', value: 'selected' }] : []),
        ...(dueStartDate ? [{ label: 'Due from', value: dueStartDate }] : []),
        ...(dueEndDate ? [{ label: 'Due to', value: dueEndDate }] : []),
        ...(costCenterId ? [{ label: 'Profit Center', value: costCenterId === 'none' ? 'Unassigned' : 'selected' }] : []),
    ];
    const clearDrillFilters = () => setSearchParams({});

    const [isInvoiceLoading, setIsInvoiceLoading] = useState<boolean>(false);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);
    const [nextInvoiceNo, setNextInvoiceNo] = useState<string>("");

    // --- DYNAMIC CUSTOM FIELDS FETCHING ---
    const { data: moduleHierarchyResponse, isLoading: isModulesLoading } = useQuery({
        queryKey: ['moduleHierarchy'],
        queryFn: () => fetchModuleHierarchy(),
        refetchOnMount: false,
        enabled: !!token,
        staleTime: 1000 * 60 * 60
    });

    const invoicesModuleId = useMemo(() => {
        if (!moduleHierarchyResponse?.data) return null;
        for (const mod of moduleHierarchyResponse.data) {
            if (mod.moduleSlug === 'invoices') return mod.id;
            if (mod.children) {
                const child = mod.children.find((c: any) => c.moduleSlug === 'invoices');
                if (child) return child.id;
            }
        }
        return null;
    }, [moduleHierarchyResponse]);

    const { data: customFieldsResponse, isLoading: isCustomFieldsLoading } = useQuery({
        queryKey: ['customFields', invoicesModuleId],
        queryFn: () => fetchCustomFieldsByModule(invoicesModuleId!),
        refetchOnMount: false,
        enabled: !!token && !!invoicesModuleId
    });

    const tableCustomFields = useMemo(() => {
        return customFieldsResponse?.data?.fields?.filter((f: any) => f.showInTable) || [];
    }, [customFieldsResponse]);

    // Construct Dynamic Table Headers
    const baseHeaders = ["#", "Invoice ID", "Type", "Customer", "Amount", "Paid", "Status", "Profit Center", "Created On"];
    const dynamicHeaders = tableCustomFields.map((f: any) => f.labelName);
    const tableHeaders = [...baseHeaders, ...dynamicHeaders, "Actions"];

    // Unified loading state prevents UI shifting
    const isPageLoading = isInvoiceLoading || isModulesLoading || isCustomFieldsLoading;

    const handleNewInvoiceClick = () => {
        if (!nextInvoiceNo) {
            toast.warning("Something went wrong. Please refresh the page.");
            return;
        }
        setTenantValue("nextInvoiceNo", nextInvoiceNo);
        navigate("/invoices/create-invoice");
    }

    const handleSearch = (value: string) => {
        setSearchParams({
            search: value,
            limit: String(limit),
            page: String(page),
            ...(invoiceTypeFilter !== 'all' ? { invoiceType: invoiceTypeFilter } : {}),
            ...drillParams
        });
    }

    const handlePageLengthChange = (value: number) => {
        setSearchParams({
            search,
            limit: String(value),
            page: String(page),
            ...(invoiceTypeFilter !== 'all' ? { invoiceType: invoiceTypeFilter } : {}),
            ...drillParams
        });
    }

    const handleCostCenterFilterChange = (value: string) => {
        const next: Record<string, string> = {
            search: search || '',
            limit: String(limit),
            page: '1',
            ...drillParams,
            ...(invoiceTypeFilter !== 'all' ? { invoiceType: invoiceTypeFilter } : {}),
        };
        // drillParams already carries the OLD value, so drop it before re-adding.
        delete next.costCenterId;
        if (value) next.costCenterId = value;
        setSearchParams(next);
    };

    const handleInvoiceTypeFilterChange = (opt: 'all' | 'INVOICE' | 'PROFORMA') => {
        const next: Record<string, string> = {
            search: search || '',
            limit: String(limit),
            page: '1',
            ...drillParams
        };
        if (opt !== 'all') {
            next.invoiceType = opt;
        }
        setSearchParams(next);
    }

    const fetchInvoices = async () => {
        try {
            setIsInvoiceLoading(true);
            const response = await api.get(Constants.GET_INVOICES_FOR_LIST_URL, {
                params: {
                    search,
                    limit,
                    page,
                    ...(invoiceTypeFilter !== 'all' ? { invoiceType: invoiceTypeFilter } : {}),
                    ...drillParams
                },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = response.data.data;
            if (data.invoices.length > 0) {
                setInvoices(data.invoices);
            } else {
                setInvoices([]);
            }

            if (data.pagination) {
                setPagination(data.pagination);
            }
            if (data.nextInvoiceNumber) {
                setNextInvoiceNo(data.nextInvoiceNumber);
            }
        } catch (error) {
            console.error("Error fetching invoices:", error);
        } finally {
            setIsInvoiceLoading(false);
        }
    }

    useEffect(() => {
        fetchInvoices();
    }, [search, limit, page, token, invoiceTypeFilter, startDate, endDate, statusFilter, customerId, dueStartDate, dueEndDate, costCenterId]);

    const handlePageChange = (page: number) => {
        setSearchParams({
            search: search || '',
            limit: limit ? String(limit) : '10',
            page: String(page),
            ...(invoiceTypeFilter !== 'all' ? { invoiceType: invoiceTypeFilter } : {}),
            ...drillParams
        });
    }

    // Permission gating for Edit/Delete is handled per-action by TableRow via `requirePermission`.
    const getTableActions = (item: Invoice): Action<Invoice>[] => {
        const actions: Array<Action<Invoice> & { hideWhen?: string[] }> = [
            {
                label: 'Edit',
                icon: <Edit size={14} />,
                primary: true,
                requirePermission: { moduleSlug: 'invoices', action: 'edit' },
                onClick: () => handleEditClick(item),
                // Only drafts are editable; everything else is locked.
                hideWhen: ['SENT', 'UNPAID', 'PAID', 'OVERDUE', 'CANCELLED', 'PARTIALLY_PAID']
            },
            {
                label: 'Delete',
                icon: <Trash2Icon size={14} />,
                primary: true,
                variant: 'danger',
                requirePermission: { moduleSlug: 'invoices', action: 'delete' },
                onClick: () => handleDeleteClick(item),
                hideWhen: ['PAID', 'PARTIALLY_PAID']
            },
            // Payment / Convert / Send Email / Mark Sent / View removed from the list —
            // View is the row click, and the rest are available from the invoice view toolbar.
        ];

        return actions.filter((action) => {
            if (action.hideWhen?.includes(item.status)) {
                return false;
            }
            return true;
        });
    };

    const handleEditClick = (item: Invoice) => {
        navigate(`/invoices/edit-invoice/${item.id}`);
    }
    const handleDeleteClick = (item: Invoice) => {
        setItemToDelete(item);
        setShowDeleteModal(true);
    }

    const confirmDelete = async () => {
        try {
            setIsDeleting(true);
            await api.delete(`${Constants.DELETE_INVOICE_URL}/${itemToDelete?.id}`);
            toast.success('Invoice deleted successfully');
            setShowDeleteModal(false);
            await fetchInvoices();
        } catch (error) {
            console.error('Failed to delete invoice:', error);
        } finally {
            setIsDeleting(false);
        }
    }

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    /**
     * Nothing here, and nothing asked for — so this workspace has never raised
     * an invoice, rather than having filtered its way to an empty screen.
     *
     * The list controller returns a filtered count only, so there is no total
     * to test against. There does not need to be: with no search, no drill-down
     * and both selectors neutral, the filtered count IS the unfiltered one.
     */
    const isFirstRun =
        !isPageLoading &&
        invoices.length === 0 &&
        !search &&
        activeFilters.length === 0 &&
        invoiceTypeFilter === 'all' &&
        !costCenterId;

    return (
        <div className="space-y-4">
            <PageHeader title="Invoices">
                {hasPermission(permissions, 'invoices', 'view') && (
                    <>
                        <ExportButton
                            url={Constants.EXPORT_INVOICES_URL}
                            filename="invoices.csv"
                        />
                        <ExportButton
                            url={Constants.EXPORT_INVOICE_ITEMS_URL}
                            filename="invoice-items.csv"
                            label="Line items"
                        />
                    </>
                )}
                {hasPermission(permissions, 'invoices', 'create') && (
                    <Button
                        onClick={handleNewInvoiceClick}
                        leftIcon={<CirclePlusIcon size={14} />}>
                        New Invoice
                    </Button>
                )}
            </PageHeader>

{isFirstRun ? (
                <EmptyStateHero
                    {...LIST_EMPTY_STATES.invoices}
                    action={hasPermission(permissions, 'invoices', 'create') && (
                        <Button size="lg" leftIcon={<CirclePlusIcon size={16} />} onClick={handleNewInvoiceClick}>
                            {LIST_EMPTY_STATES.invoices.cta}
                        </Button>
                    )}
                />
            ) : (
                <>
                    <ActiveFilterBanner filters={activeFilters} onClear={clearDrillFilters} />

                    {/* Invoice Type Filter Pills */}
                    <div className="flex items-center gap-2 mb-3">
                        {(['all', 'INVOICE', 'PROFORMA'] as const).map((opt) => (
                            <Button
                                key={opt}
                                type="button"
                                variant={invoiceTypeFilter === opt ? 'soft' : 'white'}
                                size="sm"
                                onClick={() => handleInvoiceTypeFilterChange(opt)}
                            >
                                {opt === 'all' ? 'All' : opt === 'INVOICE' ? 'Invoices' : 'Proformas'}
                            </Button>
                        ))}
                    </div>

                    {/* Search Input, Profit Center filter & PageLength */}
                    <div className="flex justify-between items-center mb-4 gap-3">
                        <FormField
                            type="text"
                            placeholder="Search..."
                            value={search}
                            onChange={(e) => handleSearch(e.target.value)}
                            containerClassName="w-full md:w-64"
                        />
                        <div className="flex items-center gap-3">
                            <Select
                                value={costCenterId}
                                onChange={(e) => handleCostCenterFilterChange(e.target.value)}
                                aria-label="Filter by profit center"
                            >
                                <option value="">All profit centers</option>
                                {/* Matches the report's Common / Unallocated column, so the
                                    list and the departmental P&L agree on what "untagged" means. */}
                                <option value="none">Unassigned</option>
                                {costCenterOptions.map((c) => (
                                    <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                                ))}
                            </Select>
                            <PageSizeSelect value={limit} onChange={handlePageLengthChange} />
                        </div>
                    </div>

                    {/* Invoice Table */}
                    <Table headers={tableHeaders}>
                        {!isPageLoading && invoices && invoices.map((invoice, index) => (
                            <TableRow
                                key={invoice.id}
                                index={(page - 1) * limit + index + 1}
                                row={invoice}
                                columns={[
                                    <a href={`/view-invoice/${invoice.id}`} onClick={(e) => e.stopPropagation()} // inline-block + py-1 lifts the hit area to ~26px; as a bare inline link it
                                    // measured 18px tall, under the 24x24 minimum in WCAG 2.2 SC 2.5.8.
                                    className="inline-block py-1 text-primary font-medium cursor-pointer hover:underline">{invoice.invoiceNumber}</a>,
                                    <Badge color={invoice.invoiceType === 'PROFORMA' ? 'info' : 'success'}>
                                        {invoice.invoiceType === 'PROFORMA' ? 'Proforma' : 'Invoice'}
                                    </Badge>,
                                    <ProfileCard
                                        imageUrl={invoice.billTo?.image}
                                        name={invoice.billTo?.name}
                                        email={invoice.billTo?.email}
                                    />,
                                    <span className="font-semibold text-gray-600 ">{formatMoney(invoice.TotalAmount, invoice.currencyCode)}</span>,
                                    <span className="font-semibold text-gray-600 ">{formatMoney(invoice.totalPaid as number ?? 0, invoice.currencyCode)}</span>,
                                    <InvoiceStatusBadge status={invoice.status} dueDate={invoice.dueDate} totalAmount={invoice.TotalAmount} totalPaid={invoice.totalPaid} />,
                                    invoice.costCenter
                                        ? <span className="text-gray-600 font-medium" title={invoice.costCenter.name}>{invoice.costCenter.code}</span>
                                        : <span className="text-gray-400">—</span>,
                                    <span className="font-medium text-gray-600 ">{formatDate(invoice.createdAt as string, systemSettings?.dateFormat.format || 'd-m-Y')}</span>,

                                    // Map over configured custom fields using fieldSlug
                                    ...tableCustomFields.map((f: any) => (
                                        <span key={f.id} className="text-gray-600 font-medium">
                                            {extractCustomFieldValue(invoice, f.fieldSlug)}
                                        </span>
                                    ))
                                ]}
                                actions={getTableActions(invoice)}
                                onRowClick={(item) => navigate(`/view-invoice/${item.id}`)}
                            />
                        ))}

                        {!isPageLoading && invoices.length === 0 && (
                            <NoRecords art="invoice" message="No records found" colSpan={tableHeaders.length} />
                        )}

                        {isPageLoading && (
                            <tr key="table-loader">
                                <td className="text-center py-4 text-gray-950 font-semibold" colSpan={tableHeaders.length}>
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
                </>
            )}

            {/* Delete Invoice */}
            <DeleteConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={confirmDelete}
                isDeleting={isDeleting}
                title="Confirm Deletion"
                message="Are you sure you want to delete this invoice? This action cannot be undone."
            />
        </div>
    );
};

export default InvoiceList;