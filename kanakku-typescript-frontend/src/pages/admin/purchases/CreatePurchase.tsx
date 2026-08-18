import React, { useEffect, useState, useMemo, useRef } from 'react';
import { PlusCircle, Edit3 } from 'lucide-react';
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
import { useNavigate } from 'react-router-dom';
import PaymentModal from '@pages/admin/purchases/PaymentModal';
import FullPageLoader from '@components/admin/FullPageLoader';
import AdminCard from '@components/admin/AdminCard';
import { resolveCompanyLogo } from '@utils/companyLogo';
import SubmitButton from '@components/admin/SubmitButton';
import type { OptionType, SelectedAdmin } from '@models/common';
import type { Product } from '@models/product';
import type { SignatureOptions } from '@models/signature';
import SmartDropdown from '@components/admin/SmartDropdown';
import InvoiceTableRow from '@components/admin/InvoiceTableRow';
import CreateProductForm from '@components/admin/CreateProductForm';
import CreateSignatureModal from '../invoices/CreateSignatureModal';
import CreateBankAccountModal from '../invoices/CreateBankAccountModal';
import type { BankAccountCreatedResponse } from '@models/bank-account';
import DynamicCustomFields from '@components/admin/DynamicCustomFields'; // <-- Reusable Custom Fields Component
import CurrencySelect from '@components/admin/CurrencySelect';
import { useCurrencies } from '@hooks/useCurrencies';
import { useDocumentDefaults } from '@hooks/useDocumentDefaults';
import { useDirtyGuard, confirmIfDirty } from '@hooks/useDirtyGuard';
import { useLineItemCustomFields } from '@hooks/useLineItemCustomFields';
import { validateLineCustomFields } from '@lib/lineCustomFields';
import type { TaxRate, TaxLine } from '@models/taxRate';
import LineTaxSelect from '@components/admin/LineTaxSelect';
import { recomputeLineTaxesByIds, recomputeLineTaxesFromComponents, appendLineTaxFormData, applyFlatRateToLine, resolveLineTaxByRateId } from '@lib/lineTax';
import { round2 } from '@utils/round2';
import type { Contact } from '@models/contact';
import ContactPicker from '@components/admin/ContactPicker';
import { Button, FormField, Select, fieldControlClasses } from '@components/ui';
import { PageHeader } from "@/context/PageHeaderContext";

interface PurchaseLineItem {
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

interface PurchaseFormData {
    purchaseOrderId?: string;
    userId: string;
    billFrom: string;
    billTo: string;
    supplierId: string;
    referenceNo: string;
    purchaseDate: Date | null;
    status: string;
    items: PurchaseLineItem[];
    notes: string;
    termsAndCondition: string;
    paymentMode: string;
    paymentModeSlug: string;
    checkNumber?: string;
    bank?: string | null;
    sign_type: 'none' | 'digitalSignature' | 'eSignature';
    signatureId: string | null;
    signatureName: string;
    esignDataUrl: string | null;
    subTotal: number | null;
    totalTax: number | null;
    totalDiscount: number | null;
    grandTotal: number | null;
    sp_referenceNumber?: string;
    sp_paymentDate?: Date | null;
    sp_paymentMode?: string;
    sp_amount?: number;
    sp_paid_amount?: number;
    sp_due_amount?: number;
    sp_notes?: string | null;
    sp_attachment?: File | null;
    customFields: Record<string, any>; // <-- Dynamic Custom Fields
    currencyCode: string;
    contactId?: string;
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

interface IPaymentMode {
    id: string;
    name: string;
    slug: string;
}

const CreatePurchase: React.FC = () => {
    const navigate = useNavigate();
    const { token, user } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { defaultCurrencyCode, resolveCurrency } = useCurrencies();
    const { defaults: docDefaults, loading: docDefaultsLoading } = useDocumentDefaults();
    const { fields: lineFields } = useLineItemCustomFields(token, 'purchases');

    // States
    const [adminUsers, setAdminUsers] = useState<OptionType[]>([]);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [selectedAdmin, setSelectedAdmin] = useState<OptionType | null>(null);
    const [companyDetails, setCompanyDetails] = useState<SelectedAdmin | null>(null);
    const [paymentModes, setPaymentModes] = useState<IPaymentMode[]>([]);
    const [purchaseOrders, setPurchaseOrders] = useState<OptionType[]>([]);
    const [purchaseOrderSearchInput, setPurchaseOrderSearchInput] = useState<string>('');
    const debouncedPurchaseOrderSearchTerm = useDebounce(purchaseOrderSearchInput, 500);
    const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

    // Dynamic custom fields active array
    const [activeCustomFields, setActiveCustomFields] = useState<any[]>([]);

    const [purchaseFormData, setPurchaseFormData] = useState<PurchaseFormData>({
        purchaseOrderId: '',
        userId: user?.id || '',
        billFrom: '',
        billTo: '',
        supplierId: '',
        referenceNo: '',
        purchaseDate: new Date(),
        // Default to "pending" (goods received) so a directly-created purchase moves
        // stock, matching PO→purchase conversion. "new" is a draft that does NOT
        // move stock — leaving this blank/new was why new purchases skipped inventory.
        status: 'pending',
        items: [{
            id: crypto.randomUUID(),
            name: '',
            unit: '',
            qty: 1,
            rate: 0,
            discount: 0,
            tax: 0,
            amount: 0,
            taxes: [],
            appliedTaxRateIds: [],
        }],
        notes: '',
        termsAndCondition: '',
        paymentMode: '',
        paymentModeSlug: '',
        checkNumber: '',
        bank: null,
        sign_type: 'none',
        signatureId: null,
        signatureName: '',
        esignDataUrl: null,
        subTotal: null,
        totalTax: null,
        totalDiscount: null,
        grandTotal: null,
        sp_referenceNumber: '',
        sp_paymentDate: null,
        sp_paymentMode: '',
        sp_amount: 0,
        sp_paid_amount: 0,
        sp_due_amount: 0,
        customFields: {},
        currencyCode: defaultCurrencyCode,
        contactId: '',
        taxTreatment: 'STANDARD',
    });

    // Apply document defaults once loaded — seed blank new form, never overwrite user edits
    useEffect(() => {
        if (docDefaultsLoading) return;
        setPurchaseFormData(prev => {
            const updates: Partial<typeof prev> = {};

            // currencyCode: prefer docDefaults, fall back to company default
            if (!prev.currencyCode) {
                updates.currencyCode = docDefaults.defaultCurrencyCode || defaultCurrencyCode;
            } else if (prev.currencyCode === defaultCurrencyCode && docDefaults.defaultCurrencyCode) {
                updates.currencyCode = docDefaults.defaultCurrencyCode;
            }

            // sign_type: only if still at the initial 'none'
            if (prev.sign_type === 'none' && docDefaults.defaultSignType !== 'none') {
                updates.sign_type = docDefaults.defaultSignType;
                if (docDefaults.defaultSignType === 'digitalSignature' && docDefaults.defaultSignatureId) {
                    updates.signatureId = docDefaults.defaultSignatureId;
                }
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
    const [editingItem, setEditingItem] = useState<PurchaseLineItem | null>(null);
    const [taxRateLibrary, setTaxRateLibrary] = useState<TaxRate[]>([]);
    const [taxes, setTaxes] = useState<taxGroup[]>([]);

    // Extra Information State
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
    const [adminSearchInput, setAdminSearchInput] = useState<string>('');
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [signatureSearchInput, setSignatureSearchInput] = useState<string>('');
    const debouncedSearchTermSignature = useDebounce(signatureSearchInput, 500);
    const [isCreateSignModalOpen, setIsCreateSignModalOpen] = useState(false);
    const [bankAccountSearchInput, setBankAccountSearchInput] = useState<string>('');
    const debouncedSearchTermBankAccount = useDebounce(bankAccountSearchInput, 500);
    const [isCreateBankAccountModalOpen, setIsCreateBankAccountModalOpen] = useState(false);

    // ==========================================
    // 1. EVENT HANDLERS (Defined before fetchers)
    // ==========================================
    const handleFormChange = (field: keyof PurchaseFormData, value: any) => {
        isDirtyRef.current = true;
        setPurchaseFormData(prev => ({ ...prev, [field]: value }));
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
        setPurchaseFormData(prev => ({
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

    const handleAdminChange = async (user: OptionType) => {
        isDirtyRef.current = true;
        setSelectedAdmin(user);
        try {
            setIsFetching(true);
            const response = await axios.get(`${Constants.FETCH_COMPANY_SETTINGS_URL}/${user.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setPurchaseFormData(prev => ({ ...prev, billFrom: user.id }));
            setCompanyDetails(response.data.data);
        } catch (error) {
            setCompanyDetails(null);
            setSelectedAdmin(null);
            setPurchaseFormData(prev => ({ ...prev, billFrom: '' }));
        } finally {
            setIsFetching(false);
        }
    };

    const handlePurchaseOrderSelect = (option: OptionType) => {
        isDirtyRef.current = true;
        let _purchaseOrderId = option ? option.id : '';
        setPurchaseFormData(prev => ({ ...prev, purchaseOrderId: _purchaseOrderId }));
    }

    const handleContactChange = (contactId: string | null, contact: Contact | null) => {
        isDirtyRef.current = true;
        setSelectedContactId(contactId);
        if (contact) {
            setPurchaseFormData(prev => ({
                ...prev,
                contactId: contactId ?? '',
                supplierId: '',
                billTo: '',
                currencyCode: contact.currencyCode || prev.currencyCode,
                taxTreatment: contact.defaultTaxTreatment ?? 'STANDARD',
            }));
        } else {
            setPurchaseFormData(prev => ({
                ...prev,
                contactId: '',
                supplierId: '',
                billTo: '',
            }));
        }
    };

    // ==========================================
    // 2. FETCHERS (Must be defined before useEffects)
    // ==========================================
    const fetchAdminUsers = async () => {
        try {
            const response = await axios.get(`${Constants.FETCH_USERS_URL}/1`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data.data.length > 0) {
                const formattedUsers = response.data.data.map((user: any) => ({ id: user.id, name: `${user.firstName} ${user.lastName}` }));
                setAdminUsers(formattedUsers);
            } else {
                setAdminUsers([]);
            }
        } catch (error) {
            console.error('Error fetching admin users:', error);
        }
    };

    const fetchPaymentModes = async () => {
        try {
            const response = await axios.get(Constants.GET_ALL_PAYMENT_MODES_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.data.data) {
                setPaymentModes(response.data.data);
            }
        } catch (error) {
            console.error('Error fetching payment modes:', error);
        }
    };

    const fetchTaxes = async () => {
        if (!token) return;
        try {
            const response = await axios.get(Constants.FETCH_TAX_GROUPS_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setTaxes(response.data.data);
        } catch (error) {
            console.error('Error fetching taxes:', error);
            setTaxes([]);
        }
    };

    const fetchPurchaseOrder = async () => {
        if (!purchaseFormData.purchaseOrderId) return;
        try {
            setIsFetching(true);
            const response = await axios.get(`${Constants.FETCH_PURCHASE_ORDER_URL}/${purchaseFormData.purchaseOrderId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });

            const data = response.data.data;

            if (data) {
                if (data.billFrom) {
                    let _admin = { id: data.billFrom.id, name: data.billFrom.name };
                    handleAdminChange(_admin);
                }

                if (data.bank) {
                    setBankAccounts((prev) => {
                        const exists = prev.find(bank => bank.id === data.bank.id);
                        if (exists) return prev;
                        return [...prev, { id: data.bank.id, name: data.bank.bankName }];
                    });
                }

                setPurchaseFormData(prev => ({
                    ...prev,
                    id: data.id,
                    userId: user?.id || '',
                    billFrom: data.billFrom?.id || '',
                    supplierId: data.billTo?.id || '',
                    billTo: '',
                    referenceNo: data.referenceNo || '',
                    purchaseDate: data.purchaseOrderDate ? new Date(data.purchaseOrderDate) : null,
                    status: data.status || '',
                    items: data.items || [],
                    notes: data.notes || '',
                    termsAndCondition: data.termsAndCondition || '',
                    bank: data.bank?.id || null,
                    sign_type: data.sign_type ?? 'none',
                    signatureId: data.signature?.id || null,
                    signatureName: data.signature?.name || '',
                    esignDataUrl: data.signature?.image || null
                    // Do not override custom fields here as it is creating from PO
                }));
            }
        } catch (error) {
            console.error('Error fetching purchase order:', error);
        } finally {
            setIsFetching(false);
        }
    };

    // ==========================================
    // 3. USE EFFECTS
    // ==========================================
    useEffect(() => {
        fetchPaymentModes();
        fetchAdminUsers();
        fetchTaxes();
    }, []);

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

    useEffect(() => {
        if (purchaseFormData.purchaseOrderId) {
            fetchPurchaseOrder();
        }
    }, [purchaseFormData.purchaseOrderId]);

    useEffect(() => {
        const fetchPurchaseOrdersMinimal = async () => {
            try {
                const response = await axios.get(Constants.GET_PURCHASE_ORDERS_MINIMAL_URL, {
                    params: { search: debouncedPurchaseOrderSearchTerm },
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = response.data.data;
                if (data.length > 0) {
                    const formattedOrders = data.map((order: any) => ({ id: order.id, name: order.purchaseOrderId }));
                    setPurchaseOrders(formattedOrders);
                } else {
                    setPurchaseOrders([]);
                }
            } catch (error) {
                console.error('Error fetching minimal purchase orders:', error);
            }
        }
        fetchPurchaseOrdersMinimal();
    }, [debouncedPurchaseOrderSearchTerm]);

    useEffect(() => {
        const fetchBankAccounts = async () => {
            try {
                const response = await axios.get(Constants.FETCH_BANK_ACCOUNTS_WITH_SEARCH_URL, {
                    params: { search: debouncedSearchTermBankAccount },
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.data.data.length > 0) {
                    const formattedBankAccounts = response.data.data.map((item: any) => {
                        return {
                            id: item.id,
                            name: item.bankName
                        }
                    });
                    setBankAccounts(formattedBankAccounts);
                } else {
                    setBankAccounts([]);
                }
            } catch (error) {
                console.error("Error fetching bank accounts:", error);
            }
        }
        fetchBankAccounts();
    }, [debouncedSearchTermBankAccount, token]);

    useEffect(() => {
        const fetchManualSignatures = async () => {
            try {
                const response = await axios.get(Constants.FETCH_SIGNATURES_WITH_SEARCH_URL, {
                    params: { search: debouncedSearchTermSignature },
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.data.data.length > 0) {
                    const formattedSignatures = response.data.data.map((item: any) => {
                        return {
                            id: item.id,
                            name: item.signatureName,
                            imageUrl: item.signatureImage
                        }
                    });
                    setManualSignatures(formattedSignatures);
                } else {
                    setManualSignatures([]);
                }
            } catch (error) {
                console.error("Error fetching manual signatures:", error);
            }
        }
        fetchManualSignatures();
    }, [debouncedSearchTermSignature, token]);

    // ==========================================
    // 4. ITEM / PRODUCT HANDLERS
    // ==========================================
    const handleRemoveItem = (itemToRemove: PurchaseLineItem) => {
        handleFormChange('items', purchaseFormData.items.filter(item => item.id !== itemToRemove.id));
    };

    const handleEditItem = (itemToEdit: PurchaseLineItem) => {
        setEditingItem({ ...itemToEdit });
        setIsEditProductModalOpen(true);
    };

    const handleEditingItemChange = (field: keyof PurchaseLineItem, value: string | number) => {
        setEditingItem(prev => {
            if (!prev) return null;

            const fieldsToNumber = ['qty', 'rate', 'discount_value'];
            const newValue = fieldsToNumber.includes(field as string)
                ? Number(value) || 0
                : value;

            const updatedItem = { ...prev, [field]: newValue } as any;
            const { qty, rate, discount_type, tax_group_id } = updatedItem;

            const subtotal = qty * rate;
            // Clamp discount on the PRE-TAX subtotal: percentage 0..100, fixed 0..subtotal —
            // consistent with the inline row and backend lib/documentTotals.ts `lineDiscount`.
            let discount_value = Number(updatedItem.discount_value || 0);
            if (discount_type === 'Percentage') {
                if (discount_value < 0) discount_value = 0;
                if (discount_value > 100) discount_value = 100;
            } else {
                if (discount_value < 0) discount_value = 0;
                if (discount_value > subtotal) discount_value = subtotal;
            }
            const clampedDiscount = discount_type === 'Percentage'
                ? (subtotal * discount_value) / 100
                : discount_value;
            const safeDiscountAmount = Math.min(clampedDiscount, subtotal);

            const discountedSubtotal = subtotal - safeDiscountAmount;
            const selectedTaxGroup = taxes.find(t => String(t.id) === String(tax_group_id));
            const taxRate = selectedTaxGroup?.total_tax_rate || 0;

            const existingComponents = (updatedItem.taxes ?? []) as TaxLine[];
            if (existingComponents.length > 0) {
                // Re-scale existing per-component taxes on the new discounted base.
                const result = recomputeLineTaxesFromComponents(
                    { qty, rate, discount: safeDiscountAmount },
                    existingComponents,
                );
                const newAmount = round2(discountedSubtotal + result.totalTax);
                return {
                    ...updatedItem,
                    discount_value,
                    discount: safeDiscountAmount,
                    discount_type: discount_type || 'Fixed',
                    taxes: result.taxes,
                    totalTax: result.totalTax,
                    tax: result.totalTax,
                    amount: newAmount,
                };
            }

            const totalTax = round2((discountedSubtotal * taxRate) / 100);
            const newAmount = round2(discountedSubtotal + totalTax);

            const clearTaxFields = !selectedTaxGroup
                ? { taxes: [], totalTax: 0, appliedTaxRateIds: [] }
                : {};

            return {
                ...updatedItem,
                ...clearTaxFields,
                discount_value,
                discount: safeDiscountAmount,
                discount_type: discount_type || 'Fixed',
                tax: totalTax,
                amount: newAmount
            };
        });
    };

    const handleUpdateItem = () => {
        if (!editingItem) return;
        const updatedItems = purchaseFormData.items.map(item =>
            item.id === editingItem.id ? editingItem : item
        );
        handleFormChange('items', updatedItems);
        setIsEditProductModalOpen(false);
        setEditingItem(null);
    };

    /**
     * Compute discount + tax fields for one line from its raw inputs (qty, rate,
     * discount_value/type, tax_group_id, and optionally already-resolved
     * appliedTaxRateIds/taxes). Single source of truth reused by manual inline
     * edits (handleInLineItemChange) and the quick-create product seed path
     * (handleNewProductCreated) so the two paths can't drift apart again.
     * Ported from CreateInvoice.tsx's computeLineTaxFields (Task W5).
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
        if (discountAmount < 0) discountAmount = 0;
        if (discountAmount > subtotal) discountAmount = subtotal;

        const discountedSubtotal = subtotal - discountAmount;
        const lineTaxable = { qty, rate, discount: discountAmount };

        const selectedTaxGroup = taxes.find(t => String(t.id) === String(input.tax_group_id));
        const taxRate = selectedTaxGroup?.total_tax_rate || 0;
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

    // Apply a resolved (or flat-fallback) single-rate tax pick to one line.
    // C7 resolve-line responses may contain engine-provisioned system-component
    // taxRateIds NOT present in taxRateLibrary — always rescale via
    // recomputeLineTaxesFromComponents, never recomputeLineTaxesByIds here.
    const applyResolvedToLine = (
        it: PurchaseLineItem,
        taxRateId: string,
        resolved: Awaited<ReturnType<typeof resolveLineTaxByRateId>>,
    ): PurchaseLineItem => {
        const lineTaxable = { qty: Number(it.qty || 0), rate: Number(it.rate || 0), discount: Number(it.discount || 0) };
        const r = resolved
            ? { ...recomputeLineTaxesFromComponents(lineTaxable, resolved.taxes), appliedTaxRateIds: resolved.appliedTaxRateIds }
            : applyFlatRateToLine(lineTaxable, taxRateLibrary.find((x) => x.id === taxRateId) ?? null);
        return { ...it, tax_rate_id: taxRateId, tax_group_id: '', taxes: r.taxes, totalTax: r.totalTax, tax: r.totalTax, amount: r.amount, appliedTaxRateIds: r.appliedTaxRateIds };
    };

    const handleRowTaxSelect = async (rowId: string, taxRateId: string, snapshot?: { qty: number; rate: number; discount: number }) => {
        if (!taxRateId) {
            setPartyStateMissing(false);
            setPurchaseFormData((prev) => ({
                ...prev,
                items: prev.items.map((it) => it.id === rowId ? {
                    ...it, tax_rate_id: '', tax_group_id: '', taxes: [], totalTax: 0, tax: 0, appliedTaxRateIds: [],
                    amount: round2(Number(it.qty || 0) * Number(it.rate || 0) - Number(it.discount || 0)),
                } : it),
            }));
            return;
        }
        const line = snapshot ?? purchaseFormData.items.find((i) => i.id === rowId);
        if (!line) return;
        const taxableAmount = round2(Number(line.qty || 0) * Number(line.rate || 0) - Number(line.discount || 0));
        const resolved = await resolveLineTaxByRateId({
            token: token!, taxableAmount, taxRateId,
            ...(selectedContactId ? { supplierId: selectedContactId } : {}),
        });
        setPartyStateMissing(!!resolved?.partyStateMissing);
        setPurchaseFormData((prev) => ({
            ...prev,
            items: prev.items.map((it) => (it.id === rowId ? applyResolvedToLine(it, taxRateId, resolved) : it)),
        }));
    };

    const handleInLineItemChange = (product: PurchaseLineItem, rowId: string) => {
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
        const updatedProduct: PurchaseLineItem = { ...product, ...computed };
        isDirtyRef.current = true;
        setPurchaseFormData((prev) => ({
            ...prev,
            items: prev.items.map(item => item.id === rowId ? updatedProduct : item)
        }));
    }

    const handleNewRow = () => {
        isDirtyRef.current = true;
        setPurchaseFormData((prev) => ({
            ...prev,
            items: [...prev.items, {
                id: crypto.randomUUID(),
                name: '',
                unit: '',
                qty: 1,
                rate: 0,
                discount: 0,
                discount_value: 0,
                discount_type: 'Fixed',
                tax: 0,
                tax_group_id: undefined,
                amount: 0,
                taxes: [],
                appliedTaxRateIds: [],
            }]
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
        setPurchaseFormData((prev) => ({
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

    const handleNewProductClick = () => {
        setIsProductModalOpen(true);
    }

    // --- SIGNATURE HANDLERS ---
    const clearSignature = () => sigPadRef.current?.clear();
    const saveSignature = () => {
        if (sigPadRef.current) {
            const dataUrl = sigPadRef.current.getCanvas().toDataURL('image/png');
            handleFormChange('esignDataUrl', dataUrl);
            setSignatureModalOpen(false);
        }
    };

    // ==========================================
    // 5. CALCULATIONS
    // ==========================================
    const { subTotal, totalTax, totalDiscount, grandTotal } = useMemo(() => {
        const totals = purchaseFormData.items.reduce((acc, item) => {
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

        setTimeout(() => {
            setPurchaseFormData(prev => {
                if (prev.subTotal === roundedSubTotal && prev.grandTotal === roundedGrandTotal) return prev;
                return { ...prev, subTotal: roundedSubTotal, totalTax: roundedTotalTax, totalDiscount: roundedTotalDiscount, grandTotal: roundedGrandTotal };
            });
        }, 0);

        return { subTotal: roundedSubTotal, totalTax: roundedTotalTax, totalDiscount: roundedTotalDiscount, grandTotal: roundedGrandTotal };
    }, [purchaseFormData.items]);

    const totalInWords = useMemo(() => {
        if (grandTotal <= 0) return 'Zero';
        return numberToWords(Math.round(grandTotal));
    }, [grandTotal]);

    // Derive the document-level currency symbol from the selected currencyCode
    const docCurrencySymbol = resolveCurrency(purchaseFormData.currencyCode).symbol;

    const selectedManualSignatureImage = useMemo(() => {
        return manualSignatures.find(sig => sig.id === purchaseFormData.signatureId)?.imageUrl || null;
    }, [purchaseFormData.signatureId, manualSignatures]);


    // ==========================================
    // 6. VALIDATION & SUBMISSION
    // ==========================================
    const validatePurchaseOrderData = () => {
        const newErrors: { [key: string]: string } = {};

        if (!purchaseFormData.purchaseDate) newErrors.purchaseDate = 'Order date is required.';
        if (!purchaseFormData.status.trim()) newErrors.status = 'Status is required.';
        if (!purchaseFormData.billFrom.trim()) newErrors.billFrom = 'Bill from is required.';
        if (!purchaseFormData.supplierId?.trim() && !purchaseFormData.contactId?.trim()) newErrors.billTo = 'Bill to is required.';

        const hasItemPopulated = purchaseFormData.items.some(item => (item.name ?? '').trim() !== '');
        if (!hasItemPopulated) newErrors.items = 'At least one item is required.';

        if (purchaseFormData.sign_type === 'digitalSignature' && !purchaseFormData.signatureId) newErrors.signatureId = 'Manual signature is required.';
        if (purchaseFormData.sign_type === 'eSignature' && !purchaseFormData.signatureName.trim()) newErrors.signatureName = 'Esignature name is required.';
        if (purchaseFormData.sign_type === 'eSignature' && !purchaseFormData.esignDataUrl) newErrors.esignDataUrl = 'Esignature is required.';

        if (purchaseFormData.status === 'paid' && (!purchaseFormData.sp_paymentDate || !purchaseFormData.sp_paymentMode || !purchaseFormData.sp_amount)) {
            newErrors.status = 'Payment details are required.';
            setIsPaymentModalOpen(true);
        }

        // Custom Fields Validation
        activeCustomFields.forEach((field: any) => {
            if (field.isMandatory) {
                const val = purchaseFormData.customFields[field.fieldSlug] ?? purchaseFormData.customFields[field.id];
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

        const lineFieldError = validateLineCustomFields(purchaseFormData.items, lineFields);
        if (lineFieldError) newErrors.lineCustomFields = lineFieldError;

        setFormErrors(newErrors);
        return newErrors;
    }

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

    const savePurchaseOrder = async (e: React.FormEvent) => {
        e.preventDefault();

        const errors = validatePurchaseOrderData();

        if (Object.keys(errors).length > 0) {
            const firstErrorField = Object.keys(errors)[0];
            const firstErrorElement = document.querySelector(`[name="${firstErrorField}"]`) as HTMLInputElement | null;
            firstErrorElement?.focus();
            toast.error(errors.lineCustomFields || 'Please check the form for errors.');
            return;
        }

        const formData = new FormData();

        for (const [key, value] of Object.entries(purchaseFormData)) {
            if (key === 'esignDataUrl' && purchaseFormData.sign_type === 'eSignature') {
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
                const filteredItems = purchaseFormData.items.filter(item => (item.name ?? '').trim() !== '');
                appendLineTaxFormData(formData, filteredItems as unknown as Parameters<typeof appendLineTaxFormData>[1]);
            } else if (key === 'customFields') {
                const customFieldsEntries = Object.entries(purchaseFormData.customFields)
                    .filter(([_, val]) => {
                        if (val === undefined || val === null) return false;
                        if (typeof val === 'string' && val.trim() === '') return false;
                        if (Array.isArray(val) && val.length === 0) return false;
                        return true;
                    });

                customFieldsEntries.forEach(([fieldSlugOrId, val], index) => {
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

        // Clean empty parameters
        for (const [key, value] of formData.entries()) {
            if (value === null || value === undefined || value === 'null' || value === '') {
                formData.delete(key);
            }
        }

        try {
            setIsSubmitting(true);
            await axios.post(Constants.CREATE_NEW_PURCHASE_URL, formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data',
                },
            });

            toast.success('Purchase order saved successfully.');
            isDirtyRef.current = false;
            navigate('/admin/purchases');
        } catch (error: any) {
            if (error.response?.status !== 200 && error.response?.data?.errors) {
                setFormErrors(error.response.data.errors);
            } else if (axios.isAxiosError(error) && error.response?.data?.message) {
                toast.error(error.response.data.message);
            } else {
                toast.error('An unexpected error occurred.');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const handlePaymentConfirm = (paymentModalData: PurchaseFormData) => {
        isDirtyRef.current = true;
        setPurchaseFormData(prev => ({ ...prev, ...paymentModalData }));
        setIsPaymentModalOpen(false);
    }

    // ==========================================
    // 7. RENDER
    // ==========================================
    return (
        <div className="md:p-4 bg-white-50   min-h-screen border border-gray-200  rounded">
            <form onSubmit={savePurchaseOrder}>
                <div className="max-w-7xl mx-auto space-y-4">

                    <PageHeader title="New Purchase" />
                    {/* Header */}
                    <div className="flex justify-end items-center mb-2">
                        <img src={resolveCompanyLogo(systemSettings?.company?.siteLogo)} alt="" className='w-32 h-auto' />
                    </div>

                    {/* Top Section: PO Details & Logo */}
                    <div className="w-full">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 w-full">
                            <div className="w-full">
                                <label htmlFor="ref-no" className="block text-sm font-medium text-heading mb-1">
                                    Purchase Order
                                </label>
                                <SmartDropdown
                                    items={purchaseOrders}
                                    placeholder='Search and select'
                                    value={purchaseOrderSearchInput}
                                    onChange={(keyword) => setPurchaseOrderSearchInput(keyword)}
                                    onSelect={(item) => handlePurchaseOrderSelect(item as OptionType)}
                                    selectedItem={purchaseOrders.find(order => order.id === purchaseFormData.purchaseOrderId) || null}
                                />
                            </div>
                            <div className="w-full mt-1">
                                <DateInput
                                    label="Order Date"
                                    value={purchaseFormData.purchaseDate}
                                    onChange={(newDate) => handleFormChange('purchaseDate', newDate)}
                                    isRequired
                                />
                                {formErrors?.purchaseDate && <span className="text-danger text-sm">{formErrors.purchaseDate}</span>}
                            </div>
                            <div className="w-full mt-1">
                                <Select
                                    name="status"
                                    label={<>Status <em className='text-danger'>*</em></>}
                                    onChange={(e) => handleFormChange('status', e.target.value)}
                                    value={purchaseFormData.status}
                                    error={formErrors?.status}
                                    options={[
                                        { value: '', label: 'Select' },
                                        { value: 'new', label: 'New (Draft — no stock)' },
                                        { value: 'paid', label: 'Paid' },
                                        { value: 'pending', label: 'Pending' },
                                        { value: 'cancelled', label: 'Cancelled' },
                                    ]}
                                />
                            </div>
                            <div className="w-full mt-1">
                                <CurrencySelect
                                    label="Currency"
                                    value={purchaseFormData.currencyCode}
                                    onChange={(code) => handleFormChange('currencyCode', code)}
                                />
                            </div>
                        </div>
                    </div>

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
                                />
                                {!selectedAdmin && formErrors?.billFrom && <span className="text-danger text-sm">{formErrors.billFrom}</span>}
                                {!selectedAdmin && <p className="mt-2 text-xs text-gray-500  p-2 bg-gray-50  rounded-md font-semibold">
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
                            <h3 className="font-bold text-gray-950  mb-4">Bill To <span className='text-danger'>*</span></h3>
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
                                value={purchaseFormData.taxTreatment}
                                onChange={(e) => handleFormChange('taxTreatment', e.target.value as PurchaseFormData['taxTreatment'])}
                                options={[
                                    { value: 'STANDARD', label: 'Standard' },
                                    { value: 'ZERO_RATED', label: 'Zero-rated' },
                                    { value: 'EXEMPT', label: 'Exempt' },
                                    { value: 'REVERSE_CHARGE', label: 'Reverse charge' },
                                    { value: 'OUT_OF_SCOPE', label: 'Out of scope' },
                                ]}
                            />
                            {purchaseFormData.taxTreatment !== 'STANDARD' && (
                                <p className="text-sm text-warning font-medium mt-5">
                                    Tax suppressed — {purchaseFormData.taxTreatment.replace(/_/g, ' ').toLowerCase()}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* DYNAMIC CUSTOM FIELDS SECTION */}
                    <DynamicCustomFields
                        moduleSlug="purchases"
                        values={purchaseFormData.customFields}
                        errors={formErrors}
                        onChange={handleCustomFieldChange}
                        onFieldsLoaded={setActiveCustomFields}
                    />

                    {/* Items & Details Section */}
                    <div className="bg-white rounded-card border border-border shadow-card">
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
                                    {purchaseFormData.items.map((item) => (
                                        <React.Fragment key={item.id}>
                                            <InvoiceTableRow
                                                item={item}
                                                currencySymbol={docCurrencySymbol}
                                                currencyCode={purchaseFormData.currencyCode}
                                                onInLineItemChange={(updatedItem) => handleInLineItemChange(updatedItem as PurchaseLineItem, item.id)}
                                                onProductPicked={(updated) => {
                                                    handleInLineItemChange(updated as PurchaseLineItem, item.id);
                                                    const taxRateId = (updated as PurchaseLineItem).tax_rate_id;
                                                    if (taxRateId) {
                                                        void handleRowTaxSelect(updated.id, taxRateId, { qty: updated.qty, rate: updated.rate, discount: updated.discount });
                                                    }
                                                }}
                                                onEditItem={(i) => handleEditItem(i as PurchaseLineItem)}
                                                onDeleteItem={(i) => handleRemoveItem(i as PurchaseLineItem)}
                                                availableItems={purchaseFormData.items}
                                                addNewProduct={handleNewProductClick}
                                                lineFields={lineFields}
                                            />
                                            <tr>
                                                <td colSpan={8 + lineFields.length} className="px-3 pb-2">
                                                    <span className="text-xs text-gray-500 mr-2">Tax rates:</span>
                                                    {purchaseFormData.taxTreatment === 'STANDARD' ? (
                                                        <LineTaxSelect
                                                            taxRates={taxRateLibrary}
                                                            value={(item as PurchaseLineItem).tax_rate_id ?? ''}
                                                            legacyLabel={(item.taxes ?? []).length > 0
                                                                ? `Current: ${(item.taxes ?? []).map((t) => `${t.kind ?? t.name} ${t.percent}%`).join(' + ')}`
                                                                : null}
                                                            onSelect={(rateId) => { void handleRowTaxSelect(item.id, rateId); }}
                                                        />
                                                    ) : (
                                                        <span className="text-xs text-warning italic">Tax suppressed</span>
                                                    )}
                                                    {(item.taxes ?? []).length > 0 && (
                                                        <span className="ml-2 text-xs text-gray-400">
                                                            {item.taxes!.map(t => `${t.name} ${t.percent}%`).join(' + ')}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        </React.Fragment>
                                    ))}
                                    {purchaseFormData.items.length === 0 && (
                                        <tr className="bg-white  text-gray-950 ">
                                            <td className="p-3 font-medium text-center" colSpan={8 + lineFields.length}>
                                                No Items Selected
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            {/* Add New Row */}
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
                            {/* Discount Type */}
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
                                        // Optimistically set so the stale-guard below can compare (mirrors old group flow)
                                        setEditingItem((prev) => prev ? { ...prev, tax_rate_id: rateId } : null);
                                        const taxableAmount = round2(Number(editingItem.qty || 0) * Number(editingItem.rate || 0) - Number(editingItem.discount || 0));
                                        const resolved = await resolveLineTaxByRateId({ token: token!, taxableAmount, taxRateId: rateId, ...(selectedContactId ? { supplierId: selectedContactId } : {}) });
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
                                    No supplier state set — taxed as inter-state (IGST).
                                </p>
                            )}

                            <div className="pt-2">
                                <p className="text-lg font-semibold text-gray-950 ">
                                    New Amount: {docCurrencySymbol}{editingItem.amount.toFixed(2)}
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
                        <h3 className="text-lg font-semibold text-gray-950  mb-3">Extra Information</h3>
                        <div className="flex items-center gap-2 mb-4">
                            <Button type='button' size="sm" variant={activeInfoTab === 'notes' ? 'primary' : 'white'} onClick={() => setActiveInfoTab('notes')}>Add Notes</Button>
                            <Button type='button' size="sm" variant={activeInfoTab === 'termsAndCondition' ? 'primary' : 'white'} onClick={() => setActiveInfoTab('termsAndCondition')}>Add Terms & Conditions</Button>
                            <Button type='button' size="sm" variant={activeInfoTab === 'bank' ? 'primary' : 'white'} onClick={() => setActiveInfoTab('bank')}>Bank Details</Button>
                        </div>

                        {activeInfoTab === 'notes' && (
                            <FormField label="Additional Notes">
                                {(field) => (
                                    <textarea
                                        id={field.id}
                                        aria-describedby={field['aria-describedby']}
                                        value={purchaseFormData.notes}
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
                                        value={purchaseFormData.termsAndCondition}
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
                                <label className="block text-sm font-medium text-gray-700 ">Account</label>
                                <SmartDropdown
                                    items={bankAccounts}
                                    value={bankAccountSearchInput}
                                    onChange={(value) => { setBankAccountSearchInput(value); handleFormChange('bank', null); }}
                                    onSelect={(item) => handleFormChange('bank', (item as OptionType)?.id || null)}
                                    onAddNew={() => setIsCreateBankAccountModalOpen(true)}
                                    selectedItem={bankAccounts.find(item => item.id === purchaseFormData.bank)}
                                    addNewLabel='New Bank Account'
                                    placeholder='Type to search Bank Account...'
                                />
                            </div>
                        )}
                    </div>

                    {/* Right Side: Totals & Signature */}
                    <div className="bg-white p-4 rounded-card border border-border shadow-card space-y-3">
                        <div className="flex justify-between text-sm text-gray-600 "><span>Amount</span><span>{docCurrencySymbol}{subTotal?.toFixed(2) || '0.00'}</span></div>
                        <div className="flex justify-between text-sm text-gray-600 "><span>Tax</span><span>{docCurrencySymbol}{totalTax?.toFixed(2) || '0.00'}</span></div>
                        <div className="flex justify-between text-sm text-gray-600 "><span>Discount</span><span>- {docCurrencySymbol}{totalDiscount?.toFixed(2) || '0.00'}</span></div>
                        <hr className="border-gray-200 " />
                        <div className="flex justify-between font-bold text-gray-950 "><span>Total</span><span>{docCurrencySymbol}{grandTotal?.toFixed(2) || '0.00'}</span></div>
                        <p className="text-sm text-gray-500 capitalize">{totalInWords}</p>

                        <div className="flex items-center gap-4 pt-4">
                            <div className="flex items-center"><input id="no-sig" type="radio" name="signature" checked={purchaseFormData.sign_type === 'none'} onChange={() => { handleFormChange('sign_type', 'none'); handleFormChange('esignDataUrl', null) }} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="no-sig" className="ml-2 block text-sm text-gray-700 cursor-pointer">No Signature</label></div>
                            <div className="flex items-center"><input id="manual-sig" type="radio" name="signature" checked={purchaseFormData.sign_type === 'digitalSignature'} onChange={() => { handleFormChange('sign_type', 'digitalSignature'); handleFormChange('esignDataUrl', null) }} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="manual-sig" className="ml-2 block text-sm text-gray-700 cursor-pointer">Manual Signature</label></div>
                            <div className="flex items-center"><input id="e-sig" type="radio" name="signature" checked={purchaseFormData.sign_type === 'eSignature'} onChange={() => { handleFormChange('sign_type', 'eSignature'); handleFormChange('esignDataUrl', null) }} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="e-sig" className="ml-2 block text-sm text-gray-700 cursor-pointer">eSignature</label></div>
                        </div>

                        {purchaseFormData.sign_type !== 'none' && (purchaseFormData.sign_type === 'digitalSignature' ? (
                            <div>
                                <label className="block text-sm font-medium text-heading mb-2">Select Signature Name <span className="text-danger">*</span></label>
                                <SmartDropdown
                                    items={manualSignatures}
                                    value={signatureSearchInput}
                                    onChange={(value) => setSignatureSearchInput(value)}
                                    onSelect={(item) => handleFormChange('signatureId', item?.id || '')}
                                    selectedItem={manualSignatures.find(sig => sig.id === purchaseFormData.signatureId) || null}
                                    onAddNew={() => setIsCreateSignModalOpen(true)}
                                    addNewLabel='New Signature'
                                    placeholder='Type to search signatures...'
                                />
                                {formErrors?.signatureId && <p className="text-danger text-xs mt-1">{formErrors.signatureId}</p>}
                                <p className="mt-2 text-sm font-medium text-gray-700 ">Signature Image</p>
                                <div className="mt-2 h-20 w-48 bg-gray-100 rounded-md flex items-center justify-center">
                                    {selectedManualSignatureImage ? <img src={selectedManualSignatureImage} alt="Selected Signature" className="max-h-full max-w-full" /> : <span className="text-xs text-gray-400">No signature selected</span>}
                                </div>
                            </div>
                        ) : (
                            <div>
                                <FormField
                                    label="Signature Name"
                                    required
                                    name='signatureName'
                                    type="text"
                                    value={purchaseFormData.signatureName}
                                    onChange={e => handleFormChange('signatureName', e.target.value)}
                                    placeholder="Enter Signature Name"
                                    error={formErrors?.signatureName}
                                />
                                <p className="mt-2 text-sm font-medium text-heading">Draw your eSignature</p>
                                <div className="mt-2 h-20 w-48 bg-gray-100 rounded-md flex items-center justify-center cursor-pointer border-2 border-dashed border-gray-400" onClick={() => setSignatureModalOpen(true)}>
                                    {purchaseFormData.esignDataUrl ? <img src={purchaseFormData.esignDataUrl} alt="Drawn Signature" className="max-h-full max-w-full" /> : <div className="text-center text-gray-500"><Edit3 size={20} className="mx-auto mb-1" /><span className="text-xs">Draw Signature</span></div>}
                                </div>
                                {formErrors?.esignDataUrl && <p className="text-danger text-xs mt-1">{formErrors.esignDataUrl}</p>}
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex justify-end mt-4 gap-3">
                    <Button variant="white" onClick={() => { if (confirmIfDirty(isDirtyRef.current)) navigate('/admin/purchases'); }}>Cancel</Button>
                    <SubmitButton isDisabled={isSubmitting} isLoading={isSubmitting} mode='create' />
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
                            <Button variant="white" onClick={() => setSignatureModalOpen(false)}>Cancel</Button>
                            <Button onClick={saveSignature}>Save</Button>
                        </div>
                    </div>
                </Modal>
            </form>

            {/* Payment Modal */}
            <PaymentModal
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                onConfirm={handlePaymentConfirm}
                totalAmount={grandTotal}
                paymentModes={paymentModes}
            />

            {/* Create Product Form */}
            <CreateProductForm
                isOpen={isProductModalOpen}
                onClose={() => setIsProductModalOpen(false)}
                onSuccess={(newProduct: Product) => handleNewProductCreated(newProduct)}
            />

            {/* Create Signature Modal */}
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

            {/* Create Bank Account Modal */}
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
            {isFetching && <FullPageLoader />}
        </div>
    );
};

export default CreatePurchase;