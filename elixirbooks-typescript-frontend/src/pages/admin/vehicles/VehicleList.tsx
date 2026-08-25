import { CirclePlusIcon, Edit, Trash2Icon } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
import { hasPermission } from "@utils/hasPermission";
import type { Action } from "@components/admin/tableActions";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import NoRecords from "@components/admin/NoRecords";
import type { Vehicle } from "@models/vehicle";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button, Badge } from "@components/ui";

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

type StatusFilter = 'all' | 'true' | 'false';

const VehicleList: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [pagination, setPagination] = useState<PaginationData>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [isDeleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
    const [deleteItem, setDeleteItem] = useState<Vehicle | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const [isLoading, setIsLoading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleCreateClick = () => {
        navigate('/admin/vehicles/new');
    };

    const handleEditClick = (item: Vehicle) => {
        navigate(`/admin/vehicles/edit/${item.id}`);
    };

    const handleDeleteClick = (item: Vehicle) => {
        setDeleteItem(item);
        setDeleteModalOpen(true);
    };

    // Permission gating for Edit/Delete is handled per-action by TableRow via `requirePermission`.
    const tableActions: Action<Vehicle>[] = [
        {
            label: 'Edit',
            icon: <Edit size={14} />,
            primary: true,
            requirePermission: { moduleSlug: 'vehicles', action: 'edit' },
            onClick: (item: Vehicle) => { handleEditClick(item); },
        },
        {
            label: 'Delete',
            icon: <Trash2Icon size={14} />,
            primary: true,
            variant: 'danger',
            requirePermission: { moduleSlug: 'vehicles', action: 'delete' },
            onClick: (item: Vehicle) => { handleDeleteClick(item); },
        },
    ];

    const canEdit = hasPermission(permissions, 'vehicles', 'edit');
    const canDelete = hasPermission(permissions, 'vehicles', 'delete');
    const tableHeaders = ['#', 'Name', 'Customer', 'Reg Number', 'VIN', 'Year', 'Status', 'Actions'];
    if (!canEdit && !canDelete) {
        tableHeaders.pop();
    }

    const fetchVehicles = async (
        searchValue?: string,
        limitValue?: number,
        pageValue?: number,
        statusValue?: StatusFilter,
    ) => {
        try {
            setIsLoading(true);
            const params: Record<string, string | number> = {
                search: searchValue ?? '',
                limit: limitValue ?? 10,
                page: pageValue ?? 1,
            };
            if (statusValue && statusValue !== 'all') {
                params.status = statusValue;
            }
            const response = await axios.get(Constants.GET_VEHICLES_FOR_LIST_URL, {
                params,
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setVehicles(response.data.data?.vehicles || []);
            setPagination(response.data.data?.pagination || { total: 0, page: 1, limit: 10, totalPages: 1 });
        } catch (error) {
            console.error("Error fetching vehicles:", error);
            toast.error("Failed to fetch vehicles.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchVehicles(search, limit, page, statusFilter);
    }, [search, limit, page, statusFilter]);

    const handleSearch = (keyword: string) => {
        setSearchParams({ search: keyword, limit: String(limit), page: '1' });
    };

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ search, limit: String(newLimit), page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ search, limit: String(limit), page: String(newPage) });
    };

    const handleStatusFilterChange = (opt: StatusFilter) => {
        setStatusFilter(opt);
        setSearchParams({ search, limit: String(limit), page: '1' });
    };

    const handleConfirmDelete = async () => {
        if (!deleteItem) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_VEHICLE_URL}/${deleteItem.id}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            toast.success("Vehicle deleted successfully.");
            fetchVehicles(search, limit, page, statusFilter);
            setDeleteModalOpen(false);
            setDeleteItem(null);
        } catch (error) {
            console.error("Error deleting vehicle:", error);
            toast.error("Failed to delete vehicle.");
        } finally {
            setIsDeleting(false);
        }
    };

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    const renderName = (row: Vehicle): string => {
        if (row.name && row.name.trim()) return row.name;
        const composed = [row.make, row.model].filter(Boolean).join(' ').trim();
        if (composed) return composed;
        if (row.registrationNumber && row.registrationNumber.trim()) return row.registrationNumber;
        return '—';
    };

    return (
        <div className="space-y-4">
            <PageHeader title="Vehicles">
                {hasPermission(permissions, 'vehicles', 'create') &&
                    <Button onClick={() => { handleCreateClick(); }} leftIcon={<CirclePlusIcon size={14} />}>
                        Add Vehicle
                    </Button>
                }
            </PageHeader>

            {/* Search Input & PageLength */}
            <div className="flex justify-between items-center">
                <input
                    type="text"
                    placeholder="Search by name, registration, VIN, make, model..."
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="border border-gray-300 rounded-md px-4 py-2 w-full md:w-80 text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                />
                <select
                    value={limit}
                    onChange={(e) => handlePageLengthChange(Number(e.target.value))}
                    className="border border-gray-300 px-3 py-2 rounded-md bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                >
                    {[10, 25, 50].map((num) => (
                        <option className="text-gray-800 " key={num} value={num}>{num} / page</option>
                    ))}
                </select>
            </div>

            {/* Status filter pill */}
            <div className="flex items-center gap-2">
                {(['all', 'true', 'false'] as const).map((opt) => (
                    <button
                        key={opt}
                        type="button"
                        onClick={() => handleStatusFilterChange(opt)}
                        className={
                            'px-3 py-1 text-sm rounded-full border cursor-pointer ' +
                            (statusFilter === opt
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50')
                        }
                    >
                        {opt === 'all' ? 'All' : opt === 'true' ? 'Active' : 'Inactive'}
                    </button>
                ))}
            </div>

            {/* Table */}
            <Table headers={tableHeaders}>
                {!isLoading && vehicles && vehicles.map((vehicle, index) => (
                    <TableRow
                        key={vehicle.id}
                        index={index + 1}
                        row={vehicle}
                        columns={[
                            renderName(vehicle),
                            vehicle.customerId
                                ? (
                                    <Link
                                        to={`/admin/customers/edit/${vehicle.customerId}`}
                                        className="text-purple-600 hover:underline"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {vehicle.customerName ?? '—'}
                                    </Link>
                                )
                                : (vehicle.customerName ?? '—'),
                            vehicle.registrationNumber ?? '—',
                            vehicle.vin ?? '—',
                            vehicle.year ?? '—',
                            <Badge color={vehicle.status === true ? 'success' : 'gray'}>
                                {vehicle.status === true ? 'Active' : 'Inactive'}
                            </Badge>,
                        ]}
                        actions={canEdit || canDelete ? tableActions : undefined}
                        onRowClick={(item) => navigate(`/admin/vehicles/edit/${item.id}`)}
                    />
                ))}
                {!isLoading && !vehicles.length &&
                    <NoRecords colSpan={8} message="No vehicles found" />
                }
                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-1 text-gray-950 font-semibold" colSpan={8}>
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

            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={handleConfirmDelete}
                isDeleting={isDeleting}
                title="Delete Vehicle"
                message="Are you sure you want to delete this vehicle? This action cannot be undone."
            />
        </div>
    );
};

export default VehicleList;
