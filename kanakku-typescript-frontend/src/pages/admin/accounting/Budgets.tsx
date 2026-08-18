import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Constants from "../../../constants/api";
import axios, { AxiosError } from "axios";
import Table from "../../../components/admin/Table";
import PaginationWrapper from "../../../components/admin/PaginationWrapper";
import { Edit, Trash2, CirclePlusIcon } from "lucide-react";
import { toast } from "sonner";
import Modal from "../../../components/admin/Modal";
import { useSelector } from "react-redux";
import type { RootState } from "../../../store";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import TableRow from "@components/admin/TableRow";
import SubmitButton from "@components/admin/SubmitButton";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import SearchableDropdown from "@components/admin/SearchableDropdown";
import ReactDateInput from "@components/admin/ReactDateInput";
import InputField from "@components/admin/InputField";
import type { SyntheticEvent } from "react";
import useDateFormatter from "@hooks/useDateFormatter";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button } from "@components/ui";

interface IAccount {
    id: string;
    name: string;
}

interface IBudget {
    id: string;
    accountId: string;
    account?: { id: string; name: string };
    periodStart: string;
    periodEnd: string;
    amount: number;
}

interface BudgetPagination {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

interface FormErrors {
    accountId?: string;
    periodStart?: string;
    periodEnd?: string;
    amount?: string;
}

interface IBudgetForm {
    id?: string;
    accountId: string;
    periodStart: string;
    periodEnd: string;
    amount: string;
}

const emptyForm = (): IBudgetForm => ({
    accountId: "",
    periodStart: "",
    periodEnd: "",
    amount: "",
});

const Budgets: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const [searchParams, setSearchParams] = useSearchParams();
    const { formatDate } = useDateFormatter();

    const [budgets, setBudgets] = useState<IBudget[]>([]);
    const [pagination, setPagination] = useState<BudgetPagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [accounts, setAccounts] = useState<IAccount[]>([]);
    const [form, setForm] = useState<IBudgetForm>(emptyForm());
    const [selectedAccount, setSelectedAccount] = useState<IAccount | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [formErrors, setFormErrors] = useState<FormErrors>({});
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<IBudget | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const search = searchParams.get("search") || "";
    const limit = Number(searchParams.get("limit") || 10);
    const page = Number(searchParams.get("page") || 1);

    const authHeaders = { Authorization: `Bearer ${token}` };

    const fetchBudgets = async (s?: string, l?: number, p?: number) => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.FETCH_BUDGETS_URL, {
                params: { search: s, limit: l, page: p },
                headers: authHeaders,
            });
            setBudgets(response.data.data || []);
            if (response.data.pagination) {
                setPagination(response.data.pagination);
            }
        } catch {
            toast.error("Failed to fetch budgets.");
        } finally {
            setIsLoading(false);
        }
    };

    const fetchAccounts = async () => {
        try {
            const response = await axios.get(Constants.GET_ACCOUNTS_URL, { headers: authHeaders });
            const list = response.data?.data?.accounts ?? [];
            setAccounts(list.map((a: any) => ({ id: a.id, name: a.name })));
        } catch {
            toast.error("Failed to load accounts.");
        }
    };

    useEffect(() => { fetchBudgets(search, limit, page); }, [search, limit, page]);
    useEffect(() => { fetchAccounts(); }, []);

    const handleSearch = (keyword: string) => {
        setSearchParams({ search: keyword, limit: String(limit), page: "1" });
    };

    const handlePageLengthChange = (newLimit: number) => {
        setSearchParams({ search, limit: String(newLimit), page: "1" });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams({ search, limit: String(limit), page: String(newPage) });
    };

    const openCreate = () => {
        setForm(emptyForm());
        setSelectedAccount(null);
        setIsEditMode(false);
        setFormErrors({});
        setShowModal(true);
    };

    const openEdit = (budget: IBudget) => {
        const acct = accounts.find((a) => a.id === budget.accountId) ||
            (budget.account ? { id: budget.account.id, name: budget.account.name } : null);
        setForm({
            id: budget.id,
            accountId: budget.accountId,
            periodStart: budget.periodStart ? budget.periodStart.substring(0, 10) : "",
            periodEnd: budget.periodEnd ? budget.periodEnd.substring(0, 10) : "",
            amount: String(budget.amount),
        });
        setSelectedAccount(acct);
        setIsEditMode(true);
        setFormErrors({});
        setShowModal(true);
    };

    const validate = (): boolean => {
        const errors: FormErrors = {};
        if (!form.accountId) errors.accountId = "Account is required.";
        if (!form.periodStart) errors.periodStart = "Period start is required.";
        if (!form.periodEnd) errors.periodEnd = "Period end is required.";
        if (!form.amount || isNaN(Number(form.amount))) errors.amount = "Valid amount is required.";
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validate()) return;
        try {
            setIsSaving(true);
            const payload = {
                accountId: form.accountId,
                periodStart: form.periodStart,
                periodEnd: form.periodEnd,
                amount: Number(form.amount),
            };
            if (isEditMode && form.id) {
                await axios.put(`${Constants.UPDATE_BUDGET_URL}/${form.id}`, payload, { headers: authHeaders });
                toast.success("Budget updated successfully.");
            } else {
                await axios.post(Constants.CREATE_BUDGET_URL, payload, { headers: authHeaders });
                toast.success("Budget created successfully.");
            }
            setShowModal(false);
            fetchBudgets(search, limit, page);
        } catch (error) {
            const axiosError = error as AxiosError<{ errors: FormErrors }>;
            if (axiosError.response?.data?.errors) {
                setFormErrors(axiosError.response.data.errors);
            } else {
                toast.error("Failed to save budget.");
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteClick = (budget: IBudget) => {
        setItemToDelete(budget);
        setDeleteModalOpen(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_BUDGET_URL}/${itemToDelete.id}`, { headers: authHeaders });
            toast.success("Budget deleted successfully.");
            fetchBudgets(search, limit, page);
            setDeleteModalOpen(false);
        } catch {
            toast.error("Failed to delete budget.");
        } finally {
            setIsDeleting(false);
        }
    };

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    const tableActions = [
        { label: "Edit", icon: <Edit size={14} />, onClick: (item: IBudget) => openEdit(item) },
        { label: "Delete", icon: <Trash2 size={14} />, onClick: (item: IBudget) => handleDeleteClick(item) },
    ];

    const tableHeaders = ["#", "Account", "Period Start", "Period End", "Amount", "Actions"];

    return (
        <div className="space-y-4">
            <PageHeader title="Budgets">
                <Button onClick={openCreate} leftIcon={<CirclePlusIcon size={14} />}>
                    New Budget
                </Button>
            </PageHeader>

            <div className="flex flex-col md:flex-row justify-between gap-4">
                <input
                    type="text"
                    placeholder="Search budgets..."
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="border border-gray-300 rounded-md px-4 py-2 w-full md:w-64 text-gray-950 focus:outline-none focus:ring-2 focus:ring-purple-600"
                />
                <select
                    value={limit}
                    onChange={(e) => handlePageLengthChange(Number(e.target.value))}
                    className="border border-gray-300 px-3 py-2 rounded-md bg-white text-gray-950 focus:outline-none focus:ring-2 focus:ring-purple-600"
                >
                    {[10, 25, 50].map((num) => (
                        <option key={num} value={num}>{num} / page</option>
                    ))}
                </select>
            </div>

            <Table headers={tableHeaders}>
                {!isLoading && budgets.length > 0 &&
                    budgets.map((budget, index) => (
                        <TableRow
                            key={budget.id}
                            row={budget}
                            index={index + 1}
                            columns={[
                                <span className="text-indigo-600">{budget.account?.name || budget.accountId}</span>,
                                formatDate(budget.periodStart, systemSettings?.dateFormat?.format || "d-m-Y"),
                                formatDate(budget.periodEnd, systemSettings?.dateFormat?.format || "d-m-Y"),
                                Number(budget.amount).toLocaleString(),
                            ]}
                            actions={tableActions}
                        />
                    ))
                }
                {!isLoading && budgets.length === 0 && (
                    <tr><td className="text-center py-4 font-semibold text-gray-500" colSpan={6}>No Budgets Found</td></tr>
                )}
                {isLoading && (
                    <tr key="loader"><td className="text-center py-2 text-gray-950 font-semibold" colSpan={6}><LoaderSpinner /></td></tr>
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

            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={isEditMode ? "Edit Budget" : "Add New Budget"}>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <SearchableDropdown
                        label="Account"
                        required
                        value={selectedAccount}
                        options={accounts}
                        onChange={(_e: SyntheticEvent, val: IAccount | null) => {
                            setSelectedAccount(val);
                            setForm((prev) => ({ ...prev, accountId: val?.id || "" }));
                        }}
                        placeholder="Select account"
                    />
                    {formErrors.accountId && <p className="text-red-500 text-xs -mt-2">{formErrors.accountId}</p>}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <ReactDateInput
                                label="Period Start"
                                required
                                selected={form.periodStart ? new Date(form.periodStart) : null}
                                onChange={(date) => setForm((prev) => ({ ...prev, periodStart: date ? date.toISOString().substring(0, 10) : "" }))}
                                id="periodStart"
                            />
                            {formErrors.periodStart && <p className="text-red-500 text-xs -mt-3">{formErrors.periodStart}</p>}
                        </div>
                        <div>
                            <ReactDateInput
                                label="Period End"
                                required
                                selected={form.periodEnd ? new Date(form.periodEnd) : null}
                                onChange={(date) => setForm((prev) => ({ ...prev, periodEnd: date ? date.toISOString().substring(0, 10) : "" }))}
                                id="periodEnd"
                            />
                            {formErrors.periodEnd && <p className="text-red-500 text-xs -mt-3">{formErrors.periodEnd}</p>}
                        </div>
                    </div>

                    <InputField
                        id="amount"
                        label="Amount"
                        placeholder="0.00"
                        type="number"
                        required
                        value={form.amount}
                        onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                        error={formErrors.amount}
                    />

                    <div className="flex justify-end pt-2 space-x-2">
                        <Button variant="white" onClick={() => setShowModal(false)}>Cancel</Button>
                        <SubmitButton isDisabled={isSaving} isLoading={isSaving} mode={isEditMode ? "edit" : "create"} />
                    </div>
                </form>
            </Modal>

            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={confirmDelete}
                isDeleting={isDeleting}
                title="Delete Budget"
                message="Are you sure you want to delete this budget?"
            />
        </div>
    );
};

export default Budgets;
