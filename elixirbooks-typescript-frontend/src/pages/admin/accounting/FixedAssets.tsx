import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Constants from "../../../constants/api";
import axios, { AxiosError } from "axios";
import Table from "../../../components/admin/Table";
import PaginationWrapper from "../../../components/admin/PaginationWrapper";
import { Edit, Trash2, CirclePlusIcon, PlayCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import Modal from "../../../components/admin/Modal";
import { useSelector } from "react-redux";
import type { RootState } from "../../../store";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import TableRow from "@components/admin/TableRow";
import type { Action } from "@components/admin/tableActions";
import SubmitButton from "@components/admin/SubmitButton";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import InputField from "@components/admin/InputField";
import ReactDateInput from "@components/admin/ReactDateInput";
import useDateFormatter from "@hooks/useDateFormatter";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button, Badge } from "@components/ui";

const DEPRECIATION_METHODS = ["STRAIGHT_LINE"] as const;
type DepreciationMethod = typeof DEPRECIATION_METHODS[number];

interface IFixedAsset {
    id: string;
    name: string;
    cost: number;
    salvageValue: number;
    usefulLifeMonths: number;
    method: DepreciationMethod;
    acquisitionDate: string;
    postAcquisition?: boolean;
    accumulatedDepreciation?: number;
    status?: string;
    disposalDate?: string;
    disposalProceeds?: number;
}

interface DisposeForm {
    proceeds: string;
    tax: string;
    disposalDate: string;
}

interface DisposeFormErrors {
    proceeds?: string;
    tax?: string;
    disposalDate?: string;
}

interface Pagination {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

interface FormErrors {
    name?: string;
    cost?: string;
    salvageValue?: string;
    usefulLifeMonths?: string;
    acquisitionDate?: string;
}

interface IForm {
    id?: string;
    name: string;
    cost: string;
    salvageValue: string;
    usefulLifeMonths: string;
    method: DepreciationMethod;
    acquisitionDate: string;
    postAcquisition: boolean;
}

interface DeprecResult {
    assetId?: string;
    name?: string;
    amount?: number;
    [key: string]: unknown;
}

const emptyForm = (): IForm => ({
    name: "",
    cost: "",
    salvageValue: "",
    usefulLifeMonths: "",
    method: "STRAIGHT_LINE",
    acquisitionDate: "",
    postAcquisition: false,
});

const FixedAssets: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const [searchParams, setSearchParams] = useSearchParams();
    const { formatDate } = useDateFormatter();

    const [items, setItems] = useState<IFixedAsset[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, totalPages: 1 });
    const [form, setForm] = useState<IForm>(emptyForm());
    const [showModal, setShowModal] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [formErrors, setFormErrors] = useState<FormErrors>({});
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<IFixedAsset | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Dispose modal
    const todayStr = () => new Date().toISOString().substring(0, 10);
    const emptyDisposeForm = (): DisposeForm => ({ proceeds: "", tax: "", disposalDate: todayStr() });
    const [showDisposeModal, setShowDisposeModal] = useState(false);
    const [disposeAsset, setDisposeAsset] = useState<IFixedAsset | null>(null);
    const [disposeForm, setDisposeForm] = useState<DisposeForm>(emptyDisposeForm());
    const [disposeFormErrors, setDisposeFormErrors] = useState<DisposeFormErrors>({});
    const [isDisposing, setIsDisposing] = useState(false);

    // Run depreciation modal
    const [showDeprecModal, setShowDeprecModal] = useState(false);
    const [deprecAsOf, setDeprecAsOf] = useState<Date | null>(new Date());
    const [isRunningDeprec, setIsRunningDeprec] = useState(false);
    const [deprecResults, setDeprecResults] = useState<DeprecResult[] | null>(null);

    const search = searchParams.get("search") || "";
    const limit = Number(searchParams.get("limit") || 10);
    const page = Number(searchParams.get("page") || 1);
    const authHeaders = { Authorization: `Bearer ${token}` };

    const fetchItems = async (s?: string, l?: number, p?: number) => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.FETCH_FIXED_ASSETS_URL, {
                params: { search: s, limit: l, page: p },
                headers: authHeaders,
            });
            setItems(response.data.data || []);
            if (response.data.pagination) setPagination(response.data.pagination);
        } catch {
            toast.error("Failed to fetch fixed assets.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchItems(search, limit, page); }, [search, limit, page]);

    const handleSearch = (keyword: string) => setSearchParams({ search: keyword, limit: String(limit), page: "1" });
    const handlePageLengthChange = (newLimit: number) => setSearchParams({ search, limit: String(newLimit), page: "1" });
    const handlePageChange = (newPage: number) => setSearchParams({ search, limit: String(limit), page: String(newPage) });

    const openCreate = () => { setForm(emptyForm()); setIsEditMode(false); setFormErrors({}); setShowModal(true); };

    const openEdit = (item: IFixedAsset) => {
        setForm({
            id: item.id,
            name: item.name,
            cost: String(item.cost),
            salvageValue: String(item.salvageValue),
            usefulLifeMonths: String(item.usefulLifeMonths),
            method: item.method,
            acquisitionDate: item.acquisitionDate ? item.acquisitionDate.substring(0, 10) : "",
            postAcquisition: item.postAcquisition ?? false,
        });
        setIsEditMode(true);
        setFormErrors({});
        setShowModal(true);
    };

    const validate = (): boolean => {
        const errors: FormErrors = {};
        if (!form.name.trim()) errors.name = "Name is required.";
        if (!form.cost || isNaN(Number(form.cost))) errors.cost = "Valid cost is required.";
        if (!form.salvageValue || isNaN(Number(form.salvageValue))) errors.salvageValue = "Valid salvage value is required.";
        if (!form.usefulLifeMonths || isNaN(Number(form.usefulLifeMonths))) errors.usefulLifeMonths = "Valid useful life is required.";
        if (!form.acquisitionDate) errors.acquisitionDate = "Acquisition date is required.";
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validate()) return;
        try {
            setIsSaving(true);
            const payload = {
                name: form.name,
                cost: Number(form.cost),
                salvageValue: Number(form.salvageValue),
                usefulLifeMonths: Number(form.usefulLifeMonths),
                method: form.method,
                acquisitionDate: form.acquisitionDate,
                postAcquisition: form.postAcquisition,
            };
            if (isEditMode && form.id) {
                await axios.put(`${Constants.UPDATE_FIXED_ASSET_URL}/${form.id}`, payload, { headers: authHeaders });
                toast.success("Fixed asset updated successfully.");
            } else {
                await axios.post(Constants.CREATE_FIXED_ASSET_URL, payload, { headers: authHeaders });
                toast.success("Fixed asset created successfully.");
            }
            setShowModal(false);
            fetchItems(search, limit, page);
        } catch (error) {
            const axiosError = error as AxiosError<{ errors: FormErrors }>;
            if (axiosError.response?.data?.errors) {
                setFormErrors(axiosError.response.data.errors);
            } else {
                toast.error("Failed to save fixed asset.");
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteClick = (item: IFixedAsset) => { setItemToDelete(item); setDeleteModalOpen(true); };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            setIsDeleting(true);
            await axios.delete(`${Constants.DELETE_FIXED_ASSET_URL}/${itemToDelete.id}`, { headers: authHeaders });
            toast.success("Fixed asset deleted successfully.");
            fetchItems(search, limit, page);
            setDeleteModalOpen(false);
        } catch {
            toast.error("Failed to delete fixed asset.");
        } finally {
            setIsDeleting(false);
        }
    };

    const handleRunDepreciation = async () => {
        if (!deprecAsOf) { toast.error("Please select an 'as of' date."); return; }
        try {
            setIsRunningDeprec(true);
            const response = await axios.post(
                Constants.RUN_DEPRECIATION_URL,
                { asOf: deprecAsOf.toISOString().substring(0, 10) },
                { headers: authHeaders }
            );
            const results: DeprecResult[] = response.data?.data?.results || [];
            setDeprecResults(results);
            const count = results.length;
            toast.success(`Depreciation run complete — ${count} asset${count !== 1 ? "s" : ""} processed.`);
            fetchItems(search, limit, page);
        } catch {
            toast.error("Failed to run depreciation.");
        } finally {
            setIsRunningDeprec(false);
        }
    };

    const openDispose = (item: IFixedAsset) => {
        setDisposeAsset(item);
        setDisposeForm(emptyDisposeForm());
        setDisposeFormErrors({});
        setShowDisposeModal(true);
    };

    const validateDispose = (): boolean => {
        const errors: DisposeFormErrors = {};
        const p = Number(disposeForm.proceeds);
        const t = Number(disposeForm.tax || "0");
        if (!disposeForm.proceeds || isNaN(p) || p < 0) errors.proceeds = "Valid non-negative proceeds required.";
        if (disposeForm.tax && (isNaN(t) || t < 0)) errors.tax = "Tax must be non-negative.";
        if (!isNaN(p) && !isNaN(t) && t > p) errors.tax = "Tax must not exceed proceeds.";
        if (!disposeForm.disposalDate) errors.disposalDate = "Disposal date is required.";
        setDisposeFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleDispose = async () => {
        if (!disposeAsset || !validateDispose()) return;
        try {
            setIsDisposing(true);
            await axios.post(
                `${Constants.DISPOSE_FIXED_ASSET_URL}/${disposeAsset.id}/dispose`,
                {
                    proceeds: Number(disposeForm.proceeds),
                    tax: disposeForm.tax ? Number(disposeForm.tax) : 0,
                    disposalDate: disposeForm.disposalDate,
                },
                { headers: authHeaders }
            );
            toast.success(`Asset "${disposeAsset.name}" disposed successfully.`);
            setShowDisposeModal(false);
            fetchItems(search, limit, page);
        } catch {
            toast.error("Failed to dispose fixed asset.");
        } finally {
            setIsDisposing(false);
        }
    };

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);
    const dateFormat = systemSettings?.dateFormat?.format || "d-m-Y";

    const tableActions: Action<IFixedAsset>[] = [
        { label: "Edit", icon: <Edit size={14} />, primary: true, onClick: (item: IFixedAsset) => openEdit(item) },
        { label: "Delete", icon: <Trash2 size={14} />, primary: true, variant: "danger", onClick: (item: IFixedAsset) => handleDeleteClick(item) },
        {
            label: "Dispose",
            icon: <XCircle size={14} />,
            onClick: (item: IFixedAsset) => openDispose(item),
            isDisabled: (item: IFixedAsset) => item.status === "disposed",
        },
    ];

    const tableHeaders = ["#", "Name", "Cost", "Acquisition Date", "Accumulated Depr.", "Status", "Disposal Proceeds", "Actions"];

    return (
        <div className="space-y-4">
            <PageHeader title="Fixed Assets">
                <div className="flex items-center gap-2">
                    <Button
                        variant="warning"
                        onClick={() => { setDeprecResults(null); setShowDeprecModal(true); }}
                        leftIcon={<PlayCircle size={14} />}
                    >
                        Run Depreciation
                    </Button>
                    <Button onClick={openCreate} leftIcon={<CirclePlusIcon size={14} />}>
                        New Asset
                    </Button>
                </div>
            </PageHeader>

            <div className="flex flex-col md:flex-row justify-between gap-4">
                <input
                    type="text"
                    placeholder="Search assets..."
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
                {!isLoading && items.length > 0 &&
                    items.map((item, index) => (
                        <TableRow
                            key={item.id}
                            row={item}
                            index={index + 1}
                            columns={[
                                <span className="text-indigo-600 font-medium">{item.name}</span>,
                                Number(item.cost).toLocaleString(),
                                formatDate(item.acquisitionDate, dateFormat),
                                item.accumulatedDepreciation !== undefined ? Number(item.accumulatedDepreciation).toLocaleString() : "—",
                                item.status ? (
                                    <Badge
                                        color={item.status === "disposed" ? "danger" : item.status === "fully_depreciated" ? "warning" : "success"}
                                        className="capitalize"
                                    >
                                        {item.status.replace(/_/g, " ")}
                                    </Badge>
                                ) : "—",
                                item.disposalProceeds !== undefined ? Number(item.disposalProceeds).toLocaleString() : "—",
                            ]}
                            actions={tableActions}
                            onRowClick={(item) => openEdit(item)}
                        />
                    ))
                }
                {!isLoading && items.length === 0 && (
                    <tr><td className="text-center py-4 font-semibold text-gray-500" colSpan={8}>No Fixed Assets Found</td></tr>
                )}
                {isLoading && (
                    <tr key="loader"><td className="text-center py-2 font-semibold" colSpan={8}><LoaderSpinner /></td></tr>
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

            {/* Create / Edit Modal */}
            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={isEditMode ? "Edit Fixed Asset" : "Add New Fixed Asset"}>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <InputField
                        id="name"
                        label="Name"
                        placeholder="e.g., Office Laptop"
                        required
                        value={form.name}
                        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                        error={formErrors.name}
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <InputField
                            id="cost"
                            label="Cost"
                            placeholder="0.00"
                            type="number"
                            required
                            value={form.cost}
                            onChange={(e) => setForm((prev) => ({ ...prev, cost: e.target.value }))}
                            error={formErrors.cost}
                        />
                        <InputField
                            id="salvageValue"
                            label="Salvage Value"
                            placeholder="0.00"
                            type="number"
                            required
                            value={form.salvageValue}
                            onChange={(e) => setForm((prev) => ({ ...prev, salvageValue: e.target.value }))}
                            error={formErrors.salvageValue}
                        />
                        <InputField
                            id="usefulLifeMonths"
                            label="Useful Life (Months)"
                            placeholder="e.g., 60"
                            type="number"
                            required
                            value={form.usefulLifeMonths}
                            onChange={(e) => setForm((prev) => ({ ...prev, usefulLifeMonths: e.target.value }))}
                            error={formErrors.usefulLifeMonths}
                        />
                        <div>
                            <label htmlFor="method" className="block text-sm font-medium text-gray-700 mb-1">
                                Depreciation Method <span className="text-red-500">*</span>
                            </label>
                            <select
                                id="method"
                                value={form.method}
                                onChange={(e) => setForm((prev) => ({ ...prev, method: e.target.value as DepreciationMethod }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-950 focus:outline-none focus:ring-2 focus:ring-purple-600"
                            >
                                {DEPRECIATION_METHODS.map((m) => (
                                    <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div>
                        <ReactDateInput
                            label="Acquisition Date"
                            required
                            selected={form.acquisitionDate ? new Date(form.acquisitionDate) : null}
                            onChange={(date) => setForm((prev) => ({ ...prev, acquisitionDate: date ? date.toISOString().substring(0, 10) : "" }))}
                            id="acquisitionDate"
                        />
                        {formErrors.acquisitionDate && <p className="text-red-500 text-xs -mt-3">{formErrors.acquisitionDate}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="postAcquisition"
                            checked={form.postAcquisition}
                            onChange={(e) => setForm((prev) => ({ ...prev, postAcquisition: e.target.checked }))}
                            className="h-4 w-4 text-purple-600 border-gray-300 rounded"
                        />
                        <label htmlFor="postAcquisition" className="text-sm font-medium text-gray-700">Post acquisition journal entry</label>
                    </div>
                    <div className="flex justify-end pt-2 space-x-2">
                        <Button variant="white" onClick={() => setShowModal(false)}>Cancel</Button>
                        <SubmitButton isDisabled={isSaving} isLoading={isSaving} mode={isEditMode ? "edit" : "create"} />
                    </div>
                </form>
            </Modal>

            {/* Run Depreciation Modal */}
            <Modal isOpen={showDeprecModal} onClose={() => setShowDeprecModal(false)} title="Run Depreciation" size="md">
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">Calculate and post depreciation entries for all eligible assets up to the selected date.</p>
                    <ReactDateInput
                        label="As Of Date"
                        required
                        selected={deprecAsOf}
                        onChange={(date) => setDeprecAsOf(date)}
                        id="deprecAsOf"
                    />
                    {deprecResults && (
                        <div className="mt-2">
                            <p className="text-sm font-medium text-gray-700 mb-2">Results — {deprecResults.length} asset(s) processed</p>
                            {deprecResults.length > 0 && (
                                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
                                    {deprecResults.map((r, i) => (
                                        <div key={i} className="px-3 py-2 flex justify-between text-sm">
                                            <span className="text-gray-700">{r.name || r.assetId || `Asset ${i + 1}`}</span>
                                            <span className="font-medium text-gray-900">{r.amount !== undefined ? Number(r.amount).toLocaleString() : "—"}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {deprecResults.length === 0 && (
                                <p className="text-sm text-gray-500">No assets were due for depreciation.</p>
                            )}
                        </div>
                    )}
                    <div className="flex justify-end pt-2 space-x-2">
                        <Button variant="white" onClick={() => setShowDeprecModal(false)}>Close</Button>
                        <Button
                            variant="warning"
                            onClick={handleRunDepreciation}
                            disabled={isRunningDeprec}
                            isLoading={isRunningDeprec}
                            leftIcon={<PlayCircle size={14} />}
                        >
                            {isRunningDeprec ? 'Running...' : 'Run'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Dispose Asset Modal */}
            <Modal isOpen={showDisposeModal} onClose={() => setShowDisposeModal(false)} title={`Dispose Asset: ${disposeAsset?.name ?? ""}`} size="md">
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                        Post a gain/loss disposal entry and mark the asset disposed.
                        {disposeAsset && (
                            <span className="block mt-1 text-xs text-gray-500">
                                Cost: {Number(disposeAsset.cost).toLocaleString()} &middot; Acc. Depr.: {disposeAsset.accumulatedDepreciation !== undefined ? Number(disposeAsset.accumulatedDepreciation).toLocaleString() : "—"}
                            </span>
                        )}
                    </p>
                    <InputField
                        id="disposeProceeds"
                        label="Gross Proceeds (incl. tax)"
                        placeholder="0.00"
                        type="number"
                        required
                        value={disposeForm.proceeds}
                        onChange={(e) => setDisposeForm((prev) => ({ ...prev, proceeds: e.target.value }))}
                        error={disposeFormErrors.proceeds}
                    />
                    <InputField
                        id="disposeTax"
                        label="Tax on Proceeds"
                        placeholder="0.00"
                        type="number"
                        value={disposeForm.tax}
                        onChange={(e) => setDisposeForm((prev) => ({ ...prev, tax: e.target.value }))}
                        error={disposeFormErrors.tax}
                    />
                    <div>
                        <ReactDateInput
                            label="Disposal Date"
                            required
                            selected={disposeForm.disposalDate ? new Date(disposeForm.disposalDate) : null}
                            onChange={(date) => setDisposeForm((prev) => ({ ...prev, disposalDate: date ? date.toISOString().substring(0, 10) : "" }))}
                            id="disposeDate"
                        />
                        {disposeFormErrors.disposalDate && <p className="text-red-500 text-xs -mt-3">{disposeFormErrors.disposalDate}</p>}
                    </div>
                    <div className="flex justify-end pt-2 space-x-2">
                        <Button variant="white" onClick={() => setShowDisposeModal(false)}>Cancel</Button>
                        <Button
                            variant="danger"
                            onClick={handleDispose}
                            disabled={isDisposing}
                            isLoading={isDisposing}
                            leftIcon={<XCircle size={14} />}
                        >
                            {isDisposing ? 'Disposing...' : 'Dispose Asset'}
                        </Button>
                    </div>
                </div>
            </Modal>

            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={confirmDelete}
                isDeleting={isDeleting}
                title="Delete Fixed Asset"
                message="Are you sure you want to delete this fixed asset?"
            />
        </div>
    );
};

export default FixedAssets;
