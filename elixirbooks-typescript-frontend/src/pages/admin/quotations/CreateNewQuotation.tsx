import React, { useEffect, useState, useMemo, useRef } from 'react';
import { PlusCircle, Edit3, Mail } from 'lucide-react';
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
import FullPageLoader from '@components/admin/FullPageLoader';
import AdminCard from '@components/admin/AdminCard';
import { resolveCompanyLogo } from '@utils/companyLogo';
import type { Product, ProductItem as BaseProductItem } from '@models/product';
import type { OptionType, SelectedAdmin } from '@models/common';
import type { SignatureOptions } from '@models/signature';
import type { TaxRate } from '@models/taxRate';
import CreateProductForm from '@components/admin/CreateProductForm';
import type { Contact } from '@models/contact';
import ContactPicker from '@components/admin/ContactPicker';
import LineTaxSelect from '@components/admin/LineTaxSelect';
import CreateSignatureModal from '../invoices/CreateSignatureModal';
import CreateBankAccountModal from '../invoices/CreateBankAccountModal';
import type { BankAccountCreatedResponse } from '@models/bank-account';
import SmartDropdown from '@components/admin/SmartDropdown';
import InvoiceTableRow from '@components/admin/InvoiceTableRow';
import type { QuotationPreference } from '@models/modulesettings/quotation';
import CurrencySelect from '@components/admin/CurrencySelect';
import { useCurrencies } from '@hooks/useCurrencies';
import { useDocumentDefaults } from '@hooks/useDocumentDefaults';
import { useDirtyGuard, confirmIfDirty } from '@hooks/useDirtyGuard';
import { PageHeader } from "@/context/PageHeaderContext";
import { Button } from "@components/ui";
import { round2 } from '@utils/round2';
import { useLineItemCustomFields } from '@hooks/useLineItemCustomFields';
import { validateLineCustomFields } from '@lib/lineCustomFields';

type ProductItem = BaseProductItem & { customFields?: Record<string, string | number | boolean | string[]> };

interface QuotationFormData {
    userId: string;
    salesPerson: string | null;
    billFrom: string;
    billTo: string;
    quotationDate: Date | null;
    expiryDate: Date | null;
    status: string;
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

const CreateNewQuotation: React.FC = () => {
    const navigate = useNavigate();
    const { token, user } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { defaultCurrencyCode, resolveCurrency } = useCurrencies();
    const { defaults: docDefaults, loading: docDefaultsLoading } = useDocumentDefaults();
    const { fields: lineFields } = useLineItemCustomFields(token, 'quotations');
    const [adminUsers, setAdminUsers] = useState<OptionType[]>([]);
    const [selectedAdmin, setSelectedAdmin] = useState<OptionType | null>(null);
    const [companyDetails, setCompanyDetails] = useState<SelectedAdmin | null>(null);
    const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
    const [quotationFormData, setQuotationFormData] = useState<QuotationFormData>({
        userId: user?.id || '',
        salesPerson: '',
        billFrom: '',
        billTo: '',
        quotationDate: new Date(),
        expiryDate: null,
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
        bank: null,
        sign_type: 'none',
        signatureId: null,
        signatureName: '',
        esignDataUrl: null,
        subTotal: null,
        totalTax: null,
        totalDiscount: null,
        grandTotal: null,
        currencyCode: defaultCurrencyCode,
        contactId: '',
        billToContactId: '',
        taxTreatment: 'STANDARD',
    });

    // Apply document defaults once loaded — seed blank new form, never overwrite user edits
    useEffect(() => {
        if (docDefaultsLoading) return;
        setQuotationFormData(prev => {
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

            // expiryDate (due date equivalent): only if not yet set
            if (!prev.expiryDate && typeof docDefaults.paymentTermsDays === 'number' && docDefaults.paymentTermsDays > 0) {
                const base = prev.quotationDate ?? new Date();
                const due = new Date(base);
                due.setDate(due.getDate() + docDefaults.paymentTermsDays);
                updates.expiryDate = due;
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
    // Cheap dirty flag (no deep-compare): flipped inside the page's central
    // change handlers, disarmed right before a successful save navigates away.
    const isDirtyRef = useRef(false);
    useDirtyGuard(isDirtyRef.current);
    const [isFetching, setIsFetching] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [signatureSearchInput, setSignatureSearchInput] = useState<string>('');
    const debouncedSearchTermSignature = useDebounce(signatureSearchInput, 500);
    const [isCreateSignModalOpen, setIsCreateSignModalOpen] = useState(false);
    const [bankAccountSearchInput, setBankAccountSearchInput] = useState<string>('');
    const debouncedSearchTermBankAccount = useDebounce(bankAccountSearchInput, 500);
    const [isCreateBankAccountModalOpen, setIsCreateBankAccountModalOpen] = useState(false);
    const [adminSearchInput, setAdminSearchInput] = useState<string>('');
    const [moduleSettings, setModuleSettings] = useState<QuotationPreference | null>(null);
    const [salesPersons, setSalesPersons] = useState<OptionType[]>([]);
    const [salesPersonSearchInput, setSalesPersonSearchInput] = useState<string>('');
    const debouncedSearchTermSalesPerson = useDebounce(salesPersonSearchInput, 500);
    const [fetchingSalesPersons, setFetchingSalesPersons] = useState(false);
    useEffect(() => {
        const fetchDropDownData = async () => {
            try {
                setIsFetching(true);
                await fetchModuleSettings();
                await fetchAdminUsers();
                await fetchTaxes();
            } catch (error) {
                toast.error('Failed to fetch drop-down data.');
            } finally {
                setIsFetching(false);
            }
        }

        fetchDropDownData();
    }, []);

    const fetchModuleSettings = async () => {
        try {
            const response = await axios.get(Constants.GET_GENERAL_SETTINGS_URL, {
                params: { groupSlug: 'quotation' },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            let settings: QuotationPreference = {
                quoteSalesPersonRole: ''
            };

            let data = response.data.data;
            if (data) {
                data.forEach((setting: any) => {
                    const key = setting.key as keyof QuotationPreference;
                    settings[key] = setting.value;
                });
                // Terms & notes come solely from Document Defaults (applied by the
                // effect above); the legacy per-module quotation terms/notes are retired.
                // This fetch only supplies the sales-person role.
                setModuleSettings(settings);
            }
        } catch (error) {
            console.error('Error fetching module settings:', error);
        }
    }

    useEffect(() => {
        const fetchSalesPersons = async () => {
            const salesPersonRoleId = moduleSettings?.quoteSalesPersonRole || '';
            try {
                setFetchingSalesPersons(true);
                let data;
                if (salesPersonRoleId) {
                    const response = await axios.get(`${Constants.FETCH_USERS_BY_ROLE_WITH_SEARCH_URL}/${salesPersonRoleId}`, {
                        params: { search: debouncedSearchTermSalesPerson },
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    data = response.data.data;
                } else {
                    const response = await axios.get(`${Constants.FETCH_USERS_URL}/1`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    data = response.data.data;
                }
                if (data) {
                    const formattedSalesPersons = data.map((user: any) => ({ id: user.id, name: `${user.firstName ?? ''} ${user.lastName ?? ''}` }));
                    setSalesPersons(formattedSalesPersons);
                }
            } catch (error) { }
            finally {
                setFetchingSalesPersons(false);
            }
        }
        fetchSalesPersons();
    }, [moduleSettings?.quoteSalesPersonRole, debouncedSearchTermSalesPerson]);

    const handleSalesPersonSelect = (option: OptionType) => {
        isDirtyRef.current = true;
        const salesPersonId = option ? option.id : '';
        setQuotationFormData(prevState => ({
            ...prevState,
            salesPerson: salesPersonId
        }));
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
        isDirtyRef.current = true;
        setSelectedAdmin(user);
        try {
            setIsFetching(true);
            const response = await axios.get(`${Constants.FETCH_COMPANY_SETTINGS_URL}/${user.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            //set billFrom to formData
            setQuotationFormData(prev => ({ ...prev, billFrom: user.id }));
            setCompanyDetails(response.data.data);
        } catch (error) {
            setCompanyDetails(null);
            setQuotationFormData(prev => ({ ...prev, billFrom: '' }));
            setSelectedAdmin(null);
        } finally {
            setIsFetching(false);
        }
    };

    const handleContactChange = (contactId: string | null, contact: Contact | null) => {
        isDirtyRef.current = true;
        setSelectedContactId(contactId);
        if (contact) {
            setQuotationFormData(prev => ({
                ...prev,
                contactId: contactId ?? '',
                billToContactId: contactId ?? '',
                currencyCode: contact.currencyCode || prev.currencyCode,
                billTo: '',
                taxTreatment: contact.defaultTaxTreatment ?? 'STANDARD',
            }));
        } else {
            setQuotationFormData(prev => ({
                ...prev,
                contactId: '',
                billToContactId: '',
                billTo: '',
            }));
        }
    };

    // --- ITEM & FORM HANDLERS ---
    const handleFormChange = (field: keyof QuotationFormData, value: any) => {
        isDirtyRef.current = true;
        setQuotationFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleRemoveItem = (itemToRemove: ProductItem) => {
        handleFormChange('items', quotationFormData.items.filter(item => item.id !== itemToRemove.id));
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

            let discountAmount = discount_type === 'Percentage'
                ? (subtotal * (discount_value || 0)) / 100
                : (discount_value || 0);

            if (discountAmount < 0) discountAmount = 0;
            if (discountAmount > subtotal) discountAmount = subtotal;

            const discountedSubtotal = subtotal - discountAmount;

            const taxRate = lineTaxPercent(updatedItem);

            const totalTax = round2((discountedSubtotal * taxRate) / 100);

            const newAmount = round2(discountedSubtotal + totalTax);

            return {
                ...updatedItem,
                discount_type: discount_type || 'Fixed',
                discount: discountAmount,
                tax: totalTax,
                amount: newAmount
            };
        });
    };

    const handleUpdateItem = () => {
        if (!editingItem) return;
        const updatedItems = quotationFormData.items.map(item =>
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
        const totals = quotationFormData.items.reduce((acc, item) => {
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
        setQuotationFormData(prev => ({ ...prev, subTotal: roundedSubTotal, totalTax: roundedTotalTax, totalDiscount: roundedTotalDiscount, grandTotal: roundedGrandTotal }));
        return { subTotal: roundedSubTotal, totalTax: roundedTotalTax, totalDiscount: roundedTotalDiscount, grandTotal: roundedGrandTotal };
    }, [quotationFormData.items]);

    const totalInWords = useMemo(() => {
        if (grandTotal <= 0) return 'Zero';
        const grandTotalInteger = Math.round(grandTotal);
        return numberToWords(grandTotalInteger);
    }, [grandTotal]);

    // Derive the document-level currency symbol from the selected currencyCode
    const docCurrencySymbol = resolveCurrency(quotationFormData.currencyCode).symbol;

    const selectedManualSignatureImage = useMemo(() => {
        return manualSignatures.find(sig => sig.id === quotationFormData.signatureId)?.imageUrl || null;
    }, [quotationFormData.signatureId, manualSignatures]);


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
        isDirtyRef.current = true;
        setQuotationFormData((prev) => ({
            ...prev,
            items: prev.items.map(item => item.id === rowId ? updatedProduct : item)
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
        isDirtyRef.current = true;
        setQuotationFormData((prev) => ({
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
    const handleNewRow = () => {
        isDirtyRef.current = true;
        setQuotationFormData((prev) => ({
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
    const validateQuotationData = () => {
        // Add your validation logic here
        const newErrors: { [key: string]: string } = {};
        //order date required
        if (!quotationFormData.quotationDate) newErrors.quotationDate = 'Quotation date is required.';
        //billFrom required
        if (!quotationFormData.billFrom.trim()) newErrors.billFrom = 'Bill from is required.';
        //billTo required
        if (!quotationFormData.billTo.trim() && !quotationFormData.contactId?.trim()) newErrors.billTo = 'Bill to is required.';
        //atleast 1 item required
        const hasItemPopulated = quotationFormData.items.some(item => (item.name ?? '').trim() !== '');
        if (!hasItemPopulated) newErrors.items = 'At least one item is required.';
        //sign_type if manual then signatureId required
        if (quotationFormData.sign_type === 'digitalSignature' && !quotationFormData.signatureId) newErrors.signatureId = 'Manual signature is required.';
        //sign_type if esignature then signatureName required
        if (quotationFormData.sign_type === 'eSignature' && !quotationFormData.signatureName.trim()) newErrors.signatureName = 'Esignature name is required.';
        if (quotationFormData.sign_type === 'eSignature' && !quotationFormData.esignDataUrl) newErrors.esignDataUrl = 'Esignature is required.';
        const lineFieldError = validateLineCustomFields(quotationFormData.items, lineFields);
        if (lineFieldError) newErrors.lineCustomFields = lineFieldError;
        setFormErrors(newErrors);
        return newErrors;
    }
    const handleSaveAsDraft = async (e: React.FormEvent) => {
        e.preventDefault();
        await saveQuotation('draft');
    }

    const handleSaveAndSend = async (e: React.FormEvent) => {
        e.preventDefault();
        await saveQuotation('sent');
    }
    const saveQuotation = async (status: string) => {
        const errors = validateQuotationData();
        if (Object.keys(errors).length > 0) {
            const firstErrorField = Object.keys(errors)[0];
            // Not every errored field renders a real `name` attribute (SmartDropdown /
            // ContactPicker / the items table have none) — focus when we can, but
            // always toast the specific validation message so the user isn't left
            // guessing which field needs attention.
            const firstErrorElement = document.querySelector(`[name="${firstErrorField}"]`) as HTMLInputElement | null;
            if (firstErrorElement) {
                firstErrorElement.focus();
                firstErrorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            toast.error(errors[firstErrorField] || 'Please check the form for errors.');
            return;
        }

        const formData = new FormData();

        for (const [key, value] of Object.entries(quotationFormData)) {
            if (key === 'esignDataUrl' && quotationFormData.sign_type === 'eSignature') {
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
        formData.set('status', status);
        try {
            setIsSaving(true);
            await axios.post(Constants.CREATE_QUOTATION_URL, formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data',
                },
            });

            toast.success('Quotation saved successfully.');
            isDirtyRef.current = false;
            navigate('/admin/quotations');
        } catch (error: any) {
            if (error.response?.status !== 200 && error.response?.data?.errors) {
                const serverErrors = error.response.data.errors;
                setFormErrors(serverErrors);
                const firstErrorField = Object.keys(serverErrors)[0];
                const firstErrorElement = firstErrorField
                    ? (document.querySelector(`[name="${firstErrorField}"]`) as HTMLInputElement | null)
                    : null;
                if (firstErrorElement) {
                    firstErrorElement.focus();
                    firstErrorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                toast.error((firstErrorField && serverErrors[firstErrorField]) || 'Please check the form for errors.');
            } else if (axios.isAxiosError(error) && error.response?.data?.message) {
                toast.error(error.response.data.message);
            } else {
                toast.error('An unexpected error occurred.');
            }
        } finally {
            setIsSaving(false);
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

    const handleNewProductClick = () => {
        setIsProductModalOpen(true);
    }
    return (
        <div className="md:p-4 bg-white-50   min-h-screen border border-gray-200  rounded">
            <form>
                <div className="max-w-7xl mx-auto space-y-4">

                    <PageHeader title="New Quotation" />

                    {/* Header */}
                    <div className="flex justify-end items-center mb-2">
                        <img src={resolveCompanyLogo(systemSettings?.company?.siteLogo)} alt="" className='w-32' />
                    </div>
                    {/* Top Section: PO Details & Logo */}
                    <div className="w-full">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 w-full">
                            <div className="w-full">
                                <DateInput
                                    label="Quotation Date"
                                    value={quotationFormData.quotationDate}
                                    onChange={(newDate) => handleFormChange('quotationDate', newDate)}
                                    isRequired
                                />
                                {formErrors?.quotationDate && <span className="text-red-500 text-sm">{formErrors.quotationDate}</span>}
                            </div>
                            <div className="w-full">
                                <DateInput
                                    label="Expiry Date"
                                    value={quotationFormData.expiryDate}
                                    onChange={(newDate) => handleFormChange('expiryDate', newDate)}
                                    minDate={new Date()}
                                />
                                {formErrors?.quotationDate && <span className="text-red-500 text-sm">{formErrors.quotationDate}</span>}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 ">Sales Person</label>
                                <SmartDropdown
                                    items={salesPersons}
                                    value={salesPersonSearchInput}
                                    onChange={(keyword) => setSalesPersonSearchInput(keyword)}
                                    onSelect={(staff) => handleSalesPersonSelect(staff as OptionType)}
                                    placeholder='Search and select'
                                    selectedItem={salesPersons.find(staff => staff.id === quotationFormData.salesPerson) || null}
                                    loading={fetchingSalesPersons}
                                />
                            </div>
                            <div className="w-full">
                                <CurrencySelect
                                    label="Currency"
                                    value={quotationFormData.currencyCode}
                                    onChange={(code) => handleFormChange('currencyCode', code)}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Billing Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="bg-white  p-4 rounded-lg border border-gray-200 ">
                            <h3 className="font-bold text-gray-950 ">Bill From <span className='text-red-500'>*</span></h3>
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
                                {!selectedAdmin && formErrors?.billFrom && <span className="text-red-500 text-sm">{formErrors.billFrom}</span>}
                                {!selectedAdmin && <p className="mt-2 text-xs text-gray-500  p-2 bg-gray-50  rounded-md font-semibold">
                                    Select admin to view company details.
                                </p>}
                                {/* spacer */}
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

                        <div className="bg-white  p-4 rounded-lg border border-gray-200 ">
                            <h3 className="font-bold text-gray-950 mb-4">Bill To <span className='text-red-500'>*</span></h3>
                            <ContactPicker
                                view="all-active"
                                value={selectedContactId}
                                onChange={handleContactChange}
                                error={formErrors?.billTo}
                            />
                        </div>
                    </div>

                    {/* Tax Treatment */}
                    <div className="bg-white p-4 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-4 flex-wrap">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Tax Treatment</label>
                                <select
                                    value={quotationFormData.taxTreatment}
                                    onChange={(e) => handleFormChange('taxTreatment', e.target.value as QuotationFormData['taxTreatment'])}
                                    className="border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-600"
                                >
                                    <option value="STANDARD">Standard</option>
                                    <option value="ZERO_RATED">Zero-rated</option>
                                    <option value="EXEMPT">Exempt</option>
                                    <option value="REVERSE_CHARGE">Reverse charge</option>
                                    <option value="OUT_OF_SCOPE">Out of scope</option>
                                </select>
                            </div>
                            {quotationFormData.taxTreatment !== 'STANDARD' && (
                                <p className="text-sm text-amber-600 font-medium mt-5">
                                    Tax suppressed — {quotationFormData.taxTreatment.replace(/_/g, ' ').toLowerCase()}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Items & Details Section */}
                    <div className="bg-white  rounded-lg border border-gray-200 ">
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
                                    {quotationFormData.items.map((item) => (
                                        <InvoiceTableRow
                                            key={item.id}
                                            item={item}
                                            currencySymbol={docCurrencySymbol}
                                            currencyCode={quotationFormData.currencyCode}
                                            onInLineItemChange={(updatedItem) => handleInLineItemChange(updatedItem, item.id)}
                                            onEditItem={handleEditItem}
                                            onDeleteItem={handleRemoveItem}
                                            availableItems={quotationFormData.items}
                                            addNewProduct={handleNewProductClick}
                                            lineFields={lineFields}
                                        />
                                    ))}
                                    {quotationFormData.items.length === 0 && (
                                        <tr className="bg-white  text-gray-950 ">
                                            <td className="p-3 font-medium text-center" colSpan={8 + lineFields.length}>
                                                No Items Selected
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            {/* Add New Product */}
                            <div className="p-4 flex">
                                <Button variant="ghost" onClick={() => handleNewRow()} leftIcon={<PlusCircle className="h-4 w-4" />}>
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
                            <div>
                                <label htmlFor="edit-qty" className="block text-sm font-medium text-gray-700 ">Quantity</label>
                                <input
                                    type="number"
                                    id="edit-qty"
                                    min="1"
                                    step="1"
                                    value={editingItem.qty}
                                    onChange={(e) => handleEditingItemChange('qty', e.target.value)}
                                    className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"
                                />
                            </div>

                            <div>
                                <label htmlFor="edit-rate" className="block text-sm font-medium text-gray-700 ">Rate ({docCurrencySymbol})</label>
                                <input
                                    type="number"
                                    id="edit-rate"
                                    min="0"
                                    value={editingItem.rate}
                                    onChange={(e) => handleEditingItemChange('rate', e.target.value)}
                                    className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"
                                />
                            </div>
                            {/* Discount Type */}
                            <div>
                                <label htmlFor="edit-discount-type" className="block text-sm font-medium text-gray-700 ">Discount Type</label>
                                <select
                                    id="edit-discount-type"
                                    className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"
                                    value={editingItem.discount_type}
                                    onChange={(e) => handleEditingItemChange('discount_type', e.target.value)}
                                >
                                    <option value="Fixed">Fixed</option>
                                    <option value="Percentage">Percentage</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="edit-discount" className="block text-sm font-medium text-gray-700 ">Discount Amount ({docCurrencySymbol})</label>
                                <input
                                    type="number"
                                    id="edit-discount"
                                    min="0"
                                    value={editingItem.discount_value || 0}
                                    onChange={(e) => handleEditingItemChange('discount_value', e.target.value)}
                                    className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"
                                />
                            </div>

                            <div>
                                <label htmlFor="edit-tax-select" className="block text-sm font-medium text-gray-700 ">Tax</label>
                                <LineTaxSelect
                                    id="edit-tax-select"
                                    className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"
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
                            <button type='button' onClick={() => setActiveInfoTab('notes')} className={`px-4 py-2 text-sm cursor-pointer font-medium rounded-md ${activeInfoTab === 'notes' ? 'bg-purple-600 text-white' : 'bg-gray-200  text-gray-700 '}`}>Add Notes</button>
                            <button type='button' onClick={() => setActiveInfoTab('termsAndCondition')} className={`px-4 py-2 text-sm cursor-pointer font-medium rounded-md ${activeInfoTab === 'termsAndCondition' ? 'bg-purple-600 text-white' : 'bg-gray-200  text-gray-700 '}`}>Add Terms & Conditions</button>
                            <button type='button' onClick={() => setActiveInfoTab('bank')} className={`px-4 py-2 text-sm cursor-pointer font-medium rounded-md ${activeInfoTab === 'bank' ? 'bg-purple-600 text-white' : 'bg-gray-200  text-gray-700 '}`}>Bank Details</button>
                        </div>

                        {activeInfoTab === 'notes' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 ">Additional Notes</label>
                                <textarea value={quotationFormData.notes} onChange={(e) => handleFormChange('notes', e.target.value)} rows={4} placeholder="Enter Notes" className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"></textarea>
                            </div>
                        )}
                        {activeInfoTab === 'termsAndCondition' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 ">Terms & Conditions</label>
                                <textarea value={quotationFormData.termsAndCondition} onChange={(e) => handleFormChange('termsAndCondition', e.target.value)} rows={4} placeholder="Enter Terms & Conditions" className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"></textarea>
                            </div>
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
                                    selectedItem={bankAccounts.find(item => item.id === quotationFormData.bank)}
                                    addNewLabel='New Bank Account'
                                    placeholder='Type to search Bank Account...'
                                />
                            </div>
                        )}
                    </div>

                    {/* Right Side: Totals & Signature */}
                    <div className="bg-white  p-4 rounded-lg border border-gray-200  space-y-3">
                        <div className="flex justify-between text-sm text-gray-600 "><span>Amount</span><span>{docCurrencySymbol}{subTotal.toFixed(2)}</span></div>
                        <div className="flex justify-between text-sm text-gray-600 "><span>Tax</span><span>{docCurrencySymbol}{totalTax.toFixed(2)}</span></div>
                        <div className="flex justify-between text-sm text-gray-600 "><span>Discount</span><span>- {docCurrencySymbol}{totalDiscount.toFixed(2)}</span></div>
                        <hr className="border-gray-200 " />
                        <div className="flex justify-between font-bold text-gray-950 "><span>Total</span><span>{docCurrencySymbol}{grandTotal.toFixed(2)}</span></div>
                        <p className="text-sm text-gray-500  capitalize">{totalInWords}</p>

                        <div className="flex items-center gap-4 pt-4">
                            <div className="flex items-center"><input id="no-sig" type="radio" name="signature" checked={quotationFormData.sign_type === 'none'} onChange={() => handleFormChange('sign_type', 'none')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="no-sig" className="ml-2 block text-sm text-gray-700 cursor-pointer">No Signature</label></div>
                            <div className="flex items-center"><input id="manual-sig" type="radio" name="signature" checked={quotationFormData.sign_type === 'digitalSignature'} onChange={() => handleFormChange('sign_type', 'digitalSignature')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="manual-sig" className="ml-2 block text-sm text-gray-700  cursor-pointer">Manual Signature</label></div>
                            <div className="flex items-center"><input id="e-sig" type="radio" name="signature" checked={quotationFormData.sign_type === 'eSignature'} onChange={() => handleFormChange('sign_type', 'eSignature')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="e-sig" className="ml-2 block text-sm text-gray-700  cursor-pointer">eSignature</label></div>
                        </div>

                        {quotationFormData.sign_type !== 'none' && (quotationFormData.sign_type === 'digitalSignature' ? (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 ">Select Signature Name <span className="text-red-500">*</span></label>
                                <SmartDropdown
                                    items={manualSignatures}
                                    value={signatureSearchInput}
                                    onChange={(value) => setSignatureSearchInput(value)}
                                    onSelect={(item) => handleFormChange('signatureId', item?.id || '')}
                                    selectedItem={manualSignatures.find(sig => sig.id === quotationFormData.signatureId) || null}
                                    onAddNew={() => setIsCreateSignModalOpen(true)}
                                    addNewLabel='New Signature'
                                    placeholder='Type to search signatures...'
                                />
                                {formErrors?.signatureId && <p className="text-red-500 text-xs mt-1">{formErrors.signatureId}</p>}
                                <p className="mt-2 text-sm font-medium text-gray-700 ">Signature Image</p>
                                <div className="mt-2 h-20 w-48 bg-gray-100  rounded-md flex items-center justify-center">
                                    {selectedManualSignatureImage ? <img src={selectedManualSignatureImage} alt="Selected Signature" className="max-h-full max-w-full" /> : <span className="text-xs text-gray-400">No signature selected</span>}
                                </div>
                            </div>
                        ) : (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 ">Signature Name <span className="text-red-500">*</span></label>
                                <input name='signatureName' type="text" value={quotationFormData.signatureName} onChange={e => handleFormChange('signatureName', e.target.value)} placeholder="Enter Signature Name" className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600" />
                                {formErrors?.signatureName && <p className="text-red-500 text-xs mt-1">{formErrors.signatureName}</p>}
                                <p className="mt-2 text-sm font-medium text-gray-700 ">Draw your eSignature</p>
                                <div className="mt-2 h-20 w-48 bg-gray-100  rounded-md flex items-center justify-center cursor-pointer border-2 border-dashed border-gray-400" onClick={() => setSignatureModalOpen(true)}>
                                    {quotationFormData.esignDataUrl ? <img src={quotationFormData.esignDataUrl} alt="Drawn Signature" className="max-h-full max-w-full" /> : <div className="text-center text-gray-500"><Edit3 size={20} className="mx-auto mb-1" /><span className="text-xs">Draw Signature</span></div>}
                                </div>
                                {formErrors?.esignDataUrl && <p className="text-red-500 text-xs mt-1">{formErrors.esignDataUrl}</p>}
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex justify-end mt-4 gap-3">
                    <Button variant="white" onClick={() => { if (confirmIfDirty(isDirtyRef.current)) navigate('/admin/quotations'); }}>Cancel</Button>
                    <Button
                        disabled={isSaving}
                        onClick={handleSaveAsDraft}
                    >
                        Save as Draft
                    </Button>
                    <Button
                        disabled={isSaving}
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
                            <Button variant="white" onClick={() => setSignatureModalOpen(false)}>Cancel</Button>
                            <Button onClick={saveSignature}>Save</Button>
                        </div>
                    </div>
                </Modal>
            </form>

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

export default CreateNewQuotation;