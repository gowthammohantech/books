import { useEffect, useState, useMemo } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import { PageHeader } from '@/context/PageHeaderContext';
import DateInput from '@components/admin/DateInput';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { Button, Checkbox } from '@components/ui';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmt(value: string | number | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Negative figures read as losses; colour them so a loss-making department is
 *  visible at a glance rather than needing the minus sign to be spotted. */
function amountClass(value: string | number | undefined): string {
  return Number(value ?? 0) < 0 ? 'text-danger' : 'text-gray-700';
}

interface Column {
  key: string;
  code: string;
  name: string;
}

interface Row {
  accountId: string;
  code: string;
  name: string;
  amounts: Record<string, string>;
  total: string;
}

interface ReportData {
  period?: { from: string; to: string };
  columns: Column[];
  revenue: Row[];
  expenses: Row[];
  totals: {
    revenue: Record<string, string>;
    expenses: Record<string, string>;
    net: Record<string, string>;
    grandRevenue: string;
    grandExpenses: string;
    grandNet: string;
  };
}

export default function PnlByDepartmentReport() {
  const token = useSelector((s: RootState) => s.auth.token);
  const today = isoDate(new Date());
  const yearStart = isoDate(new Date(new Date().getFullYear(), 0, 1));

  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(today);
  const [rollup, setRollup] = useState(false);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const res = await axios.get(Constants.FETCH_PNL_BY_DEPARTMENT_URL, {
          params: { from, to, ...(rollup ? { rollup: 'parent' } : {}) },
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) setData(res.data?.data ?? null);
      } catch {
        if (!cancelled) {
          toast.error('Failed to load P&L by department.');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [token, from, to, rollup]);

  const columns = data?.columns ?? [];

  /** Sum of every department column plus Common. Shown next to the grand total
   *  so the reconciliation this report exists to support is visible on the page
   *  rather than something you have to recompute by hand. */
  const columnSum = useMemo(() => {
    if (!data) return 0;
    return columns.reduce((s, c) => s + Number(data.totals.net[c.key] ?? 0), 0);
  }, [data, columns]);

  const reconciles = data ? Math.abs(columnSum - Number(data.totals.grandNet)) < 0.005 : true;

  const renderSection = (title: string, rows: Row[], totals: Record<string, string>, grand: string) => (
    <>
      <tr className="bg-gray-100">
        <td className="p-3 font-semibold text-gray-900" colSpan={columns.length + 2}>{title}</td>
      </tr>
      {rows.length === 0 && (
        <tr>
          <td className="p-3 text-gray-400 italic" colSpan={columns.length + 2}>No activity in this period</td>
        </tr>
      )}
      {rows.map((r) => (
        <tr key={r.accountId} className="border-b border-gray-100">
          <td className="p-3 whitespace-nowrap">
            <span className="font-mono text-indigo-600">{r.code}</span> <span className="text-gray-700">{r.name}</span>
          </td>
          {columns.map((c) => (
            <td key={c.key} className={`p-3 text-right ${amountClass(r.amounts[c.key])}`}>
              {fmt(r.amounts[c.key])}
            </td>
          ))}
          <td className="p-3 text-right font-semibold text-gray-800">{fmt(r.total)}</td>
        </tr>
      ))}
      <tr className="border-b-2 border-gray-300 bg-gray-50">
        <td className="p-3 font-semibold text-gray-900">Total {title}</td>
        {columns.map((c) => (
          <td key={c.key} className={`p-3 text-right font-semibold ${amountClass(totals[c.key])}`}>
            {fmt(totals[c.key])}
          </td>
        ))}
        <td className="p-3 text-right font-bold text-gray-900">{fmt(grand)}</td>
      </tr>
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="P&L by Department" />

      <div className="bg-white p-4 rounded-card border border-border shadow-card flex flex-wrap items-end gap-4">
        <div className="w-44">
          <DateInput
            label="From"
            value={ymdStringToDate(from)}
            onChange={(d) => setFrom(dateToYmdString(d) || yearStart)}
          />
        </div>
        <div className="w-44">
          <DateInput
            label="To"
            value={ymdStringToDate(to)}
            onChange={(d) => setTo(dateToYmdString(d) || today)}
          />
        </div>
        <Checkbox
          id="rollup"
          checked={rollup}
          onChange={(e) => setRollup(e.target.checked)}
          label={<span className="text-sm text-gray-700">Roll departments up into their parent division</span>}
        />
        <Button variant="white" onClick={() => { setFrom(yearStart); setTo(today); setRollup(false); }}>
          Reset
        </Button>
      </div>

      {loading && (
        <div className="py-10 text-center"><LoaderSpinner /></div>
      )}

      {!loading && data && (
        <>
          <div className="bg-white rounded-card border border-border shadow-card overflow-x-auto">
            <table className="w-full min-w-max">
              <thead className="bg-gray-100 text-gray-900">
                <tr>
                  <th className="p-3 text-left text-sm font-semibold">Account</th>
                  {columns.map((c) => (
                    <th key={c.key} className="p-3 text-right text-sm font-semibold whitespace-nowrap" title={c.name}>
                      {c.code === '—' ? c.name : c.code}
                    </th>
                  ))}
                  <th className="p-3 text-right text-sm font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {renderSection('Revenue', data.revenue, data.totals.revenue, data.totals.grandRevenue)}
                {renderSection('Expenses', data.expenses, data.totals.expenses, data.totals.grandExpenses)}
                <tr className="bg-gray-100">
                  <td className="p-3 font-bold text-gray-900">Net Profit</td>
                  {columns.map((c) => (
                    <td key={c.key} className={`p-3 text-right font-bold ${amountClass(data.totals.net[c.key])}`}>
                      {fmt(data.totals.net[c.key])}
                    </td>
                  ))}
                  <td className="p-3 text-right font-bold text-gray-900">{fmt(data.totals.grandNet)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500">
            Untagged amounts appear in the <strong>Common / Unallocated</strong> column. Departments
            are not cross-charged, so overheads stay where they were booked.
          </p>

          {!reconciles && (
            <p className="text-sm text-danger">
              Department columns sum to {fmt(columnSum)} but the grand total is {fmt(data.totals.grandNet)}.
              These should match exactly — please report this.
            </p>
          )}
        </>
      )}

      {!loading && !data && (
        <p className="text-gray-500 text-sm">No data for this period.</p>
      )}
    </div>
  );
}
