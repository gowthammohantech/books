import React, { useEffect, useState, useMemo, useRef } from 'react';
import { PlusCircle, Edit, Mail, Settings, Loader2Icon } from 'lucide-react';
import DateInput from '@components/admin/DateInput';
import axios from 'axios';
import Constants from '@constants/api';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import { useDebounce } from '@hooks/useDebounce';
import Modal from '@components/admin/Modal';
import SignatureCanvas from 'react-signature-canvas';
import { numberToWords } from '@utils/converters';
import { toast } from "sonner";
import { useNavigate, useSearchParams } from 'react-router-dom';
import FullPageLoader from '@components/admin/FullPageLoader';
import AdminCard from '@components/admin/AdminCard';
import { resolveCompanyLogo } from '@utils/companyLogo';
import InvoiceTableRow from '@components/admin/InvoiceTableRow';
import CreateProductForm from '@components/admin/CreateProductForm';
import SmartDropdown from '@components/admin/SmartDropdown';
import CreateSignatureModal from './CreateSignatureModal';
import CreateBankAccountModal from './CreateBankAccountModal';
import InvoiceNumberConfigModal from './InvoiceNumberConfigModal';
import DynamicCustomFields from '@components/admin/DynamicCustomFields';
import CurrencySelect from '@components/admin/CurrencySelect';
import { useCurrencies } from '@hooks/useCurrencies';
import { useDocumentDefaults } from '@hooks/useDocumentDefaults';
import { useDirtyGuard, confirmIfDirty } from '@hooks/useDirtyGuard';
import { useLineItemCustomFields } from '@hooks/useLineItemCustomFields';
import { validateLineCustomFields } from '@lib/lineCustomFields';

// Type Imports
import type { OptionType, SelectedAdmin } from '@models/common';
import type { Product } from '@models/product';
import type { SignatureOptions } from '@models/signature';
import type { BankAccountCreatedResponse } from '@models/bank-account';
import type { TaxRate, TaxLine } from '@models/taxRate';
import LineTaxSelect from '@components/admin/LineTaxSelect';
import { recomputeLineTaxesByIds, recomputeLineTaxesFromComponents, appendLineTaxFormData, clampDiscountValue, applyFlatRateToLine, resolveLineTaxByRateId } from '@lib/lineTax';
import { round2 } from '@utils/round2';
import type { Contact } from '@models/contact';
import ContactPicker from '@components/admin/ContactPicker';
import { Button, FormField, Select, fieldControlClasses } from '@components/ui';
import { PageHeader } from "@/context/PageHeaderContext";

interface InvoiceFormData {
    invoiceNumber: string;
    invoiceDate: Date | null;
    dueDate: Date | null;
    status: string;
    billFrom: string;
    billTo: string;
    items: ProductItem[];
    notes: string;
    termsAndCondition: string;
    bank: string | null;
    sign_type: 'none' | 'digitalSignature' | 'eSignature';
    signatureId: string | null;
    signatureName: string;
    esignDataUrl: string | null;
    subTotal: number | null;
    totalTax: number | null;
    totalDiscount: number | null;
    grandTotal: number | null;
    customFields: Record<string, any>;
    vehicleId: string | null;
    invoiceType: 'INVOICE' | 'PROFORMA';
    currencyCode: string;
    contactId?: string;
    billToContactId?: string;
    taxTreatment: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'REVERSE_CHARGE' | 'OUT_OF_SCOPE';
}

interface taxGroup {
    id: string;
    tax_name: string;
    total_tax_rate: number;
    tax_rates: {
        id: string;
        tax_name: string;
        tax_rate: number;
    }[];
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


const CreateInvoice: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { defaultCurrencyCode, resolveCurrency, formatMoney } = useCurrencies();
    const { defaults: docDefaults, loading: docDefaultsLoading } = useDocumentDefaults();
    const { fields: lineFields } = useLineItemCustomFields(token, 'invoices');

    // Core State
    const [adminUsers, setAdminUsers] = useState<OptionType[]>([]);
    const [selectedAdmin, setSelectedAdmin] = useState<OptionType | null>(null);
    const [companyDetails, setCompanyDetails] = useState<SelectedAdmin | null>(null);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

    const [invoiceFormData, setInvoiceFormData] = useState<InvoiceFormData>({
        invoiceNumber: '',
        invoiceDate: new Date(),
        dueDate: null,
        status: 'DRAFT',
        billFrom: '',
        billTo: '',
        items: [{
            id: crypto.randomUUID(),
            name: '',
            unit: '',
            qty: 1,
            rate: 0,
            discount: 0,
            discount_type: 'Fixed',
            tax: 0,
            amount: 0
        }],
        notes: '',
        termsAndCondition: '',
        bank: null,
        sign_type: 'none',
        signatureId: null,
        signatureName: '',
        esignDataUrl: null,
        subTotal: null,
        totalTax: null,
        totalDiscount: null,
        grandTotal: null,
        customFields: {},
        vehicleId: null,
        invoiceType: 'INVOICE',
        currencyCode: defaultCurrencyCode,
        contactId: '',
        billToContactId: '',
        taxTreatment: 'STANDARD',
    });

    // Apply document defaults once loaded — seed blank new form, never overwrite user edits
    useEffect(() => {
        if (docDefaultsLoading) return;
        setInvoiceFormData(prev => {
            const updates: Partial<typeof prev> = {};

            // currencyCode: prefer docDefaults, fall back to company default
            if (!prev.currencyCode) {
                updates.currencyCode = docDefaults.defaultCurrencyCode || defaultCurrencyCode;
            } else if (prev.currencyCode === defaultCurrencyCode && docDefaults.defaultCurrencyCode) {
                // Still at the seeded company-default — upgrade to doc-default
                updates.currencyCode = docDefaults.defaultCurrencyCode;
            }

            // sign_type: only if still at the initial 'none'
            if (prev.sign_type === 'none' && docDefaults.defaultSignType !== 'none') {
                updates.sign_type = docDefaults.defaultSignType;
                if (docDefaults.defaultSignType === 'digitalSignature' && docDefaults.defaultSignatureId) {
                    updates.signatureId = docDefaults.defaultSignatureId;
                }
            }

            // dueDate: only if not yet set and paymentTermsDays is a positive number
            if (!prev.dueDate && typeof docDefaults.paymentTermsDays === 'number' && docDefaults.paymentTermsDays > 0) {
                const base = prev.invoiceDate ?? new Date();
                const due = new Date(base);
                due.setDate(due.getDate() + docDefaults.paymentTermsDays);
                updates.dueDate = due;
            }

            // notes: only if field is still empty
            if (!prev.notes && docDefaults.defaultNotes) {
                updates.notes = docDefaults.defaultNotes;
            }

            // termsAndCondition: only if field is still empty
            if (!prev.termsAndCondition && docDefaults.defaultTerms) {
                updates.termsAndCondition = docDefaults.defaultTerms;
            }

            if (Object.keys(updates).length === 0) return prev;
            return { ...prev, ...updates };
        });
    }, [docDefaultsLoading, docDefaults, defaultCurrencyCode]);

    // Edit Modal State
    const [isEditProductModalOpen, setIsEditProductModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<ProductItem | null>(null);
    const [taxes, setTaxes] = useState<taxGroup[]>([]);
    const [taxRateLibrary, setTaxRateLibrary] = useState<TaxRate[]>([]);
    // Id of a row just appended via Enter (see handleNewRow) whose name input
    // should receive focus once it's rendered — see the effect below.
    const [focusRowId, setFocusRowId] = useState<string | null>(null);

    // Extra Information State
    const [activeCustomFields, setActiveCustomFields] = useState<any[]>([]);
    const [activeInfoTab, setActiveInfoTab] = useState<'notes' | 'termsAndCondition' | 'bank'>('notes');
    const [bankAccounts, setBankAccounts] = useState<OptionType[]>([]);
    const [manualSignatures, setManualSignatures] = useState<SignatureOptions[]>([]);
    const [isSignatureModalOpen, setSignatureModalOpen] = useState(false);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const sigPadRef = useRef<SignatureCanvas>(null);
    // Cheap dirty flag (no deep-compare): flipped inside the page's central
    // change handlers, disarmed right before a successful save navigates away.
    const isDirtyRef = useRef(false);
    useDirtyGuard(isDirtyRef.current);
    const [isFetching, setIsFetching] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [partyStateMissing, setPartyStateMissing] = useState(false);
    const [signatureSearchInput, setSignatureSearchInput] = useState<string>('');
    const debouncedSearchTermSignature = useDebounce(signatureSearchInput, 500);
    const [isCreateSignModalOpen, setIsCreateSignModalOpen] = useState(false);
    const [bankAccountSearchInput, setBankAccountSearchInput] = useState<string>('');
    const debouncedSearchTermBankAccount = useDebounce(bankAccountSearchInput, 500);
    const [isCreateBankAccountModalOpen, setIsCreateBankAccountModalOpen] = useState(false);
    const [adminSearchInput, setAdminSearchInput] = useState<string>('');
    const [invoiceNumberConfigModalOpen, setInvoiceNumberConfigModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    // In-flight flags + one-shot error-toast guards for the dropdown-feeding list
    // fetches below — these can re-fire on every debounced keystroke, so a plain
    // toast in the catch would spam the user; the ref only re-arms after a fetch
    // succeeds.
    const [bankAccountsLoading, setBankAccountsLoading] = useState(false);
    const bankAccountsErrorShownRef = useRef(false);
    const [signaturesLoading, setSignaturesLoading] = useState(false);
    const signaturesErrorShownRef = useRef(false);
    const [adminUsersLoading, setAdminUsersLoading] = useState(false);
    const adminUsersErrorShownRef = useRef(false);

    // --- SHARED HANDLERS ---
    const handleFormChange = (field: keyof InvoiceFormData, value: any) => {
        isDirtyRef.current = true;
        setInvoiceFormData(prev => ({ ...prev, [field]: value }));
        if (formErrors[field]) {
            setFormErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[field];
                return newErrors;
            });
        }
    };

    const handleCustomFieldChange = (fieldSlugOrId: string, value: any) => {
        isDirtyRef.current = true;
        setInvoiceFormData(prev => ({
            ...prev,
            customFields: { ...prev.customFields, [fieldSlugOrId]: value }
        }));

        if (formErrors[`customField_${fieldSlugOrId}`]) {
            setFormErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[`customField_${fieldSlugOrId}`];
                return newErrors;
            });
        }
    };

    useEffect(() => {
        fetchAdminUsers();
        fetchTaxes();
        fetchNextInvoiceNumber();
    }, []);

    const fetchNextInvoiceNumber = async () => {
        try {
            setIsLoading(true);
            const response = await axios.get(Constants.FETCH_NEXT_INVOICE_NO_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            let data = response.data.data;
            if (data) {
                if (data.invoiceNumberType === 'auto') {
                    sessionStorage.setItem('defaultNextInvNo', data.nextInvoiceNumber);
                    sessionStorage.setItem('nextInvoiceNo', data.nextInvoiceNumber);
                    setInvoiceFormData(prev => ({ ...prev, invoiceNumber: data.nextInvoiceNumber }));
                } else {
                    sessionStorage.setItem('defaultNextInvNo', data.nextInvoiceNumber);
                    sessionStorage.setItem('nextInvoiceNo', data.nextInvoiceNumber);
                    setInvoiceFormData(prev => ({ ...prev, invoiceNumber: '' }));
                }
            }
        } catch (error) {
            toast.error('Failed to fetch next invoice number.');
        } finally {
            setIsLoading(false);
        }
    }

    const fetchTaxes = async () => {
        if (!token) return;
        try {
            const response = await axios.get(Constants.FETCH_TAX_GROUPS_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setTaxes(response.data.data);
        } catch (error) {
            setTaxes([]);
        }
    };

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

    const handleRowTaxSelect = async (rowId: string, taxRateId: string, snapshot?: { qty: number; rate: number; discount: number }) => {
        if (!taxRateId) {
            setPartyStateMissing(false);
            setInvoiceFormData((prev) => ({
                ...prev,
                items: prev.items.map((it) => it.id === rowId ? {
                    ...it, tax_rate_id: '', tax_group_id: '', taxes: [], totalTax: 0, tax: 0, appliedTaxRateIds: [],
                    amount: round2(Number(it.qty || 0) * Number(it.rate || 0) - Number(it.discount || 0)),
                } : it),
            }));
            return;
        }
        const line = snapshot ?? invoiceFormData.items.find((i) => i.id === rowId);
        if (!line) return;
        const taxableAmount = round2(Number(line.qty || 0) * Number(line.rate || 0) - Number(line.discount || 0));
        const resolved = await resolveLineTaxByRateId({
            token: token!, taxableAmount, taxRateId,
            ...(selectedContactId ? { customerId: selectedContactId } : {}),
        });
        setPartyStateMissing(!!resolved?.partyStateMissing);
        setInvoiceFormData((prev) => ({
            ...prev,
            items: prev.items.map((it) => (it.id === rowId ? applyResolvedToLine(it, taxRateId, resolved) : it)),
        }));
    };

    useEffect(() => {
        const fetchBankAccounts = async () => {
            try {
                setBankAccountsLoading(true);
                const response = await axios.get(Constants.FETCH_BANK_ACCOUNTS_WITH_SEARCH_URL, {
                    params: { search: debouncedSearchTermBankAccount },
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.data.data.length > 0) {
                    const formattedBankAccounts = response.data.data.map((item: any) => ({
                        id: item.id, name: item.bankName
                    }));
                    setBankAccounts(formattedBankAccounts);
                } else {
                    setBankAccounts([]);
                }
                bankAccountsErrorShownRef.current = false;
            } catch (error) {
                console.error('Error fetching bank accounts:', error);
                if (!bankAccountsErrorShownRef.current) {
                    bankAccountsErrorShownRef.current = true;
                    toast.error('Failed to load bank accounts.');
                }
            } finally {
                setBankAccountsLoading(false);
            }
        }
        fetchBankAccounts();
    }, [debouncedSearchTermBankAccount]);


    useEffect(() => {
        const fetchManualSignatures = async () => {
            try {
                setSignaturesLoading(true);
                const response = await axios.get(Constants.FETCH_SIGNATURES_WITH_SEARCH_URL, {
                    params: { search: debouncedSearchTermSignature },
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.data.data.length > 0) {
                    const formattedSignatures = response.data.data.map((item: any) => ({
                        id: item.id, name: item.signatureName, imageUrl: item.signatureImage
                    }));
                    setManualSignatures(formattedSignatures);
                } else {
                    setManualSignatures([]);
                }
                signaturesErrorShownRef.current = false;
            } catch (error) {
                console.error('Error fetching manual signatures:', error);
                if (!signaturesErrorShownRef.current) {
                    signaturesErrorShownRef.current = true;
                    toast.error('Failed to load signatures.');
                }
            } finally {
                setSignaturesLoading(false);
            }
        }
        fetchManualSignatures();
    }, [debouncedSearchTermSignature]);

    const handleAdminChange = async (user: OptionType) => {
        isDirtyRef.current = true;
        setSelectedAdmin(user);
        try {
            setIsFetching(true);
            const response = await axios.get(`${Constants.FETCH_COMPANY_SETTINGS_URL}/${user.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setInvoiceFormData(prev => ({ ...prev, billFrom: user.id }));
            setCompanyDetails(response.data.data);
        } catch (error) {
            setCompanyDetails(null);
            setInvoiceFormData(prev => ({ ...prev, billFrom: '' }));
            setSelectedAdmin(null);
        } finally {
            setIsFetching(false);
        }
    };

    const handleContactChange = (contactId: string | null, contact: Contact | null) => {
        isDirtyRef.current = true;
        setSelectedContactId(contactId);
        if (contact) {
            setInvoiceFormData(prev => ({
                ...prev,
                contactId: contactId ?? '',
                billToContactId: contactId ?? '',
                currencyCode: contact.currencyCode || prev.currencyCode,
                billTo: '',
                taxTreatment: contact.defaultTaxTreatment ?? 'STANDARD',
            }));
        } else {
            setInvoiceFormData(prev => ({
                ...prev,
                contactId: '',
                billToContactId: '',
                billTo: '',
            }));
        }
    };

    // Duplicate: when navigated with ?copyFromId=<invoiceId>, load that invoice
    // and prefill this create form with a fresh number/date and DRAFT status.
    useEffect(() => {
        const copyFromId = searchParams.get('copyFromId');
        if (!copyFromId || !token) return;
        let cancelled = false;
        (async () => {
            try {
                setIsLoading(true);
                const res = await axios.get(`${Constants.FETCH_INVOICE_FOR_EDIT_URL}/${copyFromId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const src = res.data?.data;
                if (!src || cancelled) return;
                if (src.billFrom?.id) {
                    await handleAdminChange({ id: src.billFrom.id, name: src.billFrom.name ?? '' } as OptionType);
                }
                if (src.billTo?.id) {
                    // contact pre-fill from duplicate is not supported with ContactPicker
                }
                const clonedItems = (src.items ?? []).map((it: ProductItem) => ({
                    ...it,
                    id: crypto.randomUUID(),
                }));
                setInvoiceFormData(prev => ({
                    ...prev,
                    items: clonedItems.length ? clonedItems : prev.items,
                    notes: src.notes ?? prev.notes,
                    termsAndCondition: src.termsAndCondition ?? prev.termsAndCondition,
                    bank: src.bank?.id ?? prev.bank,
                    currencyCode: src.currencyCode ?? prev.currencyCode,
                    invoiceType: src.invoiceType ?? prev.invoiceType,
                    customFields: src.customFields ?? prev.customFields,
                    status: 'DRAFT',
                    invoiceDate: new Date(),
                    dueDate: null,
                }));
                toast.success('Invoice duplicated — review and save it as a new invoice — select the customer again (it is not copied)');
            } catch {
                toast.error('Could not load the invoice to duplicate');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, token]);

    const handleRemoveItem = (itemToRemove: ProductItem) => {
        handleFormChange('items', invoiceFormData.items.filter(item => item.id !== itemToRemove.id));
    };

    const handleEditItem = (itemToEdit: ProductItem) => {
        setEditingItem({ ...itemToEdit });
        setIsEditProductModalOpen(true);
    };

    const handleEditingItemChange = (field: keyof ProductItem, value: string | number) => {
        setEditingItem(prev => {
            if (!prev) return null;

            const numericFields = ['qty', 'rate', 'discount_value'] as (keyof ProductItem)[];
            let newValue: string | number = value;

            if (numericFields.includes(field)) {
                newValue = Number(value) || 0;
            }

            const updatedItem = { ...prev, [field]: newValue } as any;

            const qty = Number(updatedItem.qty || 0);
            const rate = Number(updatedItem.rate || 0);
            let discount_value = Number(updatedItem.discount_value || 0);
            const discount_type = updatedItem.discount_type || 'Fixed';
            const tax_group_id = updatedItem.tax_group_id;

            const subtotal = qty * rate;

            // Clamp the discount on the PRE-TAX subtotal — consistent with the
            // inline row and backend lib/documentTotals.ts `lineDiscount` (which
            // clamps to [0, gross]). Previously this used the tax-INCLUSIVE amount,
            // so the same line got a different discount depending on which editor
            // was used. Shared with InvoiceTableRow's inline discount input via
            // clampDiscountValue so the two paths can't drift.
            discount_value = clampDiscountValue(discount_value, discount_type, qty, rate);

            const discountAmount = discount_type === 'Percentage'
                ? (subtotal * discount_value) / 100
                : discount_value;
            const safeDiscountAmount = Math.min(discountAmount, subtotal);
            const discountedSubtotal = subtotal - safeDiscountAmount;

            // Recompute tax on the DISCOUNTED base. When per-component taxes[]
            // (e.g. CGST/SGST) already exist, re-scale each component so they never
            // go stale for the new qty/rate/discount; otherwise fall back to the
            // tax-group's flat rate. Both mirror the backend engine exactly.
            const selectedTaxGroup = taxes.find(t => String(t.id) === String(tax_group_id));
            const existingComponents = (updatedItem.taxes ?? []) as TaxLine[];

            let recomputedTaxes: TaxLine[] | undefined;
            let totalTax: number;
            if (existingComponents.length > 0) {
                const r = recomputeLineTaxesFromComponents(
                    { qty, rate, discount: safeDiscountAmount },
                    existingComponents,
                );
                recomputedTaxes = r.taxes;
                totalTax = r.totalTax;
            } else {
                const taxRate = selectedTaxGroup?.total_tax_rate || 0;
                totalTax = round2((discountedSubtotal * taxRate) / 100);
            }
            const newAmount = round2(discountedSubtotal + totalTax);

            return {
                ...updatedItem,
                qty, rate, discount_value,
                discount_type: discount_type ?? 'Fixed',
                discount: safeDiscountAmount,
                ...(recomputedTaxes ? { taxes: recomputedTaxes, totalTax } : {}),
                tax: totalTax, amount: newAmount,
            } as ProductItem;
        });
    };

    const handleUpdateItem = () => {
        if (!editingItem) return;
        const updatedItems = invoiceFormData.items.map(item =>
            item.id === editingItem.id ? editingItem : item
        );
        handleFormChange('items', updatedItems);
        setIsEditProductModalOpen(false);
        setEditingItem(null);
    };

    const clearSignature = () => sigPadRef.current?.clear();
    const saveSignature = () => {
        if (sigPadRef.current) {
            const dataUrl = sigPadRef.current.getCanvas().toDataURL('image/png');
            handleFormChange('esignDataUrl', dataUrl);
            setSignatureModalOpen(false);
        }
    };

    const { subTotal, totalTax, totalDiscount, grandTotal } = useMemo(() => {
        const totals = invoiceFormData.items.reduce((acc, item) => {
            acc.subTotal += item.rate * item.qty;
            acc.totalDiscount += item.discount;
            acc.totalTax += item.tax;
            return acc;
        }, { subTotal: 0, totalTax: 0, totalDiscount: 0 });
        const grand_total = totals.subTotal - totals.totalDiscount + totals.totalTax;
        const roundedSubTotal = round2(totals.subTotal);
        const roundedTotalTax = round2(totals.totalTax);
        const roundedTotalDiscount = round2(totals.totalDiscount);
        const roundedGrandTotal = round2(grand_total);
        setInvoiceFormData(prev => ({ ...prev, subTotal: roundedSubTotal, totalTax: roundedTotalTax, totalDiscount: roundedTotalDiscount, grandTotal: roundedGrandTotal }));
        return { subTotal: roundedSubTotal, totalTax: roundedTotalTax, totalDiscount: roundedTotalDiscount, grandTotal: roundedGrandTotal };
    }, [invoiceFormData.items]);

    const totalInWords = useMemo(() => {
        if (grandTotal <= 0) return 'Zero';
        const grandTotalInteger = Math.floor(grandTotal);
        return numberToWords(grandTotalInteger);
    }, [grandTotal]);

    // Derive the document-level currency symbol from the selected currencyCode
    const docCurrencySymbol = resolveCurrency(invoiceFormData.currencyCode).symbol;
    // The document-level currency code, used to format every money value consistently
    // via formatMoney() so the editor matches the PDF.
    const docCurrencyCode = invoiceFormData.currencyCode || defaultCurrencyCode;
    const fmtMoney = (amount: number) => formatMoney(amount, docCurrencyCode);

    const selectedManualSignatureImage = useMemo(() => {
        return manualSignatures.find(sig => sig.id === invoiceFormData.signatureId)?.imageUrl || null;
    }, [invoiceFormData.signatureId, manualSignatures]);


    const fetchAdminUsers = async () => {
        try {
            setAdminUsersLoading(true);
            const response = await axios.get(`${Constants.FETCH_USERS_URL}/1`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data.data.length > 0) {
                const formattedUsers = response.data.data.map((user: any) => ({ id: user.id, name: `${user.firstName} ${user.lastName}` }));
                setAdminUsers(formattedUsers);
            } else {
                setAdminUsers([]);
            }
            adminUsersErrorShownRef.current = false;
        } catch (error) {
            console.error('Error fetching admin users:', error);
            if (!adminUsersErrorShownRef.current) {
                adminUsersErrorShownRef.current = true;
                toast.error('Failed to load admin users.');
            }
        } finally {
            setAdminUsersLoading(false);
        }
    };

    /**
     * Compute discount + tax fields for one line from its raw inputs (qty, rate,
     * discount_value/type, tax_group_id, and optionally already-resolved
     * appliedTaxRateIds/taxes). Single source of truth reused by manual inline
     * edits (handleInLineItemChange) and the quick-create product seed path
     * (handleNewProductCreated) so the two paths can't drift apart again.
     */
    const computeLineTaxFields = (input: {
        qty: number;
        rate: number;
        discount_value?: number;
        discount_type?: 'Fixed' | 'Percentage';
        tax_group_id?: string;
        tax_rate_id?: string;
        appliedTaxRateIds?: string[];
        taxes?: TaxLine[];
    }): {
        discount: number;
        tax: number;
        amount: number;
        taxes?: TaxLine[];
        totalTax?: number;
        appliedTaxRateIds?: string[];
    } => {
        const qty = Number(input.qty || 0);
        const rate = Number(input.rate || 0);
        const subtotal = qty * rate;

        let discountAmount = input.discount_type === 'Percentage'
            ? (subtotal * (input.discount_value || 0)) / 100
            : (input.discount_value || 0);
        // Clamp discount to [0, line subtotal] — matches the modal + backend clamp
        // so a fixed discount larger than the line can never yield a negative
        // taxable / negative tax components.
        if (discountAmount < 0) discountAmount = 0;
        if (discountAmount > subtotal) discountAmount = subtotal;

        const discountedSubtotal = subtotal - discountAmount;
        const lineTaxable = { qty, rate, discount: discountAmount };

        const selectedTaxGroup = taxes.find(t => String(t.id) === String(input.tax_group_id));
        const taxRate = selectedTaxGroup?.total_tax_rate || 0;
        // Tax on the DISCOUNTED base (not the undiscounted rate), rounded 2dp —
        // matches lib/lineTax.ts + backend lib/documentTotals.ts. This is the
        // fallback used only when no per-line tax rates resolve below; the
        // recompute branches override it with the same discounted-base engine.
        const fallbackTax = round2((discountedSubtotal * taxRate) / 100);
        const fallbackAmount = round2(discountedSubtotal + fallbackTax);

        // Use sticky appliedTaxRateIds when available (set by resolve-line endpoint on group select).
        // Only fall back to group-member expansion if no resolved ids exist yet.
        const stickyIds = input.appliedTaxRateIds ?? [];
        if (stickyIds.length > 0) {
            // Resolved components (C7) may be engine-provisioned system rows absent
            // from taxRateLibrary (C6 hides them) — rescale components, don't re-look-up.
            const components = input.taxes ?? [];
            const result = components.length > 0
                ? { ...recomputeLineTaxesFromComponents(lineTaxable, components), appliedTaxRateIds: stickyIds }
                : recomputeLineTaxesByIds(lineTaxable, stickyIds, taxRateLibrary);
            return { discount: discountAmount, tax: result.totalTax, totalTax: result.totalTax, amount: result.amount, taxes: result.taxes, appliedTaxRateIds: result.appliedTaxRateIds };
        }

        if (input.tax_rate_id) {
            const flat = applyFlatRateToLine(lineTaxable, taxRateLibrary.find((r) => r.id === input.tax_rate_id) ?? null);
            return { discount: discountAmount, tax: flat.totalTax, totalTax: flat.totalTax, amount: flat.amount, taxes: flat.taxes, appliedTaxRateIds: flat.appliedTaxRateIds };
        }

        if (selectedTaxGroup && selectedTaxGroup.tax_rates.length > 0) {
            const groupMemberIds = selectedTaxGroup.tax_rates.map((r) => r.id);
            // Seed any missing group-member rates into the library lookup using group data.
            const syntheticRates: TaxRate[] = selectedTaxGroup.tax_rates.map((r) => {
                const found = taxRateLibrary.find((lib) => lib.id === r.id);
                if (found) return found;
                return {
                    id: r.id,
                    name: r.tax_name,
                    rate: r.tax_rate,
                    regime: 'NONE',
                    taxKind: null,
                    countryId: null,
                    stateId: null,
                    isActive: true,
                    createdAt: '',
                    updatedAt: '',
                } as TaxRate;
            });
            const result = recomputeLineTaxesByIds(lineTaxable, groupMemberIds, syntheticRates);
            return {
                discount: discountAmount,
                tax: result.totalTax,
                totalTax: result.totalTax,
                amount: result.amount,
                taxes: result.taxes,
                appliedTaxRateIds: result.appliedTaxRateIds,
            };
        }

        // If user has picked TaxRates for this line manually, recompute the per-line tax breakdown.
        const appliedIds = input.appliedTaxRateIds ?? (input.taxes ?? []).map((t) => t.taxRateId);
        if (appliedIds.length > 0) {
            const result = recomputeLineTaxesByIds(lineTaxable, appliedIds, taxRateLibrary);
            return {
                discount: discountAmount,
                tax: result.totalTax,
                totalTax: result.totalTax,
                amount: result.amount,
                taxes: result.taxes,
                appliedTaxRateIds: result.appliedTaxRateIds,
            };
        }

        return { discount: discountAmount, tax: fallbackTax, amount: fallbackAmount };
    };

    const handleInLineItemChange = (product: ProductItem, rowId: string) => {
        const computed = computeLineTaxFields({
            qty: product.qty,
            rate: product.rate,
            discount_value: product.discount_value,
            discount_type: product.discount_type,
            tax_group_id: product.tax_group_id,
            tax_rate_id: product.tax_rate_id,
            appliedTaxRateIds: product.appliedTaxRateIds,
            taxes: product.taxes,
        });
        const updatedProduct: ProductItem = { ...product, ...computed };
        isDirtyRef.current = true;
        setInvoiceFormData((prev) => ({
            ...prev,
            items: prev.items.map(item => item.id === rowId ? updatedProduct : item)
        }));
    }

    const handleNewProductCreated = (product: Product) => {
        const rate = product.prices?.selling ?? 0;
        // Same computeLineTaxFields engine as handleInLineItemChange above, so the
        // seeded row (discounted-base tax, round2, clamped discount) can never
        // drift from a manually-edited row again.
        const computed = computeLineTaxFields({
            qty: 1,
            rate,
            discount_value: product.discount?.value,
            discount_type: product.discount?.type,
            tax_group_id: product.tax?.group_id,
            tax_rate_id: product.tax_rate?.taxRateId ?? undefined,
        });

        let updated = false;
        isDirtyRef.current = true;
        setInvoiceFormData((prev) => ({
            ...prev,
            items: prev.items.map(item => {
                if (!updated && item.name === "") {
                    updated = true;
                    return {
                        ...item,
                        id: product.id,
                        name: product.name,
                        unit: product.unit?.name ?? '',
                        qty: 1,
                        rate,
                        amount: computed.amount,
                        discount: computed.discount,
                        tax: computed.tax,
                        tax_group_id: product.tax?.group_id,
                        tax_rate_id: product.tax_rate?.taxRateId ?? '',
                        discount_type: product.discount?.type || "Fixed",
                        discount_value: product.discount?.value,
                        ...(computed.taxes ? { taxes: computed.taxes } : {}),
                        ...(computed.totalTax !== undefined ? { totalTax: computed.totalTax } : {}),
                        ...(computed.appliedTaxRateIds ? { appliedTaxRateIds: computed.appliedTaxRateIds } : {}),
                    }
                }
                return item;
            })
        }));
        setIsProductModalOpen(false);
        if (product.tax_rate?.taxRateId) {
            void handleRowTaxSelect(product.id, product.tax_rate.taxRateId, { qty: 1, rate, discount: computed.discount });
        }
    }

    const handleNewRow = () => {
        const newId = crypto.randomUUID();
        isDirtyRef.current = true;
        setInvoiceFormData((prev) => ({
            ...prev,
            items: [...prev.items, {
                id: newId,
                name: '', unit: '', qty: 1, rate: 0, discount: 0, tax: 0, amount: 0
            }]
        }));
        setFocusRowId(newId);
    }

    // Focuses the newly-appended row's name input (see handleNewRow). Runs
    // after the row above has committed to the DOM in the same render pass,
    // since both state updates are batched together.
    useEffect(() => {
        if (!focusRowId) return;
        document.getElementById(`row-name-${focusRowId}`)?.focus();
        setFocusRowId(null);
    }, [focusRowId]);

    const validateQuotationData = () => {
        const newErrors: { [key: string]: string } = {};

        if (!invoiceFormData.invoiceDate) newErrors.invoiceDate = 'Invoice date is required.';
        if (!invoiceFormData.status.trim()) newErrors.status = 'Status is required.';

        if (!invoiceFormData.billFrom.trim()) newErrors.billFrom = 'Bill from is required.';
        if (!invoiceFormData.billTo.trim() && !invoiceFormData.contactId?.trim()) newErrors.billTo = 'Bill to is required.';

        const hasItemPopulated = invoiceFormData.items.some(item => (item.name ?? '').trim() !== '');
        if (!hasItemPopulated) newErrors.items = 'At least one item is required.';

        if (invoiceFormData.sign_type === 'digitalSignature' && !invoiceFormData.signatureId) newErrors.signatureId = 'Manual signature is required.';
        if (invoiceFormData.sign_type === 'eSignature' && !invoiceFormData.signatureName.trim()) newErrors.signatureName = 'Esignature name is required.';
        if (invoiceFormData.sign_type === 'eSignature' && !invoiceFormData.esignDataUrl) newErrors.esignDataUrl = 'Esignature is required.';
        activeCustomFields.forEach((field: any) => {
            if (field.isMandatory) {
                // Read using slug first, fallback to ID
                const val = invoiceFormData.customFields[field.fieldSlug] ?? invoiceFormData.customFields[field.id];

                // Generate error key using slug first, fallback to ID
                const errorKey = `customField_${field.fieldSlug || field.id}`;

                if (val === undefined || val === null) {
                    newErrors[errorKey] = `${field.labelName} is required.`;
                } else if (Array.isArray(val) && val.length === 0) {
                    newErrors[errorKey] = `${field.labelName} is required.`;
                } else if (typeof val === 'string' && val.trim() === '') {
                    newErrors[errorKey] = `${field.labelName} is required.`;
                }
            }
        });
        const lineFieldError = validateLineCustomFields(invoiceFormData.items, lineFields);
        if (lineFieldError) newErrors.lineCustomFields = lineFieldError;
        setFormErrors(newErrors);
        return newErrors;
    }

    const handleSaveAsDraft = async (e: React.FormEvent) => {
        e.preventDefault();
        setInvoiceFormData(prev => ({ ...prev, status: 'DRAFT' }));
        await saveQuotation(e, 'DRAFT');
    }

    const handleSaveAndSend = async (e: React.FormEvent) => {
        e.preventDefault();
        setInvoiceFormData(prev => ({ ...prev, status: 'SENT' }));
        await saveQuotation(e, 'SENT');
    }

    const saveQuotation = async (e: React.FormEvent, status: string) => {
        e.preventDefault();

        const errors = validateQuotationData();
        if (Object.keys(errors).length > 0) {
            toast.error(errors.lineCustomFields || 'Please check the form for errors.');
            return;
        }

        const formData = new FormData();

        for (const [key, value] of Object.entries(invoiceFormData)) {
            if (key === 'esignDataUrl' && invoiceFormData.sign_type === 'eSignature') {
                const file = await dataURLtoFile(value as string, 'signature.png');
                if (file) {
                    formData.append('signatureImage', file);
                }
            } else if (value instanceof Date) {
                const year = value.getFullYear();
                const month = String(value.getMonth() + 1).padStart(2, "0");
                const day = String(value.getDate()).padStart(2, "0");
                formData.append(key, `${year}-${month}-${day}`);
            } else if (Array.isArray(value) && key === 'items') {
                const filteredItems = invoiceFormData.items.filter(item => (item.name ?? '').trim() !== '');
                appendLineTaxFormData(formData, filteredItems as unknown as Parameters<typeof appendLineTaxFormData>[1]);
            } else if (key === 'customFields') {
                const customFieldsEntries = Object.entries(invoiceFormData.customFields)
                    .filter(([_, val]) => {
                        if (val === undefined || val === null) return false;
                        if (typeof val === 'string' && val.trim() === '') return false;
                        if (Array.isArray(val) && val.length === 0) return false;
                        return true;
                    });

                customFieldsEntries.forEach(([fieldSlugOrId, val], index) => {
                    // Match the slug back to the actual field to get its id for the backend payload
                    const matchedField = activeCustomFields.find(f => f.fieldSlug === fieldSlugOrId || f.id === fieldSlugOrId);
                    const finalFieldId = matchedField ? matchedField.id : fieldSlugOrId;

                    formData.append(`customFields[${index}][fieldId]`, finalFieldId);

                    if (Array.isArray(val)) {
                        formData.append(`customFields[${index}][value]`, val.join(','));
                    } else if (val instanceof Date) {
                        const year = val.getFullYear();
                        const month = String(val.getMonth() + 1).padStart(2, "0");
                        const day = String(val.getDate()).padStart(2, "0");
                        formData.append(`customFields[${index}][value]`, `${year}-${month}-${day}`);
                    } else if (val instanceof File) {
                        formData.append(`customFields[${index}][value]`, val);
                    } else {
                        formData.append(`customFields[${index}][value]`, String(val));
                    }
                });
            } else if (typeof value !== 'object' && value !== undefined && value !== null) {
                formData.append(key, String(value));
            }
        }

        formData.set('status', status);

        try {
            setIsSubmitting(true);
            await axios.post(Constants.CREATE_NEW_INVOICE_URL, formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data',
                },
            });

            toast.success('Invoice created successfully.');
            isDirtyRef.current = false;
            navigate('/admin/invoices');
        } catch (error: any) {
            if (error.response?.status !== 200 && error.response?.data?.errors) {
                setFormErrors(error.response.data.errors);
                toast.error('Please check the form for errors.');
            } else if (axios.isAxiosError(error) && error.response?.data?.message) {
                toast.error(error.response.data.message);
            } else {
                toast.error('An unexpected error occurred.');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const dataURLtoFile = async (input: string, filename: string): Promise<File | null> => {
        try {
            if (input.startsWith('data:')) {
                const arr = input.split(',');
                if (arr.length !== 2) return null;
                const mimeMatch = arr[0].match(/:(.*?);/);
                const mime = mimeMatch?.[1] || 'image/png';
                const bstr = atob(arr[1]);
                const u8arr = new Uint8Array(bstr.length);
                for (let i = 0; i < bstr.length; i++) {
                    u8arr[i] = bstr.charCodeAt(i);
                }
                return new File([u8arr], filename, { type: mime });
            } else if (input.startsWith('http') || input.startsWith('/')) {
                const response = await fetch(input);
                if (!response.ok) return null;
                const blob = await response.blob();
                const mime = blob.type || 'image/png';
                return new File([blob], filename, { type: mime });
            }
            return null;
        } catch {
            return null;
        }
    };

    const handleNewProductClick = () => setIsProductModalOpen(true);

    const setNewInvoiceNumber = () => {
        let newInvoiceNumber = sessionStorage.getItem('nextInvoiceNo');
        if (newInvoiceNumber) {
            setInvoiceFormData(prev => ({ ...prev, invoiceNumber: newInvoiceNumber }));
        }
        setInvoiceNumberConfigModalOpen(false);
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className='text-center text-2xl font-bold'><Loader2Icon className='animate-spin text-purple-600 h-10 w-10' /></div>
            </div>
        );
    }

    return (
        <div className="md:p-4 bg-white-50 min-h-screen border border-gray-200 rounded">
            <form onSubmit={(e) => e.preventDefault()}>
                <div className="max-w-7xl mx-auto space-y-4">

                    <PageHeader title="New Invoice" />

                    {/* Header */}
                    <div className="flex justify-end items-center mb-2">
                        <img src={resolveCompanyLogo(systemSettings?.company?.siteLogo)} alt="Logo" className='w-32 max-h-20 max-w-32 h-auto object-contain' />
                    </div>

                    {/* Document Type */}
                    <div className="mb-4">
                        <Select
                            label="Document Type"
                            className="sm:w-56"
                            value={invoiceFormData.invoiceType}
                            onChange={(e) => {
                                isDirtyRef.current = true;
                                setInvoiceFormData((prev) => ({ ...prev, invoiceType: e.target.value as 'INVOICE' | 'PROFORMA' }));
                            }}
                            options={[
                                { value: 'INVOICE', label: 'Invoice' },
                                { value: 'PROFORMA', label: 'Proforma' },
                            ]}
                        />
                        {invoiceFormData.invoiceType === 'PROFORMA' && (
                            <p className="text-xs text-body mt-1">Proformas do not deduct inventory on save.</p>
                        )}
                    </div>

                    {/* Top Section */}
                    <div className="w-full">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 w-full">
                            <div className="w-full">
                                <FormField label="Invoice Number" id="invoiceNumber" error={formErrors?.invoiceNumber}>
                                    {(field) => (
                                        <div className="relative">
                                            <input
                                                type="text"
                                                name="invoiceNumber"
                                                id={field.id}
                                                aria-invalid={field['aria-invalid']}
                                                aria-describedby={field['aria-describedby']}
                                                className={`${fieldControlClasses(Boolean(formErrors?.invoiceNumber))} pr-10`}
                                                placeholder="Invoice Number"
                                                value={invoiceFormData.invoiceNumber ?? ''}
                                                onChange={(e) => handleFormChange("invoiceNumber", e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setInvoiceNumberConfigModalOpen(true)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-body cursor-pointer hover:text-purple-600"
                                                aria-label="Configure invoice number format"
                                            >
                                                <Settings size={18} />
                                            </button>
                                        </div>
                                    )}
                                </FormField>
                            </div>

                            <div className="w-full">
                                <DateInput
                                    label="Invoice Date"
                                    value={invoiceFormData.invoiceDate}
                                    onChange={(newDate) => handleFormChange('invoiceDate', newDate)}
                                    isRequired
                                />
                                {formErrors?.invoiceDate && <span className="text-danger text-sm">{formErrors.invoiceDate}</span>}
                            </div>
                            <div className="w-full">
                                <DateInput
                                    label="Due Date"
                                    value={invoiceFormData.dueDate}
                                    onChange={(newDate) => handleFormChange('dueDate', newDate)}
                                    minDate={invoiceFormData.invoiceDate || new Date()}
                                    isRequired={false}
                                />
                                {formErrors?.dueDate && <span className="text-danger text-sm">{formErrors.dueDate}</span>}
                            </div>
                            <div className="w-full">
                                <CurrencySelect
                                    label="Currency"
                                    value={invoiceFormData.currencyCode}
                                    onChange={(code) => handleFormChange('currencyCode', code)}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Recurring retired: create recurring invoices via Recurring Invoices -> New. */}

                    {/* Billing Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="bg-white p-4 rounded-card border border-border shadow-card">
                            <h3 className="font-bold text-gray-950 ">Bill From <span className='text-danger'>*</span></h3>
                            <div className="mt-4">
                                <SmartDropdown
                                    items={adminUsers}
                                    value={adminSearchInput}
                                    onChange={setAdminSearchInput}
                                    onSelect={(item) => handleAdminChange(item as OptionType)}
                                    selectedItem={selectedAdmin}
                                    placeholder="Type to search..."
                                    serverside={false}
                                    loading={adminUsersLoading}
                                />
                                {!selectedAdmin && formErrors?.billFrom && <span className="text-danger text-sm">{formErrors.billFrom}</span>}
                                {!selectedAdmin && <p className="mt-2 text-xs text-gray-500 p-2 font-semibold">
                                    Select admin to view company details.
                                </p>}
                                <div className="h-4"></div>
                                {selectedAdmin && companyDetails && (
                                    <AdminCard
                                        logoUrl={companyDetails.siteLogo}
                                        companyName={companyDetails.companyName}
                                        city={companyDetails.city?.name}
                                        state={companyDetails.state?.name}
                                        address={companyDetails.address}
                                    />
                                )}
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-card border border-border shadow-card">
                            <h3 className="font-bold text-gray-950 mb-4">Bill To <span className='text-danger'>*</span></h3>
                            <ContactPicker
                                view="all-active"
                                value={selectedContactId}
                                onChange={handleContactChange}
                                error={formErrors?.billTo}
                            />
                        </div>
                    </div>

                    {/* Tax Treatment */}
                    <div className="bg-white p-4 rounded-card border border-border shadow-card">
                        <div className="flex items-center gap-4 flex-wrap">
                            <Select
                                label="Tax Treatment"
                                containerClassName="mb-0"
                                className="text-sm"
                                value={invoiceFormData.taxTreatment}
                                onChange={(e) => handleFormChange('taxTreatment', e.target.value as InvoiceFormData['taxTreatment'])}
                                options={[
                                    { value: 'STANDARD', label: 'Standard' },
                                    { value: 'ZERO_RATED', label: 'Zero-rated' },
                                    { value: 'EXEMPT', label: 'Exempt' },
                                    { value: 'REVERSE_CHARGE', label: 'Reverse charge' },
                                    { value: 'OUT_OF_SCOPE', label: 'Out of scope' },
                                ]}
                            />
                            {invoiceFormData.taxTreatment !== 'STANDARD' && (
                                <p className="text-sm text-warning font-medium mt-5">
                                    Tax suppressed — {invoiceFormData.taxTreatment.replace(/_/g, ' ').toLowerCase()}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* DYNAMIC CUSTOM FIELDS SECTION */}
                    <DynamicCustomFields
                        moduleSlug="invoices"
                        values={invoiceFormData.customFields}
                        errors={formErrors}
                        onChange={handleCustomFieldChange}
                        onFieldsLoaded={setActiveCustomFields}
                    />

                    {/* Items & Details Section */}
                    <div className="bg-white rounded-card border border-border shadow-card mt-4">
                        <div className="p-4">
                            {formErrors?.items && <span className="text-danger text-sm">{formErrors.items}</span>}
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
                                    {invoiceFormData.items.map((item, index) => (
                                        <React.Fragment key={item.id}>
                                            <InvoiceTableRow
                                                item={item}
                                                currencyCode={invoiceFormData.currencyCode}
                                                onInLineItemChange={(updatedItem) => handleInLineItemChange(updatedItem, item.id)}
                                                onProductPicked={(updated) => {
                                                    handleInLineItemChange(updated, item.id);
                                                    if (updated.tax_rate_id) {
                                                        void handleRowTaxSelect(updated.id, updated.tax_rate_id, { qty: updated.qty, rate: updated.rate, discount: updated.discount });
                                                    }
                                                }}
                                                onEditItem={handleEditItem}
                                                onDeleteItem={handleRemoveItem}
                                                availableItems={invoiceFormData.items}
                                                addNewProduct={handleNewProductClick}
                                                blockOutOfStock
                                                onRequestNewRow={index === invoiceFormData.items.length - 1 ? handleNewRow : undefined}
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
                                                        <span className="flex items-center gap-3">
                                                            {invoiceFormData.taxTreatment === 'STANDARD' ? (
                                                                <LineTaxSelect
                                                                    taxRates={taxRateLibrary}
                                                                    value={(item as ProductItem).tax_rate_id ?? ''}
                                                                    legacyLabel={(item.taxes ?? []).length > 0
                                                                        ? `Current: ${(item.taxes ?? []).map((t) => `${t.kind ?? t.name} ${t.percent}%`).join(' + ')}`
                                                                        : null}
                                                                    onSelect={(rateId) => { void handleRowTaxSelect(item.id, rateId); }}
                                                                />
                                                            ) : (
                                                                <span className="text-xs text-warning italic">Tax suppressed</span>
                                                            )}
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        </React.Fragment>
                                    ))}
                                    {invoiceFormData.items.length === 0 && (
                                        <tr className="bg-white text-gray-950">
                                            <td className="p-3 font-medium text-center" colSpan={8 + lineFields.length}>
                                                No Items Selected
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            {/* Add New Product */}
                            <div className="p-4 flex">
                                <Button variant="ghost" size="sm" onClick={() => handleNewRow()} leftIcon={<PlusCircle className="h-4 w-4" />} className="text-purple-600">
                                    Add New Row
                                </Button>
                            </div>
                        </div>
                    </div>

                </div>

                {/* Edit Product Modal */}
                <Modal isOpen={isEditProductModalOpen} onClose={() => setIsEditProductModalOpen(false)} title={`Edit: ${editingItem?.name}`}>
                    {editingItem && (
                        <div className="p-4 space-y-4">
                            <FormField
                                label="Quantity"
                                id="edit-qty"
                                type="number"
                                min="1"
                                step="1"
                                value={editingItem.qty}
                                onChange={(e) => handleEditingItemChange('qty', e.target.value)}
                            />

                            <FormField
                                label={`Rate (${docCurrencySymbol})`}
                                id="edit-rate"
                                type="number"
                                min="0"
                                value={editingItem.rate}
                                onChange={(e) => handleEditingItemChange('rate', e.target.value)}
                            />

                            <Select
                                label="Discount Type"
                                id="edit-discount-type"
                                value={editingItem.discount_type}
                                onChange={(e) => handleEditingItemChange('discount_type', e.target.value)}
                                options={[
                                    { value: 'Fixed', label: 'Fixed' },
                                    { value: 'Percentage', label: 'Percentage' },
                                ]}
                            />

                            <FormField
                                label={`Discount Amount (${docCurrencySymbol})`}
                                id="edit-discount"
                                type="number"
                                min="0"
                                value={editingItem.discount_value || 0}
                                onChange={(e) => handleEditingItemChange('discount_value', e.target.value)}
                                // Mirrors the clamp in handleEditingItemChange: a Percentage
                                // discount tops out at 100(%); a Fixed discount tops out at
                                // the line's pre-tax subtotal (qty * rate), not the bare rate.
                                max={editingItem.discount_type === 'Percentage'
                                    ? 100
                                    : Number(editingItem.qty || 0) * Number(editingItem.rate || 0)}
                            />

                            <div>
                                <label htmlFor="edit-tax-select" className="block text-sm font-medium text-heading mb-1">Tax</label>
                                <LineTaxSelect
                                    id="edit-tax-select"
                                    className={fieldControlClasses()}
                                    taxRates={taxRateLibrary}
                                    value={editingItem.tax_rate_id ?? ''}
                                    legacyLabel={(editingItem.taxes ?? []).length > 0
                                        ? `Current: ${(editingItem.taxes ?? []).map((t) => `${t.kind ?? t.name} ${t.percent}%`).join(' + ')}`
                                        : null}
                                    onSelect={async (rateId) => {
                                        if (!rateId) {
                                            setPartyStateMissing(false);
                                            setEditingItem((prev) => prev ? { ...prev, tax_rate_id: '', tax_group_id: '', taxes: [], totalTax: 0, tax: 0, appliedTaxRateIds: [], amount: round2(Number(prev.qty || 0) * Number(prev.rate || 0) - Number(prev.discount || 0)) } : null);
                                            return;
                                        }
                                        // Optimistic set so the stale-guard below can compare (mirrors old group flow)
                                        setEditingItem((prev) => prev ? { ...prev, tax_rate_id: rateId } : null);
                                        const taxableAmount = round2(Number(editingItem.qty || 0) * Number(editingItem.rate || 0) - Number(editingItem.discount || 0));
                                        const resolved = await resolveLineTaxByRateId({ token: token!, taxableAmount, taxRateId: rateId, ...(selectedContactId ? { customerId: selectedContactId } : {}) });
                                        setPartyStateMissing(!!resolved?.partyStateMissing);
                                        setEditingItem((prev) => {
                                            if (!prev || prev.tax_rate_id !== rateId) return prev;
                                            return applyResolvedToLine(prev, rateId, resolved);
                                        });
                                    }}
                                />
                            </div>

                            {partyStateMissing && (
                                <p className="text-xs text-warning mt-1">
                                    No customer state set — taxed as inter-state (IGST).
                                </p>
                            )}

                            <div className="pt-2">
                                <p className="text-lg font-semibold text-gray-950">
                                    New Amount: {fmtMoney(editingItem.amount)}
                                </p>
                            </div>

                            <div className="flex justify-end gap-4 pt-4">
                                <Button
                                    variant="white"
                                    onClick={() => setIsEditProductModalOpen(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleUpdateItem}
                                >
                                    Update Item
                                </Button>
                            </div>
                        </div>
                    )}
                </Modal>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                    {/* Left Side: Tabs */}
                    <div>
                        <h3 className="text-lg font-semibold text-gray-950 mb-3">Extra Information</h3>
                        <div className="flex items-center gap-2 mb-4">
                            <Button type="button" size="sm" variant={activeInfoTab === 'notes' ? 'primary' : 'white'} onClick={() => setActiveInfoTab('notes')}>Add Notes</Button>
                            <Button type="button" size="sm" variant={activeInfoTab === 'termsAndCondition' ? 'primary' : 'white'} onClick={() => setActiveInfoTab('termsAndCondition')}>Add Terms & Conditions</Button>
                            <Button type="button" size="sm" variant={activeInfoTab === 'bank' ? 'primary' : 'white'} onClick={() => setActiveInfoTab('bank')}>Bank Details</Button>
                        </div>

                        {activeInfoTab === 'notes' && (
                            <FormField label="Additional Notes">
                                {(field) => (
                                    <textarea
                                        id={field.id}
                                        aria-describedby={field['aria-describedby']}
                                        value={invoiceFormData.notes}
                                        onChange={(e) => handleFormChange('notes', e.target.value)}
                                        rows={4}
                                        placeholder="Enter Notes"
                                        className={fieldControlClasses()}
                                    />
                                )}
                            </FormField>
                        )}
                        {activeInfoTab === 'termsAndCondition' && (
                            <FormField label="Terms & Conditions">
                                {(field) => (
                                    <textarea
                                        id={field.id}
                                        aria-describedby={field['aria-describedby']}
                                        value={invoiceFormData.termsAndCondition}
                                        onChange={(e) => handleFormChange('termsAndCondition', e.target.value)}
                                        rows={4}
                                        placeholder="Enter Terms & Conditions"
                                        className={fieldControlClasses()}
                                    />
                                )}
                            </FormField>
                        )}
                        {activeInfoTab === 'bank' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Account</label>
                                <SmartDropdown
                                    items={bankAccounts}
                                    value={bankAccountSearchInput}
                                    onChange={(value) => { setBankAccountSearchInput(value); handleFormChange('bank', null); }}
                                    onSelect={(item) => handleFormChange('bank', (item as OptionType)?.id || null)}
                                    onAddNew={() => setIsCreateBankAccountModalOpen(true)}
                                    selectedItem={bankAccounts.find(item => item.id === invoiceFormData.bank)}
                                    addNewLabel='New Bank Account'
                                    placeholder='Type to search Bank Account...'
                                    loading={bankAccountsLoading}
                                />
                            </div>
                        )}
                    </div>

                    {/* Right Side: Totals & Signature */}
                    <div className="bg-white p-4 rounded-card border border-border shadow-card space-y-3">
                        <div className="flex justify-between text-sm text-gray-600"><span>Amount</span><span>{fmtMoney(subTotal)}</span></div>
                        {(() => {
                            const breakdown: Record<string, number> = {};
                            for (const line of invoiceFormData.items) {
                                for (const t of line.taxes ?? []) {
                                    const key = t.kind ? `${t.kind} ${t.percent}%` : `${t.name}`;
                                    breakdown[key] = (breakdown[key] ?? 0) + (t.amount || 0);
                                }
                            }
                            const entries = Object.entries(breakdown);
                            if (entries.length === 0) return null;
                            return (
                                <div className="pl-2 border-l-2 border-purple-200 space-y-1">
                                    {entries.map(([label, amount]) => (
                                        <div key={label} className="flex justify-between text-xs text-gray-600">
                                            <span>{label}</span>
                                            <span>{fmtMoney(amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                        <div className="flex justify-between text-sm text-gray-600"><span>Tax</span><span>{fmtMoney(totalTax)}</span></div>
                        <div className="flex justify-between text-sm text-gray-600"><span>Discount</span><span>- {fmtMoney(totalDiscount)}</span></div>
                        <hr className="border-gray-200" />
                        <div className="flex justify-between font-bold text-gray-950"><span>Total</span><span>{fmtMoney(grandTotal)}</span></div>
                        <p className="text-sm text-gray-500 capitalize">{totalInWords}</p>

                        <div className="flex items-center gap-4 pt-4">
                            <div className="flex items-center"><input id="no-sig" type="radio" name="signature" checked={invoiceFormData.sign_type === 'none'} onChange={() => handleFormChange('sign_type', 'none')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="no-sig" className="ml-2 block text-sm text-gray-700 cursor-pointer">No Signature</label></div>
                            <div className="flex items-center"><input id="manual-sig" type="radio" name="signature" checked={invoiceFormData.sign_type === 'digitalSignature'} onChange={() => handleFormChange('sign_type', 'digitalSignature')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="manual-sig" className="ml-2 block text-sm text-gray-700 cursor-pointer">Manual Signature</label></div>
                            <div className="flex items-center"><input id="e-sig" type="radio" name="signature" checked={invoiceFormData.sign_type === 'eSignature'} onChange={() => handleFormChange('sign_type', 'eSignature')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="e-sig" className="ml-2 block text-sm text-gray-700 cursor-pointer">eSignature</label></div>
                        </div>

                        {invoiceFormData.sign_type !== 'none' && (invoiceFormData.sign_type === 'digitalSignature' ? (
                            <div>
                                <label className="block text-sm font-medium text-heading mb-2">Select Signature Name <span className="text-danger">*</span></label>
                                <SmartDropdown
                                    items={manualSignatures}
                                    value={signatureSearchInput}
                                    onChange={(value) => setSignatureSearchInput(value)}
                                    onSelect={(item) => handleFormChange('signatureId', item?.id || '')}
                                    selectedItem={manualSignatures.find(sig => sig.id === invoiceFormData.signatureId) || null}
                                    onAddNew={() => setIsCreateSignModalOpen(true)}
                                    addNewLabel='New Signature'
                                    placeholder='Type to search signatures...'
                                    loading={signaturesLoading}
                                />
                                {formErrors?.signatureId && <p className="text-danger text-xs mt-1">{formErrors.signatureId}</p>}
                                <p className="mt-2 text-sm font-medium text-gray-700">Signature Image</p>
                                <div className="mt-2 h-20 w-48 bg-gray-100 rounded-md flex items-center justify-center">
                                    {selectedManualSignatureImage ? <img src={selectedManualSignatureImage} alt="Selected Signature" className="max-h-full max-w-full" /> : <span className="text-xs text-gray-400">No signature selected</span>}
                                </div>
                            </div>
                        ) : (
                            <div>
                                <FormField
                                    label="Signature Name"
                                    required
                                    name="signatureName"
                                    type="text"
                                    value={invoiceFormData.signatureName}
                                    onChange={e => handleFormChange('signatureName', e.target.value)}
                                    placeholder="Enter Signature Name"
                                    error={formErrors?.signatureName}
                                />
                                <p className="mt-2 text-sm font-medium text-heading">Draw your eSignature</p>
                                <div className="mt-2 h-20 w-48 bg-gray-100 rounded-md flex items-center justify-center cursor-pointer border-2 border-dashed border-gray-400" onClick={() => setSignatureModalOpen(true)}>
                                    {invoiceFormData.esignDataUrl ? <img src={invoiceFormData.esignDataUrl} alt="Drawn Signature" className="max-h-full max-w-full" /> : <div className="text-center text-gray-500"><Edit size={20} className="mx-auto mb-1" /><span className="text-xs">Draw Signature</span></div>}
                                </div>
                                {formErrors?.esignDataUrl && <p className="text-danger text-xs mt-1">{formErrors.esignDataUrl}</p>}
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex justify-end mt-4 gap-3">
                    <Button variant="white" onClick={() => { if (confirmIfDirty(isDirtyRef.current)) navigate('/admin/invoices'); }}>Cancel</Button>
                    <Button
                        disabled={isSubmitting}
                        onClick={handleSaveAsDraft}
                    >
                        Save as Draft
                    </Button>
                    <Button
                        type="button"
                        disabled={isSubmitting}
                        onClick={handleSaveAndSend}
                        leftIcon={<Mail size={16} />}
                    >
                        Save & Send
                    </Button>
                </div>

                <Modal isOpen={isSignatureModalOpen} onClose={() => setSignatureModalOpen(false)} title="Draw Signature">
                    <div className="p-4">
                        <div className="bg-white border border-gray-400">
                            <SignatureCanvas
                                ref={sigPadRef}
                                penColor='black'
                                canvasProps={{ className: 'w-full h-48' }}
                            />
                        </div>
                        <div className="flex justify-end gap-3 mt-4">
                            <Button variant="danger" onClick={clearSignature}>Clear</Button>
                            <Button variant="secondary" onClick={() => setSignatureModalOpen(false)}>Cancel</Button>
                            <Button onClick={saveSignature}>Save</Button>
                        </div>
                    </div>
                </Modal>
            </form>

            <CreateProductForm
                isOpen={isProductModalOpen}
                onClose={() => setIsProductModalOpen(false)}
                onSuccess={(newProduct: Product) => handleNewProductCreated(newProduct)}
            />

            <CreateSignatureModal
                isOpen={isCreateSignModalOpen}
                onClose={() => setIsCreateSignModalOpen(false)}
                onSuccess={(newSignature: any) => {
                    const formattedSignature: SignatureOptions = {
                        id: newSignature.id,
                        name: newSignature.signatureName,
                        imageUrl: newSignature.signatureImage
                    };
                    setManualSignatures(prevSignatures => [formattedSignature, ...prevSignatures]);
                    setIsCreateSignModalOpen(false);
                }}
            />

            <CreateBankAccountModal
                isOpen={isCreateBankAccountModalOpen}
                onClose={() => setIsCreateBankAccountModalOpen(false)}
                onSuccess={(newBankAccount: BankAccountCreatedResponse) => {
                    const formattedBankAccount: OptionType = {
                        id: newBankAccount.id,
                        name: newBankAccount.bankName
                    };
                    setBankAccounts(prevBankAccounts => [formattedBankAccount, ...prevBankAccounts]);
                    setIsCreateBankAccountModalOpen(false);
                }}
            />

            <InvoiceNumberConfigModal
                isOpen={invoiceNumberConfigModalOpen}
                onClose={() => setInvoiceNumberConfigModalOpen(false)}
                onSuccess={() => setNewInvoiceNumber()}
            />
            {isFetching && <FullPageLoader />}
        </div>
    );
};

export default CreateInvoice;