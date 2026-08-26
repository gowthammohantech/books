import React, { useState, useMemo } from "react";
import { useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { CirclePlusIcon, Edit, Trash2Icon } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import type { RootState } from "@store/index";
import Constants from "@constants/api";

import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";

import { fetchCustomFieldsByModule, fetchCustomFieldTypes, fetchModuleHierarchy } from "@api/customFieldTypeApi";
import CustomFieldForm from "./CustomFieldForm";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import { Button, Badge } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";

interface CustomFieldListProps {
    moduleSlug: string;
}

const LINE_ITEM_MODULES = ['invoices', 'purchases', 'purchase-orders', 'quotations'];

const CustomFieldList: React.FC<CustomFieldListProps> = ({ moduleSlug }) => {
    const { token } = useSelector((state: RootState) => state.auth);

    // Form Modal State
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [itemToEdit, setItemToEdit] = useState<any | null>(null);

    // Delete Modal State
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<any | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Pagination State
    const [page, setPage] = useState(1);

    const { data: moduleHierarchyResponse, isLoading: modulesLoading } = useQuery({
        queryKey: ['moduleHierarchy'],
        queryFn: () => fetchModuleHierarchy(token!),
        refetchOnMount: false,
        enabled: !!token
    });

    const currentModule = useMemo(() => {
        const modules = moduleHierarchyResponse?.data || [];
        for (const mod of modules) {
            if (mod.moduleSlug === moduleSlug) return mod;
            if (mod.children && mod.children.length > 0) {
                const childMatch = mod.children.find(child => child.moduleSlug === moduleSlug);
                if (childMatch) return childMatch;
            }
        }
        return null;
    }, [moduleHierarchyResponse, moduleSlug]);

    const { data: customFieldTypesResponse, isLoading: typesLoading } = useQuery({
        queryKey: ['customFieldTypes'],
        queryFn: () => fetchCustomFieldTypes(token!),
        refetchOnMount: false,
        enabled: !!token
    });

    const customFieldTypes = customFieldTypesResponse?.data || [];

    const { data: customFieldsResponse, isLoading: fieldsLoading, refetch } = useQuery({
        queryKey: ['customFields', currentModule?.id, page],
        queryFn: () => fetchCustomFieldsByModule(token!, currentModule!.id, { page, limit: 10 }),
        refetchOnMount: false,
        enabled: !!token && !!currentModule?.id
    });

    const customFields = customFieldsResponse?.data?.fields || [];
    const isLoading = modulesLoading || typesLoading || fieldsLoading;
    const pagination = customFieldsResponse?.data?.pagination || { total: 0, page: 1, limit: 10, totalPages: 1 };

    const from = pagination.total === 0 ? 0 : ((page - 1) * pagination.limit) + 1;
    const to = Math.min(page * pagination.limit, pagination.total);

    const handleCreateClick = () => {
        setItemToEdit(null);
        setIsFormOpen(true);
    };

    const handleEditClick = (item: any) => {
        const mappedItem = {
            ...item,
            dataType: item.dataType?.id || item.dataType,
            moduleId: item.moduleId?.id || item.moduleId
        };
        setItemToEdit(mappedItem);
        setIsFormOpen(true);
    };

    const handleDeleteClick = (item: any) => {
        setItemToDelete(item);
        setDeleteModalOpen(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;

        try {
            setIsDeleting(true);
            const response = await axios.delete(`${Constants.BASE_URL}/api/admin/custom-fields/${itemToDelete.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.data?.success) {
                toast.success(response.data.message || "Custom field deleted successfully");
                setDeleteModalOpen(false);
                setItemToDelete(null);

                // If we delete the last item on the current page, go back one page
                if (customFields.length === 1 && page > 1) {
                    setPage(page - 1);
                } else {
                    refetch();
                }
            } else {
                toast.error(response.data?.message || "Failed to delete custom field");
            }
        } catch (error: any) {
            toast.error(error.response?.data?.message || "Something went wrong while deleting");
        } finally {
            setIsDeleting(false);
        }
    };

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
    };

    const tableHeaders = ['#', 'Label', 'Slug', 'Type', 'Placement', 'Mandatory', 'Show in Table', 'Actions'];

    const tableActions = [
        {
            label: 'Edit',
            icon: <Edit size={14} />,
            onClick: handleEditClick
        },
        {
            label: 'Delete',
            icon: <Trash2Icon size={14} />,
            onClick: handleDeleteClick
        }
    ];

    // Fallback UI if module is invalid
    if (!isLoading && !currentModule) {
        return (
            <div className="p-4 bg-danger-soft border border-danger rounded-control text-danger text-sm font-medium">
                Error: Module with slug "{moduleSlug}" could not be found in the system.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <PageHeader title={`Custom Fields for ${currentModule?.moduleName || moduleSlug}`}>
                <Button
                    onClick={handleCreateClick}
                    disabled={isLoading}
                    variant="primary"
                    leftIcon={<CirclePlusIcon size={16} />}
                >
                    New Custom Field
                </Button>
            </PageHeader>

            {/* Table */}
            <Table headers={tableHeaders}>
                {!isLoading && customFields.map((field: any, index: number) => {
                    const typeName = field.dataType?.name || 'Unknown';

                    return (
                        <TableRow
                            key={field.id}
                            row={field}
                            // Calculate the correct row index based on the current page
                            index={from + index}
                            columns={[
                                <span className="font-medium text-heading">{field.labelName}</span>,
                                <span className="text-body font-mono text-sm">{field.fieldSlug}</span>,
                                <Badge color="primary">{typeName}</Badge>,
                                field.placement === 'lineItem' ? 'Line item' : 'Document',
                                field.isMandatory ? "Yes" : "No",
                                field.showInTable ? "Yes" : "No"
                            ]}
                            actions={tableActions}
                        />
                    )
                })}

                {!isLoading && customFields.length === 0 && (
                    <tr>
                        <td colSpan={tableHeaders.length} className="text-center text-body py-6 font-medium">
                            No Custom Fields Created Yet
                        </td>
                    </tr>
                )}

                {isLoading && (
                    <tr>
                        <td className="text-center py-8" colSpan={tableHeaders.length}>
                            <LoaderSpinner />
                        </td>
                    </tr>
                )}
            </Table>

            {isFormOpen && currentModule && (
                <CustomFieldForm
                    isOpen={isFormOpen}
                    onClose={() => {
                        setIsFormOpen(false);
                        setItemToEdit(null);
                    }}
                    onSuccess={() => {
                        setIsFormOpen(false);
                        setItemToEdit(null);
                        refetch();
                    }}
                    moduleId={currentModule.id}
                    customFieldTypes={customFieldTypes}
                    token={token!}
                    editItem={itemToEdit}
                    allowLineItemPlacement={LINE_ITEM_MODULES.includes(moduleSlug)}
                />
            )}

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

            {/* Delete Confirmation Modal */}
            <DeleteConfirmationModal
                isOpen={deleteModalOpen}
                onClose={() => {
                    setDeleteModalOpen(false);
                    setItemToDelete(null);
                }}
                onConfirm={confirmDelete}
                title="Delete Custom Field"
                message={<>Are you sure you want to delete the field <strong>{itemToDelete?.labelName}</strong>? This action cannot be undone.</>}
                isDeleting={isDeleting}
            />
        </div>
    );
};

export default CustomFieldList;