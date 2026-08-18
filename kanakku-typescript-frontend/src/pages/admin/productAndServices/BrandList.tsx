import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { FC, ChangeEvent, FormEvent } from "react";
import Constants from "@constants/api";
import axios from "axios";
import Table from "@components/admin/Table";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import { Trash2Icon, Edit, CirclePlusIcon } from "lucide-react";
import { toast } from "sonner";
import Modal from "@components/admin/Modal";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index"
import type { PermissionAction } from "@models/permissions";
import { hasPermission } from "@utils/hasPermission";
import TableRow from "@components/admin/TableRow";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import ProfileCard from "@components/admin/ProfileImage";
import SubmitButton from "@components/admin/SubmitButton";
import DynamicCustomFields from "@components/admin/DynamicCustomFields";
import ImageCropperUpload from "@components/common/ImageCropperUpload";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button } from "@components/ui";

// Interface for the brand data
interface Brand {
    id: string;
    brand_name: string;
    status: boolean;
    brandImageUrl: string;
}

// Interface for pagination data from the API
interface BrandPagination {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// Interface for the form state
interface BrandFormState {
    id?: string;
    brand_name?: string;
    status?: boolean;
    brand_image?: File | null;
    brandImageUrl?: string;
}

// Interface for form validation errors
interface FormErrors {
    brand_name?: string;
    brand_image?: string;
}

const BrandList: FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const [searchParams, setSearchParams] = useSearchParams();

    // State management
    const [brands, setBrands] = useState<Brand[]>([]);
    const [pagination, setPagination] = useState<BrandPagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [showModal, setShowModal] = useState<boolean>(false);
    const [isEditMode, setIsEditMode] = useState<boolean>(false);
    const [brand, setBrand] = useState<BrandFormState>({});
    const [formErrors, setFormErrors] = useState<FormErrors>({});

    // Dropdown and Delete Modal state
    const [isDeleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
    const [itemToDelete, setItemToDelete] = useState<Brand | null>(null);

    // Get params from URL
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

    const initialFormState: BrandFormState = {
        brand_name: '',
        status: true,
        brand_image: null,
        brandImageUrl: ''
    };

    // Fetch brands based on URL params
    const fetchBrands = async (search?: string, limit?: number, page?: number): Promise<void> => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.FETCH_BRAND_LIST_URL, {
                params: { search, limit, page },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            // Assuming API response is { data: { brands: [], pagination: {} } }
            setBrands(response.data.data.brands || []);
            setPagination(response.data.data.pagination);
        } catch (error) {
            console.error("Error fetching brands:", error);
            toast.error("Failed to fetch brands.");
        } finally {
            setIsLoading(false);
        }
    };

    // Effect to fetch data when params change
    useEffect(() => {
        fetchBrands(search, limit, page);
    }, [search, limit, page]);

    // Handlers for search and pagination
    const handleSearch = (keyword: string) => {
        setSearchParams({ search: keyword, limit: String(limit), page: '1' });
    };

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ search, limit: String(newLimit), page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ search, limit: String(limit), page: String(newPage) });
    };

    const updateStatus = async (brandToUpdate: Brand): Promise<void> => {
        try {
            const updatedBrand = { ...brandToUpdate, status: !brandToUpdate.status };
            await axios.put(`${Constants.UPDATE_BRAND_URL}/${brandToUpdate.id}`, updatedBrand, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            toast.success('Status updated successfully');
            fetchBrands(search, limit, page); // Refetch current page
        } catch (error) {
            console.error('Failed to update status:', error);
            toast.error("Failed to update status.");
        }
    };

    const handleCroppedBrandImage = (file: File): void => {
        setBrand({
            ...brand,
            brand_image: file,
            brandImageUrl: URL.createObjectURL(file),
        });
    };

    const handleEditClick = async (brandToEdit: Brand): Promise<void> => {
        try {
            const response = await axios.get<any>(`${Constants.GET_BRAND_URL}/${brandToEdit.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setBrand(response.data);
            setCustomFields(response.data.customFields || {});
            setIsEditMode(true);
            setFormErrors({});
            setShowModal(true);
        } catch (error) {
            console.error('Failed to load brand:', error);
            toast.error("Failed to load brand data.");
        }
    }

    const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
        e.preventDefault();
        setFormErrors({});

        const formData = new FormData();
        formData.append("brand_name", brand.brand_name ?? "");
        formData.append("status", String(brand.status ?? true));
        if (brand.brand_image) {
            formData.append("brand_image", brand.brand_image);
        }

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
            const url = isEditMode
                ? `${Constants.UPDATE_BRAND_URL}/${brand.id}`
                : Constants.CREATE_BRAND_URL;
            const method = isEditMode ? 'put' : 'post';

            await axios[method](url, formData, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            toast.success(`Brand ${isEditMode ? 'updated' : 'added'} successfully`);
            setShowModal(false);
            fetchBrands(search, limit, page); // Refetch current page
        } catch (error: any) {
            if (error.response?.data?.errors) {
                setFormErrors(error.response.data.errors);
            } else {
                console.error("Error submitting form:", error);
                toast.error(`Failed to ${isEditMode ? 'update' : 'add'} brand.`);
            }
        } finally {
            setIsSubmitting(false);
        }
    }

    const handleDeleteClick = (brandToDelete: Brand): void => {
        setItemToDelete(brandToDelete);
        setDeleteModalOpen(true);
    }

    const openCreateBrand = (): void => {
        setShowModal(true);
        setFormErrors({});
        setBrand(initialFormState);
        setCustomFields({});
        setIsEditMode(false);
    }

    const confirmDelete = async (): Promise<void> => {
        if (!itemToDelete) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_BRAND_URL}/${itemToDelete.id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            toast.success('Brand deleted successfully');
            fetchBrands(search, limit, page); // Refetch current page
            setDeleteModalOpen(false);
        } catch (error) {
            console.error('Failed to delete brand:', error);
            toast.error("Failed to delete brand.");
        } finally {
            setIsDeleting(false);
        }
    }

    // Calculate display range for pagination
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    const tableHeaders = ["#", "Brand Name", "Status", "Actions"];
    const restrictedActions = ['edit', 'delete'];
    const tableActions = [
        {
            label: 'Edit',
            icon: <Edit size={14} />,
            primary: true,
            onClick: (item: Brand) => { handleEditClick(item) }
        },
        {
            label: 'Delete',
            icon: <Trash2Icon size={14} />,
            primary: true,
            variant: 'danger' as const,
            onClick: (item: Brand) => { handleDeleteClick(item) }
        }
    ];

    const allowedActions = tableActions.filter((action) => {
        const actionName = action.label.toLowerCase() as PermissionAction;

        if (!restrictedActions.includes(actionName)) {
            return true;
        }

        return hasPermission(permissions, 'product-services', actionName);
    });

    if (allowedActions.length === 0) {
        tableHeaders.pop();
    }
    return (
        <div className="space-y-4">
            <PageHeader title="Brands">
                {hasPermission(permissions, 'product-services', 'create') && (
                    <Button
                        onClick={openCreateBrand}
                        leftIcon={<CirclePlusIcon size={14} />}
                        className="shadow"
                    >
                        New Brand
                    </Button>
                )}
            </PageHeader>

            <div className="flex flex-col md:flex-row justify-between gap-4">
                <input
                    type="text"
                    placeholder="Search by brand name..."
                    value={search}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleSearch(e.target.value)}
                    className="border border-gray-300 rounded-md px-4 py-2 w-full md:w-64  text-gray-950  focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
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
                {!isLoading && brands && brands.map((brandItem, index) => (
                    <TableRow
                        key={brandItem.id}
                        index={index + 1}
                        row={brandItem}
                        columns={[
                            <ProfileCard
                                imageUrl={brandItem.brandImageUrl}
                                name={brandItem.brand_name}
                                primary
                            />,
                            <label className="inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={brandItem.status}
                                    onChange={() => updateStatus(brandItem)}
                                />
                                <div className="relative w-11 h-6 bg-gray-200 peer-checked:bg-purple-600 rounded-full peer-focus:ring-2 peer-focus:ring-purple-600 transition-all duration-300">
                                    <div className={`absolute top-0.5 left-1 w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-300 ${brandItem.status ? 'translate-x-full' : ''}`}></div>
                                </div>
                            </label>
                        ]}
                        actions={allowedActions.length > 0 ? allowedActions : undefined}
                    />
                ))}

                {!isLoading && brands.length === 0 &&
                    <tr>
                        <td colSpan={tableHeaders.length} className="text-center py-4 font-semibold">No brands found.</td>
                    </tr>
                }

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-gray-950  font-semibold" colSpan={7}>
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

            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={isEditMode ? 'Edit Brand' : 'Add New Brand'}>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700  mb-1">Image <em className="text-red-600">*</em></label>
                        <ImageCropperUpload
                            value={brand.brandImageUrl || undefined}
                            aspect={1}
                            label="Upload Image"
                            onCropped={handleCroppedBrandImage}
                        />
                        {formErrors.brand_image && <p className="text-red-500 text-xs mt-1">{formErrors.brand_image}</p>}
                    </div>

                    <div>
                        <label htmlFor="brand_name" className="block text-sm font-medium text-gray-700  mb-1">
                            Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="brand_name"
                            type="text"
                            value={brand.brand_name || ''}
                            onChange={(e) => setBrand({ ...brand, brand_name: e.target.value })}
                            placeholder="Enter brand name"
                            className="w-full text-gray-950  bg-white  px-4 py-2 border border-gray-300  rounded-md text-sm focus:ring-purple-600 focus:border-purple-600"
                        />
                        {formErrors.brand_name && <p className="text-red-500 text-xs mt-1">{formErrors.brand_name}</p>}
                    </div>

                    <DynamicCustomFields
                        moduleSlug="brands"
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
                        <SubmitButton isDisabled={isSubmitting} isLoading={isSubmitting} mode={isEditMode ? "edit" : "create"} />
                    </div>
                </form>
            </Modal>

            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={confirmDelete}
                title="Confirm Deletion"
                message="Are you sure you want to delete this brand?"
                isDeleting={isDeleting}
            >
            </DeleteConfirmationModal>
        </div>
    );
}

export default BrandList;