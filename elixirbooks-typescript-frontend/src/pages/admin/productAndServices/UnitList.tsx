import { useEffect, useState, type FC, type ChangeEvent, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { useSelector } from "react-redux";
import type { RootState } from "../../../store";
import Constants from "@constants/api";
import Table from "@components/admin/Table";
import Modal from "@components/admin/Modal";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import TableRow from "@components/admin/TableRow";
import { CirclePlusIcon, Edit, Trash2Icon } from "lucide-react";
import type { PermissionAction } from "@models/permissions";
import { hasPermission } from "@utils/hasPermission";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import Switch from "@components/admin/Switch";
import SubmitButton from "@components/admin/SubmitButton";
import DynamicCustomFields from "@components/admin/DynamicCustomFields";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button } from "@components/ui";

// Define the shape of your data
interface Unit {
    id: string;
    unit_name: string;
    short_name: string;
    status: boolean;
}

// Define the shape for pagination data from the API
interface UnitPagination {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

type NewUnit = Omit<Unit, 'id'>;

// Define the shape for form validation errors
interface FormErrors {
    unit_name?: string;
    short_name?: string;
}

const UnitList: FC = () => {
    const [units, setUnits] = useState<Unit[]>([]);
    const [pagination, setPagination] = useState<UnitPagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [searchParams, setSearchParams] = useSearchParams();

    const [showModal, setShowModal] = useState<boolean>(false);
    const [editingUnit, setEditingUnit] = useState<string | null>(null);
    const [newUnit, setNewUnit] = useState<NewUnit>({
        unit_name: '',
        short_name: '',
        status: true,
    });
    const [formErrors, setFormErrors] = useState<FormErrors>({});

    const [isDeleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
    const [itemToDelete, setItemToDelete] = useState<Unit | null>(null);
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    // Get search, limit, and page from URL params
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);
    const [customFields, setCustomFields] = useState<Record<string, any>>({});
    const [activeCustomFields, setActiveCustomFields] = useState<any[]>([]);

    const handleCustomFieldChange = (fieldSlugOrId: string, value: any) => {
        setCustomFields(prev => ({ ...prev, [fieldSlugOrId]: value }));
    };

    const fetchUnits = async (search?: string, limit?: number, page?: number): Promise<void> => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.FETCH_UNITS_URL, {
                params: { search, limit, page },
                headers: { Authorization: `Bearer ${token}` },
            });
            setUnits(response.data.data.units || []);
            setPagination(response.data.data.pagination);
        } catch (error) {
            console.error('Error fetching units:', error);
            toast.error("Failed to fetch units.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchUnits(search, limit, page);
    }, [search, limit, page]);

    const handleSearch = (keyword: string) => {
        setSearchParams({ search: keyword, limit: String(limit), page: '1' });
    };

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ search, limit: String(newLimit), page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ search, limit: String(limit), page: String(newPage) });
    };

    const toggleStatus = async (unit: Unit): Promise<void> => {
        const updatedUnit = { ...unit, status: !unit.status };
        try {
            await axios.put(`${Constants.UPDATE_UNIT_URL}/${unit.id}`, updatedUnit, {
                headers: { Authorization: `Bearer ${token}` },
            });
            toast.success('Status updated successfully');
            fetchUnits(search, limit, page); // Refetch current page
        } catch (error) {
            console.error('Failed to update status:', error);
            toast.error('Failed to update status.');
        }
    };

    const handleNewUnitChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const { name, value, type, checked } = e.target;
        setNewUnit((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleNewUnitSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
        e.preventDefault();
        setFormErrors({});

        const formData = new FormData();
        formData.append('unit_name', newUnit.unit_name);
        formData.append('short_name', newUnit.short_name);
        formData.append('status', String(newUnit.status));

        Object.entries(customFields)
            .filter(([, val]) => {
                if (val === undefined || val === null) return false;
                if (typeof val === 'string' && val.trim() === '') return false;
                if (Array.isArray(val) && val.length === 0) return false;
                return true;
            })
            .forEach(([fieldSlugOrId, val], index) => {
                const matchedField = activeCustomFields.find(f => f.fieldSlug === fieldSlugOrId || f.id === fieldSlugOrId);
                const finalFieldId = matchedField ? matchedField.id : fieldSlugOrId;
                formData.append(`customFields[${index}][fieldId]`, finalFieldId);
                if (Array.isArray(val)) {
                    formData.append(`customFields[${index}][value]`, val.join(','));
                } else if (val instanceof Date) {
                    const year = val.getFullYear();
                    const month = String(val.getMonth() + 1).padStart(2, '0');
                    const day = String(val.getDate()).padStart(2, '0');
                    formData.append(`customFields[${index}][value]`, `${year}-${month}-${day}`);
                } else if (val instanceof File) {
                    formData.append(`customField_${finalFieldId}`, val);
                } else {
                    formData.append(`customFields[${index}][value]`, String(val));
                }
            });

        try {
            setIsSubmitting(true);
            const headers = { Authorization: `Bearer ${token}` };

            if (editingUnit) {
                await axios.put(`${Constants.UPDATE_UNIT_URL}/${editingUnit}`, formData, { headers });
                toast.success('Unit updated successfully');
            } else {
                await axios.post(Constants.CREATE_UNIT_URL, formData, { headers });
                toast.success('Unit added successfully');
            }

            fetchUnits(search, limit, page); // Refetch current page
            setShowModal(false);
            setNewUnit({ unit_name: '', short_name: '', status: true });
            setCustomFields({});
            setEditingUnit(null);
        } catch (err: any) {
            if (err.response?.status === 422 && err.response.data?.errors) {
                setFormErrors(err.response.data.errors);
            } else {
                console.error('Error:', err);
                const message = editingUnit ? 'Failed to update unit.' : 'Failed to add unit.';
                toast.error(message);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleEditClick = async (unit: Unit): Promise<void> => {
        try {
            const response = await axios.get<any>(`${Constants.GET_UNIT_URL}/${unit.id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setEditingUnit(unit.id);
            setNewUnit({
                unit_name: response.data.unit_name,
                short_name: response.data.short_name,
                status: response.data.status,
            });
            setCustomFields(response.data.customFields || {});
            setFormErrors({});
            setShowModal(true);
        } catch (error) {
            console.error('Failed to load unit:', error);
            toast.error('Failed to load unit data.');
        }
    };

    const handleDeleteClick = (item: Unit): void => {
        setItemToDelete(item);
        setDeleteModalOpen(true);
    };

    const openCreateUnit = (): void => {
        setEditingUnit(null);
        setShowModal(true);
        setNewUnit({ unit_name: '', short_name: '', status: true });
        setCustomFields({});
        setFormErrors({});
    };

    const confirmDelete = async (): Promise<void> => {
        if (!itemToDelete) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_UNIT_URL}/${itemToDelete.id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            toast.success('Unit deleted successfully');
            fetchUnits(search, limit, page); // Refetch current page
            setDeleteModalOpen(false);
            setItemToDelete(null);
        } catch (error) {
            console.error('Failed to delete unit:', error);
            toast.error('Failed to delete unit.');
        } finally {
            setIsDeleting(false);
        }
    };

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    const tableActions = [
        {
            label: 'Edit',
            icon: <Edit size={14} />,
            primary: true,
            onClick: (item: Unit) => { handleEditClick(item) }
        },
        {
            label: 'Delete',
            icon: <Trash2Icon size={14} />,
            primary: true,
            variant: 'danger' as const,
            onClick: (item: Unit) => { handleDeleteClick(item) }
        }
    ];
    const tableHeaders = ['#', 'Unit Name', 'Short Name', 'Status', 'Action'];
    const restrictedActions = ['edit', 'delete'];
    const allowedActions = tableActions.filter((action) => {
        const actionLabel = action.label.toLowerCase() as PermissionAction;

        if (!restrictedActions.includes(actionLabel)) {
            return true;
        }

        return hasPermission(permissions, 'product-services', actionLabel);
    });

    if (allowedActions.length === 0) {
        tableHeaders.pop();
    }

    return (
        <div className="space-y-4">
            <PageHeader title="Units">
                {hasPermission(permissions, 'product-services', 'create') && (
                    <Button
                        onClick={openCreateUnit}
                        leftIcon={<CirclePlusIcon size={14} />}
                        className="shadow"
                    >
                        New Unit
                    </Button>
                )}
            </PageHeader>

            <div className="flex flex-col md:flex-row justify-between gap-4">
                <input
                    type="text"
                    placeholder="Search by name or short name.."
                    value={search}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleSearch(e.target.value)}
                    className="border border-gray-300 px-4 py-2 rounded-md w-full md:w-64 bg-white  text-gray-950  focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                />
                <select
                    value={limit}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => handlePageLengthChange(Number(e.target.value))}
                    className="border border-gray-300 px-3 py-2 rounded-md bg-white  text-gray-950  focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                >
                    {[10, 25, 50].map((num) => (
                        <option className="text-gray-950 " key={num} value={num}>{num} / page</option>
                    ))}
                </select>
            </div>

            <Table headers={tableHeaders}>
                {!isLoading && units.length > 0 && (
                    units.map((unit, index) => (
                        <TableRow
                            key={unit.id}
                            index={(page - 1) * limit + index + 1}
                            row={unit}
                            columns={[
                                <p className="capitalize text-indigo-600">{unit.unit_name}</p>,
                                unit.short_name,
                                <Switch name={`status-${unit.id}`} checked={unit.status} onChange={() => toggleStatus(unit)} />
                            ]}
                            actions={allowedActions.length > 0 ? allowedActions : undefined}
                        />
                    ))
                )}

                {!isLoading && units.length === 0 && (
                    <tr>
                        <td colSpan={5} className="text-center py-2 text-gray-500 font-semibold">
                            No Units Found
                        </td>
                    </tr>
                )}
                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-gray-950  font-semibold" colSpan={5}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}
            </Table>

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

            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingUnit ? 'Edit Unit' : 'Add New Unit'}>
                <form onSubmit={handleNewUnitSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 ">Unit Name <em className="text-red-600">*</em></label>
                        <input
                            type="text"
                            name="unit_name"
                            value={newUnit.unit_name}
                            onChange={handleNewUnitChange}
                            className="mt-1 block w-full border border-gray-300  rounded-md p-2 bg-white  text-gray-950 "
                        />
                        {formErrors.unit_name && (
                            <p className="text-sm text-red-600 mt-1">{formErrors.unit_name}</p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 ">Short Name <em className="text-red-600">*</em></label>
                        <input
                            type="text"
                            name="short_name"
                            value={newUnit.short_name}
                            onChange={handleNewUnitChange}
                            className="mt-1 block w-full border border-gray-300  rounded-md p-2 bg-white  text-gray-950 "
                        />
                        {formErrors.short_name && (
                            <p className="text-sm text-red-600 mt-1">{formErrors.short_name}</p>
                        )}
                    </div>

                    <DynamicCustomFields
                        moduleSlug="units"
                        values={customFields}
                        onChange={handleCustomFieldChange}
                        onFieldsLoaded={setActiveCustomFields}
                    />

                    <div className="flex justify-end pt-2 space-x-2">
                        <Button
                            variant="white"
                            disabled={isSubmitting}
                            onClick={() => setShowModal(false)}
                        >
                            Cancel
                        </Button>
                        <SubmitButton isDisabled={isSubmitting} isLoading={isSubmitting} mode={editingUnit ? "edit" : "create"} />
                    </div>
                </form>
            </Modal>

            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={confirmDelete}
                title="Confirm Deletion"
                message="Are you sure you want to delete this unit?"
                isDeleting={isDeleting}
            >
            </DeleteConfirmationModal>
        </div>
    );
};

export default UnitList;