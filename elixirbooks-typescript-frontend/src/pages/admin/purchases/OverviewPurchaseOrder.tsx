import { numberToWords } from '@utils/converters';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import { useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from '@constants/api';
import axios from 'axios';
import { Edit, RefreshCcwIcon } from 'lucide-react';
import { toast } from 'sonner';
import useDateFormatter from '@hooks/useDateFormatter';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { useCurrencies } from '@hooks/useCurrencies';
import { useReactToPrint } from 'react-to-print';
import DeleteConfirmationModal from '@components/admin/DeleteConfirmationModal';
import PrintMenu from '@components/print/PrintMenu';
import { PageHeader } from '@/context/PageHeaderContext';
import { resolveCompanyLogo } from '@utils/companyLogo';
import { companyTaxId } from '@utils/companyTaxId';
import { Button } from '@components/ui';
import { useLineItemCustomFields } from '@hooks/useLineItemCustomFields';
import { collectLineCustomColumns, formatLineFieldValue } from '@lib/lineCustomFields';

// The PO detail endpoint (GET /admin/purchase-orders/:id) returns amounts as
// Decimal strings; always Number()-coerce before formatMoney (which calls
// .toFixed) or the page crashes.
interface PurchaseOrderItem {
    id: string;
    name: string;
    unit?: string;
    qty: number;
    rate: number | string;
    discount: number | string;
    amount: number | string;
    taxes?: Array<{ kind: string | null; percent: number; name: string; amount: number | string }>;
    customFields?: Record<string, unknown>;
}

interface PartyShape {
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
    address?: string | null;
    profileImage?: string;
}

interface PurchaseOrderShape {
    id: string;
    purchaseOrderId: string;
    purchaseOrderDate?: string;
    status?: string;
    currencyCode?: string | null;
    taxableAmount: number | string;
    totalDiscount: number | string;
    vat: number | string;
    TotalAmount: number | string;
    items: PurchaseOrderItem[];
    billFrom?: PartyShape;
    billTo?: PartyShape;
    termsAndCondition?: string | null;
    sign_type?: string;
    signature?: { name?: string; image?: string };
    bank?: {
        name?: string;
        accountNumber?: string;
        accountHolderName?: string;
        ifscCode?: string;
        branchName?: string;
    };
    createdAt?: string;
}

const num = (v: number | string | null | undefined): number => Number(v ?? 0) || 0;

const OverviewPurchaseOrder: React.FC = () => {
    const { id: purchaseOrderId } = useParams();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const taxId = companyTaxId(systemSettings?.company);
    const [poData, setPoData] = useState<PurchaseOrderShape>();
    const { fields: lineFields } = useLineItemCustomFields(token, 'purchase-orders');
    const { formatDate } = useDateFormatter();
    const { formatMoney } = useCurrencies();
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();
    const componentRef = useRef<HTMLDivElement>(null);

    const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
    const [isConverting, setIsConverting] = useState(false);

    const fetchPurchaseOrder = useCallback(async (id: string) => {
        try {
            setIsLoading(true);
            const response = await axios.get(`${Constants.FETCH_PURCHASE_ORDER_URL}/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setPoData(response.data.data);
        } catch (error) {
            console.error('Error fetching purchase order:', error);
        } finally {
            setIsLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (purchaseOrderId) {
            fetchPurchaseOrder(purchaseOrderId);
        }
    }, [purchaseOrderId, fetchPurchaseOrder]);

    const poTitle = poData?.purchaseOrderId
        ? `Purchase-Order-${poData.purchaseOrderId}`
        : 'Purchase Order';

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: poTitle,
        pageStyle: `
            @page {
            size: auto;
            margin: 5mm 5mm 2mm 2mm;
            }
            @page:first {
              margin: 12mm;
            }

            .page-break {
            page-break-before: always;
            }
        `,
    });

    // Convert-once guard: a converted PO is moved to `completed` server-side;
    // a `cancelled` PO can never be converted either.
    const isConverted = poData?.status === 'completed';
    const canConvert = !isConverted && poData?.status !== 'cancelled';

    const handleConvertToPurchase = async () => {
        if (!purchaseOrderId) return;
        try {
            setIsConverting(true);
            const response = await axios.post(
                Constants.CONVERT_PO_TO_PURCHASE_URL,
                { purchaseOrderId },
                { headers: { 'Authorization': `Bearer ${token}` } },
            );
            toast.success('Purchase order converted to purchase successfully.');
            setIsConvertModalOpen(false);
            const newPurchaseId = response.data?.data?.id;
            if (newPurchaseId) {
                navigate(`/admin/purchases/view/${newPurchaseId}`);
            } else {
                navigate('/admin/purchases');
            }
        } catch (error) {
            toast.error('Failed to convert purchase order to purchase.');
        } finally {
            setIsConverting(false);
        }
    };

    if (isLoading || !poData) {
        return (
            <div className='flex items-center justify-center'>
                <div className='space-y-4'>
                    <LoaderSpinner />
                </div>
            </div>
        );
    }

    const customColumns = collectLineCustomColumns(poData.items, lineFields);

    return (
        <>
            <PageHeader
                title={
                    poData?.purchaseOrderId
                        ? `Purchase Order ${poData.purchaseOrderId}`
                        : 'Purchase Order'
                }
            >
                <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    leftIcon={<Edit size={14} />}
                    onClick={() => navigate(`/admin/purchase-orders/edit/${purchaseOrderId}`)}
                >
                    Edit
                </Button>
                {canConvert && (
                    <Button
                        type="button"
                        variant="success"
                        size="sm"
                        leftIcon={<RefreshCcwIcon size={14} />}
                        onClick={() => setIsConvertModalOpen(true)}
                    >
                        Convert to Purchase
                    </Button>
                )}
                <PrintMenu
                    normalPrint={handlePrint}
                    docType="PURCHASE_ORDER"
                    data={poData}
                    systemSettings={systemSettings}
                    documentTitle={poTitle}
                    normalLabel="Normal (A4)"
                />
                <Button
                    type="button"
                    variant="white"
                    size="sm"
                    onClick={() => navigate('/admin/purchase-orders')}
                >
                    Back
                </Button>
            </PageHeader>

            <div className='space-y-2' ref={componentRef}>

                {/* Header Section */}
                <header className="pb-2 border-b border-gray-200">
                    <div className="flex justify-between items-center">
                        <img
                            src={resolveCompanyLogo(systemSettings?.company?.siteLogo)}
                            alt="Company Logo"
                            className="w-32 h-auto"
                        />
                        <h1 className="text-xl font-bold text-gray-950">PURCHASE ORDER</h1>
                    </div>

                    <div className="flex justify-between items-center mt-2 text-sm text-gray-600">
                        <p className="text-xs">Original For Recipient</p>
                        <div className="flex items-center gap-4">
                            <p>Date: {formatDate(poData.purchaseOrderDate || poData.createdAt, systemSettings?.dateFormat.format || 'd-m-Y')}</p>
                            <p>Order No: {poData?.purchaseOrderId}</p>
                        </div>
                    </div>
                </header>

                {/* Billing Information Section */}
                <section className="flex justify-between mt-2">
                    <div className="w-2/5">
                        <h2 className="font-bold text-violet-600 mb-2">Bill From :</h2>
                        <p className="font-semibold text-gray-950">{systemSettings?.company.companyName}</p>
                        <p className="text-sm text-gray-600">{systemSettings?.company.address}</p>
                        <p className="text-sm text-gray-600">{systemSettings?.company.phone}</p>
                        <p className="text-sm text-gray-600">{systemSettings?.company.pincode}</p>
                        {taxId && <p className="text-sm text-gray-600">{taxId.label}: {taxId.value}</p>}
                    </div>
                    <div className="w-2/5">
                        <h2 className="font-bold text-violet-600 mb-2">Supplier :</h2>
                        <p className="font-semibold text-gray-950">{poData?.billTo?.name ?? '—'}</p>
                        <p className="text-sm text-gray-600">{poData?.billTo?.address ?? ''}</p>
                        <p className="text-sm text-gray-600">{poData?.billTo?.email}</p>
                        <p className="text-sm text-gray-600">{poData?.billTo?.phone ?? ''}</p>
                    </div>
                    <div className="text-right">
                        <h2 className="font-bold text-violet-600 mb-2">{systemSettings?.company.companyName}</h2>
                        <p className="text-sm text-gray-600">Address: {systemSettings?.company.address}</p>
                        <p className="text-sm text-gray-600">Mobile: {systemSettings?.company.phone}</p>
                    </div>
                </section>

                {/* Items Table */}
                <section className="mt-4">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50">
                            <tr className="border-b border-gray-200">
                                <th className="p-3 text-sm font-semibold text-gray-600">#</th>
                                <th className="p-3 text-sm font-semibold text-gray-600">Item</th>
                                {customColumns.map((c) => (
                                    <th key={c.slug} className="p-3 text-sm font-semibold text-gray-600">{c.label}</th>
                                ))}
                                <th className="p-3 text-sm font-semibold text-gray-600 text-right">Qty</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 text-right">Price</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 text-right">Discount</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {poData.items.map((item, index) => (
                                <tr key={item.id} className="border-b border-gray-200 text-gray-600">
                                    <td className="p-3">{index + 1}</td>
                                    <td className="p-3 font-medium">{item.name}</td>
                                    {customColumns.map((c) => (
                                        <td key={c.slug} className="p-3">
                                            {formatLineFieldValue((item.customFields ?? {})[c.slug], c.field)}
                                        </td>
                                    ))}
                                    <td className="p-3 text-right">{item.qty}</td>
                                    <td className="p-3 text-right">{formatMoney(num(item.rate), poData?.currencyCode)}</td>
                                    <td className="p-3 text-right">{formatMoney(num(item.discount), poData?.currencyCode)}</td>
                                    <td className="p-3 text-right font-medium">{formatMoney(num(item.amount), poData?.currencyCode)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>

                {/* Totals Section */}
                <section className="flex justify-end mt-2">
                    <div className="w-full max-w-xs">
                        <div className="flex justify-between text-sm text-gray-600 py-2">
                            <span className='font-bold'>Sub Total</span>
                            <span className='font-semibold'>{formatMoney(num(poData?.taxableAmount), poData?.currencyCode)}</span>
                        </div>
                        {(() => {
                            const breakdown: Record<string, number> = {};
                            for (const line of poData?.items ?? []) {
                                const taxes = Array.isArray(line.taxes) ? line.taxes : [];
                                for (const t of taxes) {
                                    const key = t.kind ? `${t.kind} ${t.percent}%` : t.name;
                                    breakdown[key] = (breakdown[key] ?? 0) + num(t.amount);
                                }
                            }
                            const entries = Object.entries(breakdown);
                            if (entries.length === 0) {
                                return (
                                    <div className="flex justify-between text-sm text-gray-600 py-2">
                                        <span className='font-bold'>Tax</span>
                                        <span className='font-semibold'>{formatMoney(num(poData.vat), poData?.currencyCode)}</span>
                                    </div>
                                );
                            }
                            return entries.map(([label, amount]) => (
                                <div key={label} className="flex justify-between text-sm text-gray-600 py-2">
                                    <span className='font-bold'>{label}</span>
                                    <span className='font-semibold'>{formatMoney(num(amount), poData?.currencyCode)}</span>
                                </div>
                            ));
                        })()}
                        <div className="flex justify-between text-sm text-gray-600 py-2">
                            <span className='font-bold'>Discount</span>
                            <span className='font-semibold'>{formatMoney(num(poData?.totalDiscount), poData?.currencyCode)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-lg py-3 text-gray-950">
                            <span className='font-bold'>Total</span>
                            <span className='font-semibold'>{formatMoney(num(poData.TotalAmount), poData?.currencyCode)}</span>
                        </div>
                    </div>
                </section>

                {/* Amount in words and Summary */}
                <section className="mt-2 pt-2 border-t border-gray-200">
                    <p className="text-sm text-gray-600">Total Items / Qty : {poData?.items.length} / {poData?.items.reduce((sum, item) => sum + num(item.qty), 0)}</p>
                    <p className="text-sm mt-2 text-gray-600">
                        <span className="font-semibold">Total amount ( in words) : </span>
                        {numberToWords(num(poData?.TotalAmount))}
                    </p>
                </section>

                {/* Footer: Bank Details & Signature */}
                <footer className="mt-2 pt-2 flex justify-between border-t border-gray-200">
                    <div>
                        <h3 className="font-semibold mb-2 text-gray-950">Bank Details</h3>
                        <p className="text-sm text-gray-600">Bank : {poData?.bank?.name}</p>
                        <p className="text-sm text-gray-600">Account # : {poData?.bank?.accountNumber}</p>
                        <p className="text-sm text-gray-600">IFSC : {poData?.bank?.ifscCode}</p>
                        <p className="text-sm text-gray-600">BRANCH : {poData?.bank?.branchName}</p>
                    </div>
                    {poData?.signature?.image && (
                        <div className="text-center text-gray-950 font-semibold">
                            <p className="text-sm mb-4">For {systemSettings?.company?.companyName || 'Company'}</p>
                            <img src={poData.signature.image} alt="Signature" className="w-40 h-auto" />
                        </div>
                    )}
                </footer>

                {/* Terms and Conditions */}
                <section className="mt-2">
                    <h3 className="font-semibold mb-2">Terms & Conditions :</h3>
                    <ol className="list-decimal list-inside text-xs text-gray-600 space-y-1">
                        <li>{poData?.termsAndCondition}</li>
                    </ol>
                </section>

                <div className="mt-2 text-center text-sm text-gray-500">
                    <p>Thanks for your Business</p>
                </div>

            </div>

            {/* Convert to Purchase Confirmation */}
            <DeleteConfirmationModal
                isOpen={isConvertModalOpen}
                onClose={() => setIsConvertModalOpen(false)}
                onConfirm={handleConvertToPurchase}
                isDeleting={isConverting}
                title="Confirm Conversion"
                message={`Are you sure you want to convert the purchase order ${poData?.purchaseOrderId} to a purchase? This action cannot be undone.`}
            />
        </>
    );
};

export default OverviewPurchaseOrder;
