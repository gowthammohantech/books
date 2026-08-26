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
import { AR_UNPAID_STATUSES } from '@utils/agingBuckets';
import { PageHeader } from '@/context/PageHeaderContext';
import DateInput from '@components/admin/DateInput';
import { Button, Badge, type BadgeColor } from '@components/ui';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type DunningStage = 'reminder' | 'first_notice' | 'second_notice' | 'final_notice';

interface CollectionRow {
  id: string;
  label: string;
  amount: number;
  dueDate: string;
  daysOverdue: number;
  bucket: string;
  dunningStage: DunningStage | string;
}

interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

interface CollectionsData {
  rows: CollectionRow[];
  buckets: AgingBuckets;
}

const DUNNING_LABELS: Record<DunningStage, string> = {
  reminder: 'Reminder',
  first_notice: '1st Notice',
  second_notice: '2nd Notice',
  final_notice: 'Final Notice',
};

const DUNNING_COLORS: Record<DunningStage, BadgeColor> = {
  reminder: 'info',
  first_notice: 'warning',
  second_notice: 'orange',
  final_notice: 'danger',
};

function DunningBadge({ stage }: { stage: string }) {
  const s = stage as DunningStage;
  const label = DUNNING_LABELS[s] ?? stage;
  const color = DUNNING_COLORS[s] ?? 'gray';
  return (
    <Badge color={color} variant="soft">
      {label}
    </Badge>
  );
}

export default function CollectionsReport() {
  const token = useSelector((s: RootState) => s.auth.token);
  const { formatDate } = useDateFormatter();
  const today = isoDate(new Date());
  const [asOf, setAsOf] = useState(today);
  const [data, setData] = useState<CollectionsData | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await axios.get(`${Constants.FETCH_COLLECTIONS_URL}?asOf=${asOf}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data?.data ?? null);
    } catch {
      toast.error('Failed to load Collections report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sort rows by daysOverdue descending
  const rows = data?.rows
    ? [...data.rows].sort((a, b) => b.daysOverdue - a.daysOverdue)
    : [];

  return (
    <div className="p-6 max-w-5xl mx-auto bg-white">
      <PageHeader title="Collections">
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
          <div className="text-xs text-gray-400 mb-4">Overdue receivables as of {formatDate(asOf)}, sorted by days overdue</div>

          <div className="overflow-x-auto border border-border rounded-control">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-100 text-xs uppercase text-body">
                <tr>
                  <th className="px-4 py-3 text-left border-b border-border">Customer</th>
                  <th className="px-4 py-3 text-left border-b border-border">Due Date</th>
                  <th className="px-4 py-3 text-right border-b border-border">Days Overdue</th>
                  <th className="px-4 py-3 text-left border-b border-border">Bucket</th>
                  <th className="px-4 py-3 text-left border-b border-border">Dunning Stage</th>
                  <th className="px-4 py-3 text-right border-b border-border">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <NoRecords colSpan={6} message="No overdue collections as of this date." />
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b border-border hover:bg-gray-50">
                      <td className="px-4 py-3">{row.label}</td>
                      <td className="px-4 py-3">{formatDate(row.dueDate)}</td>
                      <td className="px-4 py-3 text-right">{row.daysOverdue}</td>
                      <td className="px-4 py-3 text-xs text-body">{row.bucket}</td>
                      <td className="px-4 py-3"><DunningBadge stage={row.dunningStage} /></td>
                      <td className="px-4 py-3 text-right font-mono">
                        <DrillLink to="/admin/invoices" params={{ status: AR_UNPAID_STATUSES, invoiceType: 'INVOICE', dueStartDate: row.dueDate.slice(0, 10), dueEndDate: row.dueDate.slice(0, 10) }} title="View invoices due on this date">{fmt(row.amount)}</DrillLink>
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
