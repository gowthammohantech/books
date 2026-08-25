import styled from 'styled-components';
import { numberToWords, taxTreatmentLabel } from '@utils/converters';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import type { QuotationDetail } from '@models/quotation';
import { useCurrencies } from '@hooks/useCurrencies';
import useDateFormatter from '@hooks/useDateFormatter';
import { resolveCompanyLogo } from '@utils/companyLogo';
import { collectLineCustomColumns, formatLineFieldValue, type LineCustomField } from '@lib/lineCustomFields';

type InvoiceDetailsProps = {
    quotationDeta: QuotationDetail
    lineFields?: LineCustomField[]
}
const QuotationTemplate: React.FC<InvoiceDetailsProps> = ({ quotationDeta, lineFields }) => {
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { formatMoney } = useCurrencies();
    const fmt = (amount: number) => formatMoney(amount, quotationDeta?.currencyCode);
    const { formatDate } = useDateFormatter();
    const customColumns = collectLineCustomColumns(quotationDeta?.items, lineFields);
    const InvoiceWrapper = styled.div`
    p{
      font-size: 12px;
      font-weight: 500;
    }
  `;

    return (
        <InvoiceWrapper className="bg-white pl-12 pr-12 font-sans text-gray-950 max-w-5xl mx-auto my-8">

            {/* Header Section */}
            <header className="pb-2 border-b border-gray-200">
                {/* Row 1: Logo + Title */}
                <div className="flex justify-between items-center">
                    <img
                        src={resolveCompanyLogo(systemSettings?.company?.siteLogo)}
                        alt="Company Logo"
                        className="w-32 max-h-20 max-w-32 h-auto object-contain"
                    />
                    <h1 className="text-xl font-bold text-gray-950">QUOTATION</h1>
                </div>

                {/* Row 2: Original + Date/Invoice */}
                <div className="flex justify-between items-center mt-2 text-sm text-gray-600">
                    <p className="text-xs">Original For Recipient</p>
                    <div className="flex items-center gap-4">
                        <p>Date: {formatDate(quotationDeta.quotationDate)}</p>
                        <p>
                            Quotation No: {quotationDeta?.quotationId}
                        </p>
                    </div>
                </div>
            </header>


            {/* Billing Information Section */}
            <section className="flex justify-between mt-2">
                <div className="w-2/5">
                    <h2 className="font-bold text-purple-600 mb-2">Bill To :</h2>
                    <p className="font-semibold">{quotationDeta?.billTo?.name ?? '—'}</p>
                    <p className="text-sm text-gray-600">{quotationDeta?.billTo?.billingAddress?.addressLine1}</p>
                    <p className="text-sm text-gray-600">{quotationDeta?.billTo?.billingAddress?.city}, {quotationDeta?.billTo?.billingAddress?.state}, {quotationDeta?.billTo?.billingAddress?.country}</p>
                    <p className="text-sm text-gray-600">{quotationDeta?.billTo?.email}</p>
                    <p className="text-sm text-gray-600">{quotationDeta?.billTo?.phone ?? ''}</p>
                    {quotationDeta?.billTo?.vatRegNumber && <p className="text-sm text-gray-600">VAT Reg: {quotationDeta.billTo.vatRegNumber}</p>}
                    {quotationDeta?.billTo?.gstin && <p className="text-sm text-gray-600">GSTIN: {quotationDeta.billTo.gstin}</p>}
                </div>
                <div className="w-2/5">
                    <h2 className="font-bold text-purple-600 mb-2">Pay To :</h2>
                    <p className="font-semibold">{quotationDeta?.billFrom?.name ?? '—'}</p>
                    <p className="text-sm text-gray-600">{quotationDeta?.billFrom?.address}</p>
                    <p className="text-sm text-gray-600">{quotationDeta?.billFrom?.email}</p>
                    <p className="text-sm text-gray-600">{quotationDeta?.billFrom?.phone}</p>
                </div>
                <div className="text-right">
                    <h2 className="font-bold text-purple-600 mb-2">{systemSettings?.company.companyName}</h2>
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
                        {quotationDeta?.items?.map((item, index) => (
                            <tr key={item.id} className="border-b border-gray-200">
                                <td className="p-3">{index + 1}</td>
                                <td className="p-3 font-medium">{item.name}</td>
                                {customColumns.map((c) => (
                                    <td key={c.slug} className="p-3">
                                        {formatLineFieldValue((item.customFields ?? {})[c.slug], c.field)}
                                    </td>
                                ))}
                                <td className="p-3 text-right">{item.qty}</td>
                                <td className="p-3 text-right">{fmt(item.rate)}</td>
                                <td className="p-3 text-right">{fmt(item.discount)}</td>
                                <td className="p-3 text-right font-medium">{fmt(item.amount)}</td>
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
                        <span className='font-semibold'>{fmt(quotationDeta?.taxableAmount || 0)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600 py-2">
                        <span className='font-bold'>Tax</span>
                        <span className='font-semibold'>{fmt(quotationDeta?.vat || 0)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600 py-2">
                        <span className='font-bold'>Discount</span>
                        <span className='font-semibold'>{fmt(quotationDeta?.totalDiscount || 0)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-lg py-3">
                        <span className='font-bold'>Total</span>
                        <span className='font-semibold'>{fmt(quotationDeta?.TotalAmount || 0)}</span>
                    </div>
                </div>
            </section>

            {/* Tax Treatment Notice (non-STANDARD only) */}
            {taxTreatmentLabel(quotationDeta?.taxTreatment) && (
                <section className="mt-2 pt-2 border-t border-gray-200">
                    <p className="text-sm font-semibold text-warning">
                        {taxTreatmentLabel(quotationDeta?.taxTreatment)}
                    </p>
                </section>
            )}

            {/* Amount in words and Summary */}
            <section className="mt-2 pt-2 border-t border-gray-200">
                <p className="text-sm text-gray-600">Total Items / Qty : {quotationDeta?.items?.length} / {quotationDeta?.items?.reduce((sum, item) => sum + item.qty, 0)}</p>
                <p className="text-sm mt-2">
                    <span className="font-semibold">Total amount ( in words) : </span>
                    {numberToWords(quotationDeta?.TotalAmount || 0)}
                </p>
            </section>

            {/* Footer: Bank Details & Signature */}
            <footer className="mt-2 pt-2 flex justify-between border-t border-gray-200">
                <div>
                    <h3 className="font-semibold mb-2">Bank Details</h3>
                    <p className="text-sm text-gray-600">Bank : {quotationDeta?.bank?.bankName}</p>
                    <p className="text-sm text-gray-600">Account # : {quotationDeta?.bank?.accountNumber}</p>
                    <p className="text-sm text-gray-600">IFSC : {quotationDeta?.bank?.IFSCCode}</p>
                    <p className="text-sm text-gray-600">BRANCH : {quotationDeta?.bank?.branchName}</p>
                </div>
                {quotationDeta?.signature?.image && (
                    <div className="text-center">
                        <p className="text-sm mb-4">For {systemSettings?.company?.companyName || 'Company'}</p>
                        <img src={quotationDeta.signature.image} alt="Signature" className="w-40 h-auto" />
                    </div>
                )}
            </footer>

            {/* Terms and Conditions */}
            <section className="mt-2">
                <h3 className="font-semibold mb-2">Terms & Conditions :</h3>
                <ol className="list-decimal list-inside text-xs text-gray-600 space-y-1">
                    <li className="whitespace-pre-line">{quotationDeta?.termsAndCondition}</li>
                </ol>
            </section>

            <div className="mt-2Ema text-center text-sm text-gray-500">
                <p>Thanks for your Business</p>
            </div>

        </InvoiceWrapper>
    );
}

export default QuotationTemplate;