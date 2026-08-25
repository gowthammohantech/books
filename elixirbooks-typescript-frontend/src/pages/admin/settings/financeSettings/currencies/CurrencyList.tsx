import { CirclePlusIcon, Edit, Trash2Icon } from "lucide-react";
import type React from "react";
import { useSearchParams } from "react-router-dom";
import Table from "../../../../../components/admin/Table";
import CurrencyFormModal from "./CurrencyFormModal";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "../../../../../store";
import axios from "axios";
import Constants from "../../../../../constants/api";
import { toast } from "sonner";
import TableRow from "../../../../../components/admin/TableRow";
import Switch from "../../../../../components/admin/Switch";
import PaginationWrapper from "../../../../../components/admin/PaginationWrapper";
import { fetchSystemSettings } from "@store/systemSettingsSlice";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import type { PermissionAction } from "@models/permissions";
import { hasPermission } from "@utils/hasPermission";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import { Button, FormField, Select } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";

interface Currency {
    id: string;
    name: string;
    code: string;
    symbol: string;
    status: boolean;
    isDefault: boolean;
}

const CurrencyList: React.FC = () => {
    // Handle search and page length
    const [searchParams, setSearchParams] = useSearchParams();
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);

    const [currencyModalOpen, setCurrencyModalOpen] = useState(false);
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [editData, setEditData] = useState<Currency | null>(null);
    const [deleteData, setDeleteData] = useState<Currency | null>(null);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const dispatch: AppDispatch = useDispatch();
    const [isLoading, setIsLoading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const handleCurrencySuccess = () => {
        setCurrencyModalOpen(false);
        fetchCurrencies();
    }

    useEffect(() => {
        fetchCurrencies();
    }, [search, limit, page, token]);

    const fetchCurrencies = async () => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.GET_CURRENCIES_URL, {
                params: { search, limit, page },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setCurrencies(response.data.data.currencies);
            if (response.data.data.pagination) setPagination(response.data.data.pagination);
        } catch (error) {
            console.error("Error fetching currencies:", error);
            toast.error("Failed to fetch currencies.");
        } finally {
            setIsLoading(false);
        }
    }

    const handleCurrencyStatusChange = async (id: string) => {
        const currentCurrency = currencies.find(currency => currency.id === id);
        if (!currentCurrency) return;
        const newStatus = !currentCurrency.status;
        setCurrencies(prev =>
            prev.map(currency =>
                currency.id === id ? { ...currency, status: newStatus } : currency
            )
        );

        try {
            await axios.patch(`${Constants.UPDATE_CURRENCY_STATUS_URL}/${id}`,
                { status: newStatus },
                {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            if (token) dispatch(fetchSystemSettings(token));
            toast.success('Status updated successfully');
            await fetchCurrencies();
        } catch (error) {
            toast.error('Failed to update status.');
        }
    }

    const handleCurrencyDefaultStatusChange = async (id: string) => {
        const currentCurrency = currencies.find(currency => currency.id === id);
        if (!currentCurrency) return;
        const newStatus = !currentCurrency.isDefault;
        setCurrencies(prev =>
            prev.map(currency =>
                currency.id === id ? { ...currency, isDefault: newStatus } : currency
            )
        );

        try {
            await axios.patch(`${Constants.UPDATE_CURRENCY_STATUS_URL}/${id}`,
                { isDefault: newStatus, status: newStatus },
                {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            if (token) dispatch(fetchSystemSettings(token));
            toast.success('Default Status updated successfully');
            await fetchCurrencies();
        } catch (error) {
            toast.error('Failed to update status.');
        }
    }

    const handleSearch = (keyword: string) => {
        setSearchParams({ search: keyword, limit: String(limit), page: '1' });
    }

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ search, limit: String(newLimit), page: '1' });
    }

    const handlePageChange = (newPage: number) => {
        setSearchParams({ search, limit: String(limit), page: String(newPage) });
    }
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    const tableActions = [
        { label: 'Edit', icon: <Edit size={14} />, onClick: (item: Currency) => handleEditClick(item) },
        { label: 'Delete', icon: <Trash2Icon size={14} />, onClick: (item: Currency) => handleDeleteClick(item) }
    ];

    const tableHeaders = ["#", "Currency Name", "Symbol", "Code", "Status", "Default", "Actions"];
    const restrictedActions = ['edit', 'delete'];
    const prepareTableActions = (item: Currency) => {
        const actions = tableActions.filter((action) => {
            const actionKey = action.label.toLowerCase() as PermissionAction;
            if (!restrictedActions.includes(actionKey)) {
                return true;
            }
            // if this item isDefault, hide the delete action
            if (item.isDefault && actionKey === 'delete') return false;
            return hasPermission(permissions, 'finance-settings', actionKey);
        });
        return actions;
    }
    const allowedActions = tableActions.filter((action) => {
        const actionLabel = action.label.toLowerCase() as PermissionAction;
        if (!restrictedActions.includes(actionLabel)) {
            return true;
        }
        return hasPermission(permissions, 'finance-settings', actionLabel);
    });

    if (allowedActions.length === 0) tableHeaders.pop();
    const handleEditClick = (item: Currency) => {
        setEditData(item);
        setCurrencyModalOpen(true);
    }

    const handleDeleteClick = (item: Currency) => {
        setDeleteData(item);
        setDeleteModalOpen(true);
    }

    const handleCurrencyDelete = async () => {
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_CURRENCY_URL}/${deleteData?.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            toast.success('Currency deleted successfully.');
            setDeleteModalOpen(false);
            await fetchCurrencies();
        } catch (error) {
            toast.error('Failed to delete currency.');
        } finally {
            setIsDeleting(false);
        }
    }
    return (
        <div className="space-y-4">
            <PageHeader title="Currencies">
                {hasPermission(permissions, 'finance-settings', 'create') && (
                    <Button
                        variant="primary"
                        onClick={() => { setCurrencyModalOpen(true); setEditData(null) }}
                        leftIcon={<CirclePlusIcon size={14} />}>
                        New Currency
                    </Button>
                )}
            </PageHeader>
            {/* Search and Page Length */}
            <div className="flex justify-between items-center">
                <FormField
                    type="text"
                    placeholder="Search currencies"
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                    containerClassName="w-full md:w-64"
                />
                <Select
                    value={limit}
                    onChange={(e) => handlePageLengthChange(Number(e.target.value))}
                    containerClassName="w-auto"
                    options={[10, 25, 50].map((num) => ({ value: num, label: `${num} / page` }))}
                />
            </div>

            {/* Currency Table */}
            <Table headers={tableHeaders}>
                {!isLoading && currencies && currencies.map((currency: Currency, index: number) => (
                    <TableRow
                        key={currency.id}
                        index={index + 1}
                        row={currency}
                        columns={[
                            <span className="text-indigo-600 capitalize">{currency.name}</span>,
                            currency.symbol,
                            currency.code,
                            <Switch name={`status-${currency.id}`} checked={currency.status} onChange={() => handleCurrencyStatusChange(currency.id)} disabled={currency.isDefault || !hasPermission(permissions, 'finance-settings', 'edit')} />,
                            <Switch name={`default-${currency.id}`} checked={currency.isDefault} onChange={() => handleCurrencyDefaultStatusChange(currency.id)} disabled={currency.isDefault || !hasPermission(permissions, 'finance-settings', 'edit')} />,
                        ]}
                        actions={prepareTableActions(currency)}
                    />
                ))}
                {!isLoading && !currencies.length &&
                    <tr>
                        <td colSpan={6} className="text-center text-body py-2  font-semibold">No currencies found</td>
                    </tr>
                }

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-heading  font-semibold" colSpan={7}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}
            </Table>

            {/* Pagination */}
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
            {/* Currency Form Modal */}
            <CurrencyFormModal
                isOpen={currencyModalOpen}
                onClose={() => { setCurrencyModalOpen(false) }}
                onSuccess={() => { handleCurrencySuccess(); }}
                editData={editData}
            />

            {/* Delete Modal */}
            <DeleteConfirmationModal
                isOpen={deleteModalOpen}
                onClose={() => { setDeleteModalOpen(false) }}
                onConfirm={() => { handleCurrencyDelete(); }}
                isDeleting={isDeleting}
                title="Delete Currency"
                message={`Are you sure you want to delete ${deleteData?.name}?`}
            />
        </div>
    );
}

export default CurrencyList;