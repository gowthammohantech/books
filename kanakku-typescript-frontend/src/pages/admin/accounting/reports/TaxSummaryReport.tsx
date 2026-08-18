import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import useDateFormatter from '@hooks/useDateFormatter';
import DrillLink from '@components/admin/DrillLink';
import { PageHeader } from '@/context/PageHeaderContext';
import DateInput from '@components/admin/DateInput';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';

interface TaxBuckets {
  [kind: string]: number;
}

interface TaxSummaryData {
  period: { from: string; to: string };
  outwardTaxes: TaxBuckets;
  inwardTaxes: TaxBuckets;
  netTaxLiability: TaxBuckets;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthStart(d: Date): string {
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function renderRows(
  buckets: TaxBuckets,
  drill?: { to: string; params: Record<string, string>; title: string },
) {
  const entries = Object.entries(buckets).filter(([k]) => k !== 'TOTAL');
  if (entries.length === 0) {
    return <div className="text-xs text-gray-400">No tax components in period.</div>;
  }
  return entries.map(([kind, amt]) => (
    <div key={kind} className="flex justify-between">
      <span>{kind}</span>
      <span>
        <DrillLink to={drill?.to} params={drill?.params} title={drill?.title}>
          {Number(amt).toFixed(2)}
        </DrillLink>
      </span>
    </div>
  ));
}

export default function TaxSummaryReport() {
  const token = useSelector((s: RootState) => s.auth.token);
  const { formatDate } = useDateFormatter();
  const today = isoDate(new Date());
  const start = monthStart(new Date());
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<TaxSummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await axios.get(`${Constants.GET_TAX_SUMMARY_URL}?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data?.data ?? null);
    } catch {
      setError('Failed to load tax summary');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto bg-white">
      <PageHeader title="Tax Summary">
        <button type="button" onClick={() => window.print()} className="px-3 py-1 text-sm border rounded">
          Print / Save PDF
        </button>
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
        <button type="button" onClick={load} className="px-3 py-1 text-sm bg-purple-600 text-white rounded">
          Reload
        </button>
      </div>

      {loading && <p className="text-gray-500">Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {data && (
        <div className="space-y-4 text-sm">
          <div className="text-xs text-gray-400">
            Period: {formatDate(data.period.from)} —{' '}
            {formatDate(data.period.to)}
          </div>

          <section className="border rounded p-4">
            <h2 className="font-medium mb-2">Outward Taxes (collected on sales)</h2>
            {renderRows(data.outwardTaxes, {
              to: '/admin/invoices',
              params: { startDate: from, endDate: to, invoiceType: 'INVOICE' },
              title: 'View source invoices',
            })}
            <div className="flex justify-between font-medium border-t pt-2 mt-2">
              <span>Total Outward</span>
              <span>
                <DrillLink
                  to="/admin/invoices"
                  params={{ startDate: from, endDate: to, invoiceType: 'INVOICE' }}
                  title="View source invoices"
                >
                  {Number(data.outwardTaxes.TOTAL ?? 0).toFixed(2)}
                </DrillLink>
              </span>
            </div>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-medium mb-2">Inward Taxes (paid on purchases)</h2>
            {renderRows(data.inwardTaxes, {
              to: '/admin/purchases',
              params: { startDate: from, endDate: to },
              title: 'View source purchases',
            })}
            <div className="flex justify-between font-medium border-t pt-2 mt-2">
              <span>Total Inward</span>
              <span>
                <DrillLink
                  to="/admin/purchases"
                  params={{ startDate: from, endDate: to }}
                  title="View source purchases"
                >
                  {Number(data.inwardTaxes.TOTAL ?? 0).toFixed(2)}
                </DrillLink>
              </span>
            </div>
          </section>

          <section className="border-2 border-purple-600 rounded p-4 bg-purple-100">
            <h2 className="font-medium mb-2">Net Tax Liability</h2>
            {renderRows(data.netTaxLiability)}
            <div className="flex justify-between text-lg font-bold border-t pt-2 mt-2">
              <span>Net Tax Liability</span>
              <span>{Number(data.netTaxLiability.TOTAL ?? 0).toFixed(2)}</span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
