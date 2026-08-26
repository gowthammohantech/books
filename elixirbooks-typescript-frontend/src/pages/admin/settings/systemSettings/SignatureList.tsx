import { useEffect, useState, type FC } from "react";
import Modal from "../../../../components/admin/Modal";
import { Edit, Image, Trash2Icon, CirclePlusIcon } from "lucide-react";
import Constants from "../../../../constants/api";
import axios, { AxiosError } from "axios";
import { toast } from "sonner";
import { useSelector } from "react-redux";
import type { RootState } from "../../../../store";
import Table from "../../../../components/admin/Table";
import TableRow from "../../../../components/admin/TableRow";
import { useSearchParams } from "react-router-dom";
import Switch from "../../../../components/admin/Switch";
import PaginationWrapper from "../../../../components/admin/PaginationWrapper";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import { hasPermission } from "@utils/hasPermission";
import type { PermissionAction } from "@models/permissions";
import SubmitButton from "@components/admin/SubmitButton";
import { Button, FormField, Select } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";
// Interface for the form data
interface SignatureFormData {
    id?: string;
    signatureName: string;
    signatureImage: File | null;
    signatureImage_preview_url?: string;
    signatureImage_removed?: boolean;
    markAsDefault?: boolean;
    status?: boolean;
}

// Interface for signature data from API
interface Signature {
    id: string;
    signatureName: string;
    signatureImage: string; // URL from server
    markAsDefault: boolean;
    status: boolean;
    createdAt: string;
}

// Interface for pagination data from API
interface SignaturePagination {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

const initialFormData: SignatureFormData = {
    signatureName: '',
    signatureImage: null,
    signatureImage_preview_url: '',
    signatureImage_removed: false,
    markAsDefault: false,
    status: true
};

const SignatureList: FC = () => {
    const [showModal, setShowModal] = useState<boolean>(false);
    const { token } = useSelector((state: RootState) => state.auth);
    const [signatures, setSignatures] = useState<Signature[]>([]);
    const [isEditMode, setIsEditMode] = useState<boolean>(false);
    const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
    const [itemToDelete, setItemToDelete] = useState<Signature | null>(null);
    const [searchParams, setSearchParams] = useSearchParams();
    const [pagination, setPagination] = useState<SignaturePagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [formData, setFormData] = useState<SignatureFormData>(initialFormData);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});

    // Derive search, limit, and page from URL search params
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const [isLoading, setIsLoading] = useState(false);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const fetchSignatures = async (currentSearch = search, currentLimit = limit, currentPage = page) => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.GET_SIGNATURES_URL, {
                params: { search: currentSearch, limit: currentLimit, page: currentPage },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setSignatures(response.data.data.signatures);
            if (response.data.data.pagination) setPagination(response.data.data.pagination);
        } catch (error) {
            console.error("Error fetching signatures:", error);
            toast.error("Failed to fetch signatures.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchSignatures();
    }, [search, limit, page, token]);

    // --- Handlers for Search and Pagination ---
    const handleSearch = (keyword: string) => {
        setSearchParams({ search: keyword, limit: String(limit), page: '1' });
    };
    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ search, limit: String(newLimit), page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ search, limit: String(limit), page: String(newPage) });
    };

    // --- Handlers for CRUD operations ---
    const openCreate = () => {
        setIsEditMode(false);
        setFormData(initialFormData);
        setFormErrors({});
        setShowModal(true);
    };

    const handleEditClick = (item: Signature) => {
        setFormData({
            ...item,
            signatureImage_preview_url: item.signatureImage, // Set preview URL from existing image
            signatureImage: null,
            signatureImage_removed: false,
        });
        setIsEditMode(true);
        setFormErrors({});
        setShowModal(true);
    };

    const handleDeleteClick = (signature: Signature) => {
        setItemToDelete(signature);
        setShowDeleteModal(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_SIGNATURE_URL}/${itemToDelete.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Signature deleted successfully');
            fetchSignatures(); // Refresh the list
            setShowDeleteModal(false);
            setItemToDelete(null);
        } catch (error) {
            console.error('Failed to delete signature:', error);
            toast.error('Failed to delete signature.');
        } finally {
            setIsDeleting(false);
        }
    };

    // --- Table Actions Definition ---
    const tableActions = [
        { label: 'Edit', icon: <Edit size={14} />, onClick: (item: Signature) => handleEditClick(item) },
        { label: 'Delete', icon: <Trash2Icon size={14} />, onClick: (item: Signature) => handleDeleteClick(item) }
    ];

    const tableHeaders = ["#", "Signature Name", "Signature", "Status", "Default", "Actions"];
    const restrictedActions = ['edit', 'delete'];

    const prepareTableActions = (item: Signature) => {
        const actions = [{
            label: 'Edit',
            icon: <Edit size={14} />,
            onClick: (item: Signature) => handleEditClick(item)
        },
        {
            label: 'Delete',
            icon: <Trash2Icon size={14} />,
            onClick: (item: Signature) => handleDeleteClick(item)
        }];

        return actions.filter((action) => {
            const actionKey = action.label.toLowerCase() as PermissionAction;
            if (!restrictedActions.includes(actionKey)) {
                return true;
            }
            // if this item isDefault, hide the delete action
            if (item.markAsDefault && actionKey === 'delete') return false;
            return hasPermission(permissions, 'system-settings', actionKey);
        });
    };
    const allowedActions = tableActions.filter((action) => {
        const actionKey = action.label.toLowerCase() as PermissionAction;
        if (!restrictedActions.includes(actionKey)) {
            return true;
        }
        return hasPermission(permissions, 'system-settings', actionKey);
    });

    if (allowedActions.length === 0) tableHeaders.pop();
    // --- Form Handling ---
    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};
        if (!formData.signatureName.trim()) {
            newErrors.signatureName = 'Signature name is required.';
        } else if (formData.signatureName.length < 3) {
            newErrors.signatureName = 'Name must be at least 3 characters.';
        }
        if (!isEditMode && !formData.signatureImage) {
            newErrors.signatureImage = 'Signature image is required for new entries.';
        }
        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setFormData(prev => ({
                ...prev,
                signatureImage: file,
                signatureImage_preview_url: URL.createObjectURL(file),
                signatureImage_removed: false
            }));
        }
    };

    const handleImageDelete = () => {
        setFormData(prev => ({
            ...prev,
            signatureImage: null,
            signatureImage_preview_url: '',
            signatureImage_removed: true
        }));
    };

    const handleStatusChange = async (id: String, newStatus: boolean) => {
        setSignatures(prev =>
            prev.map(sig =>
                sig.id === id ? { ...sig, status: newStatus } : sig
            )
        );
        try {
            await axios.patch(`${Constants.UPDATE_SIGNATURE_STATUS_URL}/${id}`, { status: newStatus }, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            toast.success('Status updated successfully');
        } catch (error) {
            toast.error('Failed to update status.');
        }

    }

    const handleDefaultChange = async (id: String, newDefault: boolean) => {
        setSignatures(prev =>
            prev.map(sig =>
                sig.id === id ? { ...sig, markAsDefault: newDefault, status: true } : { ...sig, markAsDefault: false }
            )
        );
        try {
            await axios.patch(`${Constants.UPDATE_SIGNATURE_DEFAULT_URL}/${id}`, { markAsDefault: newDefault }, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            toast.success('Default signature updated successfully');
        } catch (error) {
            toast.error('Failed to update default.');
        }
    }
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateForm()) return;

        const data = new FormData();
        data.append('signatureName', formData.signatureName);
        data.append('markAsDefault', String(formData.markAsDefault || false));
        data.append('status', String(formData.status || false));

        if (formData.signatureImage instanceof File) {
            data.append('signatureImage', formData.signatureImage);
        }
        if (formData.signatureImage_removed) {
            data.append('signatureImage_removed', 'true');
        }

        try {
            setIsSaving(true);
            if (isEditMode) {
                await axios.put(`${Constants.UPDATE_SIGNATURE_URL}/${formData.id}`, data, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
                });
                toast.success('Signature updated successfully');
            } else {
                await axios.post(Constants.CREATE_SIGNATURE_URL, data, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
                });
                toast.success('Signature created successfully');
            }
            fetchSignatures();
            setShowModal(false);
        } catch (error: any | AxiosError) {
            setFormErrors(error?.response?.data?.errors || {});
            toast.error('Something went wrong. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Signatures">
                {hasPermission(permissions, 'system-settings', 'create') &&
                    <Button
                        onClick={openCreate}
                        variant="primary"
                        leftIcon={<CirclePlusIcon size={14} />}
                    >
                        New Signature
                    </Button>
                }
            </PageHeader>

            {/* Search and Page Length */}
            <div className="flex justify-between items-center">
                <FormField
                    containerClassName="w-full md:w-64"
                    type="text"
                    placeholder="Search signatures..."
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                />
                <Select
                    containerClassName="w-auto"
                    value={limit}
                    onChange={(e) => handlePageLengthChange(Number(e.target.value))}
                    options={[10, 25, 50].map((num) => ({ value: num, label: `${num} / page` }))}
                />
            </div>

            {/* Table */}
            <Table headers={tableHeaders}>
                {!isLoading && signatures && signatures.length > 0 && signatures.map((sig, index) => (
                    <TableRow
                        key={sig.id}
                        index={from + index}
                        row={sig}
                        columns={[
                            <span className="text-indigo-600">{sig.signatureName}</span>,
                            <img src={sig.signatureImage} alt={sig.signatureName} className="h-10 w-24 object-cover border rounded-md" />,
                            <Switch name={`status-${sig.id}`} checked={sig.status} onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleStatusChange(sig.id, e.target.checked)} disabled={sig.markAsDefault || !hasPermission(permissions, 'system-settings', 'edit')} />,
                            <Switch name={`status-${sig.id}`} checked={sig.markAsDefault} onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleDefaultChange(sig.id, e.target.checked)} disabled={sig.markAsDefault || !hasPermission(permissions, 'system-settings', 'edit')} />,
                        ]}
                        actions={prepareTableActions(sig)}
                    />
                ))}

                {!isLoading && signatures && signatures.length === 0 &&
                    <tr>
                        <td colSpan={6} className="text-center py-4 text-body font-medium">No Signatures Found</td>
                    </tr>
                }

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-heading font-semibold" colSpan={7}>
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

            {/* Add/Edit Modal */}
            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={isEditMode ? 'Update Signature' : 'Create Signature'}>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Image Upload */}
                    <div className="flex items-start gap-4 mb-4">
                        <div className="relative w-24 h-24 border border-border rounded-control flex items-center justify-center overflow-hidden bg-white">
                            {formData.signatureImage_preview_url ? (
                                <img src={formData.signatureImage_preview_url} alt="Preview" className="w-full h-full object-contain" />
                            ) : (
                                <span className="text-xl text-body"><Image /></span>
                            )}
                            {formData.signatureImage_preview_url && (
                                <button type="button" onClick={handleImageDelete} title="Remove Image" className="absolute top-[-1px] right-[-1px] bg-white border border-danger rounded-full p-1 shadow-md hover:bg-danger group">
                                    <Trash2Icon size={14} className="text-danger group-hover:text-white" />
                                </button>
                            )}
                        </div>
                        <div>
                            <label htmlFor="imageUpload" className="inline-flex items-center bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-control transition duration-200 cursor-pointer">
                                <Image size={16} className="mr-2" /> Upload Image
                            </label>
                            <input type="file" accept="image/png, image/jpeg" onChange={handleFileChange} className="hidden" id="imageUpload" />
                            <p className="text-xs text-body mt-1">PNG or JPG, max 5MB.</p>
                            {formErrors.signatureImage && <p className="text-xs text-danger mt-1">{formErrors.signatureImage}</p>}
                        </div>
                    </div>

                    {/* Signature Name */}
                    <FormField
                        label="Name"
                        required
                        id="signatureName"
                        name="signatureName"
                        value={formData.signatureName}
                        onChange={handleChange}
                        type="text"
                        placeholder="Enter Signature Name"
                        error={formErrors.signatureName}
                    />

                    {/* Status and Is Default */}
                    <div className="flex justify-between items-center gap-6 flex-wrap">
                        {/* Status Switch */}
                        <div className="flex items-center gap-3">
                            <label htmlFor="status" className="font-medium text-sm text-heading">
                                Status
                            </label>
                            <Switch
                                name="status"
                                checked={formData.status ?? false}
                                onChange={handleChange}
                                disabled={isEditMode && formData.status}
                            />
                        </div>

                        {/* Default Switch */}
                        <div className="flex items-center gap-3">
                            <label htmlFor="markAsDefault" className="font-medium text-sm text-heading">
                                Set as Default
                            </label>
                            <Switch
                                name="markAsDefault"
                                checked={formData.markAsDefault ?? false}
                                onChange={handleChange}
                                disabled={isEditMode && formData.markAsDefault}
                            />
                        </div>
                    </div>


                    {/* Buttons */}
                    <div className="flex justify-between pt-4">
                        <Button type="button" variant="white" onClick={() => setShowModal(false)}>Cancel</Button>
                        <SubmitButton
                            isDisabled={isSaving}
                            isLoading={isSaving}
                            mode={isEditMode ? "edit" : "create"}
                        />
                    </div>
                </form>
            </Modal>

            {/* Delete Confirmation Modal */}
            <DeleteConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={confirmDelete}
                title="Confirm Deletion"
                message={`Are you sure you want to delete ${itemToDelete?.signatureName}? This action cannot be undone.`}
                isDeleting={isDeleting}
            />
        </div>
    );
};

export default SignatureList;