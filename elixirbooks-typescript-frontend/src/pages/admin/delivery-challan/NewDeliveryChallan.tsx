import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Edit, PlusCircle } from 'lucide-react';
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
import AdminCard from '@components/admin/AdminCard';
import { resolveCompanyLogo } from '@utils/companyLogo';
import FullPageLoader from '@components/admin/FullPageLoader';
import SubmitButton from '@components/admin/SubmitButton';
import type { OptionType, SelectedAdmin } from '@models/common';
import type { Product, ProductItem as BaseProductItem } from '@models/product';
import type { SignatureOptions } from '@models/signature';
import type { TaxRate } from '@models/taxRate';
import LineTaxSelect from '@components/admin/LineTaxSelect';
import CreateProductForm from '@components/admin/CreateProductForm';
import type { Contact } from '@models/contact';
import ContactPicker from '@components/admin/ContactPicker';
import CreateSignatureModal from '../invoices/CreateSignatureModal';
import CreateBankAccountModal from '../invoices/CreateBankAccountModal';
import type { BankAccountCreatedResponse } from '@models/bank-account';
import SmartDropdown from '@components/admin/SmartDropdown';
import InvoiceTableRow from '@components/admin/InvoiceTableRow';
import CurrencySelect from '@components/admin/CurrencySelect';
import { useCurrencies } from '@hooks/useCurrencies';
import { useDocumentDefaults } from '@hooks/useDocumentDefaults';
import { round2 } from '@utils/round2';
import { PageHeader } from "@/context/PageHeaderContext";
import { Button } from '@components/ui';
import { useLineItemCustomFields } from '@hooks/useLineItemCustomFields';
import { validateLineCustomFields } from '@lib/lineCustomFields';

type ProductItem = BaseProductItem & { customFields?: Record<string, string | number | boolean | string[]> };

interface InvoiceFormData {
    invoiceId: string;
    challanDate: Date | null;
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

const NewDeliveryChallan: React.FC = () => {
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { defaultCurrencyCode, resolveCurrency } = useCurrencies();
    const { defaults: docDefaults, loading: docDefaultsLoading } = useDocumentDefaults();
    const { fields: lineFields } = useLineItemCustomFields(token, 'invoices');
    const [adminUsers, setAdminUsers] = useState<OptionType[]>([]);
    const [invoiceOptions, setInvoiceOptions] = useState<OptionType[]>([]);
    const [invoiceSearchInput, setInvoiceSearchInput] = useState<string>('');
    const debouncedSearchTermInvoice = useDebounce(invoiceSearchInput, 500);
    const [selectedAdmin, setSelectedAdmin] = useState<OptionType | null>(null);
    const [companyDetails, setCompanyDetails] = useState<SelectedAdmin | null>(null);
    const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
    const [invoiceFormData, setInvoiceFormData] = useState<InvoiceFormData>({
        invoiceId: '',
        challanDate: new Date(),
        status: 'PENDING',
        billFrom: '',
        billTo: '',
        items: [],
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
        setInvoiceFormData(prev => {
            // Skip if a parent invoice has already been linked (invoiceId is set)
            if (prev.invoiceId) return prev;
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

    const invoiceStatuses = [
        { id: 'PENDING', name: 'Pending' },
        { id: 'DELIVERED', name: 'Delivered' },
        { id: 'CANCELLED', name: 'Cancelled' }
    ]

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
    const [isSaving, setIsSaving] = useState(false);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [signatureSearchInput, setSignatureSearchInput] = useState<string>('');
    const debouncedSearchTermSignature = useDebounce(signatureSearchInput, 500);
    const [isCreateSignModalOpen, setIsCreateSignModalOpen] = useState(false);
    const [bankAccountSearchInput, setBankAccountSearchInput] = useState<string>('');
    const debouncedSearchTermBankAccount = useDebounce(bankAccountSearchInput, 500);
    const [isCreateBankAccountModalOpen, setIsCreateBankAccountModalOpen] = useState(false);
    const [adminSearchInput, setAdminSearchInput] = useState<string>('');
    useEffect(() => {
        fetchAdminUsers();
        fetchTaxes();
    }, []);

    const handleInvoiceChange = async (option: OptionType) => {
        try {
            setIsFetching(true);
            const response = await axios.get(`${Constants.FETCH_INVOICE_FOR_EDIT_URL}/${option.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const invoice_data = response.data.data;
            if (invoice_data) {
                setInvoiceFormData((prev) => ({
                    ...prev,
                    invoiceId: invoice_data.id,
                    billFrom: invoice_data.billFrom.id,
                    billTo: invoice_data.billTo?.id,
                    items: invoice_data.items,
                    notes: invoice_data.notes,
                    termsAndCondition: invoice_data.termsAndCondition,
                    bank: invoice_data.bank?.id,
                    sign_type: invoice_data.sign_type ?? 'none',
                    signatureId: invoice_data.signature?.id,
                    signatureName: invoice_data.signature?.name,
                    esignDataUrl: invoice_data.signature?.image,
                    subTotal: invoice_data.taxableAmount,
                    totalTax: invoice_data.vat,
                    totalDiscount: invoice_data.totalDiscount,
                    grandTotal: invoice_data.TotalAmount
                }));
                if (invoice_data.billFrom) {
                    let _admin = { id: invoice_data.billFrom.id, name: invoice_data.billFrom.name };
                    handleAdminChange(_admin);
                }
                if (invoice_data.billTo) {
                    setSelectedContactId(null);
                }
            }
        } catch (error) {

        } finally {
            setIsFetching(false);
        }
    }

    useEffect(() => {
        const fetchInvoicesQuery = async () => {
            try {
                const response = await axios.post(
                    Constants.SEARCH_INVOICES_FOR_DELIVERY_CHALLAN_URL,
                    { search: debouncedSearchTermInvoice || "" },
                    {
                        headers: { Authorization: `Bearer ${token}` }
                    }
                );
                const data = response.data.data;
                if (data) {
                    const formattedOptions = data.map((invoice: any) => ({
                        id: invoice.id,
                        name: invoice.invoiceNumber
                    }));
                    setInvoiceOptions(formattedOptions || []);
                } else {
                    setInvoiceOptions([]);
                }

            } catch (error) {
                console.error("Error fetching invoices:", error);
            }
        };

        fetchInvoicesQuery();
    }, [debouncedSearchTermInvoice, token]);


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
    }, [debouncedSearchTermBankAccount])

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
    }, [debouncedSearchTermSignature])

    const handleAdminChange = async (user: OptionType) => {
        setSelectedAdmin(user);
        try {
            setIsFetching(true);
            const response = await axios.get(`${Constants.FETCH_COMPANY_SETTINGS_URL}/${user.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            //set billFrom to formData
            setInvoiceFormData(prev => ({ ...prev, billFrom: user.id }));
            setCompanyDetails(response.data.data);
        } catch (error) {
            setCompanyDetails(null);
            setSelectedAdmin(null);
            setInvoiceFormData(prev => ({ ...prev, billFrom: '' }));
        } finally {
            setIsFetching(false);
        }
    };

    const handleContactChange = (contactId: string | null, contact: Contact | null) => {
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

    // --- ITEM & FORM HANDLERS ---
    const handleFormChange = (field: keyof InvoiceFormData, value: any) => {
        setInvoiceFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleRemoveItem = (itemToRemove: ProductItem) => {
        handleFormChange('items', invoiceFormData.items.filter(item => item.id !== itemToRemove.id));
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

            const discountAmount = discount_type === 'Percentage'
                ? (subtotal * (discount_value || 0)) / 100
                : (discount_value || 0);

            const discountedSubtotal = subtotal - discountAmount;

            const taxRate = lineTaxPercent(updatedItem);
            const taxPerUnit = (rate * taxRate) / 100;

            const totalTax = taxPerUnit * qty;

            const newAmount = discountedSubtotal + totalTax;

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
        const updatedItems = invoiceFormData.items.map(item =>
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
        const grandTotalInteger = Math.round(grandTotal);
        return numberToWords(grandTotalInteger);
    }, [grandTotal]);

    // Derive the document-level currency symbol from the selected currencyCode
    const docCurrencySymbol = resolveCurrency(invoiceFormData.currencyCode).symbol;

    const selectedManualSignatureImage = useMemo(() => {
        return manualSignatures.find(sig => sig.id === invoiceFormData.signatureId)?.imageUrl || null;
    }, [invoiceFormData.signatureId, manualSignatures]);


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

        const discountAmount = discount_type === 'Percentage'
            ? (subtotal * (discount_value || 0)) / 100
            : (discount_value || 0);

        const discountedSubtotal = subtotal - discountAmount;

        const taxRate = lineTaxPercent(product);
        const taxPerUnit = (rate * taxRate) / 100;

        const totalTax = taxPerUnit * qty;

        const newAmount = discountedSubtotal + totalTax;
        const updatedProduct = { ...product, discount: discountAmount, tax: totalTax, amount: newAmount };
        setInvoiceFormData((prev) => ({
            ...prev,
            items: prev.items.map(item => item.id === rowId ? updatedProduct : item)
        }));
    }

    const handleInvoiceSelect = (invoice: OptionType) => {
        const _invoiceId = invoice?.id || '';
        setInvoiceFormData((prevState) => ({
            ...prevState,
            invoiceId: _invoiceId
        }));

        if (_invoiceId) {
            handleInvoiceChange(invoice);
        }
    }
    const handleNewProductCreated = (product: Product) => {
        const discount_type = product.discount?.type;
        const discount_value = product.discount?.value;
        const subtotal = product.prices?.selling ?? 0;
        const rate = product.prices?.selling ?? 0;
        const discountAmount = discount_type === 'Percentage'
            ? (subtotal * (discount_value || 0)) / 100
            : (discount_value || 0);
        const taxRate = product.tax_rate?.rate ?? product.tax?.total_rate ?? 0;
        const taxPerUnit = (rate * taxRate) / 100;

        const totalTax = taxPerUnit * 1;
        const discountedSubtotal = subtotal - discountAmount;
        const newAmount = discountedSubtotal + totalTax;

        let updated = false;
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
        setInvoiceFormData((prev) => ({
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
    const validateChallanData = () => {
        const newErrors: { [key: string]: string } = {};
        //order date required
        if (!invoiceFormData.challanDate) newErrors.challanDate = 'Delivery date is required.';
        //status required
        if (!invoiceFormData.status.trim()) newErrors.status = 'Status is required.';

        //billFrom required
        if (!invoiceFormData.billFrom.trim()) newErrors.billFrom = 'Bill from is required.';
        //billTo required
        if (!invoiceFormData.billTo.trim() && !invoiceFormData.contactId?.trim()) newErrors.billTo = 'Bill to is required.';
        //atleast 1 item required
        const hasItemPopulated = invoiceFormData.items.some(item => (item.name ?? '').trim() !== '');
        if (!hasItemPopulated) newErrors.items = 'At least one item is required.';
        //sign_type if manual then signatureId required
        if (invoiceFormData.sign_type === 'digitalSignature' && !invoiceFormData.signatureId) newErrors.signatureId = 'Manual signature is required.';
        //sign_type if esignature then signatureName required
        if (invoiceFormData.sign_type === 'eSignature' && !invoiceFormData.signatureName.trim()) newErrors.signatureName = 'Esignature name is required.';
        if (invoiceFormData.sign_type === 'eSignature' && !invoiceFormData.esignDataUrl) newErrors.esignDataUrl = 'Esignature is required.';
        const lineFieldError = validateLineCustomFields(invoiceFormData.items, lineFields);
        if (lineFieldError) newErrors.lineCustomFields = lineFieldError;
        setFormErrors(newErrors);
        return newErrors;
    }
    const saveDeliveryChallan = async (e: React.FormEvent) => {
        e.preventDefault();

        const errors = validateChallanData();
        console.log('errors', errors);
        if (Object.keys(errors).length > 0) {
            const firstErrorField = Object.keys(errors)[0];
            const firstErrorElement = document.querySelector(`[name="${firstErrorField}"]`) as HTMLInputElement | null;
            firstErrorElement?.focus();
            if (errors.lineCustomFields) toast.error(errors.lineCustomFields);
            return;
        }

        const formData = new FormData();

        for (const [key, value] of Object.entries(invoiceFormData)) {
            if (key === 'esignDataUrl' && invoiceFormData.sign_type === 'eSignature') {
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
            setIsSaving(true);
            await axios.post(`${Constants.CREATE_DELIVERY_CHALLAN_URL}`, formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data',
                },
            });

            toast.success('Delivery Challan created successfully.');
            navigate('/admin/delivery-challans');
        } catch (error: any) {
            if (error.response?.status !== 200 && error.response?.data?.errors) {
                setFormErrors(error.response.data.errors);
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
        <div className="md:p-4 bg-white-50 min-h-screen border border-gray-200 rounded">
            <form onSubmit={saveDeliveryChallan}>
                <div className="max-w-7xl mx-auto space-y-4">
                    <PageHeader title="New Delivery Challan" />
                    {/* Header */}
                    <div className="flex justify-end items-center mb-2">
                        <img src={resolveCompanyLogo(systemSettings?.company?.siteLogo)} alt="" className='w-32 h-auto' />
                    </div>
                    {/* Top Section: PO Details & Logo */}
                    <div className="w-full">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 w-full">
                            <div className='w-full flex flex-col justify-end'>
                                <label htmlFor="" className="block text-sm font-medium text-gray-700 ">Invoice </label>
                                <SmartDropdown
                                    items={invoiceOptions}
                                    placeholder='Search and select invoice'
                                    value={invoiceSearchInput}
                                    onChange={(keyword) => setInvoiceSearchInput(keyword)}
                                    onSelect={(option) => handleInvoiceSelect(option as OptionType)}
                                    selectedItem={invoiceOptions.find(option => option.id === invoiceFormData.invoiceId) || null}
                                />
                                {formErrors?.invoiceId && <span className="text-red-500 text-sm">{formErrors.invoiceId}</span>}
                            </div>
                            <div className="w-full">
                                <DateInput
                                    label="Delivery Date"
                                    value={invoiceFormData.challanDate}
                                    onChange={(newDate) => handleFormChange('challanDate', newDate)}
                                    isRequired
                                />
                                {formErrors?.challanDate && <span className="text-red-500 text-sm">{formErrors.challanDate}</span>}
                            </div>
                            <div className="w-full">
                                <label className="block text-sm font-medium text-gray-700 ">
                                    Status <em className='text-red-500'>*</em>
                                </label>
                                <SearchableDropdown
                                    placeholder="Select Status"
                                    options={invoiceStatuses}
                                    value={
                                        invoiceStatuses.find(
                                            (option) => option.id === invoiceFormData.status
                                        ) || null
                                    }
                                    onChange={(_, value) => { handleFormChange('status', value?.id || null) }}
                                />
                                {formErrors?.status && <span className="text-red-500 text-sm">{formErrors.status}</span>}
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
                </div>
                {/* Tax Treatment */}
                <div className="bg-white p-4 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-4 flex-wrap">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Tax Treatment</label>
                            <select
                                value={invoiceFormData.taxTreatment}
                                onChange={(e) => handleFormChange('taxTreatment', e.target.value as InvoiceFormData['taxTreatment'])}
                                className="border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-600"
                            >
                                <option value="STANDARD">Standard</option>
                                <option value="ZERO_RATED">Zero-rated</option>
                                <option value="EXEMPT">Exempt</option>
                                <option value="REVERSE_CHARGE">Reverse charge</option>
                                <option value="OUT_OF_SCOPE">Out of scope</option>
                            </select>
                        </div>
                        {invoiceFormData.taxTreatment !== 'STANDARD' && (
                            <p className="text-sm text-amber-600 font-medium mt-5">
                                Tax suppressed — {invoiceFormData.taxTreatment.replace(/_/g, ' ').toLowerCase()}
                            </p>
                        )}
                    </div>
                </div>
                {/* Invoice Items */}
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
                                {invoiceFormData.items.map((item) => (
                                    <InvoiceTableRow
                                        key={item.id}
                                        item={item}
                                        currencySymbol={docCurrencySymbol}
                                        currencyCode={invoiceFormData.currencyCode}
                                        onInLineItemChange={(updatedItem) => handleInLineItemChange(updatedItem, item.id)}
                                        onEditItem={handleEditItem}
                                        onDeleteItem={handleRemoveItem}
                                        availableItems={invoiceFormData.items}
                                        addNewProduct={handleNewProductClick}
                                        lineFields={lineFields}
                                    />
                                ))}
                                {invoiceFormData.items.length === 0 && (
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
                            <Button variant="ghost" onClick={() => handleNewRow()} leftIcon={<PlusCircle className="h-4 w-4" />} className="text-purple-600">
                                Add New Row
                            </Button>
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
                                <textarea value={invoiceFormData.notes} onChange={(e) => handleFormChange('notes', e.target.value)} rows={4} placeholder="Enter Notes" className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"></textarea>
                            </div>
                        )}
                        {activeInfoTab === 'termsAndCondition' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 ">Terms & Conditions</label>
                                <textarea value={invoiceFormData.termsAndCondition} onChange={(e) => handleFormChange('termsAndCondition', e.target.value)} rows={4} placeholder="Enter Terms & Conditions" className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600"></textarea>
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
                                    selectedItem={bankAccounts.find(item => item.id === invoiceFormData.bank)}
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
                            <div className="flex items-center"><input id="no-sig" type="radio" name="signature" checked={invoiceFormData.sign_type === 'none'} onChange={() => handleFormChange('sign_type', 'none')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="no-sig" className="ml-2 block text-sm text-gray-700 cursor-pointer">No Signature</label></div>
                            <div className="flex items-center"><input id="manual-sig" type="radio" name="signature" checked={invoiceFormData.sign_type === 'digitalSignature'} onChange={() => handleFormChange('sign_type', 'digitalSignature')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="manual-sig" className="ml-2 block text-sm text-gray-700  cursor-pointer">Manual Signature</label></div>
                            <div className="flex items-center"><input id="e-sig" type="radio" name="signature" checked={invoiceFormData.sign_type === 'eSignature'} onChange={() => handleFormChange('sign_type', 'eSignature')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="e-sig" className="ml-2 block text-sm text-gray-700  cursor-pointer">eSignature</label></div>
                        </div>

                        {invoiceFormData.sign_type !== 'none' && (invoiceFormData.sign_type === 'digitalSignature' ? (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 ">Select Signature Name <span className="text-red-500">*</span></label>
                                <SmartDropdown
                                    items={manualSignatures}
                                    value={signatureSearchInput}
                                    onChange={(value) => setSignatureSearchInput(value)}
                                    onSelect={(item) => handleFormChange('signatureId', item?.id || '')}
                                    selectedItem={manualSignatures.find(sig => sig.id === invoiceFormData.signatureId) || null}
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
                                <input name='signatureName' type="text" value={invoiceFormData.signatureName} onChange={e => handleFormChange('signatureName', e.target.value)} placeholder="Enter Signature Name" className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600" />
                                {formErrors?.signatureName && <p className="text-red-500 text-xs mt-1">{formErrors.signatureName}</p>}
                                <p className="mt-2 text-sm font-medium text-gray-700 ">Draw your eSignature</p>
                                <div className="mt-2 h-20 w-48 bg-gray-100  rounded-md flex items-center justify-center cursor-pointer border-2 border-dashed border-gray-400" onClick={() => setSignatureModalOpen(true)}>
                                    {invoiceFormData.esignDataUrl ? <img src={invoiceFormData.esignDataUrl} alt="Drawn Signature" className="max-h-full max-w-full" /> : <div className="text-center text-gray-500"><Edit size={20} className="mx-auto mb-1" /><span className="text-xs">Draw Signature</span></div>}
                                </div>
                                {formErrors?.esignDataUrl && <p className="text-red-500 text-xs mt-1">{formErrors.esignDataUrl}</p>}
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex justify-end mt-4 gap-3">
                    <Button variant="white" onClick={() => navigate('/admin/delivery-challans')}>Cancel</Button>
                    <SubmitButton isDisabled={isSaving} isLoading={isSaving} mode='create' />
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

export default NewDeliveryChallan;