import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios, { type AxiosError } from 'axios';
import { toast } from 'sonner';
import { CirclePlusIcon, Edit, Trash2Icon } from 'lucide-react';

import type { RootState } from '@store/index';
import Constants from '@constants/api';
import Table from '@components/admin/Table';
import TableRow from '@components/admin/TableRow';
import Modal from '@components/admin/Modal';
import DeleteConfirmationModal from '@components/admin/DeleteConfirmationModal';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import NoRecords from '@components/admin/NoRecords';
import SubmitButton from '@components/admin/SubmitButton';
import { hasPermission } from '@utils/hasPermission';
import type { PermissionAction } from '@models/permissions';
import { useTransactionCategories } from '@hooks/useTransactionCategories';
import { Button, Badge, FormField, Select } from '@components/ui';
import { PageHeader } from '@/context/PageHeaderContext';
import type { TransactionCategory, CategoryAppliesTo } from '../../../../types/moneyFlow';
import type { Account } from '@models/accounting';
import type { TaxRate } from '@models/taxRate';

// ── Domain constants ──────────────────────────────────────────────────────────

const CATEGORY_GROUP_OPTIONS = [
    { value: 'ADMIN_EXPENSES', label: 'Admin Expenses' },
    { value: 'GENERAL_OVERHEADS', label: 'General Overheads' },
    { value: 'COST_OF_SALES', label: 'Cost of Sales' },
    { value: 'PAYROLL', label: 'Payroll' },
    { value: 'TAXES', label: 'Taxes' },
    { value: 'INCOME', label: 'Income' },
    { value: 'CAPITAL', label: 'Capital' },
    { value: 'OWNER_FUNDS', label: 'Owner Funds' },
    { value: 'USER_PAYMENTS', label: 'User Payments' },
] as const;
const CATEGORY_GROUP_VALUES = CATEGORY_GROUP_OPTIONS.map((o) => o.value);
type CategoryGroup = (typeof CATEGORY_GROUP_OPTIONS)[number]['value'];

const groupLabel = (v: string): string =>
    CATEGORY_GROUP_OPTIONS.find((o) => o.value === v)?.label ?? v;

const APPLIES_TO_OPTIONS: { value: CategoryAppliesTo; label: string }[] = [
    { value: 'MONEY_IN', label: 'Money In' },
    { value: 'MONEY_OUT', label: 'Money Out' },
    { value: 'MONEY_IN_USER', label: 'Money In (User)' },
    { value: 'MONEY_OUT_USER', label: 'Money Out (User)' },
];

const appliesToLabel = (v: CategoryAppliesTo): string =>
    APPLIES_TO_OPTIONS.find((o) => o.value === v)?.label ?? v;

const TABLE_HEADERS = [
    'Name',
    'Applies To',
    'Account',
    'Default Tax',
    'Tax Applicable',
    'Status',
    'Actions',
];

// ── Form types ────────────────────────────────────────────────────────────────

interface CategoryForm {
    name: string;
    group: CategoryGroup;
    appliesTo: CategoryAppliesTo;
    accountId: string;
    defaultTaxRateId: string;
    taxApplicable: boolean;
}

const emptyForm: CategoryForm = {
    name: '',
    group: 'ADMIN_EXPENSES',
    appliesTo: 'MONEY_OUT',
    accountId: '',
    defaultTaxRateId: '',
    taxApplicable: true,
};

// ── 409 / validation error shapes ────────────────────────────────────────────

interface ApiErrorBody {
    message?: string;
    errors?: Record<string, string[]>;
}

// ── Main component ────────────────────────────────────────────────────────────

const TransactionCategoriesPage: React.FC = () => {
    const { token } = useSelector((s: RootState) => s.auth);
    const { data: systemSettings } = useSelector((s: RootState) => s.systemSettings);
    const permissions = systemSettings?.permissions ?? [];

    const { categories, loading, refetch } = useTransactionCategories();

    // ── Accounts list ────────────────────────────────────────────────────────
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [accountsLoading, setAccountsLoading] = useState(false);

    useEffect(() => {
        if (!token) return;
        setAccountsLoading(true);
        axios
            .get(Constants.GET_ACCOUNTS_URL, {
                headers: { Authorization: `Bearer ${token}` },
                params: { limit: 500 },
            })
            .then((res) => setAccounts(res.data?.data?.accounts ?? []))
            .catch((err) => {
                console.error('Failed to load accounts:', err);
                toast.error('Failed to load accounts.');
            })
            .finally(() => setAccountsLoading(false));
    }, [token]);

    // ── Tax rates list ───────────────────────────────────────────────────────
    const [taxRates, setTaxRates] = useState<TaxRate[]>([]);

    useEffect(() => {
        if (!token) return;
        axios
            .get(Constants.FETCH_TAX_RATE_LIST_URL, {
                headers: { Authorization: `Bearer ${token}` },
                params: { limit: 500 },
            })
            .then((res) => setTaxRates(res.data?.data?.taxRates ?? []))
            .catch(() => {/* non-critical */});
    }, [token]);

    // ── Modal / form state ───────────────────────────────────────────────────
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<CategoryForm>(emptyForm);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);

    // ── Delete modal ─────────────────────────────────────────────────────────
    const [deleteTarget, setDeleteTarget] = useState<TransactionCategory | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // ── Helpers ──────────────────────────────────────────────────────────────

    const canCreate = hasPermission(permissions, 'finance-settings', 'create' as PermissionAction);
    const canEdit   = hasPermission(permissions, 'finance-settings', 'edit'   as PermissionAction);
    const canDelete = hasPermission(permissions, 'finance-settings', 'delete' as PermissionAction);

    const openCreate = () => {
        setEditingId(null);
        setForm(emptyForm);
        setFieldErrors({});
        setShowModal(true);
    };

    const openEdit = (cat: TransactionCategory) => {
        setEditingId(cat.id);
        setForm({
            name: cat.name,
            group: (CATEGORY_GROUP_VALUES as readonly string[]).includes(cat.group)
                ? (cat.group as CategoryGroup)
                : 'ADMIN_EXPENSES',
            appliesTo: cat.appliesTo,
            accountId: cat.accountId ?? '',
            defaultTaxRateId: cat.defaultTaxRateId ?? '',
            taxApplicable: cat.taxApplicable,
        });
        setFieldErrors({});
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setEditingId(null);
        setForm(emptyForm);
        setFieldErrors({});
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setFieldErrors({});
        if (!form.accountId) {
            setFieldErrors({ accountId: 'Please select an account.' });
            return;
        }
        const payload = {
            name: form.name.trim(),
            group: form.group,
            appliesTo: form.appliesTo,
            accountId: form.accountId,
            defaultTaxRateId: form.defaultTaxRateId || null,
            taxApplicable: form.taxApplicable,
        };
        try {
            setSubmitting(true);
            if (editingId) {
                await axios.put(`${Constants.TRANSACTION_CATEGORIES_URL}/${editingId}`, payload, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                toast.success('Category updated');
            } else {
                await axios.post(Constants.TRANSACTION_CATEGORIES_URL, payload, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                toast.success('Category created');
            }
            closeModal();
            refetch();
        } catch (err) {
            const axErr = err as AxiosError<ApiErrorBody>;
            const status = axErr.response?.status;
            const body = axErr.response?.data;
            if (status === 422 && body?.errors) {
                const mapped: Record<string, string> = {};
                for (const [field, msgs] of Object.entries(body.errors)) {
                    mapped[field] = Array.isArray(msgs) ? msgs[0] : String(msgs);
                }
                setFieldErrors(mapped);
            } else {
                toast.error(body?.message ?? 'Failed to save category');
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleToggleStatus = async (cat: TransactionCategory) => {
        try {
            await axios.patch(
                `${Constants.TRANSACTION_CATEGORIES_URL}/${cat.id}/status`,
                { status: !cat.status },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            toast.success(cat.status ? 'Category disabled' : 'Category enabled');
            refetch();
        } catch {
            toast.error('Failed to update status');
        }
    };

    const handleDeleteConfirm = async () => {
        if (!deleteTarget) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.TRANSACTION_CATEGORIES_URL}/${deleteTarget.id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            toast.success('Category deleted');
            setDeleteTarget(null);
            refetch();
        } catch (err) {
            const axErr = err as AxiosError<ApiErrorBody>;
            const status = axErr.response?.status;
            const msg = axErr.response?.data?.message;
            if (status === 409) {
                toast.error(msg ?? 'Category is in use — disable it instead of deleting.');
            } else {
                toast.error(msg ?? 'Failed to delete category');
            }
            setDeleteTarget(null);
        } finally {
            setIsDeleting(false);
        }
    };

    // ── Group categories ─────────────────────────────────────────────────────

    const grouped: Record<string, TransactionCategory[]> = {};
    for (const g of CATEGORY_GROUP_VALUES) {
        grouped[g] = [];
    }
    // put ungrouped categories under a catch-all
    for (const cat of categories) {
        if (grouped[cat.group] !== undefined) {
            grouped[cat.group].push(cat);
        } else {
            grouped['ADMIN_EXPENSES'].push(cat);
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────

    if (loading || accountsLoading) {
        return (
            <div className="flex items-center justify-center min-h-40">
                <LoaderSpinner />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <PageHeader
                title={
                    <div>
                        <span className="block">Transaction Categories</span>
                        <p className="text-sm font-normal text-body">
                            Manage categories used for Money In / Money Out transactions.
                        </p>
                    </div>
                }
            >
                {canCreate && (
                    <Button
                        type="button"
                        variant="primary"
                        onClick={openCreate}
                        leftIcon={<CirclePlusIcon size={16} />}
                    >
                        Add Category
                    </Button>
                )}
            </PageHeader>

            {/* Grouped tables */}
            {categories.length === 0 ? (
                <NoRecords colSpan={TABLE_HEADERS.length + 1} />
            ) : (
                <div className="space-y-6">
                    {CATEGORY_GROUP_VALUES.map((group) => {
                        const rows = grouped[group];
                        if (rows.length === 0) return null;
                        return (
                            <div key={group}>
                                <h2 className="text-sm font-semibold uppercase tracking-wide text-body mb-2">
                                    {groupLabel(group)}
                                </h2>
                                <Table headers={TABLE_HEADERS}>
                                    {rows.map((cat, idx) => (
                                        <TableRow
                                            key={cat.id}
                                            index={idx + 1}
                                            row={cat}
                                            columns={[
                                                <span className="font-medium text-heading">{cat.name}</span>,
                                                <Badge color="info">
                                                    {appliesToLabel(cat.appliesTo)}
                                                </Badge>,
                                                cat.account
                                                    ? `${cat.account.code} — ${cat.account.name}`
                                                    : <span className="text-body">—</span>,
                                                cat.defaultTaxRate
                                                    ? `${cat.defaultTaxRate.name} (${cat.defaultTaxRate.rate}%)`
                                                    : <span className="text-body">—</span>,
                                                cat.taxApplicable ? (
                                                    <Badge color="success">Yes</Badge>
                                                ) : (
                                                    <Badge color="gray">No</Badge>
                                                ),
                                                cat.status ? (
                                                    <Badge color="success">Active</Badge>
                                                ) : (
                                                    <Badge color="danger">Disabled</Badge>
                                                ),
                                            ]}
                                            actions={[
                                                ...(canEdit
                                                    ? [
                                                          {
                                                              label: 'Edit',
                                                              icon: <Edit size={14} />,
                                                              onClick: (row: TransactionCategory) => openEdit(row),
                                                          },
                                                          {
                                                              label: cat.status ? 'Disable' : 'Enable',
                                                              onClick: (row: TransactionCategory) => handleToggleStatus(row),
                                                          },
                                                      ]
                                                    : []),
                                                ...(canDelete
                                                    ? [
                                                          {
                                                              label: 'Delete',
                                                              icon: <Trash2Icon size={14} />,
                                                              onClick: (row: TransactionCategory) => setDeleteTarget(row),
                                                          },
                                                      ]
                                                    : []),
                                            ]}
                                        />
                                    ))}
                                </Table>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Add / Edit modal */}
            <Modal
                isOpen={showModal}
                onClose={closeModal}
                title={editingId ? 'Edit Category' : 'Add Category'}
                size="lg"
            >
                <form onSubmit={handleSave} className="space-y-4">
                    {/* Name */}
                    <FormField
                        label="Name"
                        required
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Office Supplies"
                        error={fieldErrors.name}
                    />

                    {/* Group */}
                    <Select
                        label="Group"
                        required
                        value={form.group}
                        onChange={(e) =>
                            setForm((f) => ({ ...f, group: e.target.value as CategoryGroup }))
                        }
                        error={fieldErrors.group}
                        options={CATEGORY_GROUP_OPTIONS.map((g) => ({ value: g.value, label: g.label }))}
                    />

                    {/* Applies To */}
                    <Select
                        label="Applies To"
                        required
                        value={form.appliesTo}
                        onChange={(e) =>
                            setForm((f) => ({
                                ...f,
                                appliesTo: e.target.value as CategoryAppliesTo,
                            }))
                        }
                        error={fieldErrors.appliesTo}
                        options={APPLIES_TO_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    />

                    {/* Account */}
                    <Select
                        label="Account (Chart of Accounts)"
                        required
                        value={form.accountId}
                        onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                        error={fieldErrors.accountId}
                        options={[
                            { value: '', label: '— none —' },
                            ...accounts.map((acc) => ({ value: acc.id, label: `${acc.code} — ${acc.name}` })),
                        ]}
                    />

                    {/* Default Tax Rate */}
                    <Select
                        label="Default Tax Rate"
                        value={form.defaultTaxRateId}
                        onChange={(e) =>
                            setForm((f) => ({ ...f, defaultTaxRateId: e.target.value }))
                        }
                        error={fieldErrors.defaultTaxRateId}
                        options={[
                            { value: '', label: '— none —' },
                            ...taxRates.map((tr) => ({ value: tr.id, label: `${tr.name} (${tr.rate}%)` })),
                        ]}
                    />

                    {/* Tax Applicable */}
                    <div className="flex items-center gap-3">
                        <input
                            id="taxApplicable"
                            type="checkbox"
                            checked={form.taxApplicable}
                            onChange={(e) =>
                                setForm((f) => ({ ...f, taxApplicable: e.target.checked }))
                            }
                            className="h-4 w-4 rounded border-border text-purple-600 accent-purple-600"
                        />
                        <label htmlFor="taxApplicable" className="text-sm text-heading">
                            Tax Applicable
                        </label>
                    </div>

                    {/* Footer */}
                    <div className="flex justify-end gap-2 pt-2 border-t border-border">
                        <Button
                            type="button"
                            variant="white"
                            onClick={closeModal}
                        >
                            Cancel
                        </Button>
                        <SubmitButton isLoading={submitting} isDisabled={submitting}>
                            {submitting ? 'Saving…' : editingId ? 'Update' : 'Create'}
                        </SubmitButton>
                    </div>
                </form>
            </Modal>

            {/* Delete confirmation */}
            <DeleteConfirmationModal
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDeleteConfirm}
                isDeleting={isDeleting}
                title="Delete Category"
                message={
                    <span>
                        Delete <strong>{deleteTarget?.name}</strong>? If the category is in use you
                        will be asked to disable it instead.
                    </span>
                }
            />
        </div>
    );
};

export default TransactionCategoriesPage;
