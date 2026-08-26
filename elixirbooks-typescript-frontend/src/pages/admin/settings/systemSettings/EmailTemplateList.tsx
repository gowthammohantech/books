import { CirclePlusIcon, Edit, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import EmailTemplateModal from "./EmailTemplateModal";
import axios from "axios";
import Constants from "@constants/api";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import type { EmailTemplate, EmailTemplatePagination, TemplateListResponse } from "@models/email-template";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import useDateFormatter from "@hooks/useDateFormatter";
import StatusBadge from "@components/admin/StatusBadge";
import Switch from "@components/admin/Switch";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import { hasPermission } from "@utils/hasPermission";
import type { PermissionAction } from "@models/permissions";
import { Button, FormField, Select } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";

const EmailTemplateList: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
    const [itemToEdit, setEditingItem] = useState<EmailTemplate | null>(null);
    const [deleteItem, setDeletingItem] = useState<EmailTemplate | null>(null);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [pagination, setPagination] = useState<EmailTemplatePagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const { formatDate } = useDateFormatter();
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const [isLoading, setIsLoading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const handleNewTemplateClick = () => {
        setEditingItem(null);
        setIsTemplateModalOpen(true);
    }

    useEffect(() => {
        fetchEmailTemplates();
    }, [search, limit, page, token]);

    const fetchEmailTemplates = async () => {
        try {
            setIsLoading(true);
            const response = await axios.get<TemplateListResponse>(Constants.GET_EMAIL_TEMPLATES_URL, {
                params: { search, limit, page },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data.success && response.data.data?.templates) {
                setEmailTemplates(response.data.data.templates);
                if (response.data.data.pagination) setPagination(response.data.data.pagination);
            }
        } catch (error) {
            toast.error('Failed to fetch email templates.');
        } finally {
            setIsLoading(false);
        }
    }

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);
    const tableActions = [
        { label: 'Edit', icon: <Edit size={14} />, onClick: (item: EmailTemplate) => handleEditClick(item) },
        { label: 'Delete', icon: <Trash2Icon size={14} />, onClick: (item: EmailTemplate) => handleDeleteClick(item) }
    ];
    const tableHeaders = ['#', 'Title', 'Created On', 'Status', 'Actions'];
    const restrictedActions = ['edit', 'delete'];
    const allowedActions = tableActions.filter((action) => {
        let actionKey = action.label.toLowerCase() as PermissionAction;

        if (!restrictedActions.includes(actionKey)) {
            return true;
        }

        return hasPermission(permissions, 'system-settings', actionKey);
    });
    if (allowedActions.length === 0) tableHeaders.pop();
    const handleSearch = (keyword: string) => {
        setSearchParams({ search: keyword, limit: String(limit), page: '1' });
    };
    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ search, limit: String(newLimit), page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ search, limit: String(limit), page: String(newPage) });
    };
    const handleEditClick = (item: EmailTemplate) => {
        setEditingItem(item);
        setIsTemplateModalOpen(true);
    }

    const handleDeleteClick = (item: EmailTemplate) => {
        setDeletingItem(item);
        setDeleteModalOpen(true);
    }

    // Toggle which template is used for sending. Activating one deactivates the
    // other templates of the same notification type (enforced on the backend).
    const canToggleStatus = hasPermission(permissions, 'system-settings', 'edit');
    const handleToggleStatus = async (item: EmailTemplate) => {
        const nextStatus = item.status === 'active' ? 'inactive' : 'active';
        try {
            await axios.put(
                `${Constants.UPDATE_EMAIL_TEMPLATE_URL}/${item.id}`,
                { status: nextStatus },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success(nextStatus === 'active' ? 'Template activated for sending' : 'Template deactivated');
            fetchEmailTemplates();
        } catch (error) {
            toast.error('Failed to update template status.');
        }
    }

    const handleSuccess = () => {
        fetchEmailTemplates();
        setIsTemplateModalOpen(false);
        setEditingItem(null);
    }

    const handleDeleteConfirm = async () => {
        try {
            setIsDeleting(true);
            const response = await axios.delete(`${Constants.DELETE_EMAIL_TEMPLATE_URL}/${deleteItem?.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data.success) {
                toast.success('Email template deleted successfully.');
                fetchEmailTemplates();
                setDeleteModalOpen(false);
            }
        } catch (error) {
            toast.error('Failed to delete email template.');
        } finally {
            setIsDeleting(false);
        }
    }
    return (
        <div className="space-y-4">
            <PageHeader title="Email Templates">
                {hasPermission(permissions, 'system-settings', 'create') &&
                    <Button
                        onClick={handleNewTemplateClick}
                        variant="primary"
                        leftIcon={<CirclePlusIcon size={14} />}
                    >
                        New Email Template
                    </Button>
                }
            </PageHeader>
            {/* Search and Page Length */}
            <div className="flex justify-between items-center">
                <FormField
                    type="text"
                    placeholder="Search by title"
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                    containerClassName="w-full md:w-64"
                />
                <Select
                    value={limit}
                    onChange={(e) => handlePageLengthChange(Number(e.target.value))}
                    options={[10, 25, 50].map((num) => ({ value: num, label: `${num} / page` }))}
                    className="cursor-pointer"
                />
            </div>
            <Table headers={tableHeaders}>
                {!isLoading && emailTemplates && emailTemplates.map((template, index) => (
                    <TableRow
                        key={template.id}
                        index={index + 1}
                        row={template}
                        columns={[
                            <span className="text-indigo-600">{template.title}</span>,
                            formatDate(template.createdAt, systemSettings?.dateFormat.format || 'd-m-Y'),
                            canToggleStatus ? (
                                <div className="flex items-center gap-2">
                                    <Switch
                                        name={`tmpl-status-${template.id}`}
                                        checked={template.status === 'active'}
                                        onChange={() => handleToggleStatus(template)}
                                    />
                                    <span className="text-xs text-body">{template.status === 'active' ? 'In use' : 'Inactive'}</span>
                                </div>
                            ) : (
                                <StatusBadge status={template.status} />
                            ),
                        ]}
                        actions={allowedActions.length > 0 ? allowedActions : undefined}
                    />
                ))}

                {!isLoading && emailTemplates.length === 0 &&
                    <tr className="border-b border-border hover:bg-surface">
                        <td className="px-4 py-2 text-sm text-heading text-center font-semibold" colSpan={5}>
                            No email templates found.
                        </td>
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

            {/* Template Modal */}
            {isTemplateModalOpen &&
                <EmailTemplateModal
                    isOpen={isTemplateModalOpen}
                    onClose={() => setIsTemplateModalOpen(false)}
                    onSuccess={() => handleSuccess()}
                    editItem={itemToEdit}
                />
            }

            <DeleteConfirmationModal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={() => handleDeleteConfirm()}
                isDeleting={isDeleting}
                title="Delete Email Template"
                message="Are you sure you want to delete this email template?"
            >
            </DeleteConfirmationModal>
        </div>
    );
}

export default EmailTemplateList;