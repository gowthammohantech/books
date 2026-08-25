import React, { useEffect, useState, useMemo, useRef } from 'react';
import { PlusCircle, Edit } from 'lucide-react';
import DateInput from '@components/admin/DateInput';
import axios from 'axios';
import Constants from '@constants/api';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import { useDebounce } from '@hooks/useDebounce';
import Modal from '@components/admin/Modal';
import SignatureCanvas from 'react-signature-canvas';
import { toast } from "sonner";
import { useNavigate, useParams, Link } from 'react-router-dom';
import { numberToWords } from '@utils/converters';
import FullPageLoader from '@components/admin/FullPageLoader';
import CustomerCard from '@components/admin/CustomerCard';
import AdminCard from '@components/admin/AdminCard';
import { resolveCompanyLogo } from '@utils/companyLogo';
import SubmitButton from '@components/admin/SubmitButton';
import InvoiceActionToolbar from '@components/admin/invoice/InvoiceActionToolbar';
import { isInvoiceEditable } from '@utils/invoiceStatus';
import SmartDropdown from '@components/admin/SmartDropdown';
import CreateCustomerForm from '@components/admin/CreateCustomerForm';
import CreateProductForm from '@components/admin/CreateProductForm';
import InvoiceTableRow from '@components/admin/InvoiceTableRow';
import type { OptionType, SelectedAdmin } from '@models/common';
import CreateBankAccountModal from '@pages/admin/invoices/CreateBankAccountModal';
import type { BankAccountCreatedResponse } from '@models/bank-account';
import CreateSignatureModal from '@pages/admin/invoices/CreateSignatureModal';
import type { SignatureOptions } from '@models/signature';
import type { Product, ProductItem as BaseProductItem } from '@models/product';
import type { Customer } from '@models/customer';
import type { Vehicle } from '@models/vehicle';
import type { TaxRate, TaxLine } from '@models/taxRate';
import LineTaxSelect from '@components/admin/LineTaxSelect';
import { recomputeLineTaxesByIds, recomputeLineTaxesFromComponents, appendLineTaxFormData, applyFlatRateToLine, resolveLineTaxByRateId } from '@lib/lineTax';
import { round2 } from '@utils/round2';
import DynamicCustomFields from '@components/admin/DynamicCustomFields';
import { QRCodeSVG } from 'qrcode.react';
import CurrencySelect from '@components/admin/CurrencySelect';
import { useCurrencies } from '@hooks/useCurrencies';
import useDateFormatter from '@hooks/useDateFormatter';
import { useDirtyGuard, confirmIfDirty } from '@hooks/useDirtyGuard';
import { useLineItemCustomFields } from '@hooks/useLineItemCustomFields';
import { validateLineCustomFields } from '@lib/lineCustomFields';
import { PageHeader } from "@/context/PageHeaderContext";
import { Button, Badge, FormField, Select, fieldControlClasses } from "@components/ui";

// Extend the base ProductItem to carry the new per-line tax breakdown.
type ProductItem = BaseProductItem & {
    taxes?: TaxLine[];
    totalTax?: number;
    appliedTaxRateIds?: string[];
    customFields?: Record<string, string | number | boolean | string[]>;
};


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
    paymentOptions: { name: string; url: string }[];
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

const EditInvoice: React.FC = () => {
    const navigate = useNavigate();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { invoiceId } = useParams<{ invoiceId: string }>();
    const { defaultCurrencyCode, resolveCurrency, formatMoney } = useCurrencies();
    const { formatDate, formatDateTime } = useDateFormatter();
    const { fields: lineFields } = useLineItemCustomFields(token, 'invoices');

    // Core States
    const [adminUsers, setAdminUsers] = useState<OptionType[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerSearchInput, setCustomerSearchInput] = useState<string>('');
    const debouncedSearchTermCustomer = useDebounce(customerSearchInput, 500);

    const [selectedAdmin, setSelectedAdmin] = useState<OptionType | null>(null);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [companyDetails, setCompanyDetails] = useState<SelectedAdmin | null>(null);
    const [customerDetails, setCustomerDetails] = useState<Customer | null>(null);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
    const [bankAccountSearchInput, setBankAccountSearchInput] = useState<string>('');
    const debouncedSearchTermBankAccount = useDebounce(bankAccountSearchInput, 500);
    const [isCreateBankAccountModalOpen, setIsCreateBankAccountModalOpen] = useState(false);
    const [activeCustomFields, setActiveCustomFields] = useState<any[]>([]);

    const [invoiceFormData, setInvoiceFormData] = useState<InvoiceFormData>({
        invoiceNumber: '',
        invoiceDate: null,
        dueDate: null,
        status: 'DRAFT',
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
        customFields: {},
        vehicleId: null,
        invoiceType: 'INVOICE',
        currencyCode: '',
        paymentOptions: [],
        taxTreatment: 'STANDARD',
    });

    // Enabled link-based payment methods (Wise, Revolut, ...) from settings.
    const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string; defaultUrl: string | null }[]>([]);

    // Holds the raw loaded invoice record (used for converted banner + edit lock)
    const [invoiceData, setInvoiceData] = useState<any>(null);
    const [docCreatedAt, setDocCreatedAt] = useState<string | null>(null);

    // Load the company's enabled link-based payment methods for the checkboxes.
    useEffect(() => {
        if (!token) return;
        axios
            .get(`${Constants.PAYMENT_LINK_METHODS_URL}?enabledOnly=true`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((r) => setPaymentMethods(r.data?.data ?? []))
            .catch(() => setPaymentMethods([]));
    }, [token]);

    // Toggle a payment method on/off for this invoice; pre-fill URL from the method default.
    const togglePaymentOption = (name: string, defaultUrl: string | null) => {
        setInvoiceFormData((prev) => {
            const exists = prev.paymentOptions.some((o) => o.name === name);
            return {
                ...prev,
                paymentOptions: exists
                    ? prev.paymentOptions.filter((o) => o.name !== name)
                    : [...prev.paymentOptions, { name, url: defaultUrl ?? '' }],
            };
        });
    };

    const setPaymentOptionUrl = (name: string, url: string) => {
        setInvoiceFormData((prev) => ({
            ...prev,
            paymentOptions: prev.paymentOptions.map((o) => (o.name === name ? { ...o, url } : o)),
        }));
    };

    const [vehiclesForCustomer, setVehiclesForCustomer] = useState<Vehicle[]>([]);

    // Edit Modal State
    const [isEditProductModalOpen, setIsEditProductModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<ProductItem | null>(null);
    const [taxes, setTaxes] = useState<taxGroup[]>([]);
    const [taxRateLibrary, setTaxRateLibrary] = useState<TaxRate[]>([]);

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
    const [signatureSearchInput, setSignatureSearchInput] = useState<string>('');
    const debouncedSearchTermSignature = useDebounce(signatureSearchInput, 500);
    const [isCreateSignModalOpen, setIsCreateSignModalOpen] = useState(false);
    // Set when fetchInvoiceForEdit fails — renders a centered error panel instead
    // of a blank editor (e.g. a bad/deleted invoice id).
    const [loadError, setLoadError] = useState<string | null>(null);
    // In-flight flags + one-shot error-toast guards for the dropdown-feeding list
    // fetches below — these can re-fire on every debounced keystroke, so a plain
    // toast in the catch would spam the user; the ref only re-arms after a fetch
    // succeeds.
    const [bankAccountsLoading, setBankAccountsLoading] = useState(false);
    const bankAccountsErrorShownRef = useRef(false);
    const [signaturesLoading, setSignaturesLoading] = useState(false);
    const signaturesErrorShownRef = useRef(false);
    const [customersLoading, setCustomersLoading] = useState(false);
    const customersErrorShownRef = useRef(false);

    // --- FORM HANDLERS (Defined first so fetchers can use them) ---
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

    const handleCustomFieldChange = (fieldSlug: string, value: any) => {
        isDirtyRef.current = true;
        setInvoiceFormData(prev => ({
            ...prev,
            customFields: { ...prev.customFields, [fieldSlug]: value }
        }));
        if (formErrors[`customField_${fieldSlug}`]) {
            setFormErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[`customField_${fieldSlug}`];
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

    const fetchVehiclesForCustomer = async (customerId: string) => {
        if (!customerId) {
            setVehiclesForCustomer([]);
            return;
        }
        try {
            const res = await axios.get(
                `${Constants.GET_VEHICLES_FOR_CUSTOMER_URL}/${customerId}/vehicles`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setVehiclesForCustomer(res.data?.data?.vehicles ?? []);
        } catch {
            setVehiclesForCustomer([]);
        }
    };

    const handleCustomerChange = async (user: Customer) => {
        isDirtyRef.current = true;
        if (user) {
            setSelectedCustomer(user);
            setInvoiceFormData(prev => ({
                ...prev,
                billTo: user.id,
                vehicleId: null,
                currencyCode: user.currencyCode || prev.currencyCode,
                taxTreatment: (user as any).defaultTaxTreatment ?? prev.taxTreatment,
            }));
            setCustomerDetails(user);
            fetchVehiclesForCustomer(user.id);
        } else {
            setSelectedCustomer(null);
            setInvoiceFormData(prev => ({ ...prev, billTo: '', vehicleId: null }));
            setCustomerDetails(null);
            setVehiclesForCustomer([]);
        }
    };

    // --- PUBLIC LINK HANDLERS ---
    const [publicLinkSaving, setPublicLinkSaving] = useState(false);

    function getPublicUrl(publicToken: string): string {
        // Prefer publicBaseUrl from company settings; fall back to current origin.
        const base = (invoiceData as { company?: { publicBaseUrl?: string | null } } | null)?.company?.publicBaseUrl?.replace(/\/$/, '')
            ?? window.location.origin;
        return `${base}/invoice/${publicToken}`;
    }

    async function handleTogglePublicLink(enable: boolean) {
        if (!invoiceData?.id) return;
        setPublicLinkSaving(true);
        try {
            const url = enable
                ? `${Constants.ENABLE_PUBLIC_LINK_URL}/${invoiceData.id}/enable-public-link`
                : `${Constants.DISABLE_PUBLIC_LINK_URL}/${invoiceData.id}/disable-public-link`;
            const res = await axios.post(url, {}, { headers: { Authorization: `Bearer ${token}` } });
            const updated = res.data?.data;
            if (updated) {
                setInvoiceData((p: any) => p ? { ...p, publicViewToken: updated.publicViewToken, publicViewEnabled: updated.publicViewEnabled } : p);
            }
            toast.success(enable ? 'Public link enabled' : 'Public link disabled');
        } catch (e) {
            toast.error('Failed to update public link');
        } finally {
            setPublicLinkSaving(false);
        }
    }

    async function handleRotatePublicLink() {
        if (!invoiceData?.id) return;
        if (!window.confirm('Rotate the public link? The old URL will stop working.')) return;
        setPublicLinkSaving(true);
        try {
            const res = await axios.post(
                `${Constants.ROTATE_PUBLIC_LINK_URL}/${invoiceData.id}/rotate-public-link`,
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            const updated = res.data?.data;
            if (updated) {
                setInvoiceData((p: any) => p ? { ...p, publicViewToken: updated.publicViewToken, publicViewEnabled: updated.publicViewEnabled } : p);
            }
            toast.success('Public link rotated');
        } catch (e) {
            toast.error('Failed to rotate public link');
        } finally {
            setPublicLinkSaving(false);
        }
    }

    async function handleCopyPublicLink() {
        if (!invoiceData?.publicViewToken) return;
        try {
            await navigator.clipboard.writeText(getPublicUrl(invoiceData.publicViewToken));
            toast.success('Link copied');
        } catch {
            toast.error('Copy failed');
        }
    }

    // --- E-INVOICE (IRN) HANDLERS — slice G.1 ---
    type EInvoiceRecord = {
        id: string;
        irn: string | null;
        ackNo: string | null;
        ackDate: string | null;
        status: 'PENDING' | 'GENERATED' | 'CANCELLED' | 'FAILED';
        provider: string;
        errorMessage: string | null;
        cancelledAt: string | null;
        cancelReason: string | null;
    };
    const [eInvoice, setEInvoice] = useState<EInvoiceRecord | null>(null);
    const [eInvoiceLoading, setEInvoiceLoading] = useState(false);
    const [eInvoiceSaving, setEInvoiceSaving] = useState(false);

    async function fetchEInvoice(invId: string) {
        try {
            setEInvoiceLoading(true);
            const res = await axios.get(`${Constants.GET_E_INVOICE_BY_INVOICE_URL}/${invId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setEInvoice(res.data?.data?.eInvoice ?? null);
        } catch (e) {
            // 404 is normal — no record yet
            if (axios.isAxiosError(e) && e.response?.status === 404) {
                setEInvoice(null);
            } else {
                console.error('Failed to fetch e-invoice:', e);
            }
        } finally {
            setEInvoiceLoading(false);
        }
    }

    async function handleGenerateIrn() {
        if (!invoiceData?.id) return;
        setEInvoiceSaving(true);
        try {
            const res = await axios.post(
                `${Constants.GENERATE_E_INVOICE_URL}/${invoiceData.id}`,
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            const rec = res.data?.data?.eInvoice as EInvoiceRecord | undefined;
            if (rec) setEInvoice(rec);
            toast.success(res.data?.message ?? 'IRN generated');
        } catch (e) {
            const msg = axios.isAxiosError(e)
                ? (e.response?.data as { message?: string } | undefined)?.message
                : null;
            toast.error(msg ?? 'Failed to generate IRN');
        } finally {
            setEInvoiceSaving(false);
        }
    }

    async function handleCancelIrn() {
        if (!eInvoice?.id) return;
        const reason = window.prompt('Reason for cancellation?');
        if (reason === null) return;
        setEInvoiceSaving(true);
        try {
            const res = await axios.post(
                `${Constants.CANCEL_E_INVOICE_URL}/${eInvoice.id}/cancel`,
                { reason },
                { headers: { Authorization: `Bearer ${token}` } },
            );
            const rec = res.data?.data?.eInvoice as EInvoiceRecord | undefined;
            if (rec) setEInvoice(rec);
            toast.success('IRN cancelled');
        } catch (e) {
            const msg = axios.isAxiosError(e)
                ? (e.response?.data as { message?: string } | undefined)?.message
                : null;
            toast.error(msg ?? 'Failed to cancel IRN');
        } finally {
            setEInvoiceSaving(false);
        }
    }

    useEffect(() => {
        if (invoiceData?.id && invoiceData?.invoiceType === 'INVOICE') {
            fetchEInvoice(invoiceData.id);
        } else {
            setEInvoice(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invoiceData?.id, invoiceData?.invoiceType]);

    // --- WHATSAPP SEND HANDLER — slice G.3 ---
    const [whatsappModal, setWhatsappModal] = useState<{
        waMeUrl: string;
        phone: string;
        message: string;
        publicLink: string | null;
    } | null>(null);
    const [whatsappSending, setWhatsappSending] = useState(false);

    async function handleSendWhatsapp() {
        if (!invoiceData?.id) return;
        setWhatsappSending(true);
        try {
            const res = await axios.post(
                `${Constants.SEND_INVOICE_WHATSAPP_URL}/${invoiceData.id}/send-whatsapp`,
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
            const data = res.data?.data;
            if (data?.waMeUrl) {
                setWhatsappModal({
                    waMeUrl: data.waMeUrl,
                    phone: data.phone ?? '',
                    message: data.message ?? '',
                    publicLink: data.publicLink ?? null,
                });
            } else {
                toast.error('No WhatsApp URL returned');
            }
        } catch (e) {
            const msg = axios.isAxiosError(e)
                ? (e.response?.data as { message?: string } | undefined)?.message
                : null;
            toast.error(msg ?? 'Failed to compose WhatsApp message');
        } finally {
            setWhatsappSending(false);
        }
    }

    // Razorpay/Stripe in-app checkout was removed from the editor. Payments are
    // now offered as link-based "Pay with" buttons on the public view (see the
    // Payment options section + Settings → Payment Gateways).

    // --- FETCHERS (Defined before useEffect) ---
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

    const fetchInvoiceForEdit = async () => {
        try {
            setLoadError(null);
            const response = await axios.get(
                `${Constants.FETCH_INVOICE_FOR_EDIT_URL}/${invoiceId}`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );

            const invoiceData = response.data?.data;

            if (invoiceData) {
                setInvoiceData(invoiceData);
                setDocCreatedAt((invoiceData.createdAt as string | undefined) ?? null);
                setInvoiceFormData((prev) => ({
                    ...prev,
                    invoiceNumber: invoiceData.invoiceNumber || '',
                    invoiceDate: invoiceData.invoiceDate ? new Date(invoiceData.invoiceDate) : null,
                    dueDate: invoiceData.dueDate ? new Date(invoiceData.dueDate) : null,
                    status: invoiceData.status,
                    billFrom: invoiceData?.billFrom?.id || '',
                    billTo: invoiceData?.billTo?.id || '',
                    items: ((invoiceData.items || []) as any[]).map((it: any) => {
                        const taxesArr: TaxLine[] = Array.isArray(it.taxes)
                            ? it.taxes.map((t: any) => ({
                                  taxRateId: String(t.taxRateId ?? t.id ?? ''),
                                  name: String(t.name ?? ''),
                                  kind: (t.kind ?? null) as TaxLine['kind'],
                                  percent: Number(t.percent ?? t.rate ?? 0),
                                  amount: Number(t.amount ?? 0),
                              }))
                            : [];
                        // The persisted invoice item shape (productId/productName/
                        // lineTotal) differs from the form's canonical ProductItem
                        // (id/name/amount). Reverse-map so the row renderer and the
                        // resubmit contract both get the fields they expect.
                        const qtyN = Number(it.qty ?? 0);
                        const rateN = Number(it.rate ?? 0);
                        return {
                            ...it,
                            id: String(it.id ?? it.productId ?? ''),
                            name: String(it.name ?? it.productName ?? ''),
                            unit: it.unit ?? '',
                            qty: qtyN,
                            rate: rateN,
                            discount: Number(it.discount ?? 0),
                            tax: Number(it.tax ?? it.totalTax ?? 0),
                            amount: Number(it.amount ?? it.lineTotal ?? rateN * qtyN),
                            tax_rate_id: String(it.tax_rate_id ?? ''),
                            taxes: taxesArr,
                            totalTax: Number(it.totalTax ?? taxesArr.reduce((s, t) => s + (t.amount || 0), 0)),
                            appliedTaxRateIds: taxesArr.map((t) => t.taxRateId).filter(Boolean),
                        } as ProductItem;
                    }),
                    notes: invoiceData.notes || '',
                    termsAndCondition: invoiceData.termsAndCondition || '',
                    bank: invoiceData.bank?.id || null,
                    sign_type: invoiceData.sign_type ?? 'none',
                    signatureId: invoiceData.signature?.id || null,
                    signatureName: invoiceData.signature?.name || '',
                    esignDataUrl: invoiceData.signature?.image || null,
                    subTotal: invoiceData.taxableAmount,
                    totalTax: invoiceData.vat,
                    totalDiscount: invoiceData.totalDiscount,
                    grandTotal: invoiceData.TotalAmount,
                    customFields: invoiceData.customFields || {},
                    vehicleId: invoiceData.vehicleId ?? null,
                    invoiceType: invoiceData.invoiceType ?? 'INVOICE',
                    currencyCode: invoiceData.currencyCode ?? defaultCurrencyCode,
                    paymentOptions: Array.isArray(invoiceData.paymentOptions)
                        ? invoiceData.paymentOptions
                              .filter((o: any) => o && typeof o.name === 'string')
                              .map((o: any) => ({ name: String(o.name), url: String(o.url ?? '') }))
                        : [],
                    taxTreatment: (invoiceData.taxTreatment as InvoiceFormData['taxTreatment']) ?? 'STANDARD',
                }));

                if (invoiceData.billFrom) {
                    let _admin = { id: invoiceData.billFrom.id, name: invoiceData.billFrom.name };
                    handleAdminChange(_admin);
                }
                if (invoiceData.billTo) {
                    let _customer = {
                        id: invoiceData.billTo.id,
                        name: invoiceData.billTo.name,
                        email: invoiceData.billTo.email,
                        phone: invoiceData.billTo.phone,
                        image: invoiceData.billTo.image
                    };
                    await handleCustomerChange(_customer as any);
                    // handleCustomerChange resets vehicleId to null; restore it from the loaded invoice
                    setInvoiceFormData(prev => ({ ...prev, vehicleId: invoiceData.vehicleId ?? null }));
                }
            }
        } catch (error: any) {
            console.error("Error fetching invoice for edit:", error);
            setLoadError(error?.response?.data?.message || 'Failed to load this invoice.');
        }
    }

    // --- INITIALIZATION ---
    useEffect(() => {
        const fetchDropdownData = async () => {
            setIsFetching(true);
            await fetchAdminUsers();
            await fetchTaxes();
            await fetchInvoiceForEdit();
            setIsFetching(false);
        }

        fetchDropdownData();
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
            ...(selectedCustomer?.id ? { customerId: selectedCustomer.id } : {}),
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

    useEffect(() => {
        const fetchCustomersByQuery = async () => {
            try {
                setCustomersLoading(true);
                const response = await axios.get(`${Constants.GET_CUSTOMERS_WITH_SEARCH_URL}`, {
                    params: { search: debouncedSearchTermCustomer, limit: 100, page: 1 },
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.data.data.customers.length > 0) {
                    setCustomers(response.data.data.customers);
                } else {
                    setCustomers([]);
                }
                customersErrorShownRef.current = false;
            } catch (error) {
                console.error('Error fetching customers:', error);
                if (!customersErrorShownRef.current) {
                    customersErrorShownRef.current = true;
                    toast.error('Failed to load customers.');
                }
            } finally {
                setCustomersLoading(false);
            }
        }
        fetchCustomersByQuery();
    }, [debouncedSearchTermCustomer, token]);


    // --- REST OF HANDLERS ---

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

            const fieldsToNumber = ['qty', 'rate', 'discount_value'];
            const newValue = fieldsToNumber.includes(field as string)
                ? Number(value) || 0
                : value;

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
            // was used.
            if (discount_type === 'Percentage') {
                if (discount_value < 0) discount_value = 0;
                if (discount_value > 100) discount_value = 100;
            } else {
                if (discount_value < 0) discount_value = 0;
                if (discount_value > subtotal) discount_value = subtotal;
            }

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
        const grandTotalValue = totals.subTotal - totals.totalDiscount + totals.totalTax;
        const roundedSubTotal = round2(totals.subTotal);
        const roundedTotalTax = round2(totals.totalTax);
        const roundedTotalDiscount = round2(totals.totalDiscount);
        const roundedGrandTotal = round2(grandTotalValue);

        setTimeout(() => {
            setInvoiceFormData(prev => {
                if (prev.subTotal === roundedSubTotal && prev.grandTotal === roundedGrandTotal) return prev;
                return { ...prev, subTotal: roundedSubTotal, totalTax: roundedTotalTax, totalDiscount: roundedTotalDiscount, grandTotal: roundedGrandTotal }
            });
        }, 0);

        return { subTotal: roundedSubTotal, totalTax: roundedTotalTax, totalDiscount: roundedTotalDiscount, grandTotal: roundedGrandTotal };
    }, [invoiceFormData.items]);

    const totalInWords = useMemo(() => {
        if (grandTotal <= 0) return 'Zero';
        return numberToWords(Math.round(grandTotal));
    }, [grandTotal]);

    // Derive the document-level currency symbol from the selected currencyCode
    const docCurrencySymbol = resolveCurrency(invoiceFormData.currencyCode || defaultCurrencyCode).symbol;
    // The document-level currency code, used to format every money value consistently
    // via formatMoney() so the editor matches the PDF.
    const docCurrencyCode = invoiceFormData.currencyCode || defaultCurrencyCode;
    const fmtMoney = (amount: number) => formatMoney(amount, docCurrencyCode);

    // The invoice is locked when it is PAID (currency cannot be changed)
    const isCurrencyLocked = invoiceData?.status === 'PAID';
    // Only draft invoices can be edited; everything else is read-only.
    const isEditable = isInvoiceEditable(invoiceData?.status);

    const selectedManualSignatureImage = useMemo(() => {
        return manualSignatures.find(sig => sig.id === invoiceFormData.signatureId)?.imageUrl || null;
    }, [invoiceFormData.signatureId, manualSignatures]);

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
            const groupMemberIds = selectedTaxGroup.tax_rates.map((r) => r.id);
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

        // If user has manually picked TaxRates, recompute the per-line tax breakdown.
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
        const updatedProduct: ProductItem = { ...(product as ProductItem), ...computed };
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
        isDirtyRef.current = true;
        setInvoiceFormData((prev) => ({
            ...prev,
            items: [...prev.items, {
                id: crypto.randomUUID(),
                name: '', unit: '', qty: 1, rate: 0, discount: 0, tax: 0, amount: 0
            }]
        }));
    }

    const validateQuotationData = () => {
        const newErrors: { [key: string]: string } = {};

        if (!invoiceFormData.invoiceDate) newErrors.invoiceDate = 'Invoice date is required.';
        if (!invoiceFormData.status.trim()) newErrors.status = 'Status is required.';

        if (!invoiceFormData.billFrom.trim()) newErrors.billFrom = 'Bill from is required.';
        if (!invoiceFormData.billTo.trim()) newErrors.billTo = 'Bill to is required.';

        const hasItemPopulated = invoiceFormData.items.some(item => (item.name ?? '').trim() !== '');
        if (!hasItemPopulated) newErrors.items = 'At least one item is required.';

        if (invoiceFormData.sign_type === 'digitalSignature' && !invoiceFormData.signatureId) newErrors.signatureId = 'Manual signature is required.';
        if (invoiceFormData.sign_type === 'eSignature' && !invoiceFormData.signatureName.trim()) newErrors.signatureName = 'Esignature name is required.';
        if (invoiceFormData.sign_type === 'eSignature' && !invoiceFormData.esignDataUrl) newErrors.esignDataUrl = 'Esignature is required.';

        // Custom Fields Validation
        activeCustomFields.forEach((field: any) => {
            if (field.isMandatory) {
                const val = invoiceFormData.customFields[field.fieldSlug] || invoiceFormData.customFields[field.id];

                if (val === undefined || val === null) {
                    newErrors[`customField_${field.fieldSlug || field.id}`] = `${field.labelName} is required.`;
                } else if (Array.isArray(val) && val.length === 0) {
                    newErrors[`customField_${field.fieldSlug || field.id}`] = `${field.labelName} is required.`;
                } else if (typeof val === 'string' && val.trim() === '') {
                    newErrors[`customField_${field.fieldSlug || field.id}`] = `${field.labelName} is required.`;
                }
            }
        });

        const lineFieldError = validateLineCustomFields(invoiceFormData.items, lineFields, docCreatedAt);
        if (lineFieldError) newErrors.lineCustomFields = lineFieldError;

        setFormErrors(newErrors);
        return newErrors;
    }

    const saveQuotation = async (e: React.FormEvent) => {
        e.preventDefault();
        // Only draft invoices can be saved via the full-form PUT (the backend
        // returns 409 otherwise). Issued invoices change via dedicated actions
        // (record payment, mark sent, write off), so ignore stray submits here.
        if (!isInvoiceEditable(invoiceData?.status)) return;
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
            } else if (key === 'paymentOptions') {
                // Send as JSON string so an empty array clears the options server-side.
                const opts = (value as { name: string; url: string }[]).filter((o) => o.url && o.url.trim());
                formData.append('paymentOptions', JSON.stringify(opts));
            } else if (Array.isArray(value) && key === 'items') {
                appendLineTaxFormData(formData, value as unknown as Parameters<typeof appendLineTaxFormData>[1]);
            } else if (key === 'customFields') {
                const customFieldsEntries = Object.entries(invoiceFormData.customFields)
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

        try {
            setIsSubmitting(true);
            await axios.put(`${Constants.UPDATE_INVOICE_URL}/${invoiceId}`, formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data',
                },
            });
            toast.success('Invoice updated successfully.');
            isDirtyRef.current = false;
            navigate('/admin/invoices');
        } catch (error: any) {
            if (error.response?.status !== 200 && error.response?.data?.errors) {
                setFormErrors(error.response.data.errors);
                toast.error('Please check the form for errors.')
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

    const handleNewProductClick = () => {
        setIsProductModalOpen(true);
    }

    // The invoice failed to load (bad/deleted id, network error, etc.) — show a
    // recoverable error panel instead of silently rendering a blank editor.
    if (loadError) {
        return (
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="max-w-md w-full text-center bg-white border border-gray-200 rounded-control shadow-card p-8">
                    <p className="text-lg font-semibold text-gray-950 mb-2">Couldn't load this invoice</p>
                    <p className="text-sm text-gray-600 mb-6">{loadError}</p>
                    <div className="flex items-center justify-center gap-3">
                        <Button
                            type="button"
                            variant="white"
                            onClick={async () => {
                                setIsFetching(true);
                                await fetchInvoiceForEdit();
                                setIsFetching(false);
                            }}
                        >
                            Retry
                        </Button>
                        <Link to="/admin/invoices" className="text-sm font-medium text-purple-600 hover:underline">
                            Back to Invoices
                        </Link>
                    </div>
                </div>
                {isFetching && <FullPageLoader />}
            </div>
        );
    }

    return (
        <div className="md:p-4 bg-white-50 min-h-screen border border-gray-200 rounded">
            <form onSubmit={saveQuotation}>
                <div className="max-w-7xl mx-auto space-y-4">
                    <PageHeader title="Edit Invoice" />

                    {/* Header */}
                    <div className="flex justify-end items-center mb-2">
                        <img src={resolveCompanyLogo(systemSettings?.company?.siteLogo)} alt="Logo" className='w-32 max-h-20 max-w-32 h-auto object-contain' />
                    </div>

                    {/* Action toolbar — status-aware quick actions for this invoice */}
                    {invoiceData?.id && (
                        <InvoiceActionToolbar
                            invoiceId={invoiceData.id}
                            status={invoiceData.status}
                            invoiceType={invoiceData.invoiceType}
                            convertedAt={invoiceData.convertedAt}
                            invoiceNumber={invoiceData.invoiceNumber}
                            dueDate={invoiceData.dueDate}
                            totalAmount={Number(invoiceData.TotalAmount ?? 0)}
                            totalPaid={Number((invoiceData as any).totalPaid ?? 0)}
                            onChanged={fetchInvoiceForEdit}
                            primary={
                                isEditable ? (
                                    <SubmitButton
                                        isDisabled={isSubmitting || !!invoiceData?.convertedAt}
                                        isLoading={isSubmitting}
                                        mode="edit"
                                    />
                                ) : undefined
                            }
                        />
                    )}

                    {/* Read-only notice for non-draft invoices */}
                    {invoiceData?.id && !isEditable && (
                        <div className="rounded-control bg-warning-soft border border-warning text-warning p-3 mb-2 text-sm">
                            This invoice is <strong>{(invoiceData.status || '').toLowerCase()}</strong> and can no longer be edited.
                            Only draft invoices are editable — use the actions above to record a payment, send it, or create a credit note to adjust it.
                        </div>
                    )}

                    {/* Converted banner — shown when this proforma has been converted to a final invoice */}
                    {invoiceData?.convertedAt && (
                        <div className="rounded-control bg-success-soft border border-success text-success p-3 mb-4 text-sm">
                            Converted on {formatDate(invoiceData.convertedAt)}. This proforma is now locked.
                        </div>
                    )}

                    {/* Child-of-recurring-parent banner */}
                    {invoiceData?.parentInvoice && (
                        <div className="rounded-control bg-info-soft border border-info text-info p-3 mb-4 text-sm">
                            Generated from recurring schedule.{' '}
                            <a href={`/admin/invoices/edit-invoice/${invoiceData.parentInvoice}`} className="underline">
                                View parent
                            </a>
                        </div>
                    )}

                    {/* Sharing & advanced options — collapsed by default to keep the form focused */}
                    <details className="border border-gray-200 rounded-control mb-4 group">
                        <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-control">
                            Sharing &amp; advanced options
                            <span className="text-gray-400 font-normal"> — public link, QR, WhatsApp, e-invoice (IRN)</span>
                        </summary>
                        <div className="p-4 pt-2">

                    {/* Public link panel */}
                    {invoiceData?.id && (
                        <div className="border rounded-control p-4 mb-4">
                            <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={!!invoiceData?.publicViewEnabled}
                                        disabled={publicLinkSaving}
                                        onChange={(e) => handleTogglePublicLink(e.target.checked)}
                                    />
                                    <span className="text-sm font-medium">Public view link</span>
                                </label>
                                <div className="flex items-center gap-3">
                                    <Button
                                        variant="success"
                                        size="sm"
                                        onClick={handleSendWhatsapp}
                                        disabled={whatsappSending}
                                        className="whitespace-nowrap"
                                    >
                                        {whatsappSending ? 'Composing…' : 'Send via WhatsApp'}
                                    </Button>
                                    {invoiceData?.publicViewEnabled && invoiceData?.publicViewToken && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleRotatePublicLink}
                                            disabled={publicLinkSaving}
                                            className="text-purple-700 underline"
                                        >
                                            Rotate
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {invoiceData?.publicViewEnabled && invoiceData?.publicViewToken && (
                                <div className="mt-3 flex items-start gap-4">
                                    <QRCodeSVG value={getPublicUrl(invoiceData.publicViewToken)} size={120} />
                                    <div className="flex-1 text-sm">
                                        <p className="text-gray-500 mb-1">Anyone with this link can view (read-only):</p>
                                        <div className="flex items-center gap-2 mb-2">
                                            <code className="text-xs bg-gray-100 px-2 py-1 rounded break-all flex-1">
                                                {getPublicUrl(invoiceData.publicViewToken)}
                                            </code>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={handleCopyPublicLink}
                                                className="text-purple-700 underline whitespace-nowrap"
                                            >
                                                Copy
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* E-Invoice (IRN) panel — slice G.1, only for final invoices */}
                    {invoiceData?.id && invoiceData?.invoiceType === 'INVOICE' && (
                        <div className="border rounded-control p-4 mb-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium">E-Invoice (IRN)</span>
                                {eInvoice?.status === 'GENERATED' && (
                                    <Badge color="success">GENERATED</Badge>
                                )}
                                {eInvoice?.status === 'CANCELLED' && (
                                    <Badge color="gray">CANCELLED</Badge>
                                )}
                                {eInvoice?.status === 'FAILED' && (
                                    <Badge color="danger">FAILED</Badge>
                                )}
                            </div>

                            {eInvoiceLoading && (
                                <p className="text-xs text-gray-500">Loading…</p>
                            )}

                            {!eInvoiceLoading && !eInvoice && (
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs text-gray-500">
                                        Generate an IRN (Invoice Reference Number) for this invoice via the configured e-invoice provider.
                                    </p>
                                    <Button
                                        onClick={handleGenerateIrn}
                                        disabled={eInvoiceSaving}
                                        className="whitespace-nowrap"
                                    >
                                        {eInvoiceSaving ? 'Generating…' : 'Generate IRN'}
                                    </Button>
                                </div>
                            )}

                            {!eInvoiceLoading && eInvoice && (
                                <div className="text-sm space-y-1">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <div className="text-xs text-gray-500">IRN</div>
                                            <code className="text-xs bg-gray-100 px-2 py-1 rounded break-all block" title={eInvoice.irn ?? ''}>
                                                {eInvoice.irn ?? '—'}
                                            </code>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500">ACK No</div>
                                            <div className="text-sm">{eInvoice.ackNo ?? '—'}</div>
                                            <div className="text-xs text-gray-500 mt-1">
                                                {eInvoice.ackDate ? formatDateTime(eInvoice.ackDate) : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between pt-2">
                                        <div className="text-xs text-gray-500">
                                            Provider: <span className="uppercase">{eInvoice.provider}</span>
                                            {eInvoice.cancelledAt && (
                                                <span className="ml-2">· cancelled {formatDate(eInvoice.cancelledAt)}</span>
                                            )}
                                        </div>
                                        {eInvoice.status === 'GENERATED' && (
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={handleCancelIrn}
                                                disabled={eInvoiceSaving}
                                            >
                                                {eInvoiceSaving ? 'Cancelling…' : 'Cancel IRN'}
                                            </Button>
                                        )}
                                    </div>
                                    {eInvoice.errorMessage && (
                                        <p className="text-xs text-danger pt-1">{eInvoice.errorMessage}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                        </div>
                    </details>

                    {/* Payment options — rendered as "Pay with" buttons on the public view link */}
                    {(paymentMethods.length > 0 || invoiceFormData.paymentOptions.length > 0) && (
                        <div className="mb-4 border border-gray-200 rounded-control p-4">
                            <h3 className="text-sm font-semibold text-gray-700 mb-1">Payment options (shown on public link)</h3>
                            <p className="text-xs text-gray-500 mb-3">
                                Tick the methods to offer on this invoice, and paste the payment URL for each
                                (e.g. the Wise / Revolut / Stripe payment link for this invoice). The customer sees these
                                as "Pay with" buttons on the public view link. Manage available methods in Settings → Payment Gateways.
                            </p>
                            <div className="space-y-2">
                                {paymentMethods.map((m) => {
                                    const selected = invoiceFormData.paymentOptions.find((o) => o.name === m.name);
                                    return (
                                        <div key={m.id} className="flex flex-wrap items-center gap-2">
                                            <label className="flex items-center gap-2 w-44 text-sm text-gray-700">
                                                <input
                                                    type="checkbox"
                                                    checked={!!selected}
                                                    onChange={() => togglePaymentOption(m.name, m.defaultUrl)}
                                                />
                                                {m.name}
                                            </label>
                                            {selected && (
                                                <input
                                                    type="url"
                                                    value={selected.url}
                                                    onChange={(e) => setPaymentOptionUrl(m.name, e.target.value)}
                                                    placeholder={`Payment URL for ${m.name}`}
                                                    className={`flex-1 min-w-[220px] ${fieldControlClasses(false)}`}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                                {/* Selected options whose method was removed from settings */}
                                {invoiceFormData.paymentOptions
                                    .filter((o) => !paymentMethods.some((m) => m.name === o.name))
                                    .map((o) => (
                                        <div key={o.name} className="flex flex-wrap items-center gap-2">
                                            <label className="flex items-center gap-2 w-44 text-sm text-gray-700">
                                                <input type="checkbox" checked onChange={() => togglePaymentOption(o.name, null)} />
                                                {o.name}
                                            </label>
                                            <input
                                                type="url"
                                                value={o.url}
                                                onChange={(e) => setPaymentOptionUrl(o.name, e.target.value)}
                                                className={`flex-1 min-w-[220px] ${fieldControlClasses(false)}`}
                                            />
                                        </div>
                                    ))}
                            </div>
                        </div>
                    )}

                    {/* Document Type */}
                    <div className="mb-4">
                        <Select
                            label="Document Type"
                            value={invoiceFormData.invoiceType}
                            onChange={(e) =>
                                setInvoiceFormData((prev) => ({ ...prev, invoiceType: e.target.value as 'INVOICE' | 'PROFORMA' }))
                            }
                            disabled={!!invoiceData?.convertedAt}
                            containerClassName="sm:w-56"
                        >
                            <option value="INVOICE">Invoice</option>
                            <option value="PROFORMA">Proforma</option>
                        </Select>
                        {invoiceFormData.invoiceType === 'PROFORMA' && (
                            <p className="text-xs text-gray-500 mt-1">Proformas do not deduct inventory on save.</p>
                        )}
                    </div>

                    {/* Top Section */}
                    <div className="w-full">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 w-full">
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
                                    value={invoiceFormData.currencyCode || defaultCurrencyCode}
                                    onChange={(code) => handleFormChange('currencyCode', code)}
                                    disabled={isCurrencyLocked}
                                />
                                {isCurrencyLocked && (
                                    <p className="text-xs text-warning mt-1">Currency is locked on a paid invoice.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Recurring retired: manage recurring invoices via Recurring Invoices -> New. */}

                    {/* Billing Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="bg-white p-4 rounded-control border border-gray-200 ">
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

                        <div className="bg-white p-4 rounded-control border border-gray-200 ">
                            <div className="flex justify-between items-center">
                                <h3 className="font-bold text-gray-950 ">Bill To <span className='text-danger'>*</span></h3>
                                <Button
                                    type='button'
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setIsCustomerModalOpen(true)}
                                    leftIcon={<PlusCircle className="h-4 w-4" />}
                                    className="text-purple-600"
                                >
                                    Add Customer
                                </Button>
                            </div>
                            <div className="mt-4">
                                <SmartDropdown
                                    items={customers}
                                    value={customerSearchInput}
                                    onChange={setCustomerSearchInput}
                                    onSelect={(selectedCustomer) => handleCustomerChange(selectedCustomer as Customer)}
                                    onAddNew={() => setIsCustomerModalOpen(true)}
                                    selectedItem={customers.find((customer) => customer.id === selectedCustomer?.id) || null}
                                    addNewLabel='New Customer'
                                    placeholder='Type to search customer'
                                    loading={customersLoading}
                                />
                                {!selectedCustomer && formErrors?.billTo && <span className="text-danger text-sm">{formErrors.billTo}</span>}
                                {!selectedCustomer && <p className="mt-2 text-xs text-gray-500 p-2 font-semibold">
                                    Select customer to view customer details
                                </p>}
                                <div className="h-4"></div>
                                {selectedCustomer && customerDetails && (
                                    <CustomerCard
                                        image={customerDetails.image}
                                        name={customerDetails.name}
                                        email={customerDetails.email}
                                        phone={customerDetails.phone}
                                    />
                                )}
                                {selectedCustomer && (
                                    <div className="mt-3">
                                        <label className="block text-sm font-medium text-heading mb-1">Vehicle (optional)</label>
                                        <div className="flex items-center gap-2">
                                            <Select
                                                value={invoiceFormData.vehicleId ?? ''}
                                                onChange={(e) => setInvoiceFormData((prev) => ({ ...prev, vehicleId: e.target.value || null }))}
                                                containerClassName="flex-1"
                                            >
                                                <option value="">— No vehicle —</option>
                                                {vehiclesForCustomer.map((v) => (
                                                    <option key={v.id} value={v.id}>
                                                        {[v.name, v.make, v.model, v.registrationNumber].filter(Boolean).join(' • ') || v.id.slice(0, 8)}
                                                    </option>
                                                ))}
                                            </Select>
                                            <Button
                                                variant="white"
                                                onClick={() => window.open(`/admin/vehicles/new?customerId=${selectedCustomer.id}`, '_blank')}
                                                className="whitespace-nowrap"
                                            >
                                                + Add vehicle
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Tax Treatment */}
                    <div className="bg-white p-4 rounded-control border border-gray-200">
                        <div className="flex items-center gap-4 flex-wrap">
                            <div>
                                <Select
                                    label="Tax Treatment"
                                    value={invoiceFormData.taxTreatment}
                                    onChange={(e) => handleFormChange('taxTreatment', e.target.value as InvoiceFormData['taxTreatment'])}
                                    disabled={!isEditable}
                                >
                                    <option value="STANDARD">Standard</option>
                                    <option value="ZERO_RATED">Zero-rated</option>
                                    <option value="EXEMPT">Exempt</option>
                                    <option value="REVERSE_CHARGE">Reverse charge</option>
                                    <option value="OUT_OF_SCOPE">Out of scope</option>
                                </Select>
                            </div>
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
                    <div className="bg-white rounded-control border border-gray-200 ">
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
                                    {invoiceFormData.items.map((item) => (
                                        <React.Fragment key={item.id || Math.random()}>
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
                                                lineFields={lineFields}
                                            />
                                            <tr className="bg-gray-50">
                                                <td colSpan={8 + lineFields.length} className="px-3 py-2 border-b border-gray-200">
                                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                                        <span className="text-gray-600 font-medium">Taxes:</span>
                                                        {((item as ProductItem).taxes ?? []).length === 0 && (
                                                            <span className="text-gray-400 italic">No taxes applied</span>
                                                        )}
                                                        {((item as ProductItem).taxes ?? []).map((t, idx) => (
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
                                                                    legacyLabel={((item as ProductItem).taxes ?? []).length > 0
                                                                        ? `Current: ${((item as ProductItem).taxes ?? []).map((t) => `${t.kind ?? t.name} ${t.percent}%`).join(' + ')}`
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
                                        <tr className="bg-white text-gray-950 ">
                                            <td className="p-3 font-medium text-center" colSpan={8 + lineFields.length}>
                                                No Items Selected
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            {/* Add New Product */}
                            <div className="p-4 flex">
                                <Button type='button' variant="ghost" size="sm" onClick={() => handleNewRow()} leftIcon={<PlusCircle className="h-4 w-4" />} className="text-purple-600">
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
                            >
                                <option value="Percentage">Percentage</option>
                                <option value="Fixed">Fixed</option>
                            </Select>
                            <FormField
                                label={`Discount Amount (${docCurrencySymbol})`}
                                id="edit-discount"
                                type="number"
                                min="0"
                                value={editingItem.discount_value}
                                onChange={(e) => handleEditingItemChange('discount_value', e.target.value)}
                            />

                            <div>
                                <label htmlFor="edit-tax-select" className="block text-sm font-medium text-heading mb-1">Tax</label>
                                <LineTaxSelect
                                    id="edit-tax-select"
                                    className={fieldControlClasses(false)}
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
                                        const resolved = await resolveLineTaxByRateId({ token: token!, taxableAmount, taxRateId: rateId, ...(selectedCustomer?.id ? { customerId: selectedCustomer.id } : {}) });
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
                                <p className="text-lg font-semibold text-gray-950 ">
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
                            <Button type='button' size="sm" variant={activeInfoTab === 'notes' ? 'primary' : 'white'} onClick={() => setActiveInfoTab('notes')}>Add Notes</Button>
                            <Button type='button' size="sm" variant={activeInfoTab === 'termsAndCondition' ? 'primary' : 'white'} onClick={() => setActiveInfoTab('termsAndCondition')}>Add Terms & Conditions</Button>
                            <Button type='button' size="sm" variant={activeInfoTab === 'bank' ? 'primary' : 'white'} onClick={() => setActiveInfoTab('bank')}>Bank Details</Button>
                        </div>

                        {activeInfoTab === 'notes' && (
                            <FormField label="Additional Notes">
                                {(field) => (
                                    <textarea id={field.id} value={invoiceFormData.notes} onChange={(e) => handleFormChange('notes', e.target.value)} rows={4} placeholder="Enter Notes" className={fieldControlClasses(false)}></textarea>
                                )}
                            </FormField>
                        )}
                        {activeInfoTab === 'termsAndCondition' && (
                            <FormField label="Terms & Conditions">
                                {(field) => (
                                    <textarea id={field.id} value={invoiceFormData.termsAndCondition} onChange={(e) => handleFormChange('termsAndCondition', e.target.value)} rows={4} placeholder="Enter Terms & Conditions" className={fieldControlClasses(false)}></textarea>
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
                                    selectedItem={bankAccounts.find(item => item.id === invoiceFormData.bank)}
                                    addNewLabel='New Bank Account'
                                    placeholder='Type to search Bank Account...'
                                    loading={bankAccountsLoading}
                                />
                            </div>
                        )}
                    </div>

                    {/* Right Side: Totals & Signature */}
                    <div className="bg-white p-4 rounded-control border border-gray-200 space-y-3">
                        <div className="flex justify-between text-sm text-gray-600 "><span>Amount</span><span>{fmtMoney(subTotal || 0)}</span></div>
                        {(() => {
                            const breakdown: Record<string, number> = {};
                            for (const line of invoiceFormData.items as ProductItem[]) {
                                for (const t of (line.taxes ?? [])) {
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
                        <div className="flex justify-between text-sm text-gray-600 "><span>Tax</span><span>{fmtMoney(totalTax || 0)}</span></div>
                        <div className="flex justify-between text-sm text-gray-600 "><span>Discount</span><span>- {fmtMoney(totalDiscount || 0)}</span></div>
                        <hr className="border-gray-200 " />
                        <div className="flex justify-between font-bold text-gray-950 "><span>Total</span><span>{fmtMoney(grandTotal || 0)}</span></div>
                        <p className="text-sm text-gray-500 capitalize">{totalInWords}</p>

                        <div className="flex items-center gap-4 pt-4">
                            <div className="flex items-center"><input id="no-sig" type="radio" name="signature" checked={invoiceFormData.sign_type === 'none'} onChange={() => handleFormChange('sign_type', 'none')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="no-sig" className="ml-2 block text-sm text-gray-700 cursor-pointer">No Signature</label></div>
                            <div className="flex items-center"><input id="manual-sig" type="radio" name="signature" checked={invoiceFormData.sign_type === 'digitalSignature'} onChange={() => handleFormChange('sign_type', 'digitalSignature')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="manual-sig" className="ml-2 block text-sm text-gray-700 cursor-pointer">Manual Signature</label></div>
                            <div className="flex items-center"><input id="e-sig" type="radio" name="signature" checked={invoiceFormData.sign_type === 'eSignature'} onChange={() => handleFormChange('sign_type', 'eSignature')} className="h-4 w-4 text-purple-600 cursor-pointer" /><label htmlFor="e-sig" className="ml-2 block text-sm text-gray-700 cursor-pointer">eSignature</label></div>
                        </div>

                        {invoiceFormData.sign_type !== 'none' && (invoiceFormData.sign_type === 'digitalSignature' ? (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Select Signature Name <span className="text-danger">*</span></label>
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
                                <p className="mt-2 text-sm font-medium text-gray-700 ">Signature Image</p>
                                <div className="mt-2 h-20 w-48 bg-gray-100 rounded-control flex items-center justify-center">
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
                                    value={invoiceFormData.signatureName}
                                    onChange={e => handleFormChange('signatureName', e.target.value)}
                                    placeholder="Enter Signature Name"
                                    error={formErrors?.signatureName}
                                />
                                <p className="mt-2 text-sm font-medium text-gray-700 ">Draw your eSignature</p>
                                <div className="mt-2 h-20 w-48 bg-gray-100 rounded-control flex items-center justify-center cursor-pointer border-2 border-dashed border-gray-400" onClick={() => setSignatureModalOpen(true)}>
                                    {invoiceFormData.esignDataUrl ? <img src={invoiceFormData.esignDataUrl} alt="Drawn Signature" className="max-h-full max-w-full" /> : <div className="text-center text-gray-500"><Edit size={20} className="mx-auto mb-1" /><span className="text-xs">Draw Signature</span></div>}
                                </div>
                                {formErrors?.esignDataUrl && <p className="text-danger text-xs mt-1">{formErrors.esignDataUrl}</p>}
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex justify-end mt-4 gap-3">
                    <Button variant="white" onClick={() => { if (confirmIfDirty(isDirtyRef.current)) navigate('/admin/invoices'); }}>{isEditable ? 'Cancel' : 'Back'}</Button>
                    {isEditable && (
                        <SubmitButton isDisabled={isSubmitting || !!invoiceData?.convertedAt} isLoading={isSubmitting} mode='edit' />
                    )}
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

            {/* Modals */}
            <CreateProductForm
                isOpen={isProductModalOpen}
                onClose={() => setIsProductModalOpen(false)}
                onSuccess={(newProduct: Product) => handleNewProductCreated(newProduct)}
            />

            <CreateCustomerForm
                isOpen={isCustomerModalOpen}
                onClose={() => setIsCustomerModalOpen(false)}
                onSuccess={(newCustomer: Customer) => {
                    setCustomers(prevCustomers => [newCustomer, ...prevCustomers]);
                    setIsCustomerModalOpen(false);
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
            {isFetching && <FullPageLoader />}

            {whatsappModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-control shadow-dropdown max-w-lg w-full p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-lg font-semibold">Send via WhatsApp</h2>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setWhatsappModal(null)}
                                className="text-gray-500 hover:text-gray-700 text-xl leading-none"
                                aria-label="Close"
                            >
                                ×
                            </Button>
                        </div>
                        <div className="space-y-3 text-sm">
                            <div>
                                <div className="text-xs text-gray-500">Phone</div>
                                <code className="text-xs bg-gray-100 px-2 py-1 rounded block">{whatsappModal.phone}</code>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500">Message</div>
                                <pre className="text-xs bg-gray-100 px-2 py-2 rounded whitespace-pre-wrap">{whatsappModal.message}</pre>
                            </div>
                            {whatsappModal.publicLink && (
                                <div>
                                    <div className="text-xs text-gray-500">Public link</div>
                                    <code className="text-xs bg-gray-100 px-2 py-1 rounded break-all block">{whatsappModal.publicLink}</code>
                                </div>
                            )}
                            <div className="flex justify-end gap-2 pt-2">
                                <Button
                                    variant="white"
                                    size="sm"
                                    onClick={() => setWhatsappModal(null)}
                                >
                                    Close
                                </Button>
                                <a
                                    href={whatsappModal.waMeUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-3 py-1 bg-success text-white text-sm rounded-control"
                                >
                                    Open in WhatsApp
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EditInvoice;