import { numberToWords } from '@utils/converters';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import { useNavigate, useParams } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import Constants from '@constants/api';
import axios from 'axios';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { useCurrencies } from '@hooks/useCurrencies';
import useDateFormatter from '@hooks/useDateFormatter';
import { useReactToPrint } from 'react-to-print';
import PrintMenu from '@components/print/PrintMenu';
import { PageHeader } from '@/context/PageHeaderContext';
import { resolveCompanyLogo } from '@utils/companyLogo';
import { companyTaxId } from '@utils/companyTaxId';
import { Button } from '@components/ui';
import { useLineItemCustomFields } from '@hooks/useLineItemCustomFields';
import { collectLineCustomColumns, formatLineFieldValue } from '@lib/lineCustomFields';

interface DebitNoteVendor {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
}

interface DebitNotePurchase {
    id: string;
    purchaseId: string | null;
    purchaseDate: string | null;
    totalAmount: number;
}

interface DebitNoteBank {
    id: string;
    bankName: string | null;
    accountNumber: string | null;
    branch: string | null;
}

interface DebitNoteItem {
    product: { id: string; name: string | null } | null;
    quantity: number;
    rate: number;
    discount: number;
    tax: number;
    amount: number;
    reason: string | null;
    customFields?: Record<string, unknown>;
}

interface DebitNoteDetail {
    id: string;
    debitNoteId: string;
    referenceNo: string | null;
    vendor: DebitNoteVendor | null;
    purchase: DebitNotePurchase | null;
    debitNoteDate: string | null;
    dueDate: string | null;
    status: string | null;
    taxableAmount: number;
    totalDiscount: number;
    totalTax: number;
    totalAmount: number;
    paidAmount: number;
    balanceAmount: number;
    paymentMode: { id: string; name: string; slug: string } | null;
    bank: DebitNoteBank | null;
    notes: string | null;
    termsAndCondition: string | null;
    signatureImage: string | null;
    signatureName: string | null;
    currencyCode: string | null;
    items: DebitNoteItem[];
}

const OverviewDebitNote: React.FC = () => {
    const { id } = useParams();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const taxId = companyTaxId(systemSettings?.company);
    const [debitNote, setDebitNote] = useState<DebitNoteDetail | null>(null);
    const [notFound, setNotFound] = useState(false);
    const { fields: lineFields } = useLineItemCustomFields(token, 'purchases');
    const { resolveCurrency, defaultCurrencyCode } = useCurrencies();
    const { formatDate } = useDateFormatter();
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();
    const componentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (id) {
            fetchDebitNote(id);
        }
    }, [id]);

    const fetchDebitNote = async (debitNoteId: string) => {
        try {
            setIsLoading(true);
            setNotFound(false);
            const response = await axios.get(`${Constants.GET_DEBIT_NOTE_DETAILS_URL}/${debitNoteId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setDebitNote(response.data.data);
        } catch (error) {
            setNotFound(true);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: "Debit Note",
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

    if (isLoading) {
        return (
            <div className='flex items-center justify-center'>
                <div className='space-y-4'>
                    <LoaderSpinner />
                </div>
            </div>
        );
    }

    if (notFound || !debitNote) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
                <p className="text-gray-950 font-semibold">Debit note not found</p>
                <Button
                    type="button"
                    variant="white"
                    size="sm"
                    onClick={() => navigate("/admin/debit-notes")}
                >
                    Back
                </Button>
            </div>
        );
    }

    // Currency symbol resolved from the debit note's currencyCode (falls back to company default).
    const currencyCode = debitNote.currencyCode || defaultCurrencyCode;
    const { symbol } = resolveCurrency(currencyCode);
    // Amounts can arrive as Decimal strings from the API — coerce before toFixed.
    const money = (amount: number | string | null | undefined) => `${symbol}${(Number(amount) || 0).toFixed(2)}`;
    const customColumns = collectLineCustomColumns(debitNote.items, lineFields);

    return (
        <>
            <PageHeader
                title={
                    debitNote?.debitNoteId
                        ? `Debit Note ${debitNote.debitNoteId}`
                        : "Debit Note"
                }
            >
                <PrintMenu
                    normalPrint={handlePrint}
                    docType="DEBIT_NOTE"
                    data={debitNote}
                    systemSettings={systemSettings}
                    documentTitle={`DebitNote-${debitNote.debitNoteId}`}
                    normalLabel="Normal (A4)"
                />
                {/* Back Button */}
                <Button
                    type="button"
                    variant="white"
                    size="sm"
                    onClick={() => navigate("/admin/debit-notes")}
                >
                    Back
                </Button>
            </PageHeader>

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
                        <h1 className="text-xl font-bold text-gray-950">DEBIT NOTE</h1>
                    </div>

                    {/* Row 2: Date / Number / Status */}
                    <div className="flex justify-between items-center mt-2 text-sm text-gray-600">
                        <p className="text-xs">Original For Recipient</p>
                        <div className="flex items-center gap-4">
                            <p>Date: {formatDate(debitNote.debitNoteDate)}</p>
                            <p>Debit Note No: {debitNote.debitNoteId}</p>
                            {debitNote.status && (
                                <p className="capitalize">Status: {debitNote.status}</p>
                            )}
                        </div>
                    </div>
                    {debitNote.purchase?.purchaseId && (
                        <div className="flex justify-end mt-1 text-sm text-gray-600">
                            <p>Against Purchase: {debitNote.purchase.purchaseId}</p>
                        </div>
                    )}
                </header>

                {/* Billing Information Section */}
                <section className="flex justify-between mt-2">
                    <div className="w-2/5">
                        <h2 className="font-bold text-violet-600 mb-2">From :</h2>
                        <p className="font-semibold text-gray-950">{systemSettings?.company.companyName}</p>
                        <p className="text-sm text-gray-600">{systemSettings?.company.address}</p>
                        <p className="text-sm text-gray-600">{systemSettings?.company.phone}</p>
                        <p className="text-sm text-gray-600">{systemSettings?.company.pincode}</p>
                        {taxId && <p className="text-sm text-gray-600">{taxId.label}: {taxId.value}</p>}
                    </div>
                    <div className="w-2/5">
                        <h2 className="font-bold text-violet-600 mb-2">Vendor :</h2>
                        <p className="font-semibold text-gray-950">{debitNote.vendor?.name}</p>
                        <p className="text-sm text-gray-600">{debitNote.vendor?.address}</p>
                        <p className="text-sm text-gray-600">{debitNote.vendor?.email}</p>
                        <p className="text-sm text-gray-600">{debitNote.vendor?.phone}</p>
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
                                <th className="p-3 text-sm font-semibold text-gray-600 text-right">Rate</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 text-right">Discount</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 text-right">Tax</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {debitNote.items.map((item, index) => (
                                <tr key={item.product?.id ?? index} className="border-b border-gray-200 text-gray-600">
                                    <td className="p-3">{index + 1}</td>
                                    <td className="p-3 font-medium">{item.product?.name ?? '-'}</td>
                                    {customColumns.map((c) => (
                                        <td key={c.slug} className="p-3">
                                            {formatLineFieldValue((item.customFields ?? {})[c.slug], c.field)}
                                        </td>
                                    ))}
                                    <td className="p-3 text-right">{item.quantity}</td>
                                    <td className="p-3 text-right">{money(item.rate)}</td>
                                    <td className="p-3 text-right">{money(item.discount)}</td>
                                    <td className="p-3 text-right">{money(item.tax)}</td>
                                    <td className="p-3 text-right font-medium">{money(item.amount)}</td>
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
                            <span className='font-semibold'>{money(debitNote.taxableAmount)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-gray-600 py-2">
                            <span className='font-bold'>Tax</span>
                            <span className='font-semibold'>{money(debitNote.totalTax)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-gray-600 py-2">
                            <span className='font-bold'>Discount</span>
                            <span className='font-semibold'>{money(debitNote.totalDiscount)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-lg py-3 text-gray-950">
                            <span className='font-bold'>Total</span>
                            <span className='font-semibold'>{money(debitNote.totalAmount)}</span>
                        </div>
                    </div>
                </section>

                {/* Amount in words and Summary */}
                <section className="mt-2 pt-2 border-t border-gray-200">
                    <p className="text-sm text-gray-600">Total Items / Qty : {debitNote.items.length} / {debitNote.items.reduce((sum, item) => sum + item.quantity, 0)}</p>
                    <p className="text-sm mt-2 text-gray-600">
                        <span className="font-semibold">Total amount ( in words) : </span>
                        {numberToWords(debitNote.totalAmount || 0)}
                    </p>
                </section>

                {/* Footer: Bank Details & Signature */}
                <footer className="mt-2 pt-2 flex justify-between border-t border-gray-200">
                    <div>
                        <h3 className="font-semibold mb-2 text-gray-950">Bank Details</h3>
                        <p className="text-sm text-gray-600">Bank : {debitNote.bank?.bankName}</p>
                        <p className="text-sm text-gray-600">Account # : {debitNote.bank?.accountNumber}</p>
                        <p className="text-sm text-gray-600">BRANCH : {debitNote.bank?.branch}</p>
                    </div>
                    {debitNote.signatureImage && (
                        <div className="text-center text-gray-950 font-semibold">
                            <p className="text-sm mb-4">For {systemSettings?.company?.companyName || 'Company'}</p>
                            <img src={debitNote.signatureImage} alt="Signature" className="w-40 h-auto" />
                            {debitNote.signatureName && (
                                <p className="text-sm mt-1">{debitNote.signatureName}</p>
                            )}
                        </div>
                    )}
                </footer>

                {/* Terms and Conditions */}
                {debitNote.termsAndCondition && (
                    <section className="mt-2">
                        <h3 className="font-semibold mb-2">Terms & Conditions :</h3>
                        <ol className="list-decimal list-inside text-xs text-gray-600 space-y-1">
                            <li>{debitNote.termsAndCondition}</li>
                        </ol>
                    </section>
                )}

                {/* Notes */}
                {debitNote.notes && (
                    <section className="mt-2">
                        <h3 className="font-semibold mb-2">Notes :</h3>
                        <p className="text-xs text-gray-600">{debitNote.notes}</p>
                    </section>
                )}

                <div className="mt-2 text-center text-sm text-gray-500">
                    <p>Thanks for your Business</p>
                </div>

            </div>
        </>
    );
};

export default OverviewDebitNote;
