import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { Printer, Download, RotateCw } from 'lucide-react';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import useDateFormatter from '@hooks/useDateFormatter';
import DrillLink from '@components/admin/DrillLink';
import NoRecords from '@components/admin/NoRecords';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { PageHeader } from '@/context/PageHeaderContext';
import DateInput from '@components/admin/DateInput';
import { Button } from '@components/ui';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';

interface B2BRow {
  gstin: string;
  customerName: string;
  invoiceNumber: string | null;
  date: string;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  total: number;
}

interface B2CRow {
  placeOfSupply: string;
  invoiceCount: number;
  taxableValue: number;
  tax: number;
}

interface Summary {
  totalInvoices: number;
  totalTaxableValue: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalCess: number;
  totalTax: number;
}

interface GSTR1Data {
  period: { from: string; to: string };
  b2b: B2BRow[];
  b2c: B2CRow[];
  summary: Summary;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthStart(d: Date): string {
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

export default function GSTR1Report() {
  const token = useSelector((s: RootState) => s.auth.token);
  const { formatDate } = useDateFormatter();
  const today = isoDate(new Date());
  const start = monthStart(new Date());
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<GSTR1Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await axios.get(`${Constants.GET_GSTR1_URL}?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data?.data ?? null);
    } catch {
      setError('Failed to load GSTR-1 report');
    } finally {
      setLoading(false);
    }
  }

  async function download(format: 'json' | 'csv') {
    try {
      const res = await axios.get(
        `${Constants.EXPORT_GSTR1_URL}?from=${from}&to=${to}&format=${format}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: 'blob',
        },
      );
      const blob = new Blob([res.data], { type: format === 'csv' ? 'text/csv' : 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gstr1_${from}_${to}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(`Failed to download GSTR-1 ${format.toUpperCase()}`);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto bg-white">
      <PageHeader title="GSTR-1 (Outward Supplies)">
        <Button type="button" variant="white" size="md" leftIcon={<Printer size={14} />} onClick={() => window.print()}>
          Print / Save PDF
        </Button>
        <Button type="button" variant="white" size="md" leftIcon={<Download size={14} />} onClick={() => download('json')} className="ml-2">
          Download JSON
        </Button>
        <Button type="button" variant="white" size="md" leftIcon={<Download size={14} />} onClick={() => download('csv')} className="ml-2">
          Download CSV
        </Button>
      </PageHeader>

      <div className="flex items-end gap-4 mb-4 print:hidden">
        <DateInput
          value={ymdStringToDate(from)}
          onChange={(d) => setFrom(d ? dateToYmdString(d) : '')}
          label="From"
        />
        <DateInput
          value={ymdStringToDate(to)}
          onChange={(d) => setTo(d ? dateToYmdString(d) : '')}
          label="To"
        />
        <Button type="button" variant="primary" size="md" leftIcon={<RotateCw size={14} />} onClick={load}>
          Reload
        </Button>
      </div>

      {loading && (
        <div className="py-10">
          <LoaderSpinner />
        </div>
      )}
      {error && <p className="text-danger">{error}</p>}

      {data && (
        <div className="space-y-4 text-sm">
          <div className="text-xs text-gray-400">
            Period: {formatDate(data.period.from)} —{' '}
            {formatDate(data.period.to)}
          </div>

          <section className="border rounded p-4 bg-purple-50">
            <h2 className="font-medium mb-2">Summary</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <div className="text-xs text-gray-500">Total Invoices</div>
                <div className="font-medium">
                  <DrillLink
                    to="/admin/invoices"
                    params={{ startDate: from, endDate: to, invoiceType: 'INVOICE' }}
                    title="View source invoices"
                  >
                    {data.summary.totalInvoices}
                  </DrillLink>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Taxable Value</div>
                <div className="font-medium">
                  <DrillLink
                    to="/admin/invoices"
                    params={{ startDate: from, endDate: to, invoiceType: 'INVOICE' }}
                    title="View source invoices"
                  >
                    {data.summary.totalTaxableValue.toFixed(2)}
                  </DrillLink>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">CGST</div>
                <div className="font-medium">
                  <DrillLink
                    to="/admin/invoices"
                    params={{ startDate: from, endDate: to, invoiceType: 'INVOICE' }}
                    title="View source invoices"
                  >
                    {data.summary.totalCgst.toFixed(2)}
                  </DrillLink>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">SGST</div>
                <div className="font-medium">
                  <DrillLink
                    to="/admin/invoices"
                    params={{ startDate: from, endDate: to, invoiceType: 'INVOICE' }}
                    title="View source invoices"
                  >
                    {data.summary.totalSgst.toFixed(2)}
                  </DrillLink>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">IGST</div>
                <div className="font-medium">
                  <DrillLink
                    to="/admin/invoices"
                    params={{ startDate: from, endDate: to, invoiceType: 'INVOICE' }}
                    title="View source invoices"
                  >
                    {data.summary.totalIgst.toFixed(2)}
                  </DrillLink>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">CESS</div>
                <div className="font-medium">
                  <DrillLink
                    to="/admin/invoices"
                    params={{ startDate: from, endDate: to, invoiceType: 'INVOICE' }}
                    title="View source invoices"
                  >
                    {data.summary.totalCess.toFixed(2)}
                  </DrillLink>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Total Tax</div>
                <div className="font-medium">
                  <DrillLink
                    to="/admin/invoices"
                    params={{ startDate: from, endDate: to, invoiceType: 'INVOICE' }}
                    title="View source invoices"
                  >
                    {data.summary.totalTax.toFixed(2)}
                  </DrillLink>
                </div>
              </div>
            </div>
          </section>

          <section className="border border-border rounded-control p-4">
            <h2 className="font-medium mb-2">B2B (registered customers)</h2>
            <div className="overflow-x-auto border border-border rounded-control">
              <table className="w-full text-xs">
                <thead className="bg-gray-100 uppercase text-body">
                  <tr>
                    <th className="px-3 py-2 text-left border-b border-border">GSTIN</th>
                    <th className="px-3 py-2 text-left border-b border-border">Customer</th>
                    <th className="px-3 py-2 text-left border-b border-border">Invoice</th>
                    <th className="px-3 py-2 text-left border-b border-border">Date</th>
                    <th className="px-3 py-2 text-right border-b border-border">Taxable</th>
                    <th className="px-3 py-2 text-right border-b border-border">CGST</th>
                    <th className="px-3 py-2 text-right border-b border-border">SGST</th>
                    <th className="px-3 py-2 text-right border-b border-border">IGST</th>
                    <th className="px-3 py-2 text-right border-b border-border">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.b2b.length === 0 ? (
                    <NoRecords colSpan={9} message="No B2B invoices in period." />
                  ) : (
                    data.b2b.map((r, i) => (
                      <tr key={i} className="border-b border-border">
                        <td className="px-3 py-2">{r.gstin}</td>
                        <td className="px-3 py-2">{r.customerName}</td>
                        <td className="px-3 py-2">{r.invoiceNumber}</td>
                        <td className="px-3 py-2">{formatDate(r.date)}</td>
                        <td className="px-3 py-2 text-right">
                          <DrillLink
                            to="/admin/invoices"
                            params={{ startDate: from, endDate: to, invoiceType: 'INVOICE' }}
                            title="View source invoices"
                          >
                            {r.taxableValue.toFixed(2)}
                          </DrillLink>
                        </td>
                        <td className="px-3 py-2 text-right">{r.cgst.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{r.sgst.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{r.igst.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-medium">
                          <DrillLink
                            to="/admin/invoices"
                            params={{ startDate: from, endDate: to, invoiceType: 'INVOICE' }}
                            title="View source invoices"
                          >
                            {r.total.toFixed(2)}
                          </DrillLink>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="border border-border rounded-control p-4">
            <h2 className="font-medium mb-2">B2C (unregistered customers)</h2>
            <div className="overflow-x-auto border border-border rounded-control">
              <table className="w-full text-xs">
                <thead className="bg-gray-100 uppercase text-body">
                  <tr>
                    <th className="px-3 py-2 text-left border-b border-border">Place of Supply</th>
                    <th className="px-3 py-2 text-right border-b border-border">Invoice Count</th>
                    <th className="px-3 py-2 text-right border-b border-border">Taxable Value</th>
                    <th className="px-3 py-2 text-right border-b border-border">Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {data.b2c.length === 0 ? (
                    <NoRecords colSpan={4} message="No B2C invoices in period." />
                  ) : (
                    data.b2c.map((r, i) => (
                      <tr key={i} className="border-b border-border">
                        <td className="px-3 py-2">{r.placeOfSupply}</td>
                        <td className="px-3 py-2 text-right">{r.invoiceCount}</td>
                        <td className="px-3 py-2 text-right">{r.taxableValue.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{r.tax.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
