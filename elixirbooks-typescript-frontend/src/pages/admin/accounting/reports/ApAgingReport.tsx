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
import { bucketDueWindow, AP_UNPAID_STATUSES } from '@utils/agingBuckets';
import { PageHeader } from '@/context/PageHeaderContext';
import ExportButton from '@components/admin/ExportButton';
import DateInput from '@components/admin/DateInput';
import { Button } from '@components/ui';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

interface AgingRow {
  id: string;
  label: string;
  amount: number;
  dueDate: string;
  daysOverdue: number;
  bucket: string;
}

interface ApAgingData {
  asOf: string;
  buckets: AgingBuckets;
  total: number;
  rows: AgingRow[];
}

const BUCKET_LABELS: Record<keyof AgingBuckets, string> = {
  current: 'Current',
  d1_30: '1–30 Days',
  d31_60: '31–60 Days',
  d61_90: '61–90 Days',
  d90plus: '90+ Days',
};

export default function ApAgingReport() {
  const token = useSelector((s: RootState) => s.auth.token);
  const { formatDate } = useDateFormatter();
  const today = isoDate(new Date());
  const [asOf, setAsOf] = useState(today);
  const [data, setData] = useState<ApAgingData | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await axios.get(`${Constants.FETCH_AP_AGING_URL}?asOf=${asOf}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data?.data ?? null);
    } catch {
      toast.error('Failed to load AP Aging report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buckets = data?.buckets;

  return (
    <div className="p-6 max-w-5xl mx-auto bg-white">
      <PageHeader title="Accounts Payable Aging">
        <ExportButton url={Constants.EXPORT_AP_AGING_URL} filename="ap-aging.csv" />
        <Button type="button" variant="white" size="md" leftIcon={<Printer size={14} />} onClick={() => window.print()}>
          Print / Save PDF
        </Button>
      </PageHeader>

      <div className="flex items-end gap-4 mb-6 print:hidden">
        <DateInput
          value={ymdStringToDate(asOf)}
          onChange={(d) => setAsOf(d ? dateToYmdString(d) : '')}
          label="As Of"
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

      {!loading && data && (
        <>
          <div className="text-xs text-gray-400 mb-4">As of {formatDate(data.asOf)}</div>

          {/* Bucket summary cards */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
            {buckets && (Object.keys(BUCKET_LABELS) as (keyof AgingBuckets)[]).map((key) => (
              <div key={key} className="border rounded p-3 text-center">
                <div className="text-xs text-gray-500 mb-1">{BUCKET_LABELS[key]}</div>
                <div className="text-sm font-semibold text-right">
                  <DrillLink to="/admin/purchases" params={{ status: AP_UNPAID_STATUSES, ...bucketDueWindow(data.asOf.slice(0, 10), key) }} title="View purchases in this bucket">{fmt(buckets[key])}</DrillLink>
                </div>
              </div>
            ))}
            <div className="border-2 border-purple-600 rounded p-3 text-center">
              <div className="text-xs text-gray-500 mb-1">Total</div>
              <div className="text-sm font-bold text-right text-purple-700">{fmt(data.total)}</div>
            </div>
          </div>

          {/* Rows table */}
          <div className="overflow-x-auto border border-border rounded-control">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-100 text-xs uppercase text-body">
                <tr>
                  <th className="px-4 py-3 text-left border-b border-border">Supplier</th>
                  <th className="px-4 py-3 text-left border-b border-border">Due Date</th>
                  <th className="px-4 py-3 text-right border-b border-border">Days Overdue</th>
                  <th className="px-4 py-3 text-right border-b border-border">Amount</th>
                  <th className="px-4 py-3 text-left border-b border-border">Bucket</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <NoRecords colSpan={5} message="No outstanding payables as of this date." />
                ) : (
                  data.rows.map((row) => (
                    <tr key={row.id} className="border-b border-border hover:bg-gray-50">
                      <td className="px-4 py-3">{row.label}</td>
                      <td className="px-4 py-3">{formatDate(row.dueDate)}</td>
                      <td className="px-4 py-3 text-right">{row.daysOverdue}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        <DrillLink to="/admin/purchases" params={{ status: AP_UNPAID_STATUSES, dueStartDate: row.dueDate.slice(0, 10), dueEndDate: row.dueDate.slice(0, 10) }} title="View purchases due on this date">{fmt(row.amount)}</DrillLink>
                      </td>
                      <td className="px-4 py-3 text-xs text-body">{row.bucket}</td>
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
