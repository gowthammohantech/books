import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';
import { Printer, RotateCw } from 'lucide-react';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import DrillLink from '@components/admin/DrillLink';
import NoRecords from '@components/admin/NoRecords';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { PageHeader } from '@/context/PageHeaderContext';
import DateInput from '@components/admin/DateInput';
import { Button, Badge } from '@components/ui';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// API returns these as strings (Prisma Decimal) and variancePct may be null —
// coerce defensively so the report never crashes.
function fmt(n: number | string | null | undefined): string {
  return Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number | string | null | undefined): string {
  return Number(n ?? 0).toFixed(1) + '%';
}

// Numeric fields come back as strings (Prisma Decimal); variancePct can be null.
interface BudgetVarianceRow {
  accountId: string;
  accountName: string;
  accountType: string;
  budget: string;
  actual: string;
  variance: string;
  variancePct: string | null;
  favorable: boolean;
}

interface BudgetVarianceTotals {
  totalBudget: string;
  totalActual: string;
  totalVariance: string;
}

interface BudgetVarianceData {
  rows: BudgetVarianceRow[];
  totals: BudgetVarianceTotals;
}

function FavorableBadge({ favorable }: { favorable: boolean }) {
  return (
    <Badge color={favorable ? 'success' : 'danger'} variant="soft">
      {favorable ? 'Favorable' : 'Unfavorable'}
    </Badge>
  );
}

export default function BudgetVarianceReport() {
  const token = useSelector((s: RootState) => s.auth.token);
  const today = isoDate(new Date());
  const yearStart = isoDate(new Date(new Date().getFullYear(), 0, 1));
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<BudgetVarianceData | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await axios.get(`${Constants.FETCH_BUDGET_VARIANCE_URL}?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data?.data ?? null);
    } catch {
      toast.error('Failed to load Budget Variance report');
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
      <PageHeader title="Budget Variance">
        <Button type="button" variant="white" size="md" leftIcon={<Printer size={14} />} onClick={() => window.print()}>
          Print / Save PDF
        </Button>
      </PageHeader>

      <div className="flex items-end gap-4 mb-6 print:hidden">
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

      {!loading && data && (
        <div className="overflow-x-auto border border-border rounded-control">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-100 text-xs uppercase text-body">
              <tr>
                <th className="px-4 py-3 text-left border-b border-border">Account</th>
                <th className="px-4 py-3 text-left border-b border-border">Type</th>
                <th className="px-4 py-3 text-right border-b border-border">Budget</th>
                <th className="px-4 py-3 text-right border-b border-border">Actual</th>
                <th className="px-4 py-3 text-right border-b border-border">Variance</th>
                <th className="px-4 py-3 text-right border-b border-border">Variance %</th>
                <th className="px-4 py-3 text-left border-b border-border">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <NoRecords colSpan={7} message="No budget data found for this period." />
              ) : (
                <>
                  {data.rows.map((row) => (
                    <tr key={row.accountId} className="border-b border-border hover:bg-gray-50">
                      <td className="px-4 py-3">{row.accountName}</td>
                      <td className="px-4 py-3 text-xs text-body">{row.accountType}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmt(row.budget)}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        <DrillLink to="/admin/accounting/journal-entries" params={{ accountId: row.accountId, from, to }} title="View journal entries for this account">{fmt(row.actual)}</DrillLink>
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${Number(row.variance) < 0 ? 'text-danger' : 'text-success'}`}>
                        {fmt(row.variance)}
                      </td>
                      <td className="px-4 py-3 text-right">{fmtPct(row.variancePct)}</td>
                      <td className="px-4 py-3"><FavorableBadge favorable={row.favorable} /></td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr className="border-t-2 border-border font-medium bg-gray-50">
                    <td className="px-4 py-3" colSpan={2}>Totals</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(data.totals.totalBudget)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(data.totals.totalActual)}</td>
                    <td className={`px-4 py-3 text-right font-mono ${Number(data.totals.totalVariance) < 0 ? 'text-danger' : 'text-success'}`}>
                      {fmt(data.totals.totalVariance)}
                    </td>
                    <td className="px-4 py-3" colSpan={2}></td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
