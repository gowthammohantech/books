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

/**
 * Dense A5-landscape (210x148mm) print layout, aimed at pharmacy / retail
 * counter printing (see InvoiceActionToolbar's PAGE_STYLES[3]: `@page {
 * size: A5 landscape; margin: 5mm; }`). Root is fixed to the printable
 * content width (210mm page - 2x5mm margins = 200mm).
 *
 * Consumes the exact same invoiceData contract as InvoiceTemplateA — same
 * field access, currency/date formatting helpers and totals math — just
 * compacted so every field TemplateA renders still fits on one sheet. Unit
 * and per-line Tax columns are added (pharmacy line items care about both)
 * without dropping anything TemplateA shows.
 */
const InvoiceTemplateA5Landscape: React.FC<InvoiceDetailsProps> = ({ invoiceData, lineFields }) => {
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const { formatDate } = useDateFormatter();
    const taxId = companyTaxId(systemSettings?.company);
    const { formatMoney } = useCurrencies();
    const fmt = (amount: number) => formatMoney(amount, invoiceData?.currencyCode);
    const customColumns = collectLineCustomColumns(invoiceData?.items, lineFields);
    const InvoiceWrapper = styled.div`
    p, span, td, th, li { font-size: 10px; }
  `;

    return (
        <InvoiceWrapper
            className="bg-white font-sans text-gray-950 mx-auto my-4 text-[10px] leading-snug"
            style={{ width: '200mm', padding: '3mm 4mm' }}
        >

            {/* Row 1: company block (left) + invoice meta (right) — one compact row */}
            <header className="flex justify-between items-start gap-4 pb-1 border-b border-gray-300">
                <div className="flex items-start gap-2">
                    <img
                        src={resolveCompanyLogo(systemSettings?.company?.siteLogo)}
                        alt="Company Logo"
                        className="w-14 max-h-9 max-w-14 h-auto object-contain"
                    />
                    <div>
                        <p className="font-bold text-[12px] text-purple-700 leading-tight">{systemSettings?.company.companyName}</p>
                        <p className="text-gray-600">{systemSettings?.company.address}</p>
                        <p className="text-gray-600">Mobile: {systemSettings?.company.phone}</p>
                        {taxId && <p className="text-gray-600">{taxId.label}: {taxId.value}</p>}
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <h1 className="text-[13px] font-bold text-gray-950 leading-tight">TAX INVOICE</h1>
                    <p className="text-gray-500">Original For Recipient</p>
                    <p className="text-gray-600">Invoice No: <span className="font-semibold">{invoiceData?.invoiceNumber}</span></p>
                    <p className="text-gray-600">Date: {formatDate(invoiceData?.invoiceDate)} &nbsp; Due: {formatDate(invoiceData?.dueDate)}</p>
                    <p className="text-gray-600">Status: <span className="font-semibold">{invoiceData?.status}</span></p>
                </div>
            </header>

            {/* Row 2: Bill To / Pay To — compact two-column */}
            <section className="flex justify-between gap-4 mt-1 pb-1 border-b border-gray-200">
                <div className="w-1/2">
                    <span className="font-bold text-purple-600">Invoice To: </span>
                    <span className="font-semibold capitalize">{invoiceData?.billTo?.name ?? '—'}</span>
                    <span className="text-gray-600">
                        {' '}— {invoiceData?.billTo?.billingAddress?.addressLine1}, {invoiceData?.billTo?.billingAddress?.city}, {invoiceData?.billTo?.billingAddress?.state}, {invoiceData?.billTo?.billingAddress?.country}
                        {' '}· {invoiceData?.billTo?.email} {invoiceData?.billTo?.phone ?? ''}
                        {invoiceData?.billTo?.vatRegNumber && <> · VAT Reg: {invoiceData.billTo.vatRegNumber}</>}
                        {invoiceData?.billTo?.gstin && <> · GSTIN: {invoiceData.billTo.gstin}</>}
                    </span>
                </div>
                <div className="w-1/2 pl-4 border-l border-gray-200">
                    <span className="font-bold text-purple-600">Pay To: </span>
                    <span className="font-semibold">{invoiceData?.billFrom.name}</span>
                    <span className="text-gray-600"> — {invoiceData?.billFrom.address} · {invoiceData?.billFrom.email} {invoiceData?.billFrom.phone}</span>
                </div>
            </section>

            {/* Line items — flexible region */}
            <section className="mt-1">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-300">
                            <th className="py-0.5 px-1 font-semibold text-gray-600">#</th>
                            <th className="py-0.5 px-1 font-semibold text-gray-600">Description</th>
                            {customColumns.map((c) => (
                                <th key={c.slug} className="py-0.5 px-1 font-semibold text-gray-600">{c.label}</th>
                            ))}
                            <th className="py-0.5 px-1 font-semibold text-gray-600 text-right">Qty</th>
                            <th className="py-0.5 px-1 font-semibold text-gray-600 text-right">Unit</th>
                            <th className="py-0.5 px-1 font-semibold text-gray-600 text-right">Rate</th>
                            <th className="py-0.5 px-1 font-semibold text-gray-600 text-right">Discount</th>
                            <th className="py-0.5 px-1 font-semibold text-gray-600 text-right">Tax</th>
                            <th className="py-0.5 px-1 font-semibold text-gray-600 text-right">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoiceData && invoiceData.items.map((item, index) => {
                            const rawTaxes = (item as unknown as { taxes?: unknown }).taxes;
                            const lineTaxes: { amount?: number }[] = Array.isArray(rawTaxes) ? (rawTaxes as { amount?: number }[]) : [];
                            // Older invoices may lack the taxes[] breakdown — fall back to the
                            // flat per-line tax amount so the column doesn't read 0.00.
                            const lineTax = lineTaxes.length > 0
                                ? lineTaxes.reduce((sum, t) => sum + Number(t.amount ?? 0), 0)
                                : Number(item.tax ?? 0);
                            return (
                                <tr key={item.id ?? item.productId ?? index} className="border-b border-gray-100">
                                    <td className="py-0.5 px-1">{index + 1}</td>
                                    <td className="py-0.5 px-1 font-medium">{item.name ?? item.productName ?? '-'}</td>
                                    {customColumns.map((c) => (
                                        <td key={c.slug} className="py-0.5 px-1">
                                            {formatLineFieldValue((item.customFields ?? {})[c.slug], c.field)}
                                        </td>
                                    ))}
                                    <td className="py-0.5 px-1 text-right">{item.qty}</td>
                                    <td className="py-0.5 px-1 text-right">{item.unit || ''}</td>
                                    <td className="py-0.5 px-1 text-right">{fmt(item.rate)}</td>
                                    <td className="py-0.5 px-1 text-right">{fmt(item.discount)}</td>
                                    <td className="py-0.5 px-1 text-right">{fmt(lineTax)}</td>
                                    <td className="py-0.5 px-1 text-right font-medium">{fmt(Number(item.amount ?? item.lineTotal ?? 0))}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </section>

            {/* Tax Treatment Notice (non-STANDARD only) */}
            {taxTreatmentLabel(invoiceData?.taxTreatment) && (
                <p className="mt-1 font-semibold text-warning">{taxTreatmentLabel(invoiceData?.taxTreatment)}</p>
            )}

            {/* Reverse charge notice (EU B2B cross-border — VAT zero-rated, recipient accounts for tax) */}
            {invoiceData?.reverseCharge && (
                <p className="mt-1 text-gray-700">
                    <span className="inline-block rounded bg-amber-100 px-1 py-0.5 font-semibold text-amber-800">Reverse charge</span>
                    {' '}{invoiceData?.reverseChargeNote || 'Reverse charge — VAT to be accounted for by the recipient.'}
                </p>
            )}

            {/* Bottom row: notes/terms (left) + totals (right); signature strip below-right */}
            <section className="flex justify-between gap-4 mt-1 pt-1 border-t border-gray-200">
                <div className="w-3/5 pr-2 space-y-1">
                    <p className="text-gray-600">
                        Total Items / Qty : {invoiceData?.items.length} / {invoiceData?.items.reduce((sum, item) => sum + item.qty, 0)}
                    </p>
                    <p><span className="font-semibold">Amount in words: </span>{numberToWords(invoiceData?.TotalAmount || 0)}</p>

                    {(invoiceData?.bank?.accountHoldername || invoiceData?.bank?.bankName || invoiceData?.bank?.accountNumber || invoiceData?.bank?.IFSCCode || invoiceData?.bank?.branchName) && (
                        <p className="text-gray-600">
                            <span className="font-semibold text-gray-950">Bank Details: </span>
                            {invoiceData?.bank?.accountHoldername && <>Holder: {invoiceData.bank.accountHoldername} · </>}
                            {invoiceData?.bank?.bankName && <>Bank: {invoiceData.bank.bankName} · </>}
                            {invoiceData?.bank?.accountNumber && <>A/C: {invoiceData.bank.accountNumber} · </>}
                            {invoiceData?.bank?.IFSCCode && <>IFSC: {invoiceData.bank.IFSCCode} · </>}
                            {invoiceData?.bank?.branchName && <>Branch: {invoiceData.bank.branchName}</>}
                        </p>
                    )}

                    {invoiceData?.notes && (
                        <p><span className="font-semibold">Notes: </span><span className="whitespace-pre-line text-gray-600">{invoiceData.notes}</span></p>
                    )}

                    {invoiceData?.termsAndCondition && (
                        <p><span className="font-semibold">Terms & Conditions: </span><span className="whitespace-pre-line text-gray-600">{invoiceData.termsAndCondition}</span></p>
                    )}
                </div>

                <div className="w-2/5">
                    <div className="flex justify-between py-0.5">
                        <span className="font-bold">Sub Total</span>
                        <span className="font-semibold">{fmt(invoiceData?.taxableAmount || 0)}</span>
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
                                <div className="flex justify-between py-0.5">
                                    <span className="font-bold">Tax</span>
                                    <span className="font-semibold">{fmt(invoiceData?.vat || 0)}</span>
                                </div>
                            );
                        }
                        return entries.map(([label, amount]) => (
                            <div key={label} className="flex justify-between py-0.5">
                                <span className="font-bold">{label}</span>
                                <span className="font-semibold">{fmt(amount)}</span>
                            </div>
                        ));
                    })()}
                    <div className="flex justify-between py-0.5">
                        <span className="font-bold">Discount</span>
                        <span className="font-semibold">{fmt(invoiceData?.totalDiscount || 0)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-[12px] py-1 border-t border-gray-300">
                        <span>Total</span>
                        <span>{fmt(invoiceData?.TotalAmount || 0)}</span>
                    </div>
                    {(() => {
                        const totalPaid = Number((invoiceData as any).totalPaid ?? 0);
                        if (totalPaid <= 0) return null;
                        const balanceDue = Math.max(0, Number(invoiceData?.TotalAmount || 0) - totalPaid);
                        return (
                            <>
                                <div className="flex justify-between py-0.5 border-t border-gray-100">
                                    <span className="font-bold">Amount Paid</span>
                                    <span className="font-semibold text-success">{fmt(totalPaid)}</span>
                                </div>
                                <div className="flex justify-between py-0.5 border-t border-gray-200">
                                    <span className="font-bold text-gray-800">Balance Due</span>
                                    <span className={`font-bold ${balanceDue <= 0 ? 'text-success' : 'text-danger'}`}>{fmt(balanceDue)}</span>
                                </div>
                            </>
                        );
                    })()}

                    {/* Signature strip + QR codes, below-right */}
                    <div className="flex justify-end items-end gap-3 mt-2">
                        {(invoiceData as unknown as { publicViewEnabled?: boolean })?.publicViewEnabled && (invoiceData as unknown as { publicViewToken?: string })?.publicViewToken && (
                            <div className="flex flex-col items-center">
                                <QRCodeSVG
                                    value={`${
                                        systemSettings?.company?.publicBaseUrl?.replace(/\/$/, '')
                                            ?? (typeof window !== 'undefined' ? window.location.origin : '')
                                    }/invoice/${(invoiceData as unknown as { publicViewToken: string }).publicViewToken}`}
                                    size={44}
                                />
                                <p className="text-[8px] text-gray-500 mt-0.5">Scan to view</p>
                            </div>
                        )}
                        {(() => {
                            // The company's merchant UPI ID/name live on systemSettings.company
                            // (the redux company block), NOT invoiceData.company — mirrors
                            // InvoiceTemplateA/B's note on why this must read from systemSettings.
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
                                <div className="flex flex-col items-center">
                                    {/* Clickable (not just scannable) so tapping it on a mobile
                                        browser opens the UPI app directly. */}
                                    <a href={link} target="_blank" rel="noopener noreferrer">
                                        <QRCodeSVG value={link} size={44} />
                                    </a>
                                    <p className="text-[8px] text-gray-500 mt-0.5">Scan/tap to pay</p>
                                </div>
                            );
                        })()}
                        {invoiceData?.signature?.image && (
                            <div className="text-center">
                                <p className="mb-1">For {systemSettings?.company?.companyName || 'Company'}</p>
                                <img src={invoiceData.signature.image} alt="Signature" className="w-20 h-auto mx-auto" />
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <div className="mt-1 pt-1 border-t border-gray-200 text-center text-gray-500">
                <p>Thanks for your Business</p>
            </div>

        </InvoiceWrapper>
    );
}

export default InvoiceTemplateA5Landscape;
