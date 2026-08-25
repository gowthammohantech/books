import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import useDateFormatter from '@hooks/useDateFormatter';
import DrillLink from '@components/admin/DrillLink';
import { PageHeader } from '@/context/PageHeaderContext';
import ExportButton from '@components/admin/ExportButton';
import DateInput from '@components/admin/DateInput';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';

interface CategoryTotal {
  name: string;
  total: number;
  categoryId?: string;
}

interface ProfitLossData {
  period: { from: string; to: string };
  revenue: { total: number; byCategory: CategoryTotal[] };
  costOfGoodsSold: { total: number };
  grossProfit: number;
  operatingExpenses: { total: number; byCategory: CategoryTotal[] };
  operatingIncome: number;
  manualEntries: {
    income: number;
    expense: number;
    incomeByAccount: CategoryTotal[];
    expenseByAccount: CategoryTotal[];
  };
  netIncome: number;
  taxes: { outputTax: number; inputTax: number; netTax: number };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function ProfitLossReport() {
  const token = useSelector((s: RootState) => s.auth.token);
  const { formatDate } = useDateFormatter();
  const today = isoDate(new Date());
  const yearStart = isoDate(new Date(new Date().getFullYear(), 0, 1));
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<ProfitLossData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await axios.get(`${Constants.GET_PROFIT_LOSS_URL}?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data?.data ?? null);
    } catch {
      setError('Failed to load profit & loss report');
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
      <PageHeader title="Profit & Loss">
        <ExportButton url={Constants.EXPORT_PROFIT_AND_LOSS_URL} filename="profit-and-loss.csv" />
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
            <h2 className="font-medium mb-2">Revenue</h2>
            {data.revenue.byCategory.map((c, i) => (
              <div key={i} className="flex justify-between">
                <span>{c.name}</span>
                <span>{c.total.toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between font-medium border-t pt-2 mt-2">
              <span>Total Revenue</span>
              <DrillLink
                to="/admin/invoices"
                params={{ startDate: from, endDate: to, invoiceType: 'INVOICE' }}
                title="View invoices in this period"
              >
                {data.revenue.total.toFixed(2)}
              </DrillLink>
            </div>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-medium mb-2">Cost of Goods Sold</h2>
            <div className="flex justify-between">
              <span>COGS</span>
              <DrillLink
                to="/admin/purchases"
                params={{ startDate: from, endDate: to }}
                title="View purchases in this period"
              >
                {data.costOfGoodsSold.total.toFixed(2)}
              </DrillLink>
            </div>
          </section>

          <section className="border rounded p-4 bg-purple-50">
            <div className="flex justify-between font-medium">
              <span>Gross Profit</span>
              <span>{data.grossProfit.toFixed(2)}</span>
            </div>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-medium mb-2">Operating Expenses</h2>
            {data.operatingExpenses.byCategory.length === 0 && (
              <div className="text-gray-400 text-xs">No operating expenses in period.</div>
            )}
            {data.operatingExpenses.byCategory.map((c, i) => (
              <div key={i} className="flex justify-between">
                <span>{c.name}</span>
                <DrillLink
                  to="/admin/expenses"
                  params={{ startDate: from, endDate: to, expenseCategoryId: c.categoryId }}
                  title="View expenses in this category"
                >
                  {c.total.toFixed(2)}
                </DrillLink>
              </div>
            ))}
            <div className="flex justify-between font-medium border-t pt-2 mt-2">
              <span>Total Opex</span>
              <DrillLink
                to="/admin/expenses"
                params={{ startDate: from, endDate: to }}
                title="View all expenses in this period"
              >
                {data.operatingExpenses.total.toFixed(2)}
              </DrillLink>
            </div>
          </section>

          <section className="border rounded p-4 bg-purple-50">
            <div className="flex justify-between font-medium">
              <span>Operating Income</span>
              <span>{data.operatingIncome.toFixed(2)}</span>
            </div>
          </section>

          {(data.manualEntries.income !== 0 || data.manualEntries.expense !== 0) && (
            <section className="border rounded p-4">
              <h2 className="font-medium mb-2">Manual Journal Adjustments</h2>
              <div className="flex justify-between">
                <span>Income</span>
                <span>{data.manualEntries.income.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Expense</span>
                <span>{data.manualEntries.expense.toFixed(2)}</span>
              </div>
            </section>
          )}

          <section className="border-2 border-purple-600 rounded p-4 bg-purple-100">
            <div className="flex justify-between text-lg font-bold">
              <span>Net Income</span>
              <span>{data.netIncome.toFixed(2)}</span>
            </div>
          </section>

          <section className="border rounded p-4 text-xs text-gray-500">
            <div className="flex justify-between">
              <span>Output Tax Collected</span>
              <DrillLink
                to="/admin/invoices"
                params={{ startDate: from, endDate: to, invoiceType: 'INVOICE' }}
                title="View invoices in this period"
              >
                {data.taxes.outputTax.toFixed(2)}
              </DrillLink>
            </div>
            <div className="flex justify-between">
              <span>Input Tax Paid</span>
              <DrillLink
                to="/admin/purchases"
                params={{ startDate: from, endDate: to }}
                title="View purchases in this period"
              >
                {data.taxes.inputTax.toFixed(2)}
              </DrillLink>
            </div>
            <div className="flex justify-between">
              <span>Net Tax</span>
              <span>{data.taxes.netTax.toFixed(2)}</span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
