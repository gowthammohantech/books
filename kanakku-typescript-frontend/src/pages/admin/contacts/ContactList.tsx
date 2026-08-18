import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';
import { CirclePlusIcon, Edit, LayoutGrid, List, Trash2, Upload, X } from 'lucide-react';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import type { Contact, ContactView } from '@models/contact';
import PaginationWrapper from '@components/admin/PaginationWrapper';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import NoRecords from '@components/admin/NoRecords';
import Table from '@components/admin/Table';
import TableRow from '@components/admin/TableRow';
import type { Action } from '@components/admin/tableActions';
import DeleteConfirmationModal from '@components/admin/DeleteConfirmationModal';
import ExportButton from '@components/admin/ExportButton';
import { hasPermission } from '@utils/hasPermission';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button, Badge } from '@components/ui';

const CONTACTS_URL = `${Constants.API_BASE_URL}/admin/contacts`;

interface PaginationData {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}

interface ContactImportPreviewRow {
    rowIndex: number;
    organisation: string;
    firstName: string;
    lastName: string;
    email: string;
    telephone: string;
    town: string;
    region: string;
    postcode: string;
    currencyCode: string;
    error?: string;
}

const VIEW_LABELS: Record<ContactView, string> = {
    'all-active': 'All active',
    'clients': 'Clients',
    'suppliers': 'Suppliers',
    'clients-open-invoices': 'Clients — open invoices',
    'suppliers-open-bills': 'Suppliers — open bills',
    'hidden': 'Hidden',
    'all': 'All',
};

const VIEW_OPTIONS: ContactView[] = [
    'all-active',
    'clients',
    'suppliers',
    'clients-open-invoices',
    'suppliers-open-bills',
    'hidden',
    'all',
];

const statusBadge = (status?: string) => {
    if (status === 'HIDDEN') {
        return <Badge color="gray">Hidden</Badge>;
    }
    return <Badge color="success">Active</Badge>;
};

const ContactList: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];

    const q = searchParams.get('q') || '';
    const page = Number(searchParams.get('page') || 1);
    const pageSize = Number(searchParams.get('pageSize') || 20);
    const view = (searchParams.get('view') as ContactView) || 'all-active';
    const displayMode = (searchParams.get('display') as 'grid' | 'list') || 'list';

    const [contacts, setContacts] = useState<Contact[]>([]);
    const [pagination, setPagination] = useState<PaginationData>({
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
    });
    const [isLoading, setIsLoading] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<Contact | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // CSV import (salvaged from owner's WIP customer import wizard; wired to the
    // native /admin/contacts/import endpoints so rows land directly in the Contact table)
    const [importStep, setImportStep] = useState<'closed' | 'upload' | 'preview' | 'done'>('closed');
    const [importFile, setImportFile] = useState<File | null>(null);
    const [previewRows, setPreviewRows] = useState<ContactImportPreviewRow[]>([]);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [isConfirming, setIsConfirming] = useState(false);
    const [importResult, setImportResult] = useState<{ createdCount: number; skippedCount: number } | null>(null);

    const setParam = (updates: Record<string, string>) => {
        const next = new URLSearchParams(searchParams.toString());
        Object.entries(updates).forEach(([k, v]) => next.set(k, v));
        setSearchParams(next);
    };

    const fetchContacts = async () => {
        try {
            setIsLoading(true);
            const response = await axios.get(CONTACTS_URL, {
                params: { view, q: q || undefined, page, pageSize },
                headers: { Authorization: `Bearer ${token}` },
            });
            setContacts(response.data.data || []);
            setPagination(response.data.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 1 });
        } catch (error) {
            console.error('Error fetching contacts:', error);
            toast.error('Failed to fetch contacts.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchContacts();
    }, [view, q, page, pageSize]);

    const handleViewChange = (newView: ContactView) => {
        setParam({ view: newView, page: '1' });
    };

    const handleSearch = (value: string) => {
        setParam({ q: value, page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setParam({ page: String(newPage) });
    };

    const handleRowClick = (contact: Contact) => {
        navigate(`/admin/contacts/${contact.id}`);
    };

    const handleEditClick = (contact: Contact) => {
        navigate(`/admin/contacts/edit/${contact.id}`);
    };

    const handleDeleteClick = (contact: Contact) => {
        setItemToDelete(contact);
        setShowDeleteModal(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_CONTACT_URL}/${itemToDelete.id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            toast.success('Contact deleted successfully');
            setShowDeleteModal(false);
            setItemToDelete(null);
            await fetchContacts();
        } catch (error) {
            console.error('Failed to delete contact:', error);
            toast.error('Failed to delete contact.');
        } finally {
            setIsDeleting(false);
        }
    };

    const resetImportState = () => {
        setImportStep('closed');
        setImportFile(null);
        setPreviewRows([]);
        setImportResult(null);
    };

    const submitImportUpload = async () => {
        if (!importFile) {
            toast.error('CSV file is required.');
            return;
        }
        try {
            setIsPreviewing(true);
            const formData = new FormData();
            formData.append('file', importFile);
            const response = await axios.post(
                Constants.IMPORT_CONTACTS_URL,
                formData,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'multipart/form-data',
                    },
                },
            );
            const preview = (response.data?.data?.previewRows ?? []) as ContactImportPreviewRow[];
            setPreviewRows(preview);
            setImportStep('preview');
        } catch (err) {
            console.error('import preview error:', err);
            const msg =
                axios.isAxiosError(err) && err.response?.data?.message
                    ? err.response.data.message
                    : 'Failed to parse CSV.';
            toast.error(msg);
        } finally {
            setIsPreviewing(false);
        }
    };

    const submitImportConfirm = async () => {
        const validRows = previewRows.filter((r) => !r.error);
        if (validRows.length === 0) {
            toast.error('No valid rows to import.');
            return;
        }
        try {
            setIsConfirming(true);
            const response = await axios.post(
                Constants.CONFIRM_IMPORT_CONTACTS_URL,
                {
                    rows: validRows.map((r) => ({
                        organisation: r.organisation,
                        firstName: r.firstName,
                        lastName: r.lastName,
                        email: r.email,
                        telephone: r.telephone,
                        town: r.town,
                        region: r.region,
                        postcode: r.postcode,
                        currencyCode: r.currencyCode,
                    })),
                },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            const data = response.data?.data ?? {};
            setImportResult({
                createdCount: data.createdCount ?? 0,
                skippedCount: data.skippedCount ?? 0,
            });
            toast.success(`Imported ${data.createdCount ?? 0} contacts (${data.skippedCount ?? 0} skipped).`);
            setImportStep('done');
            await fetchContacts();
        } catch (err) {
            console.error('import confirm error:', err);
            toast.error('Failed to import contacts.');
        } finally {
            setIsConfirming(false);
        }
    };

    const validImportCount = previewRows.filter((r) => !r.error).length;
    const invalidImportCount = previewRows.length - validImportCount;

    // Contacts are gated by the `customers` module. Permission gating is handled
    // per-action by TableRow via `requirePermission`.
    const canEdit = hasPermission(permissions, 'customers', 'edit');
    const canDelete = hasPermission(permissions, 'customers', 'delete');
    const tableActions: Action<Contact>[] = [
        {
            label: 'Edit',
            icon: <Edit size={14} />,
            primary: true,
            requirePermission: { moduleSlug: 'customers', action: 'edit' },
            onClick: (item) => handleEditClick(item),
        },
        {
            label: 'Delete',
            icon: <Trash2 size={14} />,
            primary: true,
            variant: 'danger',
            requirePermission: { moduleSlug: 'customers', action: 'delete' },
            onClick: (item) => handleDeleteClick(item),
        },
    ];

    const from = (pagination.page - 1) * pagination.pageSize + 1;
    const to = Math.min(pagination.page * pagination.pageSize, pagination.total);

    const tableHeaders = ['#', 'Display Name', 'Person', 'Email', 'Phone', 'Status'];
    if (canEdit || canDelete) {
        tableHeaders.push('Actions');
    }

    return (
        <div className="space-y-4">
            <PageHeader title="Contacts">
                {hasPermission(permissions, 'customers', 'view') && (
                    <ExportButton
                        url={Constants.EXPORT_CONTACTS_URL}
                        filename="contacts.csv"
                    />
                )}
                {hasPermission(permissions, 'customers', 'create') && (
                    <Button
                        variant="white"
                        onClick={() => setImportStep('upload')}
                        leftIcon={<Upload size={14} />}
                    >
                        Import CSV
                    </Button>
                )}
                <Button
                    onClick={() => navigate('/admin/contacts/new')}
                    leftIcon={<CirclePlusIcon size={14} />}
                >
                    New Contact
                </Button>
            </PageHeader>

            {/* Filter view tabs */}
            <div className="flex flex-wrap gap-1 border-b border-gray-200 pb-2">
                {VIEW_OPTIONS.map((v) => (
                    <button
                        key={v}
                        type="button"
                        onClick={() => handleViewChange(v)}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                            view === v
                                ? 'bg-purple-600 text-white'
                                : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
                        }`}
                    >
                        {VIEW_LABELS[v]}
                    </button>
                ))}
            </div>

            {/* Search + grid/list toggle */}
            <div className="flex justify-between items-center gap-2">
                <input
                    type="text"
                    placeholder="Search contacts..."
                    value={q}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="border border-gray-300 rounded-md px-4 py-2 w-full md:w-64 text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                />
                <div className="flex items-center gap-1 border border-gray-300 rounded-md overflow-hidden">
                    <button
                        type="button"
                        title="List view"
                        onClick={() => setParam({ display: 'list' })}
                        className={`px-2 py-1.5 transition-colors ${
                            displayMode === 'list' ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                    >
                        <List size={16} />
                    </button>
                    <button
                        type="button"
                        title="Grid view"
                        onClick={() => setParam({ display: 'grid' })}
                        className={`px-2 py-1.5 transition-colors ${
                            displayMode === 'grid' ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                    >
                        <LayoutGrid size={16} />
                    </button>
                </div>
            </div>

            {/* Grid view */}
            {displayMode === 'grid' && (
                <div>
                    {isLoading && (
                        <div className="flex justify-center py-8">
                            <LoaderSpinner />
                        </div>
                    )}
                    {!isLoading && contacts.length === 0 && (
                        <p className="text-center text-gray-500 py-8">No contacts found.</p>
                    )}
                    {!isLoading && contacts.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {contacts.map((contact) => (
                                <div
                                    key={contact.id}
                                    onClick={() => handleRowClick(contact)}
                                    className="bg-white border border-border rounded-card p-4 shadow-card hover:shadow-md cursor-pointer transition-shadow space-y-1"
                                >
                                    <p className="font-semibold text-gray-800 truncate">
                                        {contact.displayName || contact.organisation || '—'}
                                    </p>
                                    {(contact.firstName || contact.lastName) && (
                                        <p className="text-sm text-gray-500 truncate">
                                            {[contact.firstName, contact.lastName].filter(Boolean).join(' ')}
                                        </p>
                                    )}
                                    {contact.email && (
                                        <p className="text-xs text-gray-400 truncate">{contact.email}</p>
                                    )}
                                    <div className="pt-1">{statusBadge(contact.status)}</div>
                                    {(canEdit || canDelete) && (
                                        <div
                                            className="flex items-center gap-2 pt-2"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {canEdit && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    leftIcon={<Edit size={14} />}
                                                    onClick={() => handleEditClick(contact)}
                                                >
                                                    Edit
                                                </Button>
                                            )}
                                            {canDelete && (
                                                <Button
                                                    size="sm"
                                                    variant="danger"
                                                    leftIcon={<Trash2 size={14} />}
                                                    onClick={() => handleDeleteClick(contact)}
                                                >
                                                    Delete
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* List / table view */}
            {displayMode === 'list' && (
                <Table headers={tableHeaders}>
                    {!isLoading && contacts.map((contact, index) => (
                        <TableRow
                            key={contact.id}
                            index={index + 1}
                            row={contact}
                            columns={[
                                <span className="font-medium text-gray-800">
                                    {contact.displayName || contact.organisation || '—'}
                                </span>,
                                [contact.firstName, contact.lastName].filter(Boolean).join(' ') || '—',
                                contact.email || '—',
                                contact.telephone || contact.mobile || '—',
                                statusBadge(contact.status),
                            ]}
                            actions={canEdit || canDelete ? tableActions : undefined}
                            onRowClick={(item) => handleRowClick(item as Contact)}
                        />
                    ))}
                    {!isLoading && contacts.length === 0 && (
                        <NoRecords colSpan={tableHeaders.length} message="No contacts found" />
                    )}
                    {isLoading && (
                        <tr key="table-loader">
                            <td className="text-center py-4 text-gray-950 font-semibold" colSpan={tableHeaders.length}>
                                <LoaderSpinner />
                            </td>
                        </tr>
                    )}
                </Table>
            )}

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

            {/* Delete Contact */}
            <DeleteConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={confirmDelete}
                isDeleting={isDeleting}
                title="Confirm Deletion"
                message="Are you sure you want to delete this contact? This action cannot be undone."
            />

            {/* CSV Import modal (salvaged from owner's WIP customer import wizard) */}
            {importStep !== 'closed' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-white rounded-md shadow-lg w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center">
                            <h2 className="text-lg font-semibold text-gray-800">
                                {importStep === 'upload' && 'Import Contacts (CSV)'}
                                {importStep === 'preview' && 'Review Contact Rows'}
                                {importStep === 'done' && 'Import Complete'}
                            </h2>
                            <button
                                type="button"
                                aria-label="close"
                                onClick={resetImportState}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {importStep === 'upload' && (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm text-gray-700 mb-1">CSV file</label>
                                    <input
                                        type="file"
                                        accept=".csv,text/csv"
                                        onChange={(e) =>
                                            setImportFile(e.target.files?.[0] ?? null)
                                        }
                                        className="border border-gray-300 rounded-md px-3 py-2 w-full bg-white text-gray-800"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        Expected columns: organisation (or firstName + lastName), email, telephone
                                        (optional: town, region, postcode, currencyCode).
                                    </p>
                                </div>
                                <div className="flex justify-end gap-2 pt-2">
                                    <button
                                        type="button"
                                        onClick={resetImportState}
                                        className="px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        disabled={isPreviewing || !importFile}
                                        onClick={submitImportUpload}
                                        className="px-3 py-1 rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                                    >
                                        {isPreviewing ? 'Parsing...' : 'Preview'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {importStep === 'preview' && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-3 text-sm">
                                    <span className="inline-flex items-center px-2 py-1 rounded-sm bg-green-100 text-green-700">
                                        {validImportCount} valid
                                    </span>
                                    <span className="inline-flex items-center px-2 py-1 rounded-sm bg-red-100 text-red-700">
                                        {invalidImportCount} invalid (skipped)
                                    </span>
                                </div>
                                <div className="border border-gray-200 rounded-md overflow-x-auto">
                                    <table className="min-w-full text-sm">
                                        <thead className="bg-gray-50 text-gray-700">
                                            <tr>
                                                <th className="px-3 py-2 text-left">#</th>
                                                <th className="px-3 py-2 text-left">Name</th>
                                                <th className="px-3 py-2 text-left">Email</th>
                                                <th className="px-3 py-2 text-left">Phone</th>
                                                <th className="px-3 py-2 text-left">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {previewRows.map((r, i) => (
                                                <tr
                                                    key={i}
                                                    className={r.error ? 'bg-red-50' : 'bg-green-50'}
                                                >
                                                    <td className="px-3 py-2 text-gray-700">{i + 1}</td>
                                                    <td className="px-3 py-2 text-gray-700">
                                                        {r.organisation || [r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}
                                                    </td>
                                                    <td className="px-3 py-2 text-gray-700">{r.email}</td>
                                                    <td className="px-3 py-2 text-gray-700">{r.telephone}</td>
                                                    <td className="px-3 py-2 text-gray-700">
                                                        {r.error ? (
                                                            <span className="text-red-700">{r.error}</span>
                                                        ) : (
                                                            <span className="text-green-700">OK</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="flex justify-end gap-2 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setImportStep('upload')}
                                        className="px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                                    >
                                        Back
                                    </button>
                                    <button
                                        type="button"
                                        disabled={isConfirming || validImportCount === 0}
                                        onClick={submitImportConfirm}
                                        className="px-3 py-1 rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                                    >
                                        {isConfirming ? 'Importing...' : `Confirm Import (${validImportCount})`}
                                    </button>
                                </div>
                            </div>
                        )}

                        {importStep === 'done' && (
                            <div className="space-y-3">
                                <div className="text-center py-4 text-gray-700">
                                    <p className="text-base">Import complete.</p>
                                    {importResult && (
                                        <div className="mt-3 flex justify-center gap-3 text-sm">
                                            <span className="inline-flex items-center px-2 py-1 rounded-sm bg-green-100 text-green-700">
                                                {importResult.createdCount} created
                                            </span>
                                            <span className="inline-flex items-center px-2 py-1 rounded-sm bg-gray-100 text-gray-700">
                                                {importResult.skippedCount} skipped
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex justify-end pt-2">
                                    <button
                                        type="button"
                                        onClick={resetImportState}
                                        className="px-3 py-1 rounded-md bg-purple-600 text-white hover:bg-purple-700"
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ContactList;
