import React, { type FC, useState, useEffect } from "react";
import { useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import axios, { AxiosError } from "axios";
import { toast } from "sonner";
import { Edit, Trash2Icon, CirclePlusIcon, EyeIcon, RotateCcw, Scale } from "lucide-react";
import Modal from "@components/admin/Modal";
import Table from "@components/admin/Table";
import TableRow, { type Action } from "@components/admin/TableRow";
import Switch from "@components/admin/Switch";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import Constants from "@constants/api";
import type { RootState } from "@store/index";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import { hasPermission } from "@utils/hasPermission";
import SubmitButton from "@components/admin/SubmitButton";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import SmartDropdown from "@components/admin/SmartDropdown";
import type { OptionType, Pagination } from "@models/common";
import { useCurrencies } from "@hooks/useCurrencies";
import CurrencySelect from "@components/admin/CurrencySelect";
import { BANK_CODE_TYPES, getBankCodeType } from "@constants/bankCodeTypes";
import type { BankAccount, BankAccountFormData } from "@models/bank-account";
import BankAccountDetailsModal from "./BankAccountDetailsModal";
import AdjustBalanceModal from "./AdjustBalanceModal";
import { Button, FormField, PageSizeSelect, Select } from "@components/ui";
import { PageHeader } from "@/context/PageHeaderContext";

const bankAccountTypes: OptionType[] = [
    { id: "savings", name: "Savings" },
    { id: "current", name: "Current" },
];
const initialFormData: BankAccountFormData = {
    userId: "",
    accountHoldername: "",
    bankName: "",
    branchName: "",
    accountNumber: "",
    IFSCCode: "",
    status: true,
    accountType: "",
    bankCodeType: "IFSC",
    openingBalance: 0,
    currencyCode: "",
};

const BankAccountList: FC = () => {
    const { token, user } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    initialFormData.userId = user.id;
    const [searchParams, setSearchParams] = useSearchParams();
    const [showModal, setShowModal] = useState<boolean>(false);
    const [isEditMode, setIsEditMode] = useState<boolean>(false);
    const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
    const [itemToDelete, setItemToDelete] = useState<BankAccount | null>(null);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [formData, setFormData] = useState<BankAccountFormData>(initialFormData);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const search = searchParams.get('search') || '';
    const limit = Number(searchParams.get('limit') || 10);
    const page = Number(searchParams.get('page') || 1);
    const [isDeleting, setIsDeleting] = useState(false);
    const [accountTypeSearchInput, setAccountTypeSearchInput] = useState<string>("");
    const { formatMoney, defaultCurrencyCode } = useCurrencies();
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [itemToView, setItemToView] = useState<BankAccount | null>(null);
    const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
    const [itemToAdjust, setItemToAdjust] = useState<BankAccount | null>(null);
    // Active vs Deleted view. Deleted accounts are hidden from the normal list
    // (soft-deleted) but can be surfaced here and restored.
    const [showDeleted, setShowDeleted] = useState<boolean>(false);
    const fetchBankAccounts = async (currentSearch = search, currentLimit = limit, currentPage = page) => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.GET_BANK_ACCOUNTS_URL, {
                params: {
                    search: currentSearch,
                    limit: currentLimit,
                    page: currentPage,
                    ...(showDeleted ? { deleted: 'true' } : {}),
                },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setBankAccounts(response.data.data.bankDetails);
            if (response.data.data.pagination) setPagination(response.data.data.pagination);
        } catch (error) {
            console.error("Error fetching bank accounts:", error);
            toast.error("Failed to fetch bank accounts.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchBankAccounts();
    }, [search, limit, page, token, showDeleted]);

    const handleViewChange = (deleted: boolean) => {
        if (deleted === showDeleted) return;
        setShowDeleted(deleted);
        // Reset to page 1 when switching views so pagination stays consistent.
        setSearchParams({ search, limit: String(limit), page: '1' });
    };

    const handleRestore = async (account: BankAccount) => {
        try {
            await axios.patch(`${Constants.RESTORE_BANK_ACCOUNT_URL}/${account.id}`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Bank account restored successfully');
            fetchBankAccounts();
        } catch (error) {
            const message = error instanceof AxiosError
                ? (error.response?.data as { message?: string } | undefined)?.message
                : undefined;
            toast.error(message || 'Failed to restore bank account.');
        }
    };

    // --- Search and Pagination Handlers ---
    const handleSearch = (keyword: string) => {
        setSearchParams({ search: keyword, limit: String(limit), page: '1' });
    };

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ search, limit: String(newLimit), page: '1' });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ search, limit: String(limit), page: String(newPage) });
    };

    const openCreate = () => {
        setIsEditMode(false);
        setFormData({ ...initialFormData, currencyCode: defaultCurrencyCode });
        setFormErrors({});
        setShowModal(true);
    };

    const handleEditClick = (item: BankAccount) => {
        setFormData({
            ...item,
            bankCodeType: item.bankCodeType || "IFSC",
            currencyCode: item.currencyCode || defaultCurrencyCode,
        });
        setIsEditMode(true);
        setFormErrors({});
        setShowModal(true);
    };

    const handleDeleteClick = (account: BankAccount) => {
        setItemToDelete(account);
        setShowDeleteModal(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_BANK_ACCOUNT_URL}/${itemToDelete.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Bank account deleted successfully');
            fetchBankAccounts();
            setShowDeleteModal(false);
            setItemToDelete(null);
        } catch (error) {
            console.error('Failed to delete bank account:', error);
            toast.error('Failed to delete bank account.');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleStatusChange = async (id: string, newStatus: boolean) => {
        setBankAccounts(prev =>
            prev.map(acc =>
                acc.id === id ? { ...acc, status: newStatus } : acc
            )
        );
        try {
            await axios.patch(`${Constants.UPDATE_BANK_ACCOUNT_STATUS_URL}/${id}`, { status: newStatus }, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            toast.success('Status updated successfully');
            fetchBankAccounts();
        } catch (error) {
            toast.error('Failed to update status.');
            fetchBankAccounts();
        }
    };

    // Inline row-end buttons (View / Edit / Delete, or View / Restore for deleted),
    // matching the other admin list pages. TableRow filters by requirePermission and
    // handles click-propagation, so no hand-rolled permission filtering is needed.
    // Restore reuses the 'edit' permission (un-deleting is an edit-level action).
    const tableActions: Action<BankAccount>[] = showDeleted
        ? [
            { label: 'View', icon: <EyeIcon size={14} />, primary: true, onClick: (item) => handleViewDetails(item) },
            { label: 'Restore', icon: <RotateCcw size={14} />, primary: true, requirePermission: { moduleSlug: 'finance-settings', action: 'edit' }, onClick: (item) => handleRestore(item) },
        ]
        : [
            { label: 'View', icon: <EyeIcon size={14} />, primary: true, onClick: (item) => handleViewDetails(item) },
            { label: 'Edit', icon: <Edit size={14} />, primary: true, requirePermission: { moduleSlug: 'finance-settings', action: 'edit' }, onClick: (item) => handleEditClick(item) },
            // Opening balance is locked; adjust the current balance via a manual txn instead.
            { label: 'Adjust balance', icon: <Scale size={14} />, requirePermission: { moduleSlug: 'finance-settings', action: 'edit' }, onClick: (item) => handleAdjustClick(item) },
            { label: 'Delete', icon: <Trash2Icon size={14} />, primary: true, variant: 'danger', requirePermission: { moduleSlug: 'finance-settings', action: 'delete' }, onClick: (item) => handleDeleteClick(item) },
        ];
    const tableHeaders = ["#", "Bank Name", "Account Holder", "Account Number", "Currency", "Current Balance", "Bank Code", "Status", "Actions"]

    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};
        if (!formData.accountHoldername.trim()) newErrors.accountHoldername = 'Account holder name is required.';
        if (!formData.bankName.trim()) newErrors.bankName = 'Bank name is required.';
        if (!formData.branchName.trim()) {
            newErrors.branchName = 'Branch name is required.';
        } else if (formData.branchName.trim().length < 2) {
            newErrors.branchName = 'Branch name must be at least 2 characters.';
        }
        if (!formData.accountNumber.trim()) {
            newErrors.accountNumber = 'Account number is required.';
        } else if (formData.accountNumber.trim().length < 5) {
            newErrors.accountNumber = 'Account number must be at least 5 characters.';
        }
        if (!formData.IFSCCode.trim()) {
            newErrors.IFSCCode = `${getBankCodeType(formData.bankCodeType).label} is required.`;
        } else if (formData.IFSCCode.trim().length < 4) {
            newErrors.IFSCCode = `${getBankCodeType(formData.bankCodeType).label} must be at least 4 characters.`;
        }
        if (!formData.accountType) newErrors.accountType = 'Account type is required.';
        if (formData.openingBalance === undefined || formData.openingBalance === null || String(formData.openingBalance).trim() === '') {
            newErrors.openingBalance = 'Opening balance is required.';
        } else if (formData.openingBalance < 0) {
            newErrors.openingBalance = 'Opening balance cannot be negative.';
        } else if (formData.openingBalance > 9999999999) {
            newErrors.openingBalance = 'Opening balance cannot exceed 9,999,999,999.';
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
    const handleOptionTypeChange = (option: OptionType | null) => {
        if (option) {
            setFormData(prev => ({
                ...prev,
                accountType: option.id,
            }));
        }
    }
    const handleCurrencyChange = (code: string) => {
        setFormData(prev => ({ ...prev, currencyCode: code }));
    }
    const handleBankCodeTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setFormData(prev => ({ ...prev, bankCodeType: e.target.value }));
    }
    const handleViewDetails = (item: BankAccount) => {
        setItemToView(item);
        setIsDetailsModalOpen(true);
    }
    const handleAdjustClick = (item: BankAccount) => {
        setItemToAdjust(item);
        setIsAdjustModalOpen(true);
    }
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateForm()) return;

        const payload = {
            ...formData,
            IFSCCode: formData.IFSCCode.toUpperCase()
        };

        try {
            setIsSaving(true);
            if (isEditMode) {
                await axios.put(`${Constants.UPDATE_BANK_ACCOUNT_URL}/${formData.id}`, payload, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                toast.success('Bank account updated successfully');
            } else {
                await axios.post(Constants.CREATE_BANK_ACCOUNT_URL, payload, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                toast.success('Bank account created successfully');
            }
            fetchBankAccounts();
            setShowModal(false);
        } catch (error: any | AxiosError) {
            const serverErrors = error?.response?.data?.errors;
            const serverMessage = error?.response?.data?.message;
            if (serverErrors) setFormErrors(serverErrors);
            toast.error(serverMessage || 'Something went wrong. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    return (
        <div className="space-y-4">
            <PageHeader title="Bank Accounts">
                {!showDeleted && hasPermission(permissions, 'finance-settings', 'create') && (
                    <Button
                        variant="primary"
                        onClick={openCreate}
                        leftIcon={<CirclePlusIcon size={14} />}>
                        New Bank Account
                    </Button>
                )}
            </PageHeader>

            {/* Active / Deleted view toggle */}
            <div className="inline-flex rounded-md border border-gray-200 p-0.5">
                <button
                    type="button"
                    onClick={() => handleViewChange(false)}
                    className={`px-4 py-1.5 text-sm font-medium rounded ${!showDeleted ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                    Active
                </button>
                <button
                    type="button"
                    onClick={() => handleViewChange(true)}
                    className={`px-4 py-1.5 text-sm font-medium rounded ${showDeleted ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                    Deleted
                </button>
            </div>

            {/* Search and Page Length */}
            <div className="flex justify-between items-center">
                <FormField
                    type="text"
                    placeholder="Search bank accounts..."
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                    containerClassName="w-full md:w-64"
                />
                <PageSizeSelect value={limit} onChange={handlePageLengthChange} />
            </div>

            {/* Table */}
            <Table headers={tableHeaders}>
                {!isLoading && bankAccounts && bankAccounts.length > 0 && bankAccounts.map((acc, index) => (
                    <TableRow
                        key={acc.id}
                        index={from + index}
                        row={acc}
                        onRowClick={(item) => handleViewDetails(item)}
                        columns={[
                            <span className="text-primary capitalize font-medium">{acc.bankName}</span>,
                            acc.accountHoldername,
                            acc.accountNumber,
                            acc.currencyCode || defaultCurrencyCode,
                            formatMoney(acc.currentBalance ?? 0, acc.currencyCode),
                            acc.IFSCCode,
                            showDeleted
                                ? <span className="inline-flex items-center rounded-full bg-destructive-soft px-2.5 py-0.5 text-xs font-medium text-destructive-strong">Deleted</span>
                                : <span onClick={(e) => e.stopPropagation()}><Switch name={`status-${acc.id}`} checked={acc.status} onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleStatusChange(acc.id, e.target.checked)} disabled={!hasPermission(permissions, 'finance-settings', 'edit')} /></span>,
                        ]}
                        actions={tableActions}
                    />
                ))}

                {!isLoading && bankAccounts && bankAccounts.length === 0 &&
                    <tr>
                        <td colSpan={9} className="text-center py-4 text-muted-foreground font-medium">{showDeleted ? 'No Deleted Bank Accounts Found' : 'No Bank Accounts Found'}</td>
                    </tr>
                }

                {isLoading && (
                    <tr key="table-loader">
                        <td className="text-center py-2 text-foreground font-semibold" colSpan={9}>
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
            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={isEditMode ? 'Update Bank Account' : 'Create Bank Account'}>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <FormField
                            label="Account Holder Name"
                            required
                            name="accountHoldername"
                            value={formData.accountHoldername}
                            onChange={handleChange}
                            type="text"
                            placeholder="Enter Account Holder Name"
                            error={formErrors.accountHoldername}
                        />
                        <FormField
                            label="Bank Name"
                            required
                            name="bankName"
                            value={formData.bankName}
                            onChange={handleChange}
                            type="text"
                            placeholder="Enter Bank Name"
                            error={formErrors.bankName}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <FormField
                            label="Branch Name"
                            required
                            name="branchName"
                            value={formData.branchName}
                            onChange={handleChange}
                            type="text"
                            placeholder="Enter Branch Name"
                            error={formErrors.branchName}
                        />

                        {/* accountType */}
                        <FormField label="Account Type" required error={formErrors.accountType}>
                            {() => (
                                <SmartDropdown
                                    items={bankAccountTypes}
                                    value={accountTypeSearchInput}
                                    onChange={(value) => setAccountTypeSearchInput(value)}
                                    onSelect={(option) => handleOptionTypeChange(option as OptionType)}
                                    selectedItem={bankAccountTypes.find(option => option.id == formData.accountType) || null}
                                    placeholder="Select Account Type"
                                    serverside={false}
                                />
                            )}
                        </FormField>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <FormField
                            label="Account Number"
                            required
                            name="accountNumber"
                            value={formData.accountNumber}
                            onChange={handleChange}
                            type="text"
                            placeholder="Enter Account Number"
                            error={formErrors.accountNumber}
                        />

                        <Select
                            label="Bank Code Type"
                            name="bankCodeType"
                            value={formData.bankCodeType || "IFSC"}
                            onChange={handleBankCodeTypeChange}
                            options={BANK_CODE_TYPES.map((t) => ({ value: t.id, label: t.label }))}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        {/* Bank Code (label + placeholder adapt to selected type) */}
                        <FormField
                            label={getBankCodeType(formData.bankCodeType).label}
                            required
                            name="IFSCCode"
                            value={formData.IFSCCode}
                            onChange={handleChange}
                            type="text"
                            placeholder={getBankCodeType(formData.bankCodeType).placeholder}
                            error={formErrors.IFSCCode}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <FormField
                            label="Opening Balance"
                            required
                            placeholder="Enter Opening Balance"
                            disabled={isEditMode}
                            type="number"
                            name="openingBalance"
                            value={formData.openingBalance}
                            onChange={handleChange}
                            error={formErrors.openingBalance}
                        />

                        {/* Currency */}
                        <div>
                            <CurrencySelect
                                label="Currency"
                                value={formData.currencyCode || defaultCurrencyCode}
                                onChange={handleCurrencyChange}
                            />
                            {formErrors.currencyCode && <p className="text-sm text-destructive mt-1">{formErrors.currencyCode}</p>}
                        </div>
                    </div>

                    {/* Status Switch */}
                    <div className="flex items-center gap-3 pt-2">
                        <label htmlFor="status" className="font-medium text-sm text-foreground">Status</label>
                        <Switch name="status" checked={formData.status ?? false} onChange={handleChange} />
                    </div>

                    {/* Buttons */}
                    <div className="flex justify-end pt-4 space-x-2">
                        <Button type="button" variant="white" onClick={() => setShowModal(false)}>Cancel</Button>
                        <SubmitButton isDisabled={isSaving} isLoading={isSaving} mode={isEditMode ? "edit" : "create"} />
                    </div>
                </form>
            </Modal>

            {/* Delete Confirmation Modal */}
            <DeleteConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={confirmDelete}
                isDeleting={isDeleting}
                title="Delete Account"
                message={`Are you sure you want to delete the account for ${itemToDelete?.accountHoldername}? This action cannot be undone.`}
            />
            {/* Details Modal */}
            {isDetailsModalOpen && itemToView && (
                <BankAccountDetailsModal isOpen={isDetailsModalOpen} onClose={() => setIsDetailsModalOpen(false)} bankAccount={itemToView} />
            )}

            {/* Adjust Balance Modal */}
            <AdjustBalanceModal
                isOpen={isAdjustModalOpen}
                onClose={() => setIsAdjustModalOpen(false)}
                onSuccess={() => fetchBankAccounts()}
                bankAccount={itemToAdjust}
            />
        </div>
    );
};

export default BankAccountList;