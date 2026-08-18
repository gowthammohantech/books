import React, { useEffect, useState, useMemo, useRef } from 'react';
import { PlusCircle, Edit } from 'lucide-react';
import DateInput from '@components/admin/DateInput';
import axios from 'axios';
import Constants from '@constants/api';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import SearchableDropdown from '@components/admin/SearchableDropdown';
import { useDebounce } from '@hooks/useDebounce';
import Modal from '@components/admin/Modal';
import SignatureCanvas from 'react-signature-canvas';
import { numberToWords } from '@utils/converters';
import { toast } from "sonner";
import { useNavigate } from 'react-router-dom';
import PaymentModal from '@pages/admin/purchases/PaymentModal';
import AdminCard from '@components/admin/AdminCard';
import { resolveCompanyLogo } from '@utils/companyLogo';
import FullPageLoader from '@components/admin/FullPageLoader';
import SubmitButton from '@components/admin/SubmitButton';
import type { OptionType, SelectedAdmin } from '@models/common';
import type { Contact } from '@models/contact';
import ContactPicker from '@components/admin/ContactPicker';
import type { Product, ProductItem as BaseProductItem } from '@models/product';
import { useLineItemCustomFields } from '@hooks/useLineItemCustomFields';
import { validateLineCustomFields } from '@lib/lineCustomFields';
import type { SignatureOptions } from '@models/signature';
import type { TaxRate } from '@models/taxRate';
import SmartDropdown from '@components/admin/SmartDropdown';
import InvoiceTableRow from '@components/admin/InvoiceTableRow';
import LineTaxSelect from '@components/admin/LineTaxSelect';
import CreateProductForm from '@components/admin/CreateProductForm';
import CreateSignatureModal from '../invoices/CreateSignatureModal';
import CreateBankAccountModal from '../invoices/CreateBankAccountModal';
import type { BankAccountCreatedResponse } from '@models/bank-account';
import CurrencySelect from '@components/admin/CurrencySelect';
import { useCurrencies } from '@hooks/useCurrencies';
import { useDocumentDefaults } from '@hooks/useDocumentDefaults';
import { Button, FormField, Select, fieldControlClasses } from '@components/ui';
import { round2 } from '@utils/round2';
import { PageHeader } from "@/context/PageHeaderContext";

// Extend the base ProductItem to carry per-line custom field values.
type ProductItem = BaseProductItem & {
    customFields?: Record<string, string | number | boolean | string[]>;
};

interface DebitNoteFormData {
    purchaseId?: string;
    userId: string;
    billFrom: string;
    billTo: string;
    referenceNo: string;
    debitNoteDate: Date | null;
    status: string;
    items: ProductItem[];
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
    currencyCode: string;
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

interface IPaymentMode {
    id: string;
    name: string;
    slug: string;
}
const CreateDebitNote: React.FC = () => {
    const navigate = useNavigate();
    const { token, user } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { defaultCurrencyCode, resolveCurrency } = useCurrencies();
    const { defaults: docDefaults, loading: docDefaultsLoading } = useDocumentDefaults();
    const { fields: lineFields } = useLineItemCustomFields(token, 'purchases');
    const [adminUsers, setAdminUsers] = useState<OptionType[]>([]);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [selectedAdmin, setSelectedAdmin] = useState<OptionType | null>(null);
    const [companyDetails, setCompanyDetails] = useState<SelectedAdmin | null>(null);
    const [paymentModes, setPaymentModes] = useState<IPaymentMode[]>([]);
    const [purchases, setPurchases] = useState<OptionType[]>([]);
    const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
    const [debitNoteFormData, setDebitNoteFormData] = useState<DebitNoteFormData>({
        purchaseId: '',
        userId: user?.id || '',
        billFrom: '',
        billTo: '',
        referenceNo: '',
        debitNoteDate: null,
        status: '',
        items: [
            {
                id: crypto.randomUUID(),
                name: '',
                unit: '',
                qty: 1,
                rate: 0,
                discount: 0,
                tax: 0,
                amount: 0
            }
        ],
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
        currencyCode: defaultCurrencyCode,
        billToContactId: '',
        taxTreatment: 'STANDARD',
    });

    // Apply document defaults once loaded — seed blank new form, never overwrite user edits
    useEffect(() => {
        if (docDefaultsLoading) return;
        setDebitNoteFormData(prev => {
            // Skip if a parent purchase has already been linked (purchaseId is set)
            if (prev.purchaseId) return prev;
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
    const [editingItem, setEditingItem] = useState<ProductItem | null>(null);
    const [taxes, setTaxes] = useState<taxGroup[]>([]);
    const [taxRateLibrary, setTaxRateLibrary] = useState<TaxRate[]>([]);
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

    // Extra Information State
    const [activeInfoTab, setActiveInfoTab] = useState<'notes' | 'termsAndCondition' | 'bank'>('notes');
    const [bankAccounts, setBankAccounts] = useState<OptionType[]>([]);
    const [manualSignatures, setManualSignatures] = useState<SignatureOptions[]>([]);
    const [isSignatureModalOpen, setSignatureModalOpen] = useState(false);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const sigPadRef = useRef<SignatureCanvas>(null);
    const [isFetching, setIsFetching] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [adminSearchInput, setAdminSearchInput] = useState<string>('');
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [signatureSearchInput, setSignatureSearchInput] = useState<string>('');
    const debouncedSearchTermSignature = useDebounce(signatureSearchInput, 500);
    const [isCreateSignModalOpen, setIsCreateSignModalOpen] = useState(false);
    const [bankAccountSearchInput, setBankAccountSearchInput] = useState<string>('');
    const debouncedSearchTermBankAccount = useDebounce(bankAccountSearchInput, 500);
    const [isCreateBankAccountModalOpen, setIsCreateBankAccountModalOpen] = useState(false);
    useEffect(() => {
        fetchPaymentModes();
        fetchAdminUsers();
        fetchTaxes();
        fetchPurchaseOrders();
    }, []);

    useEffect(() => {
        if (debitNoteFormData.purchaseId) fetchPurchase();
    }, [debitNoteFormData.purchaseId]);

    const fetchPurchase = async () => {
        try {
            setIsFetching(true);
            const response = await axios.get(`${Constants.GET_PURCHASE_DETAILS_URL}/${debitNoteFormData.purchaseId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });

            const data = response.data.data;

            if (data) {
                if (data.billTo) {
                    setSelectedContactId(null);
                }

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

                const mappedItems = (data.items || []).map((item: any) => ({
                    ...item,
                    tax_group_id: item.tax_group?.id ?? item.tax_group_id ?? '',
                    tax_rate_id: item.tax_rate_id ?? undefined,
                }));

                setDebitNoteFormData(prev => ({
                    ...prev,
                    id: data.id,
                    userId: user?.id || '',
                    billFrom: data.billFrom?.id || '',
                    billTo: data.billTo?.id || '',
                    referenceNo: data.referenceNo || '',
                    debitNoteDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
                    status: data.status || '',
                    items: mappedItems,
                    notes: data.notes || '',
                    termsAndCondition: data.termsAndCondition || '',
                    bank: data.bank?.id || null,
                    sign_type: data.sign_type ?? 'none',
                    signatureId: data.signature?.id || null,
                    signatureName: data.signature?.name || '',
                    esignDataUrl: data.signature?.image || null
                }));

            }
        } catch (error) {
            console.error('Error fetching purchase order:', error);
        } finally {
            setIsFetching(false);
        }
    }
    const fetchPurchaseOrders = async () => {
        try {
            const response = await axios.get(Constants.FETCH_ALL_PURCHASE_FOR_DEBIT_NOTE_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = response.data.data;
            if (data.length > 0) {
                const formattedPurchases = data.map((order: any) => ({ id: order.id, name: order.purchaseId }));

                setPurchases(formattedPurchases);
            }
        } catch (error) {
            console.error('Error fetching purchase orders:', error);
        }
    }
    const fetchPaymentModes = async () => {
        try {
            const response = await axios.get(Constants.GET_ALL_PAYMENT_MODES_URL, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setPaymentModes(response.data.data);
        } catch (error) {
            console.error('Error fetching payment modes:', error);
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
            console.error('Error fetching taxes:', error);
            setTaxes([]);
        }
    };

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
    }, [debouncedSearchTermBankAccount]);

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
    }, [debouncedSearchTermSignature]);

    const handleAdminChange = async (user: OptionType) => {
        setSelectedAdmin(user);
        try {
            setIsFetching(true);
            const response = await axios.get(`${Constants.FETCH_COMPANY_SETTINGS_URL}/${user.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            //set billFrom to prev debitNoteFormData
            setDebitNoteFormData(prev => ({ ...prev, billFrom: user.id }));
            setCompanyDetails(response.data.data);
        } catch (error) {
            setCompanyDetails(null);
        } finally {
            setIsFetching(false);
        }
    };

    const handleContactChange = (contactId: string | null, contact: Contact | null) => {
        setSelectedContactId(contactId);
        if (contact) {
            setDebitNoteFormData(prev => ({
                ...prev,
                billToContactId: contactId ?? '',
                billTo: '',
                currencyCode: contact.currencyCode || prev.currencyCode,
                taxTreatment: contact.defaultTaxTreatment ?? 'STANDARD',
            }));
        } else {
            setDebitNoteFormData(prev => ({
                ...prev,
                billToContactId: '',
                billTo: '',
            }));
        }
    };

    // --- ITEM & FORM HANDLERS ---
    const handleFormChange = (field: keyof DebitNoteFormData, value: any) => {
        setDebitNoteFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleRemoveItem = (itemToRemove: ProductItem) => {
        handleFormChange('items', debitNoteFormData.items.filter(item => item.id !== itemToRemove.id));
    };

    const handleEditItem = (itemToEdit: ProductItem) => {
        setEditingItem({ ...itemToEdit });
        setIsEditProductModalOpen(true);
    };

    /** Flat percent for a line: new tax_rate_id wins, legacy tax_group_id falls back (C8). */
    const lineTaxPercent = (line: { tax_rate_id?: string | null; tax_group_id?: string | null }): number => {
        if (line.tax_rate_id) {
            const r = taxRateLibrary.find((x) => x.id === line.tax_rate_id);
            if (r) return Number(r.rate);
        }
        const g = taxes.find((t) => String(t.id) === String(line.tax_group_id));
        return g?.total_tax_rate || 0;
    };

    const handleEditingItemChange = (field: keyof ProductItem, value: string | number) => {
        setEditingItem(prev => {
            if (!prev) return null;

            const fieldsToNumber = ['qty', 'rate', 'discount_value'];

            const newValue = fieldsToNumber.includes(field as string)
                ? Number(value) || 0
                : value;

            const updatedItem = { ...prev, [field]: newValue };

            const { qty, rate, discount_value, discount_type } = updatedItem;

            const subtotal = qty * rate;

            // Row-level discount, clamped to [0, subtotal]
            let discountAmount = discount_type === 'Percentage'
                ? (subtotal * (discount_value || 0)) / 100
                : (discount_value || 0);
            if (discountAmount < 0) discountAmount = 0;
            if (discountAmount > subtotal) discountAmount = subtotal;

            const discountedSubtotal = subtotal - discountAmount;

            // Tax computed on the DISCOUNTED base (matches backend documentTotals)
            const taxRate = lineTaxPercent(updatedItem);

            const totalTax = round2((discountedSubtotal * taxRate) / 100);

            // Final amount
            const newAmount = round2(discountedSubtotal + totalTax);

            return {
                ...updatedItem,
                discount: discountAmount,
                discount_type: discount_type || 'Fixed',
                tax: totalTax,
                amount: newAmount
            };
        });
    };



    const handleUpdateItem = () => {
        if (!editingItem) return;
        const updatedItems = debitNoteFormData.items.map(item =>
            item.id === editingItem.id ? editingItem : item
        );
        handleFormChange('items', updatedItems);
        setIsEditProductModalOpen(false);
        setEditingItem(null);
    };

    // --- SIGNATURE HANDLERS ---
    const clearSignature = () => sigPadRef.current?.clear();
    const saveSignature = () => {
        if (sigPadRef.current) {
            const dataUrl = sigPadRef.current.getCanvas().toDataURL('image/png');
            handleFormChange('esignDataUrl', dataUrl);
            setSignatureModalOpen(false);
        }
    };

    // --- DYNAMIC CALCULATIONS ---
    const { subTotal, totalTax, totalDiscount, grandTotal } = useMemo(() => {
        const totals = debitNoteFormData.items.reduce((acc, item) => {
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
        setDebitNoteFormData(prev => ({ ...prev, subTotal: roundedSubTotal, totalTax: roundedTotalTax, totalDiscount: roundedTotalDiscount, grandTotal: roundedGrandTotal }));
        return { subTotal: roundedSubTotal, totalTax: roundedTotalTax, totalDiscount: roundedTotalDiscount, grandTotal: roundedGrandTotal };
    }, [debitNoteFormData.items]);

    const totalInWords = useMemo(() => {
        if (grandTotal && grandTotal <= 0) return 'Zero';
        const grandTotalInterger = Math.round(grandTotal);
        return numberToWords(grandTotalInterger);
    }, [grandTotal]);

    // Derive the document-level currency symbol from the selected currencyCode
    const docCurrencySymbol = resolveCurrency(debitNoteFormData.currencyCode).symbol;

    const selectedManualSignatureImage = useMemo(() => {
        return manualSignatures.find(sig => sig.id === debitNoteFormData.signatureId)?.imageUrl || null;
    }, [debitNoteFormData.signatureId, manualSignatures]);


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

    const handleInLineItemChange = (product: ProductItem, rowId: string) => {
        //do calculations
        const { qty, rate, discount_value, discount_type } = product;
        const subtotal = qty * rate;

        let discountAmount = discount_type === 'Percentage'
            ? (subtotal * (discount_value || 0)) / 100
            : (discount_value || 0);
        if (discountAmount < 0) discountAmount = 0;
        if (discountAmount > subtotal) discountAmount = subtotal;

        const discountedSubtotal = subtotal - discountAmount;

        const taxRate = lineTaxPercent(product);

        const totalTax = round2((discountedSubtotal * taxRate) / 100);

        const newAmount = round2(discountedSubtotal + totalTax);
        const updatedProduct = { ...product, discount: discountAmount, tax: totalTax, amount: newAmount };
        setDebitNoteFormData((prev) => ({
            ...prev,
            items: prev.items.map(item => item.id === rowId ? updatedProduct : item)
        }));
    }

    const handleNewRow = () => {
        setDebitNoteFormData((prev) => ({
            ...prev,
            items: [...prev.items, {
                id: crypto.randomUUID(),
                name: '',
                unit: '',
                qty: 1,
                rate: 0,
                discount: 0,
                tax: 0,
                amount: 0
            }]
        }));
    }

    const handleNewProductCreated = (product: Product) => {
        const discount_type = product.discount?.type;
        const discount_value = product.discount?.value;
        const subtotal = product.prices?.selling ?? 0;
        let discountAmount = discount_type === 'Percentage'
            ? (subtotal * (discount_value || 0)) / 100
            : (discount_value || 0);
        if (discountAmount < 0) discountAmount = 0;
        if (discountAmount > subtotal) discountAmount = subtotal;
        const discountedSubtotal = subtotal - discountAmount;
        const taxRate = product.tax_rate?.rate ?? product.tax?.total_rate ?? 0;

        const totalTax = round2((discountedSubtotal * taxRate) / 100);
        const newAmount = round2(discountedSubtotal + totalTax);

        let updated = false;
        setDebitNoteFormData((prev) => ({
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
                        rate: product.prices?.selling ?? 0,
                        amount: newAmount,
                        discount: discountAmount,
                        tax: totalTax,
                        tax_group_id: product.tax?.group_id,
                        tax_rate_id: product.tax_rate?.taxRateId ?? undefined,
                        discount_type: product.discount?.type,
                        discount_value: product.discount?.value,
                    }
                }
                return item;
            })
        }));
        setIsProductModalOpen(false);
    }

    const validateDebitNoteData = () => {
        // Add your validation logic here
        const newErrors: { [key: string]: string } = {};
        //order date required
        if (!debitNoteFormData.debitNoteDate) newErrors.debitNoteDate = 'Order date is required.';
        //status required
        if (!debitNoteFormData.status.trim()) newErrors.status = 'Status is required.';
        //billFrom required
        if (!debitNoteFormData.billFrom.trim()) newErrors.billFrom = 'Bill from is required.';
        //billTo required
        if (!debitNoteFormData.billTo.trim() && !debitNoteFormData.billToContactId?.trim()) newErrors.billTo = 'Bill to is required.';
        //atleast 1 item required
        const hasItemPopulated = debitNoteFormData.items.some(item => (item.name ?? '').trim() !== '');
        if (!hasItemPopulated) newErrors.items = 'At least one item is required.';
        //sign_type if manual then signatureId required
        if (debitNoteFormData.sign_type === 'digitalSignature' && !debitNoteFormData.signatureId) newErrors.signatureId = 'Manual signature is required.';
        //sign_type if esignature then signatureName required
        if (debitNoteFormData.sign_type === 'eSignature' && !debitNoteFormData.signatureName.trim()) newErrors.signatureName = 'Esignature name is required.';
        if (debitNoteFormData.sign_type === 'eSignature' && !debitNoteFormData.esignDataUrl) newErrors.esignDataUrl = 'Esignature is required.';

        //if status paid then paymentDate, paymentMode and amount required open modal
        if (debitNoteFormData.status === 'paid' && (!debitNoteFormData.sp_paymentDate || !debitNoteFormData.sp_paymentMode || !debitNoteFormData.sp_amount)) {
            newErrors.status = 'Payment details are required.';
            setIsPaymentModalOpen(true);
        }

        const lineFieldError = validateLineCustomFields(debitNoteFormData.items, lineFields);
        if (lineFieldError) newErrors.lineCustomFields = lineFieldError;

        setFormErrors(newErrors);
        return newErrors;
    }
    const saveDebitNote = async (e: React.FormEvent) => {
        e.preventDefault();
        const errors = validateDebitNoteData();

        if (Object.keys(errors).length > 0) {
            const firstErrorField = Object.keys(errors)[0];
            const firstErrorElement = document.querySelector(`[name="${firstErrorField}"]`) as HTMLInputElement | null;
            firstErrorElement?.focus();
            if (errors.lineCustomFields) toast.error(errors.lineCustomFields);
            return;
        }

        const formData = new FormData();

        for (const [key, value] of Object.entries(debitNoteFormData)) {
            if (key === 'esignDataUrl' && debitNoteFormData.sign_type === 'eSignature') {
                const file = await dataURLtoFile(value, 'signature.png');
                if (file) {
                    formData.append('signatureImage', file);
                }
            } else if (value instanceof Date) {
                const year = value.getFullYear();
                const month = String(value.getMonth() + 1).padStart(2, "0");
                const day = String(value.getDate()).padStart(2, "0");

                formData.append(key, `${year}-${month}-${day}`);
            } else if (Array.isArray(value) && key === 'items') {
                value.forEach((item, index) => {
                    Object.entries(item).forEach(([itemKey, itemValue]) => {
                        if (itemKey === 'tax_rate_id' && !itemValue) return;
                        if (itemKey === 'customFields' && itemValue && typeof itemValue === 'object' && !Array.isArray(itemValue)) {
                            Object.entries(itemValue as Record<string, unknown>).forEach(([slug, cfValue]) => {
                                if (cfValue === undefined || cfValue === null) return;
                                if (typeof cfValue === 'string' && cfValue.trim() === '') return;
                                if (Array.isArray(cfValue)) {
                                    cfValue.forEach((v, vIdx) => {
                                        formData.append(`items[${index}][customFields][${slug}][${vIdx}]`, String(v));
                                    });
                                    return;
                                }
                                formData.append(`items[${index}][customFields][${slug}]`, String(cfValue));
                            });
                            return;
                        }
                        if (itemValue !== undefined && itemValue !== null) {
                            formData.append(`items[${index}][${itemKey}]`, String(itemValue));
                        }
                    });
                });
            } else if (typeof value !== 'object' && value !== undefined && value !== null) {
                formData.append(key, String(value));
            }
        }


        try {
            setIsSubmitting(true);
            await axios.post(Constants.CREATE_DEBIT_NOTE_URL, formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data',
                },
            });

            toast.success('Debit note created successfully.');
            navigate('/admin/debit-notes');
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


    const dataURLtoFile = async (input: string, filename: string): Promise<File | null> => {
        try {
            if (input.startsWith('data:')) {
                // Base64 Data URL case
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
                // Normal URL case (fetch the image)
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



    const handlePaymentConfirm = (paymentModalData: DebitNoteFormData) => {
        //set with previous data
        setDebitNoteFormData(prev => ({ ...prev, ...paymentModalData }));
        setIsPaymentModalOpen(false);
    }
    const handleNewProductClick = () => {
        setIsProductModalOpen(true);
    }
    return (
        <div className="md:p-4 bg-white-50   min-h-screen border border-gray-200  rounded">
            <form onSubmit={saveDebitNote}>
                <div className="max-w-7xl mx-auto space-y-4">

                    <PageHeader title="New Debit Note" />
                    {/* Header */}
                    <div className="flex justify-end items-center mb-2">
                        <img src={resolveCompanyLogo(systemSettings?.company?.siteLogo)} alt="" className='w-32' />
                    </div>
                    {/* Top Section: PO Details & Logo */}
                    <div className="w-full">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 w-full">
                            <div className="w-full">
                                <FormField label="Purchase ID" id="ref-no">
                                    {() => (
                                        <SearchableDropdown
                                            options={purchases}
                                            placeholder='Select Purchase Order'
                                            value={purchases.find(order => order.id === debitNoteFormData.purchaseId) ?? null}
                                            onChange={(_, value) => handleFormChange('purchaseId', (value as OptionType)?.id || null)}
                                        />
                                    )}
                                </FormField>
                            </div>
                            <div className="w-full mt-1">
                                <DateInput
                                    label="Order Date"
                                    value={debitNoteFormData.debitNoteDate}
                                    onChange={(newDate) => handleFormChange('debitNoteDate', newDate)}
                                    isRequired
                                />
                                {formErrors?.debitNoteDate && <span className="text-danger text-sm">{formErrors.debitNoteDate}</span>}
                            </div>
                            <div className="w-full mt-1">
                                <Select
                                    label="Status"
                                    required
                                    name="status"
                                    onChange={(e) => handleFormChange('status', e.target.value)}
                                    value={debitNoteFormData.status}
                                    error={formErrors?.status}
                                    options={[
                                        { value: 'Select', label: 'Select' },
                                        { value: 'new', label: 'New' },
                                        { value: 'paid', label: 'Paid' },
                                        { value: 'partially_paid', label: 'Partially Paid' },
                                        { value: 'pending', label: 'Pending' },
                                        { value: 'cancelled', label: 'Cancelled' },
                                    ]}
                                />
                            </div>
                            <div className="w-full mt-1">
                                <CurrencySelect
                                    label="Currency"
                                    value={debitNoteFormData.currencyCode}
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
                                {!selectedAdmin && <p className="mt-2 text-xs text-gray-500 p-2 font-semibold">
                                    Select admin to view company details.
                                </p>}
                                {/* spacer */}
                                <div className='h-4'></div>
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
                                value={debitNoteFormData.taxTreatment}
                                onChange={(e) => handleFormChange('taxTreatment', e.target.value as DebitNoteFormData['taxTreatment'])}
                                options={[
                                    { value: 'STANDARD', label: 'Standard' },
                                    { value: 'ZERO_RATED', label: 'Zero-rated' },
                                    { value: 'EXEMPT', label: 'Exempt' },
                                    { value: 'REVERSE_CHARGE', label: 'Reverse charge' },
                                    { value: 'OUT_OF_SCOPE', label: 'Out of scope' },
                                ]}
                            />
                            {debitNoteFormData.taxTreatment !== 'STANDARD' && (
                                <p className="text-sm text-warning font-medium mt-5">
                                    Tax suppressed — {debitNoteFormData.taxTreatment.replace(/_/g, ' ').toLowerCase()}
                                </p>
                            )}
                        </div>
                    </div>

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
                                    {debitNoteFormData.items.map((item) => (
                                        <InvoiceTableRow
                                            key={item.id}
                                            item={item}
                                            currencySymbol={docCurrencySymbol}
                                            currencyCode={debitNoteFormData.currencyCode}
                                            onInLineItemChange={(updatedItem) => handleInLineItemChange(updatedItem, item.id)}
                                            onEditItem={handleEditItem}
                                            onDeleteItem={handleRemoveItem}
                                            availableItems={debitNoteFormData.items}
                                            addNewProduct={handleNewProductClick}
                                            lineFields={lineFields}
                                        />
                                    ))}
                                    {debitNoteFormData.items.length === 0 && (
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


                    {/* Other sections can go here */}

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
                                    legacyLabel={!editingItem.tax_rate_id && editingItem.tax_group_id
                                        ? (() => { const g = taxes.find((t) => String(t.id) === String(editingItem.tax_group_id)); return g ? `${g.tax_name} (${g.total_tax_rate}%)` : null; })()
                                        : null}
                                    onSelect={(rateId) => {
                                        // Clear the legacy group first so lineTaxPercent uses the new rate,
                                        // then run the existing recompute via the one-field setter.
                                        setEditingItem((prev) => prev ? { ...prev, tax_group_id: '' } : null);
                                        handleEditingItemChange('tax_rate_id', rateId);
                                    }}
                                />
                            </div>

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
                            <Button type='button' size="sm" variant={activeInfoTab === 'bank' ? 'primary' : 'white'} onClick={() => setActiveInfoTab('bank')}>Payment Details</Button>
                        </div>

                        {activeInfoTab === 'notes' && (
                            <FormField label="Additional Notes">
                                {(field) => (
                                    <textarea
                                        id={field.id}
                                        aria-describedby={field['aria-describedby']}
                                        value={debitNoteFormData.notes}
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
                                        value={debitNoteFormData.termsAndCondition}
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
                                <label className="block text-sm font-medium text-heading mb-1">Account</label>
                                <SmartDropdown
                                    items={bankAccounts}
                                    value={bankAccountSearchInput}
                                    onChange={(value) => { setBankAccountSearchInput(value); handleFormChange('bank', null); }}
                                    onSelect={(item) => handleFormChange('bank', (item as OptionType)?.id || null)}
                                    onAddNew={() => setIsCreateBankAccountModalOpen(true)}
                                    selectedItem={bankAccounts.find(item => item.id === debitNoteFormData.bank)}
                                    addNewLabel='New Bank Account'
                                    placeholder='Type to search Bank Account...'
                                />
                            </div>
                        )}
                    </div>

                    {/* Right Side: Totals & Signature */}
                    <div className="bg-white p-4 rounded-card border border-border shadow-card space-y-3">
                        <div className="flex justify-between text-sm text-gray-600 "><span>Amount</span><span>{docCurrencySymbol}{subTotal.toFixed(2)}</span></div>
                        <div className="flex justify-between text-sm text-gray-600 "><span>Tax</span><span>{docCurrencySymbol}{totalTax.toFixed(2)}</span></div>
                        <div className="flex justify-between text-sm text-gray-600 "><span>Discount</span><span>- {docCurrencySymbol}{totalDiscount.toFixed(2)}</span></div>
                        <hr className="border-gray-200 " />
                        <div className="flex justify-between font-bold text-gray-950 "><span>Total</span><span>{docCurrencySymbol}{grandTotal.toFixed(2)}</span></div>
                        <p className="text-sm text-gray-500  capitalize">{totalInWords}</p>

                        <div className="flex items-center gap-4 pt-4">
                            <div className="flex items-center"><input id="no-sig" type="radio" name="signature" checked={debitNoteFormData.sign_type === 'none'} onChange={() => handleFormChange('sign_type', 'none')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="no-sig" className="ml-2 block text-sm text-gray-700 cursor-pointer">No Signature</label></div>
                            <div className="flex items-center"><input id="manual-sig" type="radio" name="signature" checked={debitNoteFormData.sign_type === 'digitalSignature'} onChange={() => handleFormChange('sign_type', 'digitalSignature')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="manual-sig" className="ml-2 block text-sm text-gray-700  cursor-pointer">Manual Signature</label></div>
                            <div className="flex items-center"><input id="e-sig" type="radio" name="signature" checked={debitNoteFormData.sign_type === 'eSignature'} onChange={() => handleFormChange('sign_type', 'eSignature')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="e-sig" className="ml-2 block text-sm text-gray-700  cursor-pointer">eSignature</label></div>
                        </div>

                        {debitNoteFormData.sign_type !== 'none' && (debitNoteFormData.sign_type === 'digitalSignature' ? (
                            <div>
                                <label className="block text-sm font-medium text-heading mb-2">Select Signature Name <span className="text-danger">*</span></label>
                                <SmartDropdown
                                    items={manualSignatures}
                                    value={signatureSearchInput}
                                    onChange={(value) => setSignatureSearchInput(value)}
                                    onSelect={(item) => handleFormChange('signatureId', item?.id || '')}
                                    selectedItem={manualSignatures.find(sig => sig.id === debitNoteFormData.signatureId) || null}
                                    onAddNew={() => setIsCreateSignModalOpen(true)}
                                    addNewLabel='New Signature'
                                    placeholder='Type to search signatures...'
                                />
                                {formErrors?.signatureId && <p className="text-danger text-xs mt-1">{formErrors.signatureId}</p>}
                                <p className="mt-2 text-sm font-medium text-heading">Signature Image</p>
                                <div className="mt-2 h-20 w-48 bg-gray-100 rounded-control flex items-center justify-center">
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
                                    value={debitNoteFormData.signatureName}
                                    onChange={e => handleFormChange('signatureName', e.target.value)}
                                    placeholder="Enter Signature Name"
                                    error={formErrors?.signatureName}
                                />
                                <p className="mt-2 text-sm font-medium text-heading">Draw your eSignature</p>
                                <div className="mt-2 h-20 w-48 bg-gray-100 rounded-control flex items-center justify-center cursor-pointer border-2 border-dashed border-gray-400" onClick={() => setSignatureModalOpen(true)}>
                                    {debitNoteFormData.esignDataUrl ? <img src={debitNoteFormData.esignDataUrl} alt="Drawn Signature" className="max-h-full max-w-full" /> : <div className="text-center text-gray-500"><Edit size={20} className="mx-auto mb-1" /><span className="text-xs">Draw Signature</span></div>}
                                </div>
                                {formErrors?.esignDataUrl && <p className="text-danger text-xs mt-1">{formErrors.esignDataUrl}</p>}
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex justify-end mt-4 gap-3">
                    <Button variant="white" onClick={() => navigate('/admin/debit-notes')}>Cancel</Button>
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

export default CreateDebitNote;