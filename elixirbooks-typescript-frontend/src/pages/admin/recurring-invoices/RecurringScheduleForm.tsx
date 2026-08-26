import React, { useEffect, useState, useMemo } from 'react';
import { PlusCircle, Loader2Icon } from 'lucide-react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import DateInput from '@components/admin/DateInput';
import InvoiceTableRow from '@components/admin/InvoiceTableRow';
import CreateProductForm from '@components/admin/CreateProductForm';
import CurrencySelect from '@components/admin/CurrencySelect';
import LineTaxSelect from '@components/admin/LineTaxSelect';
import ContactPicker from '@components/admin/ContactPicker';
import { Button } from '@components/ui';
import { PageHeader } from '@/context/PageHeaderContext';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import { useCurrencies } from '@hooks/useCurrencies';
import { numberToWords } from '@utils/converters';
import { recomputeLineTaxesByIds, recomputeLineTaxesFromComponents, applyFlatRateToLine, resolveLineTaxByRateId } from '@lib/lineTax';
import { round2 } from '@utils/round2';
import { useLineItemCustomFields } from '@hooks/useLineItemCustomFields';
import { validateLineCustomFields } from '@lib/lineCustomFields';

import type { Product } from '@models/product';
import type { TaxRate, TaxLine } from '@models/taxRate';
import type { Contact } from '@models/contact';

// --- Local types --------------------------------------------------------------

interface taxGroup {
    id: string;
    tax_name: string;
    total_tax_rate: number;
    tax_rates: { id: string; tax_name: string; tax_rate: number }[];
}

interface ProductItem {
    id: string;
    name: string;
    unit: string;
    qty: number;
    rate: number;
    discount: number;
    tax: number;
    amount: number;
    tax_group_id?: string;
    tax_rate_id?: string;
    discount_type?: 'Fixed' | 'Percentage';
    discount_value?: number;
    taxes?: TaxLine[];
    totalTax?: number;
    appliedTaxRateIds?: string[];
    customFields?: Record<string, string | number | boolean | string[]>;
}

type RepeatEvery = 'day' | 'week' | 'month' | 'year' | 'custom';
type CustomIntervalType = 'day' | 'week' | 'month' | 'year';
type TaxTreatment = 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'REVERSE_CHARGE' | 'OUT_OF_SCOPE';
type EndCondition = 'never' | 'onDate' | 'afterN';

interface ScheduleFormData {
    name: string;
    contactId: string;
    currencyCode: string;
    taxTreatment: TaxTreatment;
    items: ProductItem[];
    notes: string;
    termsAndCondition: string;
    repeatEvery: RepeatEvery;
    customIntervalNumber: number | null;
    customIntervalType: CustomIntervalType | null;
    startOn: Date | null;
    endsOn: Date | null;
    maxOccurrences: number | null;
    endCondition: EndCondition;
}

const blankItem = (): ProductItem => ({
    id: crypto.randomUUID(),
    name: '',
    unit: '',
    qty: 1,
    rate: 0,
    discount: 0,
    discount_type: 'Fixed',
    tax: 0,
    amount: 0,
});

const toIsoDate = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const RecurringScheduleForm: React.FC = () => {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const isEdit = Boolean(id);
    const { token } = useSelector((state: RootState) => state.auth);
    const { defaultCurrencyCode, resolveCurrency, formatMoney } = useCurrencies();
    const { fields: lineFields } = useLineItemCustomFields(token, 'invoices');

    const [formData, setFormData] = useState<ScheduleFormData>({
        name: '',
        contactId: '',
        currencyCode: defaultCurrencyCode,
        taxTreatment: 'STANDARD',
        items: [blankItem()],
        notes: '',
        termsAndCondition: '',
        repeatEvery: 'month',
        customIntervalNumber: null,
        customIntervalType: null,
        startOn: new Date(),
        endsOn: null,
        maxOccurrences: null,
        endCondition: 'never',
    });

    const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
    // Grandfathering reference for mandatory line custom fields — set only when
    // editing an existing schedule; create mode stays null (strict enforcement).
    const [docCreatedAt, setDocCreatedAt] = useState<string | null>(null);
    const [taxes, setTaxes] = useState<taxGroup[]>([]);
    const [taxRateLibrary, setTaxRateLibrary] = useState<TaxRate[]>([]);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(isEdit);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // --- Data loads -----------------------------------------------------------
    useEffect(() => {
        const fetchTaxes = async () => {
            if (!token) return;
            try {
                const res = await axios.get(Constants.FETCH_TAX_GROUPS_URL, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                setTaxes(res.data.data ?? []);
            } catch {
                setTaxes([]);
            }
        };
        fetchTaxes();
    }, [token]);

    useEffect(() => {
        if (!token) return;
        axios
            .get(`${Constants.GET_TAX_RATES_FOR_LIST_URL}?limit=100&isActive=true`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((r) => {
                const list = r.data?.data?.taxRates ?? r.data?.data ?? [];
                setTaxRateLibrary(Array.isArray(list) ? list : []);
            })
            .catch(() => setTaxRateLibrary([]));
    }, [token]);

    // Edit prefill: GET /recurring-schedules/:id
    useEffect(() => {
        if (!isEdit || !id || !token) return;
        let cancelled = false;
        (async () => {
            try {
                setIsLoading(true);
                const res = await axios.get(`${Constants.RECURRING_SCHEDULES_URL}/${id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const s = res.data?.data;
                if (!s || cancelled) return;

                const items: ProductItem[] = Array.isArray(s.items) && s.items.length
                    ? s.items.map((it: any) => ({
                        id: it.id ?? crypto.randomUUID(),
                        name: it.name ?? '',
                        unit: it.unit ?? '',
                        qty: Number(it.qty ?? 1),
                        rate: Number(it.rate ?? 0),
                        discount: Number(it.discount ?? 0),
                        tax: Number(it.tax ?? it.totalTax ?? 0),
                        amount: Number(it.amount ?? 0),
                        tax_group_id: it.tax_group_id,
                        tax_rate_id: it.tax_rate_id ?? '',
                        discount_type: it.discount_type ?? 'Fixed',
                        discount_value: it.discount_value,
                        customFields: it.customFields,
                        taxes: it.taxes ?? [],
                        totalTax: Number(it.totalTax ?? it.tax ?? 0),
                        appliedTaxRateIds:
                            it.appliedTaxRateIds ?? (it.taxes ?? []).map((t: TaxLine) => t.taxRateId),
                    }))
                    : [blankItem()];

                const contactId = s.contactId ?? '';
                setSelectedContactId(contactId || null);
                setDocCreatedAt((s.createdAt as string | undefined) ?? null);

                const endCondition: EndCondition = s.neverExpire
                    ? 'never'
                    : s.maxOccurrences != null
                        ? 'afterN'
                        : s.endsOn
                            ? 'onDate'
                            : 'never';

                setFormData({
                    name: s.name ?? '',
                    contactId,
                    currencyCode: s.currencyCode ?? defaultCurrencyCode,
                    taxTreatment: (s.taxTreatment as TaxTreatment) ?? 'STANDARD',
                    items,
                    notes: s.notes ?? '',
                    termsAndCondition: s.termsAndCondition ?? '',
                    repeatEvery: (s.repeatEvery as RepeatEvery) ?? 'month',
                    customIntervalNumber: s.customIntervalNumber ?? null,
                    customIntervalType: (s.customIntervalType as CustomIntervalType) ?? null,
                    startOn: s.startOn ? new Date(s.startOn) : new Date(),
                    endsOn: s.endsOn ? new Date(s.endsOn) : null,
                    maxOccurrences: s.maxOccurrences ?? null,
                    endCondition,
                });
            } catch {
                toast.error('Could not load the schedule.');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, isEdit, token]);

    // --- Handlers -------------------------------------------------------------
    const handleFormChange = (field: keyof ScheduleFormData, value: any) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        if (formErrors[field]) {
            setFormErrors((prev) => {
                const next = { ...prev };
                delete next[field];
                return next;
            });
        }
    };

    const handleContactChange = (contactId: string | null, contact: Contact | null) => {
        setSelectedContactId(contactId);
        setFormData((prev) => ({
            ...prev,
            contactId: contactId ?? '',
            currencyCode: contact?.currencyCode || prev.currencyCode,
            taxTreatment: contact?.defaultTaxTreatment ?? prev.taxTreatment,
        }));
        if (formErrors.contactId) {
            setFormErrors((prev) => {
                const next = { ...prev };
                delete next.contactId;
                return next;
            });
        }
    };

    // Recompute a single line's taxes against the resolved tax rates.
    const recomputeLineTaxes = (line: ProductItem, appliedTaxRateIds: string[]): ProductItem => {
        const result = recomputeLineTaxesByIds(line, appliedTaxRateIds, taxRateLibrary);
        return {
            ...line,
            taxes: result.taxes,
            totalTax: result.totalTax,
            tax: result.totalTax,
            amount: result.amount,
            appliedTaxRateIds: result.appliedTaxRateIds,
        };
    };

    // Apply a resolved (or flat-fallback) single-rate tax pick to one line.
    // C7 resolve-line responses may contain engine-provisioned system-component
    // taxRateIds NOT present in taxRateLibrary — always rescale via
    // recomputeLineTaxesFromComponents, never recomputeLineTaxesByIds here.
    const applyResolvedToLine = (
        it: ProductItem,
        taxRateId: string,
        resolved: Awaited<ReturnType<typeof resolveLineTaxByRateId>>,
    ): ProductItem => {
        const lineTaxable = { qty: Number(it.qty || 0), rate: Number(it.rate || 0), discount: Number(it.discount || 0) };
        const r = resolved
            ? { ...recomputeLineTaxesFromComponents(lineTaxable, resolved.taxes), appliedTaxRateIds: resolved.appliedTaxRateIds }
            : applyFlatRateToLine(lineTaxable, taxRateLibrary.find((x) => x.id === taxRateId) ?? null);
        return { ...it, tax_rate_id: taxRateId, tax_group_id: '', taxes: r.taxes, totalTax: r.totalTax, tax: r.totalTax, amount: r.amount, appliedTaxRateIds: r.appliedTaxRateIds };
    };

    // No party id on a schedule row resolve — valid per C7 (taxableAmount +
    // taxRateId alone); the schedule's contact is only used for invoice
    // generation later, not for this editor's tax preview.
    const handleRowTaxSelect = async (rowId: string, taxRateId: string, snapshot?: { qty: number; rate: number; discount: number }) => {
        if (!taxRateId) {
            setFormData((prev) => ({
                ...prev,
                items: prev.items.map((it) => it.id === rowId ? {
                    ...it, tax_rate_id: '', tax_group_id: '', taxes: [], totalTax: 0, tax: 0, appliedTaxRateIds: [],
                    amount: round2(Number(it.qty || 0) * Number(it.rate || 0) - Number(it.discount || 0)),
                } : it),
            }));
            return;
        }
        const line = snapshot ?? formData.items.find((i) => i.id === rowId);
        if (!line) return;
        const taxableAmount = round2(Number(line.qty || 0) * Number(line.rate || 0) - Number(line.discount || 0));
        const resolved = await resolveLineTaxByRateId({ token: token!, taxableAmount, taxRateId });
        setFormData((prev) => ({
            ...prev,
            items: prev.items.map((it) => (it.id === rowId ? applyResolvedToLine(it, taxRateId, resolved) : it)),
        }));
    };

    // In-line product row change — identical math to CreateInvoice.
    const handleInLineItemChange = (product: ProductItem, rowId: string) => {
        const { qty, rate, discount_value, discount_type, tax_group_id } = product;
        const subtotal = qty * rate;

        const discountAmount = discount_type === 'Percentage'
            ? (subtotal * (discount_value || 0)) / 100
            : (discount_value || 0);

        const discountedSubtotal = subtotal - discountAmount;

        const selectedTaxGroup = taxes.find((t) => String(t.id) === String(tax_group_id));
        const taxRate = selectedTaxGroup?.total_tax_rate || 0;
        const taxPerUnit = (rate * taxRate) / 100;
        const totalTax = taxPerUnit * qty;
        const newAmount = discountedSubtotal + totalTax;

        let updatedProduct: ProductItem = { ...product, discount: discountAmount, tax: totalTax, amount: newAmount };

        const stickyIds = product.appliedTaxRateIds ?? [];
        if (stickyIds.length > 0) {
            // Resolved components (C7) may be engine-provisioned system rows absent
            // from taxRateLibrary — rescale components, don't re-look-up by id.
            const components = product.taxes ?? [];
            if (components.length > 0) {
                const result = recomputeLineTaxesFromComponents(updatedProduct, components);
                updatedProduct = {
                    ...updatedProduct,
                    taxes: result.taxes,
                    totalTax: result.totalTax,
                    tax: result.totalTax,
                    amount: result.amount,
                    appliedTaxRateIds: stickyIds,
                };
            } else {
                updatedProduct = recomputeLineTaxes(updatedProduct, stickyIds);
            }
        } else if (product.tax_rate_id) {
            const flat = applyFlatRateToLine(updatedProduct, taxRateLibrary.find((r) => r.id === product.tax_rate_id) ?? null);
            updatedProduct = {
                ...updatedProduct,
                taxes: flat.taxes,
                totalTax: flat.totalTax,
                tax: flat.totalTax,
                amount: flat.amount,
                appliedTaxRateIds: flat.appliedTaxRateIds,
            };
        } else if (selectedTaxGroup && selectedTaxGroup.tax_rates.length > 0) {
            const groupMemberIds = selectedTaxGroup.tax_rates.map((r) => r.id);
            const syntheticRates: TaxRate[] = selectedTaxGroup.tax_rates.map((r) => {
                const found = taxRateLibrary.find((lib) => lib.id === r.id);
                if (found) return found;
                return {
                    id: r.id, name: r.tax_name, rate: r.tax_rate, regime: 'NONE',
                    taxKind: null, countryId: null, stateId: null, isActive: true,
                    createdAt: '', updatedAt: '',
                } as TaxRate;
            });
            const result = recomputeLineTaxesByIds(updatedProduct, groupMemberIds, syntheticRates);
            updatedProduct = {
                ...updatedProduct,
                taxes: result.taxes,
                totalTax: result.totalTax,
                tax: result.totalTax,
                amount: result.amount,
                appliedTaxRateIds: result.appliedTaxRateIds,
            };
        } else {
            const appliedIds = product.appliedTaxRateIds ?? (product.taxes ?? []).map((t) => t.taxRateId);
            if (appliedIds.length > 0) {
                updatedProduct = recomputeLineTaxes(updatedProduct, appliedIds);
            }
        }

        setFormData((prev) => ({
            ...prev,
            items: prev.items.map((item) => (item.id === rowId ? updatedProduct : item)),
        }));
    };

    const handleNewProductCreated = (product: Product) => {
        const discount_type = product.discount?.type;
        const discount_value = product.discount?.value;
        const rate = product.prices?.selling ?? 0;
        const subtotal = rate;
        const discountAmount = discount_type === 'Percentage'
            ? (subtotal * (discount_value || 0)) / 100
            : (discount_value || 0);
        // Prefer the unified-tax rate (single per-line TaxRate) over the legacy
        // tax-group total when seeding the flat percent for a quick-created product.
        const taxRate = product.tax_rate?.rate ?? product.tax?.total_rate ?? 0;
        const totalTax = (rate * taxRate) / 100;
        const newAmount = subtotal - discountAmount + totalTax;

        let updated = false;
        setFormData((prev) => ({
            ...prev,
            items: prev.items.map((item) => {
                if (!updated && item.name === '') {
                    updated = true;
                    return {
                        ...item,
                        id: product.id,
                        name: product.name,
                        unit: product.unit?.name ?? '',
                        qty: 1,
                        rate,
                        amount: newAmount,
                        discount: discountAmount,
                        tax: totalTax,
                        tax_group_id: product.tax?.group_id,
                        tax_rate_id: product.tax_rate?.taxRateId ?? '',
                        discount_type: product.discount?.type || 'Fixed',
                        discount_value: product.discount?.value,
                    };
                }
                return item;
            }),
        }));
        setIsProductModalOpen(false);
        if (product.tax_rate?.taxRateId) {
            void handleRowTaxSelect(product.id, product.tax_rate.taxRateId, { qty: 1, rate, discount: discountAmount });
        }
    };

    const handleNewRow = () => {
        setFormData((prev) => ({ ...prev, items: [...prev.items, blankItem()] }));
    };

    const handleRemoveItem = (itemToRemove: ProductItem) => {
        handleFormChange('items', formData.items.filter((item) => item.id !== itemToRemove.id));
    };

    // Edit-item modal is not part of the schedule editor; rows are edited inline.
    const handleEditItem = () => { /* inline editing only */ };

    // --- Totals (identical aggregation to CreateInvoice) ----------------------
    const { subTotal, totalTax, totalDiscount, grandTotal } = useMemo(() => {
        const totals = formData.items.reduce(
            (acc, item) => {
                acc.subTotal += item.rate * item.qty;
                acc.totalDiscount += item.discount;
                acc.totalTax += item.tax;
                return acc;
            },
            { subTotal: 0, totalTax: 0, totalDiscount: 0 },
        );
        const grand = totals.subTotal - totals.totalDiscount + totals.totalTax;
        return {
            subTotal: round2(totals.subTotal),
            totalTax: round2(totals.totalTax),
            totalDiscount: round2(totals.totalDiscount),
            grandTotal: round2(grand),
        };
    }, [formData.items]);

    const totalInWords = useMemo(() => {
        if (grandTotal <= 0) return 'Zero';
        return numberToWords(Math.floor(grandTotal));
    }, [grandTotal]);

    const docCurrencyCode = formData.currencyCode || defaultCurrencyCode;
    const fmtMoney = (amount: number) => formatMoney(amount, docCurrencyCode);
    // Touch resolveCurrency so currencyCode always resolves to a known currency.
    resolveCurrency(docCurrencyCode);

    // --- Validation -----------------------------------------------------------
    const validate = (): { [key: string]: string } => {
        const e: { [key: string]: string } = {};
        if (!formData.contactId.trim()) e.contactId = 'Customer is required.';
        if (!formData.startOn) e.startOn = 'Start date is required.';
        if (formData.repeatEvery === 'custom') {
            if (!formData.customIntervalNumber) e.customIntervalNumber = 'Interval number is required.';
            if (!formData.customIntervalType) e.customIntervalType = 'Interval type is required.';
        }
        if (formData.endCondition === 'onDate' && !formData.endsOn) {
            e.endsOn = 'End date is required.';
        }
        if (formData.endCondition === 'afterN' && (!formData.maxOccurrences || formData.maxOccurrences < 1)) {
            e.maxOccurrences = 'A positive number of occurrences is required.';
        }
        const hasItem = formData.items.some((item) => (item.name ?? '').trim() !== '');
        if (!hasItem) e.items = 'At least one item is required.';
        const lineFieldError = validateLineCustomFields(formData.items, lineFields, docCreatedAt);
        if (lineFieldError) e.lineCustomFields = lineFieldError;
        setFormErrors(e);
        return e;
    };

    // --- Submit ---------------------------------------------------------------
    const buildPayload = () => {
        const items = formData.items
            .filter((item) => (item.name ?? '').trim() !== '')
            .map((item) => ({
                name: item.name,
                unit: item.unit,
                qty: item.qty,
                rate: item.rate,
                discount: item.discount,
                discount_type: item.discount_type,
                discount_value: item.discount_value,
                tax: item.tax,
                amount: item.amount,
                tax_group_id: item.tax_group_id,
                tax_rate_id: item.tax_rate_id || undefined,
                customFields: item.customFields,
                taxes: item.taxes ?? [],
                totalTax: item.totalTax ?? item.tax ?? 0,
                appliedTaxRateIds: item.appliedTaxRateIds ?? (item.taxes ?? []).map((t) => t.taxRateId),
            }));

        return {
            name: formData.name || undefined,
            contactId: formData.contactId,
            currencyCode: formData.currencyCode || undefined,
            taxTreatment: formData.taxTreatment,
            items,
            taxableAmount: +(subTotal - totalDiscount).toFixed(2),
            totalDiscount: +totalDiscount.toFixed(2),
            totalTax: +totalTax.toFixed(2),
            roundOff: +(grandTotal - (subTotal - totalDiscount + totalTax)).toFixed(2),
            TotalAmount: grandTotal,
            notes: formData.notes || undefined,
            termsAndCondition: formData.termsAndCondition || undefined,
            repeatEvery: formData.repeatEvery,
            customIntervalNumber:
                formData.repeatEvery === 'custom' ? formData.customIntervalNumber : undefined,
            customIntervalType:
                formData.repeatEvery === 'custom' ? formData.customIntervalType : undefined,
            startOn: formData.startOn ? toIsoDate(formData.startOn) : undefined,
            endsOn:
                formData.endCondition === 'onDate' && formData.endsOn
                    ? toIsoDate(formData.endsOn)
                    : undefined,
            neverExpire: formData.endCondition === 'never',
            maxOccurrences:
                formData.endCondition === 'afterN' ? formData.maxOccurrences : undefined,
        };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const errors = validate();
        if (Object.keys(errors).length > 0) {
            toast.error(errors.lineCustomFields || 'Please check the form for errors.');
            return;
        }
        try {
            setIsSubmitting(true);
            const payload = buildPayload();
            const headers = {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            };
            if (isEdit && id) {
                await axios.put(`${Constants.RECURRING_SCHEDULES_URL}/${id}`, payload, { headers });
                toast.success('Schedule updated successfully.');
            } else {
                await axios.post(Constants.RECURRING_SCHEDULES_URL, payload, { headers });
                toast.success('Schedule created successfully.');
            }
            navigate('/admin/recurring-invoices');
        } catch (err: any) {
            if (err.response?.data?.errors) {
                setFormErrors(err.response.data.errors);
                toast.error('Please check the form for errors.');
            } else if (axios.isAxiosError(err) && err.response?.data?.message) {
                toast.error(err.response.data.message);
            } else {
                toast.error('An unexpected error occurred.');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <Loader2Icon className="animate-spin text-purple-600 h-10 w-10" />
            </div>
        );
    }

    const inputClass =
        'border border-gray-300 rounded-md px-4 py-2 w-full text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600';

    return (
        <div className="md:p-4 bg-white-50 min-h-screen border border-gray-200 rounded">
            <form onSubmit={handleSubmit}>
                <div className="max-w-7xl mx-auto space-y-4">
                    <PageHeader title={isEdit ? 'Edit Recurring Schedule' : 'New Recurring Schedule'} />

                    <p className="text-xs text-gray-500">
                        A schedule is a non-posting template. It does not affect the ledger or inventory —
                        only the invoices it generates do.
                    </p>

                    {/* Top: name + currency */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-900">Schedule Name</label>
                            <input
                                type="text"
                                className={`mt-1 ${inputClass}`}
                                placeholder="e.g. Monthly retainer"
                                value={formData.name}
                                onChange={(e) => handleFormChange('name', e.target.value)}
                            />
                        </div>
                        <div>
                            <CurrencySelect
                                label="Currency"
                                value={formData.currencyCode}
                                onChange={(code) => handleFormChange('currencyCode', code)}
                            />
                        </div>
                    </div>

                    {/* Customer */}
                    <div className="bg-white p-4 rounded-lg border border-gray-200">
                        <h3 className="font-bold text-gray-950 mb-4">
                            Customer <span className="text-red-500">*</span>
                        </h3>
                        <ContactPicker
                            view="all-active"
                            value={selectedContactId}
                            onChange={handleContactChange}
                            error={formErrors?.contactId}
                        />
                    </div>

                    {/* Cadence */}
                    <div className="bg-white p-4 rounded-lg border border-gray-200">
                        <h3 className="font-bold text-gray-950 mb-4">Cadence</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Repeat Every <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={formData.repeatEvery}
                                    onChange={(e) => handleFormChange('repeatEvery', e.target.value as RepeatEvery)}
                                    className={inputClass}
                                >
                                    <option value="day">Day</option>
                                    <option value="week">Week</option>
                                    <option value="month">Month</option>
                                    <option value="year">Year</option>
                                    <option value="custom">Custom</option>
                                </select>
                            </div>

                            {formData.repeatEvery === 'custom' && (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Interval <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="number"
                                            min={1}
                                            value={formData.customIntervalNumber ?? ''}
                                            onChange={(e) =>
                                                handleFormChange(
                                                    'customIntervalNumber',
                                                    e.target.value ? Number(e.target.value) : null,
                                                )
                                            }
                                            placeholder="Enter Number"
                                            className={inputClass}
                                        />
                                        {formErrors?.customIntervalNumber && (
                                            <span className="text-red-500 text-sm">{formErrors.customIntervalNumber}</span>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Interval Type <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={formData.customIntervalType ?? ''}
                                            onChange={(e) =>
                                                handleFormChange(
                                                    'customIntervalType',
                                                    (e.target.value || null) as CustomIntervalType | null,
                                                )
                                            }
                                            className={inputClass}
                                        >
                                            <option value="">Select…</option>
                                            <option value="day">Day(s)</option>
                                            <option value="week">Week(s)</option>
                                            <option value="month">Month(s)</option>
                                            <option value="year">Year(s)</option>
                                        </select>
                                        {formErrors?.customIntervalType && (
                                            <span className="text-red-500 text-sm">{formErrors.customIntervalType}</span>
                                        )}
                                    </div>
                                </>
                            )}

                            <div>
                                <DateInput
                                    label="Start On"
                                    value={formData.startOn}
                                    onChange={(d) => handleFormChange('startOn', d)}
                                    isRequired
                                />
                                {formErrors?.startOn && (
                                    <span className="text-red-500 text-sm">{formErrors.startOn}</span>
                                )}
                            </div>
                        </div>

                        {/* End condition */}
                        <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Ends</label>
                            <div className="flex flex-col gap-3">
                                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="endCondition"
                                        checked={formData.endCondition === 'never'}
                                        onChange={() => handleFormChange('endCondition', 'never')}
                                        className="h-4 w-4 text-purple-600"
                                    />
                                    Never
                                </label>

                                <div className="flex items-center gap-3 flex-wrap">
                                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="endCondition"
                                            checked={formData.endCondition === 'onDate'}
                                            onChange={() => handleFormChange('endCondition', 'onDate')}
                                            className="h-4 w-4 text-purple-600"
                                        />
                                        On date
                                    </label>
                                    {formData.endCondition === 'onDate' && (
                                        <div className="w-56">
                                            <DateInput
                                                label=""
                                                value={formData.endsOn}
                                                onChange={(d) => handleFormChange('endsOn', d)}
                                                minDate={formData.startOn || new Date()}
                                            />
                                            {formErrors?.endsOn && (
                                                <span className="text-red-500 text-sm">{formErrors.endsOn}</span>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center gap-3 flex-wrap">
                                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="endCondition"
                                            checked={formData.endCondition === 'afterN'}
                                            onChange={() => handleFormChange('endCondition', 'afterN')}
                                            className="h-4 w-4 text-purple-600"
                                        />
                                        After
                                    </label>
                                    {formData.endCondition === 'afterN' && (
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="number"
                                                min={1}
                                                value={formData.maxOccurrences ?? ''}
                                                onChange={(e) =>
                                                    handleFormChange(
                                                        'maxOccurrences',
                                                        e.target.value ? Number(e.target.value) : null,
                                                    )
                                                }
                                                placeholder="N"
                                                className="border border-gray-300 rounded-md px-3 py-2 w-24 text-gray-950 focus:outline-none focus:ring-1 focus:ring-purple-600"
                                            />
                                            <span className="text-sm text-gray-600">occurrences</span>
                                            {formErrors?.maxOccurrences && (
                                                <span className="text-red-500 text-sm">{formErrors.maxOccurrences}</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Tax treatment */}
                    <div className="bg-white p-4 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-4 flex-wrap">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Tax Treatment</label>
                                <select
                                    value={formData.taxTreatment}
                                    onChange={(e) => handleFormChange('taxTreatment', e.target.value as TaxTreatment)}
                                    className="border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-600"
                                >
                                    <option value="STANDARD">Standard</option>
                                    <option value="ZERO_RATED">Zero-rated</option>
                                    <option value="EXEMPT">Exempt</option>
                                    <option value="REVERSE_CHARGE">Reverse charge</option>
                                    <option value="OUT_OF_SCOPE">Out of scope</option>
                                </select>
                            </div>
                            {formData.taxTreatment !== 'STANDARD' && (
                                <p className="text-sm text-amber-600 font-medium mt-5">
                                    Tax suppressed — {formData.taxTreatment.replace(/_/g, ' ').toLowerCase()}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Line items */}
                    <div className="bg-white rounded-lg border border-gray-200 mt-4">
                        <div className="p-4">
                            {formErrors?.items && <span className="text-red-500 text-sm">{formErrors.items}</span>}
                            <table className="w-full border-separate border-spacing-0 overflow-x-auto">
                                <thead className="bg-gray-100 text-gray-900">
                                    <tr>
                                        <th className="p-3 text-left text-sm font-semibold rounded-tl-md">Item</th>
                                        {lineFields.map((f) => (
                                            <th key={f.fieldSlug} className="p-3 text-left text-sm font-semibold">{f.labelName}</th>
                                        ))}
                                        <th className="p-3 text-left text-sm font-semibold">Unit</th>
                                        <th className="p-3 text-left text-sm font-semibold">Quantity</th>
                                        <th className="p-3 text-left text-sm font-semibold">Rate</th>
                                        <th className="p-3 text-left text-sm font-semibold">Discount</th>
                                        <th className="p-3 text-left text-sm font-semibold">Tax</th>
                                        <th className="p-3 text-left text-sm font-semibold">Amount</th>
                                        <th className="p-3 text-left text-sm font-semibold rounded-tr-md">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {formData.items.map((item) => (
                                        <React.Fragment key={item.id}>
                                            <InvoiceTableRow
                                                item={item}
                                                currencyCode={formData.currencyCode}
                                                onInLineItemChange={(updatedItem) =>
                                                    handleInLineItemChange(updatedItem, item.id)
                                                }
                                                onEditItem={handleEditItem}
                                                onDeleteItem={handleRemoveItem}
                                                availableItems={formData.items}
                                                addNewProduct={() => setIsProductModalOpen(true)}
                                                lineFields={lineFields}
                                            />
                                            <tr className="bg-gray-50">
                                                <td colSpan={8 + lineFields.length} className="px-3 py-2 border-b border-gray-200">
                                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                                        <span className="text-gray-600 font-medium">Taxes:</span>
                                                        {(item.taxes ?? []).length === 0 && (
                                                            <span className="text-gray-400 italic">No taxes applied</span>
                                                        )}
                                                        {(item.taxes ?? []).map((t, idx) => (
                                                            <span
                                                                key={`${t.taxRateId}-${idx}`}
                                                                className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full"
                                                            >
                                                                {t.kind ? `${t.kind} ` : ''}{t.percent}% · {fmtMoney(t.amount)}
                                                            </span>
                                                        ))}
                                                        <span className="ml-auto flex items-center gap-3">
                                                            {formData.taxTreatment === 'STANDARD' ? (
                                                                <LineTaxSelect
                                                                    taxRates={taxRateLibrary}
                                                                    value={item.tax_rate_id ?? ''}
                                                                    legacyLabel={(item.taxes ?? []).length > 0
                                                                        ? `Current: ${(item.taxes ?? []).map((t) => `${t.kind ?? t.name} ${t.percent}%`).join(' + ')}`
                                                                        : null}
                                                                    onSelect={(rateId) => { void handleRowTaxSelect(item.id, rateId); }}
                                                                />
                                                            ) : (
                                                                <span className="text-xs text-amber-600 italic">Tax suppressed</span>
                                                            )}
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        </React.Fragment>
                                    ))}
                                    {formData.items.length === 0 && (
                                        <tr className="bg-white text-gray-950">
                                            <td className="p-3 font-medium text-center" colSpan={8 + lineFields.length}>
                                                No Items Selected
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            <div className="p-4 flex">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleNewRow}
                                    leftIcon={<PlusCircle className="h-4 w-4" />}
                                    className="text-purple-600"
                                >
                                    Add New Row
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Notes / terms + totals */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Notes</label>
                                <textarea
                                    value={formData.notes}
                                    onChange={(e) => handleFormChange('notes', e.target.value)}
                                    rows={4}
                                    placeholder="Enter Notes"
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Terms &amp; Conditions</label>
                                <textarea
                                    value={formData.termsAndCondition}
                                    onChange={(e) => handleFormChange('termsAndCondition', e.target.value)}
                                    rows={4}
                                    placeholder="Enter Terms & Conditions"
                                    className={inputClass}
                                />
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-lg border border-gray-200 space-y-3 h-fit">
                            <div className="flex justify-between text-sm text-gray-600">
                                <span>Amount</span><span>{fmtMoney(subTotal)}</span>
                            </div>
                            <div className="flex justify-between text-sm text-gray-600">
                                <span>Tax</span><span>{fmtMoney(totalTax)}</span>
                            </div>
                            <div className="flex justify-between text-sm text-gray-600">
                                <span>Discount</span><span>- {fmtMoney(totalDiscount)}</span>
                            </div>
                            <hr className="border-gray-200" />
                            <div className="flex justify-between font-bold text-gray-950">
                                <span>Total</span>
                                <span>{fmtMoney(grandTotal)}</span>
                            </div>
                            <p className="text-sm text-gray-500 capitalize">{totalInWords}</p>
                        </div>
                    </div>

                    <div className="flex justify-end mt-4 gap-3">
                        <Button variant="white" type="button" onClick={() => navigate('/admin/recurring-invoices')}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isEdit ? 'Update Schedule' : 'Create Schedule'}
                        </Button>
                    </div>
                </div>
            </form>

            <CreateProductForm
                isOpen={isProductModalOpen}
                onClose={() => setIsProductModalOpen(false)}
                onSuccess={(newProduct: Product) => handleNewProductCreated(newProduct)}
            />
        </div>
    );
};

export default RecurringScheduleForm;
