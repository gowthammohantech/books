import React from "react";
import {
    CheckIcon,
    CirclePlusIcon,
    LinkIcon,
    PencilIcon,
    SearchIcon,
    SparklesIcon,
    Trash2Icon,
    Undo2Icon,
    Unlink2Icon,
    Upload,
    X,
    XIcon,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import type { RootState } from "@store/index";
import Constants from "@constants/api";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import axios from "axios";
import Table from "@components/admin/Table";
import TableRow from "@components/admin/TableRow";
import type { Action } from "@components/admin/tableActions";
import PaginationWrapper from "@components/admin/PaginationWrapper";
import DeleteConfirmationModal from "@components/admin/DeleteConfirmationModal";
import ExportButton from "@components/admin/ExportButton";
import LoaderSpinner from "@components/admin/LoaderSpinner";
import NoRecords from "@components/admin/NoRecords";
import DateInput from "@components/admin/DateInput";
import Modal from "@components/admin/Modal";
import { ymdStringToDate, dateToYmdString } from "@utils/converters";
import useDateFormatter from "@hooks/useDateFormatter";
import { useTransactionCategories } from "@hooks/useTransactionCategories";
import type {
    BankTransactionRow,
    BankTransactionPreviewRow,
    BankTransactionType,
} from "@/types/bankTransaction";
import { BANK_TXN_RELATED_TYPE_LABEL, canOfferExplain, isBankTxnPaymentBorn } from "@/types/bankTransaction";
import ExplainTransactionForm from "./ExplainTransactionForm";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button, FormField, Select, Badge, fieldControlClasses } from "@components/ui";

interface PaginationData {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

interface CountsData {
    unexplained: number;
    forApproval: number;
    all: number;
}

interface BankAccountOption {
    id: string;
    bankName: string;
    accountNumber: string;
    accountHoldername?: string;
}

type TypeFilter = "all" | BankTransactionType;
type ReconciledFilter = "all" | "true" | "false";
type ExplainStatusFilter = "UNEXPLAINED" | "FOR_APPROVAL" | "";

const TYPE_PILLS: TypeFilter[] = ["all", "DEPOSIT", "WITHDRAWAL", "TRANSFER_IN", "TRANSFER_OUT"];

const typeLabel: Record<string, string> = {
    DEPOSIT: "Deposit",
    WITHDRAWAL: "Withdrawal",
    TRANSFER_IN: "Transfer In",
    TRANSFER_OUT: "Transfer Out",
    PAYMENT: "Payment",
    RECEIPT: "Receipt",
};

const typeBadgeColor = (t: string): "success" | "danger" | "gray" => {
    if (t === "DEPOSIT" || t === "TRANSFER_IN" || t === "RECEIPT") return "success";
    if (t === "WITHDRAWAL" || t === "TRANSFER_OUT" || t === "PAYMENT") return "danger";
    return "gray";
};

const explainStatusBadgeColor = (status: BankTransactionRow["explainStatus"]): "success" | "warning" | "gray" => {
    if (status === "EXPLAINED") return "success";
    if (status === "FOR_APPROVAL") return "warning";
    return "gray";
};

const explainStatusLabel = (status: BankTransactionRow["explainStatus"]): string => {
    if (status === "EXPLAINED") return "Explained";
    if (status === "FOR_APPROVAL") return "For approval";
    return "Unexplained";
};

const formatAmount = (amount: string | number, currencyCode: string | null): string => {
    const num = Number(amount).toFixed(2);
    if (currencyCode) return `${currencyCode} ${num}`;
    return num;
};

// Tabs config
interface TabDef {
    label: string;
    value: ExplainStatusFilter;
    countKey: keyof CountsData;
}

const TABS: TabDef[] = [
    { label: "For approval", value: "FOR_APPROVAL", countKey: "forApproval" },
    { label: "Unexplained", value: "UNEXPLAINED", countKey: "unexplained" },
    { label: "All", value: "", countKey: "all" },
];

// Per-bank tally row (subset of /reports/tally-check `data.bank[]`).
interface TallyBankRow {
    bankAccountId: string;
    name: string;
    currentBalance: number;
    sumExplained: number;
    currentVsExplainedTied: boolean;
}

const BankTransactionList: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { formatDate } = useDateFormatter();
    // Optional route param: when present (`/admin/banking/:bankId`) the list is
    // locked to that bank; absent (`/admin/banking/transactions`) = all banks.
    const { bankId } = useParams<{ bankId?: string }>();
    const [rows, setRows] = useState<BankTransactionRow[]>([]);
    const [pagination, setPagination] = useState<PaginationData>({
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 1,
    });
    const [counts, setCounts] = useState<CountsData>({ unexplained: 0, forApproval: 0, all: 0 });
    const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
    const [bankAccountFilter, setBankAccountFilter] = useState<string>("");
    // Per-bank tally summary (only fetched when bank-scoped).
    const [tallyRow, setTallyRow] = useState<TallyBankRow | null>(null);
    // When bank-scoped, this is the locked filter applied to every fetch.
    const effectiveBankFilter = bankId ?? bankAccountFilter;
    const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
    const [reconciledFilter, setReconciledFilter] = useState<ReconciledFilter>("all");
    const [explainStatusFilter, setExplainStatusFilter] = useState<ExplainStatusFilter>("UNEXPLAINED");
    // Search (debounced) + category filters.
    const [searchInput, setSearchInput] = useState<string>("");
    const [search, setSearch] = useState<string>("");
    const [categoryId, setCategoryId] = useState<string>("");
    const { categories } = useTransactionCategories();
    const [page, setPage] = useState<number>(1);
    const [limit, setLimit] = useState<number>(10);
    const [isLoading, setIsLoading] = useState(false);
    // Per-row action in-flight ids (approve/reject/analyse) so double-clicks
    // don't double-submit; "all" key guards the Analyse-all button.
    const [actioningId, setActioningId] = useState<string | null>(null);

    // Inline expand state
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Delete state
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteItem, setDeleteItem] = useState<BankTransactionRow | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Suggest-matches modal state
    interface SuggestMatchRow {
        candidateId: string;
        kind: 'INVOICE_PAYMENT' | 'SUPPLIER_PAYMENT';
        amount: number;
        date: string;
        reference: string;
        parentLabel: string;
        score: number;
        reasons: string[];
    }
    interface SuggestModalState {
        txnId: string;
        matches: SuggestMatchRow[];
    }
    const [suggestModalState, setSuggestModalState] = useState<SuggestModalState | null>(null);
    const [isLoadingMatches, setIsLoadingMatches] = useState(false);

    // Add transaction modal state
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [addForm, setAddForm] = useState<{
        bankAccountId: string;
        transactionDate: string;
        type: BankTransactionType;
        amount: string;
        remarks: string;
    }>({
        bankAccountId: "",
        transactionDate: new Date().toISOString().slice(0, 10),
        type: "DEPOSIT",
        amount: "",
        remarks: "",
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    // CSV import modal state
    const [importStep, setImportStep] = useState<"closed" | "upload" | "preview" | "done">("closed");
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importBankAccountId, setImportBankAccountId] = useState<string>("");
    const [previewRows, setPreviewRows] = useState<BankTransactionPreviewRow[]>([]);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [isConfirming, setIsConfirming] = useState(false);

    // Ledger-not-configured banner state
    const [showLedgerBanner, setShowLedgerBanner] = useState(false);

    const fetchLedgerStatus = async () => {
        try {
            const response = await axios.get(Constants.FETCH_LEDGER_STATUS_URL, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const configured = response.data?.data?.configured;
            if (configured === false) {
                setShowLedgerBanner(true);
            }
        } catch {
            // Fail closed: don't show banner if status call fails
        }
    };

    const fetchBankAccounts = async () => {
        try {
            const response = await axios.get(Constants.GET_BANK_ACCOUNTS_URL, {
                params: { limit: 100, page: 1 },
                headers: { Authorization: `Bearer ${token}` },
            });
            const list = (response.data?.data?.bankDetails ?? []) as BankAccountOption[];
            setBankAccounts(list);
        } catch (err) {
            console.error("fetchBankAccounts error:", err);
        }
    };

    const fetchRows = async () => {
        try {
            setIsLoading(true);
            const params: Record<string, string | number> = { page, limit };
            if (effectiveBankFilter) params.bankAccountId = effectiveBankFilter;
            if (typeFilter !== "all") params.type = typeFilter;
            if (reconciledFilter !== "all") params.isReconciled = reconciledFilter;
            if (explainStatusFilter !== "") params.explainStatus = explainStatusFilter;
            if (search.trim()) params.search = search.trim();
            if (categoryId) params.categoryId = categoryId;
            const response = await axios.get(Constants.GET_BANK_TRANSACTIONS_URL, {
                params,
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = response.data?.data;
            setRows(data?.bankTransactions ?? []);
            setPagination(
                data?.pagination ?? { total: 0, page: 1, limit: 10, totalPages: 1 },
            );
            if (data?.counts) {
                setCounts(data.counts as CountsData);
            }
        } catch (err) {
            console.error("fetchRows error:", err);
            toast.error("Failed to fetch bank transactions.");
        } finally {
            setIsLoading(false);
        }
    };

    // Per-bank tally summary for the bank-scoped header badge.
    const fetchTally = async () => {
        if (!bankId) {
            setTallyRow(null);
            return;
        }
        try {
            const response = await axios.get(Constants.GET_TALLY_CHECK_URL, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const bankRows = (response.data?.data?.bank ?? []) as TallyBankRow[];
            setTallyRow(bankRows.find((r) => r.bankAccountId === bankId) ?? null);
        } catch (err) {
            console.error("fetchTally error:", err);
        }
    };

    useEffect(() => {
        fetchBankAccounts();
        fetchLedgerStatus();
    }, [token]);

    useEffect(() => {
        fetchTally();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, bankId]);

    // Debounce the search box → `search` (resets to page 1).
    useEffect(() => {
        const t = setTimeout(() => {
            setSearch(searchInput);
            setPage(1);
        }, 350);
        return () => clearTimeout(t);
    }, [searchInput]);

    useEffect(() => {
        fetchRows();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, limit, effectiveBankFilter, typeFilter, reconciledFilter, explainStatusFilter, search, categoryId]);

    // Apply re-runs the fetch for the current filter selection. Filters also
    // apply live on change, so this is an explicit "refresh now" affordance.
    const handleApplyFilters = () => {
        setPage(1);
        fetchRows();
    };

    // Reset clears every filter back to defaults (bank lock via `bankId` stays).
    const handleResetFilters = () => {
        setBankAccountFilter("");
        setTypeFilter("all");
        setReconciledFilter("all");
        setCategoryId("");
        setSearchInput("");
        setSearch("");
        setPage(1);
        setExpandedId(null);
    };

    const handleSuggestMatches = async (txnId: string) => {
        try {
            setIsLoadingMatches(true);
            const res = await axios.get(
                `${Constants.SUGGEST_BANK_TX_MATCHES_URL}/${txnId}/suggest-matches`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            const matches = (res.data?.data?.matches ?? []) as SuggestMatchRow[];
            setSuggestModalState({ txnId, matches });
        } catch (err) {
            console.error("suggest matches error:", err);
            const msg =
                axios.isAxiosError(err) && err.response?.data?.message
                    ? err.response.data.message
                    : "Failed to load matches";
            toast.error(msg);
        } finally {
            setIsLoadingMatches(false);
        }
    };

    const handleLink = async (
        txnId: string,
        candidate: { kind: 'INVOICE_PAYMENT' | 'SUPPLIER_PAYMENT'; candidateId: string },
    ) => {
        try {
            await axios.post(
                `${Constants.LINK_BANK_TX_URL}/${txnId}/link`,
                { relatedType: candidate.kind, relatedId: candidate.candidateId },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success("Linked + reconciled");
            setSuggestModalState(null);
            fetchRows();
        } catch (err) {
            console.error("link error:", err);
            toast.error("Failed to link");
        }
    };

    const handleUnlink = async (txnId: string) => {
        try {
            await axios.post(
                `${Constants.UNLINK_BANK_TX_URL}/${txnId}/unlink`,
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success("Unlinked");
            fetchRows();
        } catch (err) {
            console.error("unlink error:", err);
            toast.error("Failed to unlink");
        }
    };

    // ── Approval-queue actions (analyse / approve / reject) ──────────────────
    const axiosErrMsg = (err: unknown, fallback: string): string =>
        axios.isAxiosError(err)
            ? (err.response?.data?.message ?? err.response?.data?.error ?? fallback)
            : fallback;

    const handleApprove = async (txnId: string) => {
        try {
            setActioningId(txnId);
            await axios.post(
                `${Constants.BANK_TXN_APPROVE_URL}/${txnId}/approve`,
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success("Approved.");
            fetchRows();
            fetchTally();
        } catch (err) {
            console.error("approve error:", err);
            toast.error(axiosErrMsg(err, "Failed to approve."));
        } finally {
            setActioningId(null);
        }
    };

    const handleReject = async (txnId: string) => {
        try {
            setActioningId(txnId);
            await axios.post(
                `${Constants.BANK_TXN_REJECT_URL}/${txnId}/reject`,
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success("Proposal rejected.");
            fetchRows();
            fetchTally();
        } catch (err) {
            console.error("reject error:", err);
            toast.error(axiosErrMsg(err, "Failed to reject."));
        } finally {
            setActioningId(null);
        }
    };

    // Undo an auto-posted row: reverse the posting and return it to UNEXPLAINED.
    // Reuses the same unexplain endpoint the ExplainTransactionForm uses; surfaces
    // the real backend message (e.g. a 423 for a locked period) verbatim.
    const handleUndo = async (txnId: string) => {
        try {
            setActioningId(txnId);
            await axios.post(
                `${Constants.EXPLAIN_BANK_TXN_URL}/${txnId}/unexplain`,
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success("Auto-posted entry undone.");
            fetchRows();
            fetchTally();
        } catch (err) {
            console.error("undo error:", err);
            toast.error(axiosErrMsg(err, "Failed to undo."));
        } finally {
            setActioningId(null);
        }
    };

    const handleAnalyse = async (txnId: string) => {
        try {
            setActioningId(txnId);
            const res = await axios.post(
                `${Constants.BANK_TXN_ANALYSE_URL}/${txnId}/analyse`,
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            const newStatus = res.data?.data?.explainStatus ?? res.data?.data?.transaction?.explainStatus;
            if (newStatus === "FOR_APPROVAL") {
                toast.success("Matched — moved to For approval");
            } else {
                toast.success("No confident match found");
            }
            fetchRows();
            fetchTally();
        } catch (err) {
            console.error("analyse error:", err);
            toast.error(axiosErrMsg(err, "Failed to analyse."));
        } finally {
            setActioningId(null);
        }
    };

    const handleAnalyseAll = async () => {
        try {
            setActioningId("all");
            const params: Record<string, string> = {};
            if (effectiveBankFilter) params.bankAccountId = effectiveBankFilter;
            const res = await axios.post(
                Constants.BANK_TXN_ANALYSE_ALL_URL,
                params,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            const queued = res.data?.data?.queued ?? res.data?.data?.count ?? 0;
            toast.success(`${queued} queued`);
            fetchRows();
            fetchTally();
        } catch (err) {
            console.error("analyse-all error:", err);
            toast.error(axiosErrMsg(err, "Failed to analyse transactions."));
        } finally {
            setActioningId(null);
        }
    };

    const handleConfirmDelete = async () => {
        if (!deleteItem) return;
        try {
            setIsDeleting(true);
            await axios.delete(
                `${Constants.DELETE_BANK_TRANSACTION_URL}/${deleteItem.id}`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success("Bank transaction deleted.");
            setDeleteModalOpen(false);
            setDeleteItem(null);
            fetchRows();
        } catch (err) {
            console.error("delete error:", err);
            toast.error("Failed to delete bank transaction.");
        } finally {
            setIsDeleting(false);
        }
    };

    const resetAddForm = () => {
        setAddForm({
            bankAccountId: "",
            transactionDate: new Date().toISOString().slice(0, 10),
            type: "DEPOSIT",
            amount: "",
            remarks: "",
        });
    };

    const submitAdd = async () => {
        if (!addForm.bankAccountId || !addForm.amount || Number(addForm.amount) <= 0) {
            toast.error("Bank account and a positive amount are required.");
            return;
        }
        try {
            setIsSubmitting(true);
            await axios.post(
                Constants.CREATE_BANK_TRANSACTION_URL,
                {
                    bankAccountId: addForm.bankAccountId,
                    transactionDate: addForm.transactionDate,
                    type: addForm.type,
                    amount: Number(addForm.amount),
                    remarks: addForm.remarks,
                },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success("Bank transaction created.");
            setIsAddOpen(false);
            resetAddForm();
            fetchRows();
        } catch (err) {
            console.error("create error:", err);
            toast.error("Failed to create bank transaction.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const submitImportUpload = async () => {
        if (!importBankAccountId || !importFile) {
            toast.error("Bank account and CSV file are required.");
            return;
        }
        try {
            setIsPreviewing(true);
            const formData = new FormData();
            formData.append("file", importFile);
            const response = await axios.post(
                Constants.IMPORT_BANK_TRANSACTIONS_URL,
                formData,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "multipart/form-data",
                    },
                },
            );
            const preview = (response.data?.data?.previewRows ?? []) as BankTransactionPreviewRow[];
            setPreviewRows(preview);
            setImportStep("preview");
        } catch (err) {
            console.error("import preview error:", err);
            const msg =
                axios.isAxiosError(err) && err.response?.data?.message
                    ? err.response.data.message
                    : "Failed to parse CSV.";
            toast.error(msg);
        } finally {
            setIsPreviewing(false);
        }
    };

    const submitImportConfirm = async () => {
        const validRows = previewRows.filter((r) => !r.error);
        if (!importBankAccountId || validRows.length === 0) {
            toast.error("No valid rows to import.");
            return;
        }
        try {
            setIsConfirming(true);
            await axios.post(
                Constants.CONFIRM_IMPORT_BANK_TRANSACTIONS_URL,
                {
                    bankAccountId: importBankAccountId,
                    rows: validRows.map((r) => ({
                        date: r.date,
                        description: r.description,
                        amount: r.amount,
                        type: r.type,
                        reference: r.reference,
                    })),
                },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success(`${validRows.length} bank transactions imported.`);
            setImportStep("done");
            setImportFile(null);
            setImportBankAccountId("");
            setPreviewRows([]);
            fetchRows();
            // Snap modal closed shortly after.
            setTimeout(() => setImportStep("closed"), 600);
        } catch (err) {
            console.error("import confirm error:", err);
            toast.error("Failed to import bank transactions.");
        } finally {
            setIsConfirming(false);
        }
    };

    // Bank-scoped derived data: the locked bank's name/balance for the header.
    const scopedBank = bankId
        ? bankAccounts.find((b) => b.id === bankId) ?? null
        : null;
    const scopedBankName =
        tallyRow?.name ??
        (scopedBank ? `${scopedBank.bankName} (${scopedBank.accountNumber})` : "Bank");

    // Column layout: essentials only (date, description, amount, type, explain
    // status, reconciled, actions) so a row fits a normal desktop viewport with
    // no horizontal scroll. Reference / category / balance-after — lower-value
    // for a scan of the list — moved into the existing expandable detail row.
    // Bank (only relevant on the all-banks route) is folded into the
    // description cell as a muted second line rather than its own column.
    const tableHeaders = [
        "#",
        "Date",
        "Description",
        "Amount",
        "Type",
        "Status",
        "Reconciled",
        "Actions",
    ];

    // 1:1 with tableHeaders — Tailwind width classes for Table's fitWidth mode.
    // Description is left unset so it absorbs all remaining row width.
    const tableColWidths = ["w-10", "w-28", "", "w-28", "w-28", "w-36", "w-32", "w-56"];

    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);

    const validCount = previewRows.filter((r) => !r.error).length;
    const invalidCount = previewRows.length - validCount;

    return (
        <div className="space-y-4">
            {/* Ledger-not-configured banner */}
            {showLedgerBanner && (
                <div
                    role="alert"
                    className="flex items-start justify-between gap-3 rounded-control border border-warning bg-warning-soft px-4 py-3 text-sm text-warning"
                >
                    <span>
                        <strong>Setup required:</strong> Choose your country to enable transaction categories.{" "}
                        <Link
                            to="/admin/settings/ledger-setup"
                            className="font-medium underline hover:opacity-80"
                        >
                            Go to Ledger Setup
                        </Link>
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="Dismiss"
                        onClick={() => setShowLedgerBanner(false)}
                        className="shrink-0 px-1.5"
                    >
                        <X size={16} />
                    </Button>
                </div>
            )}

            {/* Top-bar title + actions (rendered into the global AdminHeader). */}
            <PageHeader title={bankId ? scopedBankName : "Bank Transactions"}>
                <ExportButton
                    url={Constants.EXPORT_BANK_TRANSACTIONS_URL}
                    filename="bank-transactions.csv"
                />
                <Button
                    type="button"
                    variant="outline"
                    leftIcon={<Upload size={14} />}
                    onClick={() => setImportStep("upload")}
                >
                    Import CSV
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    leftIcon={<CirclePlusIcon size={14} />}
                    onClick={() => setIsAddOpen(true)}
                >
                    Add Transaction
                </Button>
            </PageHeader>

            {/* Bank-scoped summary header: name + balance + in-balance badge */}
            {bankId && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-white px-4 py-3 shadow-card">
                    <div className="flex items-center gap-6">
                        <div>
                            <p className="text-xs uppercase tracking-wide text-body">
                                Current balance
                            </p>
                            <p className="text-lg font-semibold text-heading">
                                {tallyRow
                                    ? Number(tallyRow.currentBalance).toFixed(2)
                                    : "—"}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs uppercase tracking-wide text-body">
                                Explained
                            </p>
                            <p className="text-lg font-semibold text-heading">
                                {tallyRow
                                    ? Number(tallyRow.sumExplained).toFixed(2)
                                    : "—"}
                            </p>
                        </div>
                    </div>
                    {tallyRow && (
                        <Badge
                            color={tallyRow.currentVsExplainedTied ? "success" : "warning"}
                            variant="soft"
                            className="px-3 py-1 text-sm rounded-full"
                        >
                            {tallyRow.currentVsExplainedTied
                                ? "In balance"
                                : `Difference: ${Number(
                                      tallyRow.currentBalance - tallyRow.sumExplained,
                                  ).toFixed(2)}`}
                        </Badge>
                    )}
                </div>
            )}

            {/* ── Toolbar ──────────────────────────────────────────────────── */}

            {/* Status tabs (one line): For approval / Unexplained / All */}
            <div className="flex items-center gap-1 border-b border-border">
                {TABS.map((tab) => {
                    const count = counts[tab.countKey];
                    const isActive = explainStatusFilter === tab.value;
                    return (
                        <button
                            key={tab.value}
                            type="button"
                            onClick={() => {
                                setExplainStatusFilter(tab.value);
                                setPage(1);
                                setExpandedId(null);
                            }}
                            className={
                                "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px cursor-pointer " +
                                (isActive
                                    ? "border-purple-600 text-purple-700"
                                    : "border-transparent text-body hover:text-heading hover:border-border")
                            }
                        >
                            {tab.label}
                            <span
                                className={
                                    "inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-xs font-semibold " +
                                    (isActive
                                        ? "bg-purple-600 text-white"
                                        : "bg-surface text-body")
                                }
                            >
                                {count}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Search (own line) */}
            <div className="relative">
                <SearchIcon
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-body"
                />
                <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search reference, description, party…"
                    className={`${fieldControlClasses()} pl-9 pr-8`}
                />
                {searchInput && (
                    <button
                        type="button"
                        aria-label="Clear search"
                        onClick={() => setSearchInput("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-body hover:text-heading"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            {/* Filters: 2-row grid, Apply + Reset aligned right on row 2 */}
            <div className="rounded-control border border-border bg-surface px-3 py-3 space-y-3">
                {/* Row 1 of filter controls */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    {!bankId && (
                        <Select
                            value={bankAccountFilter}
                            onChange={(e) => {
                                setBankAccountFilter(e.target.value);
                                setPage(1);
                            }}
                            options={[
                                { value: "", label: "All bank accounts" },
                                ...bankAccounts.map((b) => ({
                                    value: b.id,
                                    label: `[${b.accountNumber}] ${b.accountHoldername ?? ""} - ${b.bankName}`,
                                })),
                            ]}
                        />
                    )}
                    <Select
                        value={typeFilter}
                        onChange={(e) => {
                            setTypeFilter(e.target.value as TypeFilter);
                            setPage(1);
                        }}
                        options={TYPE_PILLS.map((opt) => ({
                            value: opt,
                            label: opt === "all" ? "All types" : typeLabel[opt] ?? opt,
                        }))}
                    />
                    <Select
                        value={categoryId}
                        onChange={(e) => {
                            setCategoryId(e.target.value);
                            setPage(1);
                        }}
                        options={[
                            { value: "", label: "All categories" },
                            ...categories.map((c) => ({ value: c.id, label: c.name })),
                        ]}
                    />
                    <Select
                        value={reconciledFilter}
                        onChange={(e) => {
                            setReconciledFilter(e.target.value as ReconciledFilter);
                            setPage(1);
                        }}
                        options={[
                            { value: "all", label: "Any reconcile status" },
                            { value: "true", label: "Reconciled" },
                            { value: "false", label: "Unreconciled" },
                        ]}
                    />
                </div>

                {/* Row 2: page-size + (optional) Analyse-all, then Apply / Reset */}
                <div className="flex flex-wrap items-center gap-3">
                    <Select
                        value={limit}
                        onChange={(e) => {
                            setLimit(Number(e.target.value));
                            setPage(1);
                        }}
                        options={[10, 25, 50].map((n) => ({ value: n, label: `${n} / page` }))}
                        containerClassName="w-32"
                    />
                    {explainStatusFilter === "UNEXPLAINED" && (
                        <Button
                            type="button"
                            variant="primary"
                            isLoading={actioningId === "all"}
                            disabled={actioningId === "all"}
                            leftIcon={<SparklesIcon size={14} />}
                            onClick={handleAnalyseAll}
                        >
                            {actioningId === "all" ? "Analysing…" : "Analyse all"}
                        </Button>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                        <Button type="button" variant="white" onClick={handleResetFilters}>
                            Reset
                        </Button>
                        <Button type="button" variant="primary" onClick={handleApplyFilters}>
                            Apply
                        </Button>
                    </div>
                </div>
            </div>

            {/* Table */}
            <Table headers={tableHeaders} fitWidth colWidths={tableColWidths}>
                {!isLoading &&
                    rows.length > 0 &&
                    rows.map((tx, index) => (
                        <React.Fragment key={tx.id}>
                            <TableRow
                                key={tx.id}
                                index={(page - 1) * limit + index + 1}
                                row={tx}
                                onRowClick={(item) => {
                                    setExpandedId((prev) => (prev === item.id ? null : item.id));
                                }}
                                columns={[
                                    <span className="whitespace-nowrap">
                                        {formatDate(tx.transactionDate)}
                                    </span>,
                                    // Description/remarks — the flexible column; truncates with a
                                    // native tooltip (title) for the full text on hover. On the
                                    // all-banks route, the bank name/account is folded in as a
                                    // muted second line instead of its own column.
                                    <div className="min-w-0">
                                        <span
                                            className="block truncate"
                                            title={tx.remarks || undefined}
                                        >
                                            {tx.remarks || "—"}
                                        </span>
                                        {!bankId && tx.bankAccount && (
                                            <span
                                                className="block truncate text-xs text-body"
                                                title={`${tx.bankAccount.bankName} (${tx.bankAccount.accountNumber})`}
                                            >
                                                {tx.bankAccount.bankName} ({tx.bankAccount.accountNumber})
                                            </span>
                                        )}
                                    </div>,
                                    // Amount — single, direction-coloured column (replaces the old
                                    // separate Money In / Money Out columns).
                                    <span
                                        className={
                                            "block text-right font-medium " +
                                            (tx.direction === "money_in"
                                                ? "text-success"
                                                : "text-danger")
                                        }
                                    >
                                        {formatAmount(tx.amount, tx.currencyCode)}
                                    </span>,
                                    <Badge color={typeBadgeColor(tx.type)} variant="soft">
                                        {typeLabel[tx.type] ?? tx.type}
                                    </Badge>,
                                    // Explain status pill (+ linked-to-source / auto-posted / proposal, when present)
                                    <div className="flex flex-col items-start gap-1 max-w-full">
                                        <Badge color={explainStatusBadgeColor(tx.explainStatus)} variant="soft">
                                            {explainStatusLabel(tx.explainStatus)}
                                        </Badge>
                                        {tx.autoPosted && (
                                            <Badge color="info" variant="soft" className="self-start text-[10px] px-2 py-0.5">
                                                Auto-posted
                                            </Badge>
                                        )}
                                        {/* Payment-born rows are already tied to a source document —
                                            driven by the backend-stamped isPaymentBorn flag, not
                                            relatedType (see isBankTxnPaymentBorn). */}
                                        {isBankTxnPaymentBorn(tx) && (
                                            <Badge
                                                color="info"
                                                variant="soft"
                                                className="max-w-full self-start gap-1 truncate text-[10px] px-2 py-0.5"
                                                title={`Linked: ${tx.relatedType && tx.relatedType !== 'MANUAL' ? BANK_TXN_RELATED_TYPE_LABEL[tx.relatedType] : 'source document'}`}
                                            >
                                                <LinkIcon size={10} className="shrink-0" />
                                                Linked: {tx.relatedType && tx.relatedType !== 'MANUAL' ? BANK_TXN_RELATED_TYPE_LABEL[tx.relatedType] : 'source'}
                                            </Badge>
                                        )}
                                        {tx.explainStatus === "FOR_APPROVAL" && tx.proposal && (
                                            <div className="flex max-w-full flex-col gap-0.5">
                                                <span
                                                    className="truncate text-xs font-medium text-body"
                                                    title={tx.proposal.label}
                                                >
                                                    {tx.proposal.label}
                                                </span>
                                                <Badge color="primary" variant="soft" className="self-start text-[10px] px-2 py-0.5">
                                                    {tx.proposal.confidence ?? "—"}
                                                    {tx.proposal.score !== null &&
                                                        tx.proposal.score !== undefined &&
                                                        ` · ${tx.proposal.score}`}
                                                </Badge>
                                            </div>
                                        )}
                                    </div>,
                                    // Reconciled pill
                                    <Badge color={tx.isReconciled ? "success" : "gray"} variant="soft">
                                        {tx.isReconciled ? "Reconciled" : "Unreconciled"}
                                    </Badge>,
                                ]}
                                actions={[
                                    // For-approval queue: one-click Approve / Edit / Reject.
                                    ...(tx.explainStatus === "FOR_APPROVAL"
                                        ? [
                                              {
                                                  label:
                                                      actioningId === tx.id
                                                          ? "Approving…"
                                                          : "Approve",
                                                  icon: <CheckIcon size={14} />,
                                                  isDisabled: (item: BankTransactionRow) =>
                                                      actioningId === item.id,
                                                  onClick: (item: BankTransactionRow) => {
                                                      handleApprove(item.id);
                                                  },
                                              },
                                              {
                                                  label: "Edit",
                                                  icon: <PencilIcon size={14} />,
                                                  primary: true,
                                                  onClick: (item: BankTransactionRow) => {
                                                      setExpandedId((prev) =>
                                                          prev === item.id ? null : item.id,
                                                      );
                                                  },
                                              },
                                              {
                                                  label: "Reject",
                                                  icon: <XIcon size={14} />,
                                                  isDisabled: (item: BankTransactionRow) =>
                                                      actioningId === item.id,
                                                  onClick: (item: BankTransactionRow) => {
                                                      handleReject(item.id);
                                                  },
                                              },
                                          ]
                                        : []),
                                    // Unexplained + not-payment-born only: per-row Analyse (may
                                    // move it to For-approval). Payment-born rows (isPaymentBorn)
                                    // are already tied to a source document and must not offer
                                    // Analyse/Explain — see canOfferExplain.
                                    ...(canOfferExplain(tx)
                                        ? [
                                              {
                                                  label:
                                                      actioningId === tx.id
                                                          ? "Analysing…"
                                                          : "Analyse",
                                                  icon: <SparklesIcon size={14} />,
                                                  isDisabled: (item: BankTransactionRow) =>
                                                      actioningId === item.id,
                                                  onClick: (item: BankTransactionRow) => {
                                                      handleAnalyse(item.id);
                                                  },
                                              },
                                          ]
                                        : []),
                                    // Auto-posted rows: prominent Undo (reverses the auto-post).
                                    ...(tx.autoPosted
                                        ? [
                                              {
                                                  label:
                                                      actioningId === tx.id
                                                          ? "Undoing…"
                                                          : "Undo",
                                                  icon: <Undo2Icon size={14} />,
                                                  primary: true,
                                                  isDisabled: (item: BankTransactionRow) =>
                                                      actioningId === item.id,
                                                  onClick: (item: BankTransactionRow) => {
                                                      handleUndo(item.id);
                                                  },
                                              },
                                          ]
                                        : []),
                                    ...(!tx.isReconciled
                                        ? [
                                              {
                                                  label: "Match",
                                                  icon: <LinkIcon size={14} />,
                                                  onClick: (item: BankTransactionRow) => {
                                                      handleSuggestMatches(item.id);
                                                  },
                                              },
                                          ]
                                        : [
                                              {
                                                  label: "Unlink",
                                                  icon: <Unlink2Icon size={14} />,
                                                  onClick: (item: BankTransactionRow) => {
                                                      handleUnlink(item.id);
                                                  },
                                              },
                                          ]),
                                    {
                                        label: "Delete",
                                        icon: <Trash2Icon size={14} />,
                                        primary: true,
                                        variant: "danger",
                                        onClick: (item: BankTransactionRow) => {
                                            setDeleteItem(item);
                                            setDeleteModalOpen(true);
                                        },
                                    },
                                ] as Action<BankTransactionRow>[]}
                            />
                            {expandedId === tx.id && (
                                <tr key={`expand-${tx.id}`}>
                                    <td colSpan={tableHeaders.length} className="px-4 py-3 bg-surface border-b border-border">
                                        {/* Secondary detail — reference/category/balance moved out of
                                            the main columns to keep the row width fit for the screen. */}
                                        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-body">
                                            <span>
                                                <span className="font-semibold text-heading">Reference: </span>
                                                {tx.referenceNo || "—"}
                                            </span>
                                            <span>
                                                <span className="font-semibold text-heading">Category: </span>
                                                {tx.category?.name ?? "—"}
                                            </span>
                                            <span>
                                                <span className="font-semibold text-heading">Balance after: </span>
                                                {Number(tx.balanceAfter).toFixed(2)}
                                            </span>
                                        </div>
                                        <ExplainTransactionForm
                                            txn={tx}
                                            onDone={(keepOpen) => {
                                                // Unexplain keeps the row expanded so the
                                                // re-rendered form shows the prefilled,
                                                // now-editable prior selection.
                                                if (!keepOpen) setExpandedId(null);
                                                fetchRows();
                                            }}
                                        />
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    ))}
                {!isLoading && rows.length === 0 && counts.all === 0 && (
                    <tr>
                        <td colSpan={tableHeaders.length} className="px-4 py-10 text-center">
                            <p className="text-sm text-gray-600 font-medium">No bank transactions yet</p>
                            <p className="mt-1 text-sm text-gray-500">
                                Import a bank statement to get started.
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mt-3"
                                leftIcon={<Upload size={14} />}
                                onClick={() => setImportStep("upload")}
                            >
                                Import CSV
                            </Button>
                        </td>
                    </tr>
                )}
                {!isLoading && rows.length === 0 && counts.all > 0 && (
                    <NoRecords colSpan={tableHeaders.length} message="No bank transactions found" />
                )}
                {isLoading && (
                    <tr key="table-loader">
                        <td
                            className="text-center py-1 text-gray-950 font-semibold"
                            colSpan={tableHeaders.length}
                        >
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
                onChange={(_, newPage) => setPage(newPage)}
                paginationVariant="outlined"
                paginationShape="rounded"
            />

            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={handleConfirmDelete}
                isDeleting={isDeleting}
                title="Delete Bank Transaction"
                message="Are you sure you want to delete this bank transaction? This action cannot be undone."
            />

            {/* Add Transaction modal */}
            <Modal
                isOpen={isAddOpen}
                onClose={() => {
                    setIsAddOpen(false);
                    resetAddForm();
                }}
                title="Add Bank Transaction"
                size="lg"
            >
                <div className="space-y-4">
                    <div className="space-y-3">
                        <Select
                            label="Bank account"
                            value={addForm.bankAccountId}
                            onChange={(e) =>
                                setAddForm({ ...addForm, bankAccountId: e.target.value })
                            }
                            options={[
                                { value: "", label: "Select bank account" },
                                ...bankAccounts.map((b) => ({
                                    value: b.id,
                                    label: `[${b.accountNumber}] ${b.bankName}`,
                                })),
                            ]}
                        />
                        <div className="grid grid-cols-2 gap-3">
                            <DateInput
                                label="Date"
                                value={ymdStringToDate(addForm.transactionDate)}
                                onChange={(date) =>
                                    setAddForm({ ...addForm, transactionDate: dateToYmdString(date) })
                                }
                            />
                            <Select
                                label="Type"
                                value={addForm.type}
                                onChange={(e) =>
                                    setAddForm({
                                        ...addForm,
                                        type: e.target.value as BankTransactionType,
                                    })
                                }
                                options={(Object.keys(typeLabel) as BankTransactionType[]).map((t) => ({
                                    value: t,
                                    label: typeLabel[t],
                                }))}
                            />
                        </div>
                        <FormField
                            label="Amount"
                            type="number"
                            min="0"
                            step="0.01"
                            value={addForm.amount}
                            onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })}
                        />
                        <FormField
                            label="Remarks"
                            type="text"
                            value={addForm.remarks}
                            onChange={(e) =>
                                setAddForm({ ...addForm, remarks: e.target.value })
                            }
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            type="button"
                            variant="white"
                            onClick={() => {
                                setIsAddOpen(false);
                                resetAddForm();
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            isLoading={isSubmitting}
                            disabled={isSubmitting}
                            onClick={submitAdd}
                        >
                            {isSubmitting ? "Saving..." : "Save"}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* CSV Import modal */}
            <Modal
                isOpen={importStep !== "closed"}
                onClose={() => {
                    setImportStep("closed");
                    setImportFile(null);
                    setImportBankAccountId("");
                    setPreviewRows([]);
                }}
                title={
                    importStep === "preview"
                        ? "Review Imported Rows"
                        : importStep === "done"
                          ? "Import Complete"
                          : "Import Bank Transactions (CSV)"
                }
                size="2xl"
            >
                {importStep === "upload" && (
                    <div className="space-y-3">
                        <Select
                            label="Bank account"
                            value={importBankAccountId}
                            onChange={(e) => setImportBankAccountId(e.target.value)}
                            options={[
                                { value: "", label: "Select bank account" },
                                ...bankAccounts.map((b) => ({
                                    value: b.id,
                                    label: `[${b.accountNumber}] ${b.bankName}`,
                                })),
                            ]}
                        />
                        <FormField
                            label="CSV file"
                            type="file"
                            accept=".csv,text/csv"
                            onChange={(e) =>
                                setImportFile(e.target.files?.[0] ?? null)
                            }
                            helper="Expected columns: date, description, amount, type (DEPOSIT/WITHDRAWAL/DEBIT/CREDIT)."
                        />
                        <div className="flex justify-end gap-2 pt-2">
                            <Button type="button" variant="white" onClick={() => setImportStep("closed")}>
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                variant="primary"
                                isLoading={isPreviewing}
                                disabled={isPreviewing || !importFile || !importBankAccountId}
                                onClick={submitImportUpload}
                            >
                                {isPreviewing ? "Parsing..." : "Preview"}
                            </Button>
                        </div>
                    </div>
                )}

                {importStep === "preview" && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-3 text-sm">
                            <Badge color="success" variant="soft">{validCount} valid</Badge>
                            <Badge color="danger" variant="soft">{invalidCount} invalid (skipped)</Badge>
                        </div>
                        <div className="border border-border rounded-control overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-surface text-body">
                                    <tr>
                                        <th className="px-3 py-2 text-left">#</th>
                                        <th className="px-3 py-2 text-left">Date</th>
                                        <th className="px-3 py-2 text-left">Description</th>
                                        <th className="px-3 py-2 text-right">Amount</th>
                                        <th className="px-3 py-2 text-left">Type</th>
                                        <th className="px-3 py-2 text-left">Reference</th>
                                        <th className="px-3 py-2 text-left">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewRows.map((r, i) => (
                                        <tr
                                            key={i}
                                            className={r.error ? "bg-danger-soft" : "bg-success-soft"}
                                        >
                                            <td className="px-3 py-2 text-body">{i + 1}</td>
                                            <td className="px-3 py-2 text-body">{formatDate(r.date)}</td>
                                            <td className="px-3 py-2 text-body">
                                                {r.description}
                                            </td>
                                            <td className="px-3 py-2 text-right text-body">
                                                {Number(r.amount).toFixed(2)}
                                            </td>
                                            <td className="px-3 py-2 text-body">{r.type}</td>
                                            <td className="px-3 py-2 text-body">{r.reference || "—"}</td>
                                            <td className="px-3 py-2 text-body">
                                                {r.error ? (
                                                    <span className="text-danger">{r.error}</span>
                                                ) : (
                                                    <span className="text-success">OK</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <Button type="button" variant="white" onClick={() => setImportStep("upload")}>
                                Back
                            </Button>
                            <Button
                                type="button"
                                variant="primary"
                                isLoading={isConfirming}
                                disabled={isConfirming || validCount === 0}
                                onClick={submitImportConfirm}
                            >
                                {isConfirming ? "Importing..." : `Confirm Import (${validCount})`}
                            </Button>
                        </div>
                    </div>
                )}

                {importStep === "done" && (
                    <div className="text-center py-6 text-body">
                        Import complete.
                    </div>
                )}
            </Modal>

            {/* Suggest-matches modal (slice E.2) */}
            <Modal
                isOpen={Boolean(suggestModalState || isLoadingMatches)}
                onClose={() => {
                    if (!isLoadingMatches) setSuggestModalState(null);
                }}
                title="Suggested Matches"
                size="3xl"
            >
                {isLoadingMatches && (
                    <div className="py-6 text-center text-body">
                        <LoaderSpinner />
                    </div>
                )}
                {!isLoadingMatches && suggestModalState && (
                    <>
                        {suggestModalState.matches.length === 0 ? (
                            <p className="text-sm text-body py-4">No matches found.</p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left border-b border-border text-body">
                                        <th className="py-2">Score</th>
                                        <th>Kind</th>
                                        <th>Reference</th>
                                        <th>Amount</th>
                                        <th>Date</th>
                                        <th>Reasons</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {suggestModalState.matches.map((m) => (
                                        <tr key={m.candidateId} className="border-b border-border">
                                            <td className="py-2 font-medium text-heading">
                                                {m.score}
                                            </td>
                                            <td className="text-body">
                                                {m.kind === "INVOICE_PAYMENT"
                                                    ? "Invoice"
                                                    : "Supplier"}
                                            </td>
                                            <td className="text-body">{m.parentLabel}</td>
                                            <td className="text-body">
                                                {Number(m.amount).toFixed(2)}
                                            </td>
                                            <td className="text-body">
                                                {formatDate(m.date)}
                                            </td>
                                            <td className="text-xs text-body">
                                                {m.reasons.join(", ")}
                                            </td>
                                            <td>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="primary"
                                                    onClick={() =>
                                                        handleLink(suggestModalState.txnId, {
                                                            kind: m.kind,
                                                            candidateId: m.candidateId,
                                                        })
                                                    }
                                                >
                                                    Link
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                        <div className="text-right mt-3">
                            <Button
                                type="button"
                                variant="white"
                                size="sm"
                                onClick={() => setSuggestModalState(null)}
                            >
                                Close
                            </Button>
                        </div>
                    </>
                )}
            </Modal>
        </div>
    );
};

export default BankTransactionList;
