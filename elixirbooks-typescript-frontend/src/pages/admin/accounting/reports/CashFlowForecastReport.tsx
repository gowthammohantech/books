import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';
import { Printer, RotateCw } from 'lucide-react';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import useDateFormatter from '@hooks/useDateFormatter';
import DrillLink from '@components/admin/DrillLink';
import NoRecords from '@components/admin/NoRecords';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { PageHeader } from '@/context/PageHeaderContext';
import { Button } from '@components/ui';

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface ForecastBucket {
  monthStart: string;
  inflow: number;
  outflow: number;
  net: number;
  runningCash: number;
}

interface CashFlowForecastData {
  buckets: ForecastBucket[];
  droppedBeyondHorizon: number;
}

const MONTHS_OPTIONS = [3, 6, 12] as const;
type MonthsOption = typeof MONTHS_OPTIONS[number];

export default function CashFlowForecastReport() {
  const token = useSelector((s: RootState) => s.auth.token);
  const { formatDate } = useDateFormatter();
  const [months, setMonths] = useState<MonthsOption>(6);
  const [data, setData] = useState<CashFlowForecastData | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await axios.get(`${Constants.FETCH_CASH_FLOW_FORECAST_URL}?months=${months}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data?.data ?? null);
    } catch {
      toast.error('Failed to load Cash Flow Forecast');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto bg-white">
      <PageHeader title="Cash Flow Forecast">
        <Button type="button" variant="white" size="md" leftIcon={<Printer size={14} />} onClick={() => window.print()}>
          Print / Save PDF
        </Button>
      </PageHeader>

      <div className="flex items-end gap-4 mb-6 print:hidden">
        <div>
          <label className="block text-xs text-gray-500">Horizon (months)</label>
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value) as MonthsOption)}
            className="p-1 border rounded text-sm"
          >
            {MONTHS_OPTIONS.map((m) => (
              <option key={m} value={m}>{m} months</option>
            ))}
          </select>
        </div>
        <Button type="button" variant="primary" size="md" leftIcon={<RotateCw size={14} />} onClick={load}>
          Reload
        </Button>
      </div>

      {loading && (
        <div className="py-10">
          <LoaderSpinner />
        </div>
      )}

      {!loading && data && (
        <>
          {data.droppedBeyondHorizon > 0 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
              Note: {data.droppedBeyondHorizon} transaction(s) beyond the {months}-month horizon were excluded.
            </div>
          )}

          <div className="overflow-x-auto border border-border rounded-control">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-100 text-xs uppercase text-body">
                <tr>
                  <th className="px-4 py-3 text-left border-b border-border">Month</th>
                  <th className="px-4 py-3 text-right border-b border-border">Inflow</th>
                  <th className="px-4 py-3 text-right border-b border-border">Outflow</th>
                  <th className="px-4 py-3 text-right border-b border-border">Net</th>
                  <th className="px-4 py-3 text-right border-b border-border">Running Cash</th>
                </tr>
              </thead>
              <tbody>
                {data.buckets.length === 0 ? (
                  <NoRecords colSpan={5} message="No forecast data available for this horizon." />
                ) : (
                  data.buckets.map((bucket) => (
                    <tr key={bucket.monthStart} className="border-b border-border hover:bg-gray-50">
                      <td className="px-4 py-3">{formatDate(bucket.monthStart, 'M Y')}</td>
                      <td className="px-4 py-3 text-right font-mono text-success">
                        <DrillLink
                          to="/admin/invoices"
                          params={{ status: 'UNPAID', invoiceType: 'INVOICE' }}
                          title="View unpaid invoices"
                        >
                          {fmt(bucket.inflow)}
                        </DrillLink>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-danger">
                        <DrillLink
                          to="/admin/purchases"
                          params={{ status: 'pending' }}
                          title="View pending purchases"
                        >
                          {fmt(bucket.outflow)}
                        </DrillLink>
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${bucket.net < 0 ? 'text-danger' : 'text-success'}`}>
                        {fmt(bucket.net)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-medium ${bucket.runningCash < 0 ? 'text-danger' : ''}`}>
                        {fmt(bucket.runningCash)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
