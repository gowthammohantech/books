import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';

import Constants from '@constants/api';
import type { PublicInvoicePayload } from '@models/publicInvoice';
import { upiDeepLink } from '@/lib/upiDeepLink';
import useDateFormatter from '@hooks/useDateFormatter';
import { companyTaxId } from '@utils/companyTaxId';
import { assetUrl } from '@utils/assetUrl';
import { formatPublicMoney } from '@utils/publicFormat';

export default function PublicInvoiceViewer() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicInvoicePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { formatDate } = useDateFormatter();

  useEffect(() => {
    if (!token) {
      setError('Invalid link');
      setLoading(false);
      return;
    }
    axios
      .get(`${Constants.GET_PUBLIC_INVOICE_URL}/${token}`)
      .then((r) => setData(r.data?.data?.invoice ?? null))
      .catch((e) => setError(axios.isAxiosError(e) && e.response?.status === 404 ? 'Link not found or revoked.' : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="p-6 text-gray-600">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!data) return <div className="p-6 text-gray-600">No data.</div>;

  const items = Array.isArray(data.items)
    ? (data.items as Array<{
        name?: string;
        productName?: string;
        qty?: number;
        rate?: number;
        amount?: number;
        discount?: number;
        tax?: number;
        totalTax?: number;
      }>)
    : [];
  const taxId = companyTaxId(data.company);
  // Task-1 addition — cast locally rather than widening the shared payload
  // type, since older payloads simply omit the field.
  const company = data.company as (NonNullable<PublicInvoicePayload['company']> & { siteLogo?: string | null }) | null;
  const logoSrc = company?.siteLogo ? assetUrl(company.siteLogo) : null;
  const hasDiscountCol = items.some((item) => typeof item.discount === 'number');
  const hasTaxCol = items.some((item) => typeof item.tax === 'number' || typeof item.totalTax === 'number');

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white text-sm text-gray-600 print:p-0">
      {logoSrc && (
        <div className="mb-4">
          <img src={logoSrc} alt={company?.companyName || 'logo'} className="h-12 max-w-[180px] object-contain" />
        </div>
      )}
      <div className="flex justify-between items-center mb-4 print:hidden">
        <h1 className="text-2xl font-bold">{data.invoiceType === 'PROFORMA' ? 'Proforma' : 'Invoice'}</h1>
        <button type="button" onClick={() => window.print()} className="px-3 py-1 text-sm border rounded">Print / Save PDF</button>
      </div>

      <div className="border-t border-b py-4 my-4">
        <div className="flex justify-between text-sm">
          <div>
            <div className="font-medium">{data.company?.companyName}</div>
            <div className="text-gray-600">{data.company?.address}</div>
            <div className="text-gray-600">{data.company?.email}</div>
            {taxId && <div className="text-gray-600">{taxId.label}: {taxId.value}</div>}
          </div>
          <div className="text-right">
            <div className="text-gray-600">#{data.invoiceNumber}</div>
            <div className="text-gray-600">{formatDate(data.invoiceDate)}</div>
            <div className="text-gray-600">Due {formatDate(data.dueDate)}</div>
          </div>
        </div>
      </div>

      <div className="mb-4 text-sm">
        <div className="font-medium">Bill to:</div>
        <div>{data.customer?.name}</div>
        <div className="text-gray-600">{data.customer?.email}</div>
      </div>

      <table className="w-full text-sm mb-4">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Item</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Rate</th>
            {hasDiscountCol && <th className="text-right">Discount</th>}
            {hasTaxCol && <th className="text-right">Tax</th>}
            <th className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            // Stored line amount from the server — only recompute qty*rate for
            // older payloads that predate the stored `amount` field.
            const lineAmount = item.amount !== undefined ? item.amount : (item.qty ?? 0) * (item.rate ?? 0);
            const lineTax = item.totalTax !== undefined ? item.totalTax : item.tax;
            return (
              <tr key={idx} className="border-b">
                <td className="py-2">{item.name ?? item.productName ?? '-'}</td>
                <td className="text-right">{item.qty ?? 0}</td>
                <td className="text-right">{formatPublicMoney(Number(item.rate ?? 0), data.currency)}</td>
                {hasDiscountCol && (
                  <td className="text-right">{formatPublicMoney(Number(item.discount ?? 0), data.currency)}</td>
                )}
                {hasTaxCol && (
                  <td className="text-right">{formatPublicMoney(Number(lineTax ?? 0), data.currency)}</td>
                )}
                <td className="text-right">{formatPublicMoney(Number(lineAmount), data.currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex justify-end text-sm">
        <div className="w-64">
          <div className="flex justify-between"><span>Subtotal</span><span>{formatPublicMoney(Number(data.taxableAmount ?? 0), data.currency)}</span></div>
          {data.vat !== null && data.vat !== undefined && (
            <div className="flex justify-between"><span>Tax</span><span>{formatPublicMoney(Number(data.vat), data.currency)}</span></div>
          )}
          <div className="flex justify-between font-medium border-t pt-2 mt-2"><span>Total</span><span>{formatPublicMoney(Number(data.TotalAmount ?? 0), data.currency)}</span></div>
        </div>
      </div>

      {/* Pay with … buttons (link-based gateways set on the invoice) */}
      {Array.isArray(data.paymentOptions) && data.paymentOptions.filter((o) => o?.url).length > 0 && (
        <div className="mt-6 border-t pt-5">
          <p className="text-sm font-medium text-gray-700 mb-3 text-center">Pay this invoice</p>
          <div className="flex flex-wrap justify-center gap-3">
            {data.paymentOptions
              .filter((o) => o?.url)
              .map((o) => (
                <a
                  key={o.name}
                  href={o.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-purple-600 text-white text-sm font-medium hover:bg-purple-700"
                >
                  Pay with {o.name}
                </a>
              ))}
          </div>
        </div>
      )}

      {(() => {
        const upi = data.company?.merchantUpiId;
        const amount = Number(data.TotalAmount ?? 0);
        if (!upi || amount <= 0) return null;
        const link = upiDeepLink({
          vpa: upi,
          payeeName: data.company?.merchantName || data.company?.companyName || 'Merchant',
          amount,
          note: data.invoiceNumber ?? '',
        });
        return (
          <div className="flex flex-col items-center mt-6">
            {/* Clickable (not just scannable) so tapping it on a mobile
                browser opens the UPI app directly. */}
            <a href={link} target="_blank" rel="noopener noreferrer">
              <QRCodeSVG value={link} size={128} />
            </a>
            <p className="text-xs text-gray-600 mt-2">Scan or tap to pay via UPI</p>
          </div>
        );
      })()}

      {/* Bank Details — shown only when the merchant attached a bank account */}
      {data.bank && (data.bank.accountHoldername || data.bank.bankName || data.bank.accountNumber || data.bank.IFSCCode || data.bank.branchName) && (
        <div className="mt-6 border-t pt-4 text-sm">
          <div className="font-medium mb-1">Bank Details</div>
          {data.bank.accountHoldername && <div className="text-gray-600">Account Holder : {data.bank.accountHoldername}</div>}
          {data.bank.bankName && <div className="text-gray-600">Bank : {data.bank.bankName}</div>}
          {data.bank.accountNumber && <div className="text-gray-600">Account # : {data.bank.accountNumber}</div>}
          {data.bank.IFSCCode && <div className="text-gray-600">IFSC : {data.bank.IFSCCode}</div>}
          {data.bank.branchName && <div className="text-gray-600">Branch : {data.bank.branchName}</div>}
        </div>
      )}

      {/* Notes */}
      {data.notes && (
        <div className="mt-6 border-t pt-4 text-sm">
          <div className="font-medium mb-1">Notes</div>
          <p className="text-gray-600 whitespace-pre-line">{data.notes}</p>
        </div>
      )}

      {/* Terms & Conditions */}
      {data.termsAndCondition && (
        <div className="mt-6 border-t pt-4 text-sm">
          <div className="font-medium mb-1">Terms &amp; Conditions</div>
          <p className="text-gray-600 whitespace-pre-line">{data.termsAndCondition}</p>
        </div>
      )}
    </div>
  );
}
