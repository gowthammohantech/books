import styled from 'styled-components';
import { numberToWords, taxTreatmentLabel } from '@utils/converters';
import type { InvoiceData } from '@models/invoice';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import useDateFormatter from '@hooks/useDateFormatter';
import { useCurrencies } from '@hooks/useCurrencies';
import { QRCodeSVG } from 'qrcode.react';
import { upiDeepLink } from '@/lib/upiDeepLink';
import { resolveCompanyLogo } from '@utils/companyLogo';
import { companyTaxId } from '@utils/companyTaxId';
import { collectLineCustomColumns, formatLineFieldValue, type LineCustomField } from '@lib/lineCustomFields';

type InvoiceDetailsProps = {
    invoiceData: InvoiceData
    lineFields?: LineCustomField[]
}
const InvoiceTemplateA: React.FC<InvoiceDetailsProps> = ({ invoiceData, lineFields }) => {
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { formatDate } = useDateFormatter();
    const taxId = companyTaxId(systemSettings?.company);
    const { formatMoney } = useCurrencies();
    const fmt = (amount: number) => formatMoney(amount, invoiceData?.currencyCode);
    const customColumns = collectLineCustomColumns(invoiceData?.items, lineFields);
    const InvoiceWrapper = styled.div`
    p {
      font-size: 14px;
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
                    <h1 className="text-xl font-bold text-gray-950">TAX INVOICE</h1>
                </div>

                {/* Row 2: Original + Date/Invoice */}
                <div className="flex justify-between items-center mt-2 text-sm text-gray-600">
                    <p className="text-sm text-gray-600">Original For Recipient</p>
                    <div className="flex items-center gap-4">
                        <p>Date: {formatDate(invoiceData?.invoiceDate)}</p>
                        <p>
                            Invoice No: {invoiceData?.invoiceNumber}
                        </p>
                    </div>
                </div>
            </header>


            {/* Billing Information Section */}
            <section className="flex justify-between mt-2">
                <div className="w-2/5">
                    <h2 className="font-bold text-purple-600 mb-2">Invoice To :</h2>
                    <p className="font-semibold capitalize">{invoiceData?.billTo?.name ?? '—'}</p>
                    <p className="text-sm text-gray-600">{invoiceData?.billTo?.billingAddress?.addressLine1}</p>
                    <p className="text-sm text-gray-600">{invoiceData?.billTo?.billingAddress?.city}, {invoiceData?.billTo?.billingAddress?.state}, {invoiceData?.billTo?.billingAddress?.country}</p>
                    <p className="text-sm text-gray-600">{invoiceData?.billTo?.email}</p>
                    <p className="text-sm text-gray-600">{invoiceData?.billTo?.phone ?? ''}</p>
                    {invoiceData?.billTo?.vatRegNumber && <p className="text-sm text-gray-600">VAT Reg: {invoiceData.billTo.vatRegNumber}</p>}
                    {invoiceData?.billTo?.gstin && <p className="text-sm text-gray-600">GSTIN: {invoiceData.billTo.gstin}</p>}
                </div>
                <div className="w-2/5">
                    <h2 className="font-bold text-purple-600 mb-2">Pay To :</h2>
                    <p className="font-semibold">{invoiceData?.billFrom.name}</p>
                    <p className="text-sm text-gray-600">{invoiceData?.billFrom.address}</p>
                    <p className="text-sm text-gray-600">{invoiceData?.billFrom.email}</p>
                    <p className="text-sm text-gray-600">{invoiceData?.billFrom.phone}</p>
                </div>
                <div className="text-right">
                    <h2 className="font-bold text-purple-600 mb-2">{systemSettings?.company.companyName}</h2>
                    <p className="text-sm text-gray-600">Address: {systemSettings?.company.address}</p>
                    <p className="text-sm text-gray-600">Mobile: {systemSettings?.company.phone}</p>
                    {taxId && <p className="text-sm text-gray-600">{taxId.label}: {taxId.value}</p>}
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
                        {invoiceData && invoiceData.items.map((item, index) => (
                            <tr key={item.id ?? item.productId ?? index} className="border-b border-gray-200">
                                <td className="p-3">{index + 1}</td>
                                <td className="p-3 font-medium">{item.name ?? item.productName ?? '-'}</td>
                                {customColumns.map((c) => (
                                    <td key={c.slug} className="p-3">
                                        {formatLineFieldValue((item.customFields ?? {})[c.slug], c.field)}
                                    </td>
                                ))}
                                <td className="p-3 text-right">{item.qty}</td>
                                <td className="p-3 text-right">{fmt(item.rate)}</td>
                                <td className="p-3 text-right">{fmt(item.discount)}</td>
                                <td className="p-3 text-right font-medium">{fmt(Number(item.amount ?? item.lineTotal ?? 0))}</td>
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
                        <span className='font-semibold'>{fmt(invoiceData?.taxableAmount || 0)}</span>
                    </div>
                    {(() => {
                        type TaxLineRow = { kind: string | null; percent: number; name: string; amount: number };
                        const breakdown: Record<string, number> = {};
                        for (const line of invoiceData?.items ?? []) {
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
                                    <span className='font-semibold'>{fmt(invoiceData?.vat || 0)}</span>
                                </div>
                            );
                        }
                        return entries.map(([label, amount]) => (
                            <div key={label} className="flex justify-between text-sm text-gray-600 py-2">
                                <span className='font-bold'>{label}</span>
                                <span className='font-semibold'>{fmt(amount)}</span>
                            </div>
                        ));
                    })()}
                    <div className="flex justify-between text-sm text-gray-600 py-2">
                        <span className='font-bold'>Discount</span>
                        <span className='font-semibold'>{fmt(invoiceData?.totalDiscount || 0)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-lg py-3">
                        <span className='font-bold'>Total</span>
                        <span className='font-semibold'>{fmt(invoiceData?.TotalAmount || 0)}</span>
                    </div>
                    {(() => {
                        const totalPaid = Number((invoiceData as any).totalPaid ?? 0);
                        if (totalPaid <= 0) return null;
                        const balanceDue = Math.max(0, Number(invoiceData?.TotalAmount || 0) - totalPaid);
                        return (
                            <>
                                <div className="flex justify-between text-sm text-gray-600 py-2 border-t border-gray-100">
                                    <span className='font-bold'>Amount Paid</span>
                                    <span className='font-semibold text-success'>{fmt(totalPaid)}</span>
                                </div>
                                <div className="flex justify-between text-sm py-2 border-t border-gray-200">
                                    <span className='font-bold text-gray-800'>Balance Due</span>
                                    <span className={`font-bold ${balanceDue <= 0 ? 'text-success' : 'text-danger'}`}>{fmt(balanceDue)}</span>
                                </div>
                            </>
                        );
                    })()}
                </div>
            </section>

            {/* Tax Treatment Notice (non-STANDARD only) */}
            {taxTreatmentLabel(invoiceData?.taxTreatment) && (
                <section className="mt-2 pt-2 border-t border-gray-200">
                    <p className="text-sm font-semibold text-warning">
                        {taxTreatmentLabel(invoiceData?.taxTreatment)}
                    </p>
                </section>
            )}

            {/* Reverse charge notice (EU B2B cross-border — VAT zero-rated, recipient accounts for tax) */}
            {invoiceData?.reverseCharge && (
                <section className="mt-2 pt-2 border-t border-gray-200">
                    <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        Reverse charge
                    </span>
                    <p className="text-sm text-gray-700 mt-1">
                        {invoiceData?.reverseChargeNote || 'Reverse charge — VAT to be accounted for by the recipient.'}
                    </p>
                </section>
            )}

            {/* Amount in words and Summary */}
            <section className="mt-2 pt-2 border-t border-gray-200">
                <p className="text-sm text-gray-600">Total Items / Qty : {invoiceData?.items.length} / {invoiceData?.items.reduce((sum, item) => sum + item.qty, 0)}</p>
                <p className="text-sm mt-2">
                    <span className="font-semibold">Total amount ( in words) : </span>
                    {numberToWords(invoiceData?.TotalAmount || 0)}
                </p>
            </section>

            {/* Footer: Bank Details & Signature */}
            <footer className="mt-2 pt-2 flex justify-between border-t border-gray-200">
                {(invoiceData?.bank?.accountHoldername || invoiceData?.bank?.bankName || invoiceData?.bank?.accountNumber || invoiceData?.bank?.IFSCCode || invoiceData?.bank?.branchName) && (
                    <div>
                        <h3 className="font-semibold mb-2">Bank Details</h3>
                        {invoiceData?.bank?.accountHoldername && <p className="text-sm text-gray-600">Account Holder : {invoiceData.bank.accountHoldername}</p>}
                        {invoiceData?.bank?.bankName && <p className="text-sm text-gray-600">Bank : {invoiceData.bank.bankName}</p>}
                        {invoiceData?.bank?.accountNumber && <p className="text-sm text-gray-600">Account # : {invoiceData.bank.accountNumber}</p>}
                        {invoiceData?.bank?.IFSCCode && <p className="text-sm text-gray-600">IFSC : {invoiceData.bank.IFSCCode}</p>}
                        {invoiceData?.bank?.branchName && <p className="text-sm text-gray-600">BRANCH : {invoiceData.bank.branchName}</p>}
                    </div>
                )}
                {(invoiceData as unknown as { publicViewEnabled?: boolean })?.publicViewEnabled && (invoiceData as unknown as { publicViewToken?: string })?.publicViewToken && (
                    <div className="flex flex-col items-center mt-4">
                        <QRCodeSVG
                            value={`${
                                systemSettings?.company?.publicBaseUrl?.replace(/\/$/, '')
                                    ?? (typeof window !== 'undefined' ? window.location.origin : '')
                            }/invoice/${(invoiceData as unknown as { publicViewToken: string }).publicViewToken}`}
                            size={96}
                        />
                        <p className="text-xs text-gray-500 mt-1">Scan to view online</p>
                    </div>
                )}
                {(() => {
                    // The company's merchant UPI ID/name live on systemSettings.company
                    // (the redux company block), NOT invoiceData.company — the invoice
                    // GET response never includes a nested company object at all, so
                    // reading it from invoiceData silently made this QR never render.
                    const company = systemSettings?.company;
                    const upi = company?.merchantUpiId;
                    const amount = Number((invoiceData as unknown as { TotalAmount?: string | number } | null)?.TotalAmount ?? 0);
                    if (!upi || amount <= 0) return null;
                    const link = upiDeepLink({
                        vpa: upi,
                        payeeName: company?.merchantName || company?.companyName || 'Merchant',
                        amount,
                        note: (invoiceData as unknown as { invoiceNumber?: string | null } | null)?.invoiceNumber ?? '',
                    });
                    return (
                        <div className="flex flex-col items-center mt-4">
                            {/* Clickable (not just scannable) so tapping it on a mobile
                                browser opens the UPI app directly, without needing a
                                separate camera scan. */}
                            <a href={link} target="_blank" rel="noopener noreferrer">
                                <QRCodeSVG value={link} size={96} />
                            </a>
                            <p className="text-xs text-gray-500 mt-1">Scan or tap to pay via UPI</p>
                        </div>
                    );
                })()}
                {invoiceData?.signature?.image && (
                    <div className="text-center">
                        <p className="text-sm mb-4">For {systemSettings?.company?.companyName || 'Company'}</p>
                        <img src={invoiceData.signature.image} alt="Signature" className="w-40 h-auto" />
                    </div>
                )}
            </footer>

            {/* Notes */}
            {invoiceData?.notes && (
                <section className="mt-2">
                    <h3 className="font-semibold mb-2">Notes :</h3>
                    <p className="text-sm text-gray-600 whitespace-pre-line">{invoiceData.notes}</p>
                </section>
            )}

            {/* Terms and Conditions */}
            {invoiceData?.termsAndCondition && (
                <section className="mt-2">
                    <h3 className="font-semibold mb-2">Terms & Conditions :</h3>
                    <ol className="list-decimal list-inside text-sm text-gray-600 space-y-1">
                        <li className="whitespace-pre-line">{invoiceData.termsAndCondition}</li>
                    </ol>
                </section>
            )}

            <div className="mt-2Ema text-center text-sm text-gray-500">
                <p>Thanks for your Business</p>
            </div>

        </InvoiceWrapper>
    );
}

export default InvoiceTemplateA;