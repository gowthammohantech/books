import { numberToWords } from '@utils/converters';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import { useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from '@constants/api';
import axios from 'axios';
import type { PurchaseShape } from '@models/purchase';
import useDateFormatter from '@hooks/useDateFormatter';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { useCurrencies } from '@hooks/useCurrencies';
import { useReactToPrint } from 'react-to-print';
import { useSupplierPayments } from '@hooks/useSupplierPayments';
import { usePurchaseActivity } from '@hooks/usePurchaseActivity';
import PurchaseActionToolbar from '@components/admin/purchase/PurchaseActionToolbar';
import PurchasePaymentHistoryPanel from '@components/admin/purchase/PurchasePaymentHistoryPanel';
import PurchaseActivityTimeline from '@components/admin/purchase/PurchaseActivityTimeline';
import PrintMenu from '@components/print/PrintMenu';
import { PageHeader } from '@/context/PageHeaderContext';
import { resolveCompanyLogo } from '@utils/companyLogo';
import { companyTaxId } from '@utils/companyTaxId';
import { Button } from '@components/ui';
import { useLineItemCustomFields } from '@hooks/useLineItemCustomFields';
import { collectLineCustomColumns, formatLineFieldValue } from '@lib/lineCustomFields';

const OverviewPurchase: React.FC = () => {
    const { id: purchaseId } = useParams();
    const { token } = useSelector((state: RootState) => state.auth);
    const [purchaseData, setPurchaseData] = useState<PurchaseShape>();
    const { fields: lineFields } = useLineItemCustomFields(token, 'purchases');
    const { formatDate } = useDateFormatter();
    const { formatMoney } = useCurrencies();
    const [isLoading, setIsLoading] = useState(false);

    const fetchPurchase = useCallback(async (id: string) => {
        try {
            setIsLoading(true);
            const response = await axios.get(`${Constants.GET_PURCHASE_DETAILS_URL}/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setPurchaseData(response.data.data);
        } catch (error) {
            // intentional
        } finally {
            setIsLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (purchaseId) {
            fetchPurchase(purchaseId);
        }
    }, [purchaseId, fetchPurchase]);

    const { summary, refetch: refetchPayments } = useSupplierPayments(purchaseId ?? '');
    const { refetch: refetchActivity } = usePurchaseActivity(purchaseId ?? '');

    const handleChanged = useCallback(() => {
        if (purchaseId) fetchPurchase(purchaseId);
        refetchPayments();
        refetchActivity();
    }, [purchaseId, fetchPurchase, refetchPayments, refetchActivity]);

    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const taxId = companyTaxId(systemSettings?.company);
    const navigate = useNavigate();
    const componentRef = useRef<HTMLDivElement>(null);
    const purchaseTitle = purchaseData?.purchaseId
        ? `Purchase-${purchaseData.purchaseId}`
        : "Purchase";
    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: purchaseTitle,
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
    if (isLoading || !purchaseData) {
        return (
            <div className='flex items-center justify-center'>
                <div className='space-y-4'>
                    <LoaderSpinner />
                </div>
            </div>
        );
    }
    const customColumns = collectLineCustomColumns(purchaseData.items, lineFields);
    return (
        <>
            <PageHeader
                title={
                    purchaseData?.purchaseId
                        ? `Purchase ${purchaseData.purchaseId}`
                        : "Purchase"
                }
            >
                {/* Action Toolbar */}
                <PurchaseActionToolbar
                    purchaseId={purchaseId ?? ''}
                    purchaseNumber={purchaseData.purchaseId}
                    supplierId={purchaseData.billTo?.id}
                    supplierEmail={purchaseData.billTo?.email}
                    status={purchaseData.status ?? ''}
                    totalAmount={purchaseData.totalAmount}
                    totalPaid={summary.paid}
                    currencyCode={purchaseData.currencyCode}
                    onChanged={handleChanged}
                />
                <PrintMenu
                    normalPrint={handlePrint}
                    docType="PURCHASE"
                    data={purchaseData}
                    systemSettings={systemSettings}
                    documentTitle={purchaseTitle}
                    normalLabel="Normal (A4)"
                />
                <Button
                    type="button"
                    variant="white"
                    size="sm"
                    onClick={() => navigate("/admin/purchases")}
                >
                    Back
                </Button>
            </PageHeader>
            {/* Status badge + payment summary (page body, below the top bar) */}
            <PurchaseActionToolbar
                render="summary"
                purchaseId={purchaseId ?? ''}
                purchaseNumber={purchaseData.purchaseId}
                supplierId={purchaseData.billTo?.id}
                supplierEmail={purchaseData.billTo?.email}
                status={purchaseData.status ?? ''}
                totalAmount={purchaseData.totalAmount}
                totalPaid={summary.paid}
                currencyCode={purchaseData.currencyCode}
                onChanged={handleChanged}
            />

            <div className='space-y-2' ref={componentRef}>

                {/* Header Section */}
                <header className="pb-2 border-b border-gray-200">
                    {/* Row 1: Logo + Title */}
                    <div className="flex justify-between items-center">
                        <img
                            src={resolveCompanyLogo(systemSettings?.company?.siteLogo)}
                            alt="Company Logo"
                            className="w-32 h-auto"
                        />
                        <h1 className="text-xl font-bold text-gray-950">PURCHASE</h1>
                    </div>

                    {/* Row 2: Original + Date/Invoice */}
                    <div className="flex justify-between items-center mt-2 text-sm text-gray-600">
                        <p className="text-xs">Original For Recipient</p>
                        <div className="flex items-center gap-4">
                            <p>Date: {formatDate(purchaseData.createdAt, systemSettings?.dateFormat.format || 'd-m-Y')}</p>
                            <p>
                                Purchase No: {purchaseData?.purchaseId}
                            </p>
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
                        <h2 className="font-bold text-violet-600 mb-2">Bill To :</h2>
                        <p className="font-semibold text-gray-950">{purchaseData?.billTo?.name ?? '—'}</p>
                        <p className="text-sm text-gray-600">{purchaseData?.billTo?.address ?? ''}</p>
                        <p className="text-sm text-gray-600">{purchaseData?.billTo?.email}</p>
                        <p className="text-sm text-gray-600">{purchaseData?.billTo?.phone ?? ''}</p>
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
                            {purchaseData && purchaseData.items.map((item, index) => (
                                <tr key={item.id} className="border-b border-gray-200 text-gray-600">
                                    <td className="p-3">{index + 1}</td>
                                    <td className="p-3 font-medium">{item.name}</td>
                                    {customColumns.map((c) => (
                                        <td key={c.slug} className="p-3">
                                            {formatLineFieldValue((item.customFields ?? {})[c.slug], c.field)}
                                        </td>
                                    ))}
                                    <td className="p-3 text-right">{item.qty}</td>
                                    <td className="p-3 text-right">{formatMoney(item.rate, purchaseData?.currencyCode)}</td>
                                    <td className="p-3 text-right">{formatMoney(item.discount, purchaseData?.currencyCode)}</td>
                                    <td className="p-3 text-right font-medium">{formatMoney(item.amount, purchaseData?.currencyCode)}</td>
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
                            <span className='font-semibold'>{formatMoney(purchaseData?.taxableAmount || 0, purchaseData?.currencyCode)}</span>
                        </div>
                        {(() => {
                            type TaxLineRow = { kind: string | null; percent: number; name: string; amount: number };
                            const breakdown: Record<string, number> = {};
                            for (const line of purchaseData?.items ?? []) {
                                const rawTaxes = (line as unknown as { taxes?: unknown }).taxes;
                                const taxes: TaxLineRow[] = Array.isArray(rawTaxes)
                                    ? (rawTaxes as TaxLineRow[])
                                    : [];
                                for (const t of taxes) {
                                    const key = t.kind ? `${t.kind} ${t.percent}%` : t.name;
                                    breakdown[key] = (breakdown[key] ?? 0) + Number(t.amount ?? 0);
                                }
                            }
                            const entries = Object.entries(breakdown);
                            if (entries.length === 0) {
                                return (
                                    <div className="flex justify-between text-sm text-gray-600 py-2">
                                        <span className='font-bold'>Tax</span>
                                        <span className='font-semibold'>{formatMoney(purchaseData.totalTax || 0, purchaseData?.currencyCode)}</span>
                                    </div>
                                );
                            }
                            return entries.map(([label, amount]) => (
                                <div key={label} className="flex justify-between text-sm text-gray-600 py-2">
                                    <span className='font-bold'>{label}</span>
                                    <span className='font-semibold'>{formatMoney(amount, purchaseData?.currencyCode)}</span>
                                </div>
                            ));
                        })()}
                        <div className="flex justify-between text-sm text-gray-600 py-2">
                            <span className='font-bold'>Discount</span>
                            <span className='font-semibold'>{formatMoney(purchaseData?.totalDiscount || 0, purchaseData?.currencyCode)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-lg py-3 text-gray-950">
                            <span className='font-bold'>Total</span>
                            <span className='font-semibold'>{formatMoney(purchaseData.totalAmount || 0, purchaseData?.currencyCode)}</span>
                        </div>
                    </div>
                </section>

                {/* Amount in words and Summary */}
                <section className="mt-2 pt-2 border-t border-gray-200">
                    <p className="text-sm text-gray-600">Total Items / Qty : {purchaseData?.items.length} / {purchaseData?.items.reduce((sum, item) => sum + item.qty, 0)}</p>
                    <p className="text-sm mt-2 text-gray-600">
                        <span className="font-semibold">Total amount ( in words) : </span>
                        {numberToWords(purchaseData?.totalAmount || 0)}
                    </p>
                </section>

                {/* Footer: Bank Details & Signature */}
                <footer className="mt-2 pt-2 flex justify-between border-t border-gray-200">
                    <div>
                        <h3 className="font-semibold mb-2 text-gray-950">Bank Details</h3>
                        <p className="text-sm text-gray-600">Bank : {purchaseData?.bank?.name}</p>
                        <p className="text-sm text-gray-600">Account # : {purchaseData?.bank?.accountNumber}</p>
                        <p className="text-sm text-gray-600">IFSC : {purchaseData?.bank?.ifscCode}</p>
                        <p className="text-sm text-gray-600">BRANCH : {purchaseData?.bank?.branchName}</p>
                    </div>
                    {purchaseData?.signature?.image && (
                        <div className="text-center text-gray-950 font-semibold">
                            <p className="text-sm mb-4">For {systemSettings?.company?.companyName || 'Company'}</p>
                            <img src={purchaseData.signature.image} alt="Signature" className="w-40 h-auto" />
                        </div>
                    )}
                </footer>

                {/* Terms and Conditions */}
                <section className="mt-2">
                    <h3 className="font-semibold mb-2">Terms & Conditions :</h3>
                    <ol className="list-decimal list-inside text-xs text-gray-600 space-y-1">
                        <li>{purchaseData?.termsAndCondition}</li>
                    </ol>
                </section>

                <div className="mt-2 text-center text-sm text-gray-500">
                    <p>Thanks for your Business</p>
                </div>

            </div>

            {/* Payment History Panel */}
            <PurchasePaymentHistoryPanel
                purchaseId={purchaseId ?? ''}
                onChanged={handleChanged}
            />

            {/* Activity Timeline */}
            <PurchaseActivityTimeline purchaseId={purchaseId ?? ''} />
        </>
    );
}

export default OverviewPurchase;