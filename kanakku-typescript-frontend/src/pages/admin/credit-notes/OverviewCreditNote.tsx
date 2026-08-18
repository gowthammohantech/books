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
import { useLineItemCustomFields } from '@hooks/useLineItemCustomFields';
import { collectLineCustomColumns, formatLineFieldValue } from '@lib/lineCustomFields';

interface CreditNoteParty {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
}

interface CreditNoteInvoice {
    id: string;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    totalAmount: number;
}

interface CreditNoteBank {
    id: string;
    bankName: string | null;
    accountNumber: string | null;
    branch: string | null;
}

interface CreditNoteItem {
    id?: string;
    name: string | null;
    quantity?: number;
    qty?: number;
    rate: number;
    discount: number;
    tax: number;
    amount: number;
    customFields?: Record<string, unknown>;
}

interface CreditNoteDetail {
    id: string;
    creditNoteNumber: string | null;
    referenceNo: string | null;
    billFrom: CreditNoteParty | null;
    billTo: CreditNoteParty | null;
    invoice: CreditNoteInvoice | null;
    creditNoteDate: string | null;
    dueDate: string | null;
    status: string | null;
    taxableAmount: number;
    totalDiscount: number;
    vat: number;
    totalAmount: number;
    paidAmount: number;
    balanceAmount: number;
    paymentMode: { id: string; name: string; slug: string } | null;
    bank: CreditNoteBank | null;
    notes: string | null;
    termsAndCondition: string | null;
    signature: { id: string; name: string | null; image: string | null } | null;
    currencyCode: string | null;
    items: CreditNoteItem[];
}

const OverviewCreditNote: React.FC = () => {
    const { id } = useParams();
    const { token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const [creditNote, setCreditNote] = useState<CreditNoteDetail | null>(null);
    const [notFound, setNotFound] = useState(false);
    const { fields: lineFields } = useLineItemCustomFields(token, 'invoices');
    const { resolveCurrency, defaultCurrencyCode } = useCurrencies();
    const { formatDate } = useDateFormatter();
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();
    const componentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (id) {
            fetchCreditNote(id);
        }
    }, [id]);

    const fetchCreditNote = async (creditNoteId: string) => {
        try {
            setIsLoading(true);
            setNotFound(false);
            const response = await axios.get(`${Constants.FETCH_CREDIT_NOTE_FOR_EDIT_URL}/${creditNoteId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setCreditNote(response.data.data);
        } catch (error) {
            setNotFound(true);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: "Credit Note",
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

    if (notFound || !creditNote) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
                <p className="text-gray-950 font-semibold">Credit note not found</p>
                <button
                    onClick={() => navigate("/admin/credit-notes")}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-950 px-3 py-1 rounded-md shadow cursor-pointer"
                >  Back
                </button>
            </div>
        );
    }

    // Currency symbol resolved from the credit note's currencyCode (falls back to company default).
    const currencyCode = creditNote.currencyCode || defaultCurrencyCode;
    const { symbol } = resolveCurrency(currencyCode);
    // Amounts can arrive as Decimal strings from the API — coerce before toFixed.
    const money = (amount: number | string | null | undefined) => `${symbol}${(Number(amount) || 0).toFixed(2)}`;
    const itemQty = (item: CreditNoteItem) => Number(item.quantity ?? item.qty ?? 0);
    const customColumns = collectLineCustomColumns(creditNote.items, lineFields);

    return (
        <>
            <PageHeader
                title={
                    creditNote?.creditNoteNumber
                        ? `Credit Note ${creditNote.creditNoteNumber}`
                        : "Credit Note"
                }
            >
                <PrintMenu
                    normalPrint={handlePrint}
                    docType="CREDIT_NOTE"
                    data={creditNote}
                    systemSettings={systemSettings}
                    documentTitle={`CreditNote-${creditNote.creditNoteNumber}`}
                    normalLabel="Normal (A4)"
                />
                {/* Back Button */}
                <button
                    onClick={() => navigate("/admin/credit-notes")}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-950 px-2 py-1 rounded-md shadow cursor-pointer flex items-center gap-2"
                >  Back
                </button>
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
                        <h1 className="text-xl font-bold text-gray-950">CREDIT NOTE</h1>
                    </div>

                    {/* Row 2: Date / Number / Status */}
                    <div className="flex justify-between items-center mt-2 text-sm text-gray-600">
                        <p className="text-xs">Original For Recipient</p>
                        <div className="flex items-center gap-4">
                            <p>Date: {formatDate(creditNote.creditNoteDate)}</p>
                            <p>Credit Note No: {creditNote.creditNoteNumber}</p>
                            {creditNote.status && (
                                <p className="capitalize">Status: {creditNote.status}</p>
                            )}
                        </div>
                    </div>
                    {creditNote.invoice?.invoiceNumber && (
                        <div className="flex justify-end mt-1 text-sm text-gray-600">
                            <p>Against Invoice: {creditNote.invoice.invoiceNumber}</p>
                        </div>
                    )}
                </header>

                {/* Billing Information Section */}
                <section className="flex justify-between mt-2">
                    <div className="w-2/5">
                        <h2 className="font-bold text-violet-600 mb-2">From :</h2>
                        <p className="font-semibold text-gray-950">{creditNote.billFrom?.name || systemSettings?.company.companyName}</p>
                        <p className="text-sm text-gray-600">{creditNote.billFrom?.address || systemSettings?.company.address}</p>
                        <p className="text-sm text-gray-600">{creditNote.billFrom?.phone || systemSettings?.company.phone}</p>
                        <p className="text-sm text-gray-600">{creditNote.billFrom?.email}</p>
                    </div>
                    <div className="w-2/5">
                        <h2 className="font-bold text-violet-600 mb-2">Customer :</h2>
                        <p className="font-semibold text-gray-950">{creditNote.billTo?.name}</p>
                        <p className="text-sm text-gray-600">{creditNote.billTo?.address}</p>
                        <p className="text-sm text-gray-600">{creditNote.billTo?.email}</p>
                        <p className="text-sm text-gray-600">{creditNote.billTo?.phone}</p>
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
                            {creditNote.items.map((item, index) => (
                                <tr key={item.id ?? index} className="border-b border-gray-200 text-gray-600">
                                    <td className="p-3">{index + 1}</td>
                                    <td className="p-3 font-medium">{item.name ?? '-'}</td>
                                    {customColumns.map((c) => (
                                        <td key={c.slug} className="p-3">
                                            {formatLineFieldValue((item.customFields ?? {})[c.slug], c.field)}
                                        </td>
                                    ))}
                                    <td className="p-3 text-right">{itemQty(item)}</td>
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
                            <span className='font-semibold'>{money(creditNote.taxableAmount)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-gray-600 py-2">
                            <span className='font-bold'>Tax</span>
                            <span className='font-semibold'>{money(creditNote.vat)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-gray-600 py-2">
                            <span className='font-bold'>Discount</span>
                            <span className='font-semibold'>{money(creditNote.totalDiscount)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-lg py-3 text-gray-950">
                            <span className='font-bold'>Total</span>
                            <span className='font-semibold'>{money(creditNote.totalAmount)}</span>
                        </div>
                    </div>
                </section>

                {/* Amount in words and Summary */}
                <section className="mt-2 pt-2 border-t border-gray-200">
                    <p className="text-sm text-gray-600">Total Items / Qty : {creditNote.items.length} / {creditNote.items.reduce((sum, item) => sum + itemQty(item), 0)}</p>
                    <p className="text-sm mt-2 text-gray-600">
                        <span className="font-semibold">Total amount ( in words) : </span>
                        {numberToWords(creditNote.totalAmount || 0)}
                    </p>
                </section>

                {/* Footer: Bank Details & Signature */}
                <footer className="mt-2 pt-2 flex justify-between border-t border-gray-200">
                    <div>
                        <h3 className="font-semibold mb-2 text-gray-950">Bank Details</h3>
                        <p className="text-sm text-gray-600">Bank : {creditNote.bank?.bankName}</p>
                        <p className="text-sm text-gray-600">Account # : {creditNote.bank?.accountNumber}</p>
                        <p className="text-sm text-gray-600">BRANCH : {creditNote.bank?.branch}</p>
                    </div>
                    {creditNote.signature?.image && (
                        <div className="text-center text-gray-950 font-semibold">
                            <p className="text-sm mb-4">For {systemSettings?.company?.companyName || 'Company'}</p>
                            <img src={creditNote.signature.image} alt="Signature" className="w-40 h-auto" />
                            {creditNote.signature.name && (
                                <p className="text-sm mt-1">{creditNote.signature.name}</p>
                            )}
                        </div>
                    )}
                </footer>

                {/* Terms and Conditions */}
                {creditNote.termsAndCondition && (
                    <section className="mt-2">
                        <h3 className="font-semibold mb-2">Terms & Conditions :</h3>
                        <ol className="list-decimal list-inside text-xs text-gray-600 space-y-1">
                            <li>{creditNote.termsAndCondition}</li>
                        </ol>
                    </section>
                )}

                {/* Notes */}
                {creditNote.notes && (
                    <section className="mt-2">
                        <h3 className="font-semibold mb-2">Notes :</h3>
                        <p className="text-xs text-gray-600">{creditNote.notes}</p>
                    </section>
                )}

                <div className="mt-2 text-center text-sm text-gray-500">
                    <p>Thanks for your Business</p>
                </div>

            </div>
        </>
    );
};

export default OverviewCreditNote;
