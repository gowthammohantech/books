import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useSelector } from 'react-redux';
import { toast } from 'sonner';
import type { RootState } from '@store/index';
import Constants from '@constants/api';
import SmartDropdown from '@components/admin/SmartDropdown';
import { useTransactionTypes } from '@hooks/useTransactionTypes';
import { useTransactionCategories } from '@hooks/useTransactionCategories';
import type { BankTransactionRow } from '@/types/bankTransaction';
import { BANK_TXN_RELATED_TYPE_LABEL, isBankTxnPaymentBorn } from '@/types/bankTransaction';
import type { TransactionTypeDef, CategoryAppliesTo, MoneyFlow } from '@/types/moneyFlow';
import { deriveExplainPrefill } from '@/lib/explainPrefill';
import { Button, FormField, Select, fieldControlClasses } from '@components/ui';

// ── Types ────────────────────────────────────────────────────────────────────

interface DropdownItem {
    id: string;
    name: string;
}

type TaxTreatment = 'AUTO' | 'ZERO' | 'EXEMPT' | 'OUT_OF_SCOPE' | 'MANUAL';

const TAX_OPTIONS: { value: TaxTreatment; label: string }[] = [
    { value: 'AUTO', label: 'Auto' },
    { value: 'ZERO', label: 'Zero rated' },
    { value: 'EXEMPT', label: 'Exempt' },
    { value: 'OUT_OF_SCOPE', label: 'Out of scope' },
    { value: 'MANUAL', label: 'Manual' },
];

// Status pill shown in the editable form header — mirrors the row's
// explainStatus so an EXPLAINED or FOR_APPROVAL row still reads clearly
// once it's rendered as an editable form rather than a locked panel.
const STATUS_PILL: Record<BankTransactionRow['explainStatus'], { label: string; cls: string }> = {
    EXPLAINED: { label: 'Explained — posted', cls: 'bg-success-soft text-success' },
    FOR_APPROVAL: { label: 'Awaiting approval', cls: 'bg-warning-soft text-warning' },
    UNEXPLAINED: { label: 'Unexplained', cls: 'bg-surface text-body' },
};

const DEPRECIATION_OPTIONS = [
    { value: 'STRAIGHT_LINE', label: 'Straight line', help: 'Equal charge each year over the asset life.' },
    { value: 'REDUCING_BALANCE', label: 'Reducing balance', help: 'Fixed % applied to the diminishing book value each year.' },
    { value: 'NONE', label: 'No depreciation', help: 'Asset is not depreciated (land, works-in-progress, etc.).' },
];

// Money formatter — mirrors formatAmount in BankTransactionList.tsx.
const formatAmount = (amount: string | number, currencyCode: string | null): string => {
    const num = Number(amount).toFixed(2);
    return currencyCode ? `${currencyCode} ${num}` : num;
};

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
    txn: BankTransactionRow;
    // keepOpen=true asks the parent to refetch but leave the row expanded
    // (used after unexplain so the prefilled, editable form stays visible).
    onDone: (keepOpen?: boolean) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

const ExplainTransactionForm: React.FC<Props> = ({ txn, onDone }) => {
    const { token } = useSelector((s: RootState) => s.auth);
    const { types, userPaymentReasons, loading: typesLoading } = useTransactionTypes();

    // Derive eligible flows from direction
    const eligibleFlows: MoneyFlow[] = txn.direction === 'money_in'
        ? ['MONEY_IN', 'MONEY_IN_USER']
        : ['MONEY_OUT', 'MONEY_OUT_USER'];

    const eligibleTypes = types.filter((t) => eligibleFlows.includes(t.flow) && !t.hidden);

    // Prefill precedence: persisted selection (explained / retained-after-
    // unexplain) → AI proposal (FOR_APPROVAL) → empty. See deriveExplainPrefill.
    const prefill = deriveExplainPrefill(txn);

    // Selected type definition
    const [selectedTypeKey, setSelectedTypeKey] = useState<string>(prefill.transactionTypeKey);
    const selectedDef: TransactionTypeDef | undefined = eligibleTypes.find((t) => t.key === selectedTypeKey);

    // The appliesTo for categories = the selected type's flow
    const appliesTo: CategoryAppliesTo | undefined = selectedDef?.flow as CategoryAppliesTo | undefined;
    const { categories, loading: catsLoading } = useTransactionCategories(appliesTo);

    // Form state
    const [categoryId, setCategoryId] = useState<string>(prefill.categoryId);
    const TAX_VALUES: string[] = TAX_OPTIONS.map((o) => o.value);
    const [taxTreatment, setTaxTreatment] = useState<TaxTreatment>(
        (TAX_VALUES.includes(prefill.taxTreatment) ? prefill.taxTreatment : 'AUTO') as TaxTreatment,
    );
    const [description, setDescription] = useState<string>(prefill.description);
    const [assetType, setAssetType] = useState<string>('');
    const [depreciationMethod, setDepreciationMethod] = useState<string>('STRAIGHT_LINE');
    const [assetLifeMonths, setAssetLifeMonths] = useState<string>('');

    // Person (user) dropdown
    const [users, setUsers] = useState<DropdownItem[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [userSearch, setUserSearch] = useState('');
    const [selectedUser, setSelectedUser] = useState<DropdownItem | null>(null);

    // Invoice picker — prefilled from the persisted/proposed linked document
    // only when its relatedType matches (linkedDoc is null otherwise, so this
    // never falsely prefills off a stale relatedType).
    const [invoices, setInvoices] = useState<DropdownItem[]>([]);
    const [invoiceSearch, setInvoiceSearch] = useState('');
    const [selectedInvoice, setSelectedInvoice] = useState<DropdownItem | null>(
        prefill.linkedRelatedType === 'INVOICE_PAYMENT' ? prefill.linkedDoc : null,
    );

    // Bill / purchase picker
    const [purchases, setPurchases] = useState<DropdownItem[]>([]);
    const [purchaseSearch, setPurchaseSearch] = useState('');
    const [selectedPurchase, setSelectedPurchase] = useState<DropdownItem | null>(
        prefill.linkedRelatedType === 'SUPPLIER_PAYMENT' ? prefill.linkedDoc : null,
    );

    // Credit note picker (for credit_note_refund)
    const [creditNotes, setCreditNotes] = useState<DropdownItem[]>([]);
    const [creditNoteSearch, setCreditNoteSearch] = useState('');
    const [selectedCreditNote, setSelectedCreditNote] = useState<DropdownItem | null>(
        txn.transactionTypeKey === 'credit_note_refund' ? prefill.linkedDoc : null,
    );

    // Fixed-asset picker (for capital_asset_disposal)
    const [assets, setAssets] = useState<DropdownItem[]>([]);
    const [assetSearch, setAssetSearch] = useState('');
    const [selectedAsset, setSelectedAsset] = useState<DropdownItem | null>(
        txn.transactionTypeKey === 'capital_asset_disposal' ? prefill.linkedDoc : null,
    );

    // Reason (for money_received_from_user / money_paid_to_user)
    const [selectedReason, setSelectedReason] = useState<string>('');

    // Submit state
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isUnexplaining, setIsUnexplaining] = useState(false);

    // ── Data fetching ────────────────────────────────────────────────────────

    const fetchUsers = useCallback(async (search: string) => {
        if (!token) return;
        try {
            setUsersLoading(true);
            // /admin/user/type/1 = admin/staff users (user_type = 1)
            const res = await axios.get(`${Constants.FETCH_USERS_URL}/1`, {
                params: { search, limit: 50, page: 1 },
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = (res.data?.data ?? []) as Array<{ id: string; firstName: string; lastName: string }>;
            setUsers(data.map((u) => ({ id: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() })));
        } catch {
            // silently ignore
        } finally {
            setUsersLoading(false);
        }
    }, [token]);

    const fetchInvoices = useCallback(async (search: string) => {
        if (!token) return;
        try {
            // POST /admin/invoices-minimal with { search } — same pattern as credit-note search
            const res = await axios.post(
                Constants.SEARCH_INVOICES_FOR_CREDIT_NOTE_URL,
                { search },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            const data = (res.data?.data ?? []) as Array<{ id: string; invoiceNumber: string }>;
            setInvoices(data.map((inv) => ({ id: inv.id, name: inv.invoiceNumber })));
        } catch {
            // silently ignore
        }
    }, [token]);

    const fetchPurchases = useCallback(async (search: string) => {
        if (!token) return;
        try {
            // GET /admin/purchases-minimal (same endpoint used by debit-note)
            const res = await axios.get(Constants.FETCH_ALL_PURCHASE_FOR_DEBIT_NOTE_URL, {
                params: { search, limit: 50, page: 1 },
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = (res.data?.data ?? []) as Array<{ id: string; purchaseId: string }>;
            setPurchases(data.map((p) => ({ id: p.id, name: p.purchaseId })));
        } catch {
            // silently ignore
        }
    }, [token]);

    const fetchCreditNotes = useCallback(async (search: string) => {
        if (!token) return;
        try {
            const res = await axios.get(Constants.CREDIT_NOTE_LIST_URL, {
                params: { search, limit: 50, page: 1 },
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = (res.data?.data?.creditNotes ?? []) as Array<{ id: string; creditNoteNumber: string; customer?: { name?: string }; totalAmount?: string | number }>;
            setCreditNotes(data.map((cn) => ({
                id: cn.id,
                name: cn.customer?.name
                    ? `${cn.creditNoteNumber} – ${cn.customer.name}`
                    : cn.creditNoteNumber,
            })));
        } catch {
            // silently ignore
        }
    }, [token]);

    const fetchAssets = useCallback(async (search: string) => {
        if (!token) return;
        try {
            const res = await axios.get(Constants.SEARCH_FIXED_ASSETS_URL, {
                params: { q: search },
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = (res.data?.data ?? []) as Array<{ id: string; name: string; cost: string | number; accumulatedDepreciation: string | number }>;
            setAssets(data.map((a) => {
                const nbv = Number(a.cost) - Number(a.accumulatedDepreciation);
                return { id: a.id, name: `${a.name} (NBV ${nbv.toFixed(2)})` };
            }));
        } catch {
            // silently ignore
        }
    }, [token]);

    // Load users/invoices/purchases when relevant fields appear
    useEffect(() => {
        if (selectedDef?.fields.includes('person')) {
            fetchUsers(userSearch);
        }
    }, [selectedDef, userSearch, fetchUsers]);

    useEffect(() => {
        if (selectedDef?.fields.includes('invoiceLink')) {
            fetchInvoices(invoiceSearch);
        }
    }, [selectedDef, invoiceSearch, fetchInvoices]);

    useEffect(() => {
        if (selectedDef?.fields.includes('billLink')) {
            fetchPurchases(purchaseSearch);
        }
    }, [selectedDef, purchaseSearch, fetchPurchases]);

    useEffect(() => {
        if (selectedDef?.fields.includes('creditNoteLink')) {
            fetchCreditNotes(creditNoteSearch);
        }
    }, [selectedDef, creditNoteSearch, fetchCreditNotes]);

    useEffect(() => {
        if (selectedDef?.fields.includes('disposedAssetLink')) {
            fetchAssets(assetSearch);
        }
    }, [selectedDef, assetSearch, fetchAssets]);

    // Reset dependent fields when type changes
    const handleTypeChange = (key: string) => {
        setSelectedTypeKey(key);
        setCategoryId('');
        setSelectedUser(null);
        setUserSearch('');
        setSelectedInvoice(null);
        setInvoiceSearch('');
        setSelectedPurchase(null);
        setPurchaseSearch('');
        setSelectedCreditNote(null);
        setCreditNoteSearch('');
        setSelectedAsset(null);
        setAssetSearch('');
        setTaxTreatment('AUTO');
        setAssetType('');
        setDepreciationMethod('STRAIGHT_LINE');
        setAssetLifeMonths('');
        setSelectedReason('');
    };

    // ── Submit / Unexplain ───────────────────────────────────────────────────

    const handleSubmit = async () => {
        if (!selectedTypeKey) {
            toast.error('Please select a transaction type.');
            return;
        }
        if (selectedDef?.fields.includes('person') && !selectedUser?.id) {
            toast.error('A person is required for this transaction type.');
            return;
        }
        if (selectedDef?.fields.includes('category') && !categoryId) {
            toast.error('Please select a category.');
            return;
        }
        if (selectedDef?.fields.includes('invoiceLink') && !selectedInvoice?.id) {
            toast.error('Please select an invoice.');
            return;
        }
        if (selectedDef?.fields.includes('billLink') && !selectedPurchase?.id) {
            toast.error('Please select a bill.');
            return;
        }
        if (selectedDef?.fields.includes('creditNoteLink') && !selectedCreditNote?.id) {
            toast.error('Please select a credit note.');
            return;
        }
        if (selectedDef?.fields.includes('disposedAssetLink') && !selectedAsset?.id) {
            toast.error('Please select the asset being disposed.');
            return;
        }
        if (selectedDef?.fields.includes('reason') && !selectedReason) {
            toast.error('Please select a reason.');
            return;
        }

        const body: Record<string, string | number | undefined> = {
            transactionTypeKey: selectedTypeKey,
        };
        if (categoryId) body.categoryId = categoryId;
        if (selectedUser?.id) body.payToUserId = selectedUser.id;
        if (selectedDef?.taxApplicable) body.taxTreatment = taxTreatment;
        if (description) body.explainedDescription = description;
        if (selectedInvoice?.id) body.invoiceId = selectedInvoice.id;
        if (selectedPurchase?.id) body.billId = selectedPurchase.id;
        if (selectedCreditNote?.id) body.creditNoteId = selectedCreditNote.id;
        if (selectedAsset?.id) body.assetId = selectedAsset.id;
        if (selectedDef?.fields.includes('assetFields')) {
            if (assetType) body.assetType = assetType;
            if (depreciationMethod) body.depreciationMethod = depreciationMethod;
            if (assetLifeMonths) body.assetLifeMonths = Number(assetLifeMonths);
        }
        if (selectedReason) body.reason = selectedReason;

        try {
            setIsSubmitting(true);
            await axios.post(
                `${Constants.EXPLAIN_BANK_TXN_URL}/${txn.id}/explain`,
                body,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success('Saved.');
            onDone();
        } catch (err) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data?.message ?? err.response?.data?.error ?? 'Failed to save.')
                : 'Failed to save.';
            toast.error(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUnexplain = async () => {
        try {
            setIsUnexplaining(true);
            await axios.post(
                `${Constants.EXPLAIN_BANK_TXN_URL}/${txn.id}/unexplain`,
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            toast.success('Transaction un-explained.');
            // Keep the row expanded so the form re-renders with the retained
            // selection prefilled and editable for re-explain.
            onDone(true);
        } catch (err) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data?.message ?? err.response?.data?.error ?? 'Failed to un-explain.')
                : 'Failed to un-explain.';
            toast.error(msg);
        } finally {
            setIsUnexplaining(false);
        }
    };

    // ── Payment-born read-only view ──────────────────────────────────────────
    // A row is "payment-born" when it was CREATED by a module payment flow
    // (invoice receipt, supplier payment, petty cash, expense) — stamped by
    // the backend at create (isPaymentBorn). It is already linked to its
    // source document and cannot be (re-)explained here: edit it at the
    // source, or Un-explain to convert it into a normal bank line. Every
    // other row — including EXPLAINED ones — renders the editable form below.
    if (isBankTxnPaymentBorn(txn)) {
        const exp = txn.explanation;
        const relatedLabel = txn.relatedType ? BANK_TXN_RELATED_TYPE_LABEL[txn.relatedType] : null;
        // Compose the rich sub-line pieces (kind, party, amount, GL account).
        const subParts: string[] = [];
        if (exp?.kind) subParts.push(`Explained as ${exp.kind}`);
        if (exp?.partyName) subParts.push(exp.partyName);
        subParts.push(formatAmount(txn.amount, txn.currencyCode));
        if (exp?.accountCode || exp?.accountName) {
            subParts.push(`→ ${[exp.accountCode, exp.accountName].filter(Boolean).join(' ')}`);
        }
        const headline = exp?.label ?? (relatedLabel ? `Linked: ${relatedLabel}` : 'Linked to source');

        return (
            <div className="rounded-card border border-success bg-success-soft p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="inline-flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-wide bg-success-soft text-success">
                                Linked to source
                            </span>
                        </div>
                        {/* Headline — explanation label, linked when a link is present */}
                        <div className="mt-1 text-sm font-semibold text-success">
                            {exp?.link ? (
                                <Link to={exp.link} className="text-success hover:underline">
                                    {exp.label}
                                </Link>
                            ) : (
                                headline
                            )}
                        </div>
                        {/* Sub-line — kind + party + amount + GL account */}
                        <div className="mt-0.5 text-xs text-success">
                            {subParts.join(' • ')}
                        </div>
                        <p className="mt-1 text-xs text-body">Created by a payment recorded at the source document — edit it there, or un-explain to convert this into a normal bank line.</p>
                    </div>
                    <Button
                        type="button"
                        variant="warning"
                        size="sm"
                        disabled={isUnexplaining}
                        isLoading={isUnexplaining}
                        onClick={handleUnexplain}
                        className="shrink-0"
                    >
                        {isUnexplaining ? 'Removing…' : 'Un-explain'}
                    </Button>
                </div>
            </div>
        );
    }

    // ── Editable form view — every non-payment-born row, any explainStatus ──

    const fields = selectedDef?.fields ?? [];

    return (
        <div className="space-y-4 rounded-card border border-border bg-white p-4">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-heading">Explain Transaction</h3>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-wide ${STATUS_PILL[txn.explainStatus].cls}`}>
                    {STATUS_PILL[txn.explainStatus].label}
                </span>
            </div>
            {txn.explanation && (
                <p className="text-xs text-body">
                    {[txn.explanation.label,
                      [txn.explanation.accountCode, txn.explanation.accountName].filter(Boolean).join(' ')]
                        .filter(Boolean).join(' → ')}
                </p>
            )}

            {/* Transaction Type */}
            {typesLoading ? (
                <div className="text-sm text-body">Loading types…</div>
            ) : (
                <Select
                    label="Transaction type"
                    required
                    value={selectedTypeKey}
                    onChange={(e) => handleTypeChange(e.target.value)}
                    placeholder="Select type…"
                    options={eligibleTypes.map((t) => ({ value: t.key, label: t.label }))}
                />
            )}

            {/* Conditional fields */}
            {selectedDef && (
                <>
                    {/* Category */}
                    {fields.includes('category') && (
                        catsLoading ? (
                            <div>
                                <label className="block text-sm font-medium text-heading mb-1">Category</label>
                                <div className="text-sm text-body">Loading categories…</div>
                            </div>
                        ) : (
                            <Select
                                label="Category"
                                value={categoryId}
                                onChange={(e) => setCategoryId(e.target.value)}
                                placeholder="Select category…"
                                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                            />
                        )
                    )}

                    {/* Tax treatment — only when type.taxApplicable */}
                    {fields.includes('tax') && selectedDef.taxApplicable && (
                        <Select
                            label="Tax treatment"
                            value={taxTreatment}
                            onChange={(e) => setTaxTreatment(e.target.value as TaxTreatment)}
                            options={TAX_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                        />
                    )}

                    {/* Person */}
                    {fields.includes('person') && (
                        <FormField label="Person" required>
                            <SmartDropdown
                                items={users}
                                value={userSearch}
                                onChange={(v) => setUserSearch(v)}
                                onSelect={(item) => setSelectedUser(item ? { id: String(item.id), name: item.name } : null)}
                                selectedItem={selectedUser ? { id: selectedUser.id, name: selectedUser.name } : null}
                                placeholder="Search users…"
                                serverside
                                loading={usersLoading}
                            />
                        </FormField>
                    )}

                    {/* Reason (for money_received_from_user / money_paid_to_user) */}
                    {fields.includes('reason') && (
                        <Select
                            label="Reason"
                            required
                            value={selectedReason}
                            onChange={(e) => setSelectedReason(e.target.value)}
                            placeholder="Select reason…"
                            options={(
                                (selectedTypeKey === 'money_received_from_user'
                                    ? userPaymentReasons?.money_received_from_user
                                    : userPaymentReasons?.money_paid_to_user
                                ) ?? []
                            ).map((r) => ({ value: r.key, label: r.label }))}
                        />
                    )}

                    {/* Invoice link */}
                    {fields.includes('invoiceLink') && (
                        <FormField label="Link invoice">
                            <SmartDropdown
                                items={invoices}
                                value={invoiceSearch}
                                onChange={(v) => setInvoiceSearch(v)}
                                onSelect={(item) => setSelectedInvoice(item ? { id: String(item.id), name: item.name } : null)}
                                selectedItem={selectedInvoice ? { id: selectedInvoice.id, name: selectedInvoice.name } : null}
                                placeholder="Search invoices…"
                                serverside
                            />
                        </FormField>
                    )}

                    {/* Bill / purchase link */}
                    {fields.includes('billLink') && (
                        <FormField label="Link bill / purchase">
                            <SmartDropdown
                                items={purchases}
                                value={purchaseSearch}
                                onChange={(v) => setPurchaseSearch(v)}
                                onSelect={(item) => setSelectedPurchase(item ? { id: String(item.id), name: item.name } : null)}
                                selectedItem={selectedPurchase ? { id: selectedPurchase.id, name: selectedPurchase.name } : null}
                                placeholder="Search purchases…"
                                serverside
                            />
                        </FormField>
                    )}

                    {/* Credit note link (credit_note_refund) */}
                    {fields.includes('creditNoteLink') && (
                        <FormField label="Link credit note" required>
                            <SmartDropdown
                                items={creditNotes}
                                value={creditNoteSearch}
                                onChange={(v) => setCreditNoteSearch(v)}
                                onSelect={(item) => setSelectedCreditNote(item ? { id: String(item.id), name: item.name } : null)}
                                selectedItem={selectedCreditNote ? { id: selectedCreditNote.id, name: selectedCreditNote.name } : null}
                                placeholder="Search credit notes…"
                                serverside
                            />
                        </FormField>
                    )}

                    {/* Disposed asset link (capital_asset_disposal) */}
                    {fields.includes('disposedAssetLink') && (
                        <FormField label="Asset being disposed" required>
                            <SmartDropdown
                                items={assets}
                                value={assetSearch}
                                onChange={(v) => setAssetSearch(v)}
                                onSelect={(item) => setSelectedAsset(item ? { id: String(item.id), name: item.name } : null)}
                                selectedItem={selectedAsset ? { id: selectedAsset.id, name: selectedAsset.name } : null}
                                placeholder="Search fixed assets…"
                                serverside
                            />
                        </FormField>
                    )}

                    {/* Asset fields */}
                    {fields.includes('assetFields') && (
                        <div className="space-y-3 rounded-control bg-surface border border-border p-3">
                            <p className="text-xs font-medium text-body uppercase tracking-wide">Asset details</p>

                            <FormField
                                label="Asset type"
                                type="text"
                                value={assetType}
                                onChange={(e) => setAssetType(e.target.value)}
                                placeholder="e.g. Computer equipment"
                            />

                            <Select
                                label="Depreciation method"
                                value={depreciationMethod}
                                onChange={(e) => setDepreciationMethod(e.target.value)}
                                options={DEPRECIATION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                                helper={DEPRECIATION_OPTIONS.find((o) => o.value === depreciationMethod)?.help}
                            />

                            <FormField
                                label="Useful life (months)"
                                type="number"
                                min="1"
                                step="1"
                                value={assetLifeMonths}
                                onChange={(e) => setAssetLifeMonths(e.target.value)}
                                placeholder="e.g. 60"
                            />
                        </div>
                    )}
                </>
            )}

            {/* Description */}
            <FormField label="Description">
                {(field) => (
                    <textarea
                        id={field.id}
                        aria-describedby={field['aria-describedby']}
                        rows={2}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Optional description or notes…"
                        className={`${fieldControlClasses()} resize-none`}
                    />
                )}
            </FormField>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
                {txn.explainStatus === 'EXPLAINED' && (
                    <Button
                        type="button"
                        variant="warning"
                        size="sm"
                        disabled={isUnexplaining || isSubmitting}
                        isLoading={isUnexplaining}
                        onClick={handleUnexplain}
                        className="mr-auto"
                    >
                        {isUnexplaining ? 'Removing…' : 'Un-explain'}
                    </Button>
                )}
                <Button
                    type="button"
                    variant="primary"
                    disabled={isSubmitting || isUnexplaining || !selectedTypeKey}
                    isLoading={isSubmitting}
                    onClick={handleSubmit}
                >
                    {isSubmitting ? 'Saving…' : 'Save'}
                </Button>
            </div>
        </div>
    );
};

export default ExplainTransactionForm;
