import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import useDateFormatter from '@hooks/useDateFormatter';
import DrillLink from '@components/admin/DrillLink';
import { AR_UNPAID_STATUSES, AP_UNPAID_STATUSES } from '@utils/agingBuckets';
import { PageHeader } from '@/context/PageHeaderContext';
import ExportButton from '@components/admin/ExportButton';
import DateInput from '@components/admin/DateInput';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';

interface BankRow {
  id: string;
  name: string;
  balance: number;
}

interface BalanceSheetData {
  asOf: string;
  assets: {
    current: { cashAndBank: number; receivables: number; inventory: number };
    fixed: { total: number };
    total: number;
  };
  liabilities: {
    current: { payables: number; taxLiability: number };
    longTerm: { total: number };
    total: number;
  };
  equity: { ownerEquity: number; retainedEarnings: number; total: number };
  totalLiabilitiesAndEquity: number;
  bankBreakdown: BankRow[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function BalanceSheetReport() {
  const token = useSelector((s: RootState) => s.auth.token);
  const { formatDate } = useDateFormatter();
  const today = isoDate(new Date());
  const [asOf, setAsOf] = useState(today);
  const [data, setData] = useState<BalanceSheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await axios.get(`${Constants.GET_BALANCE_SHEET_URL}?asOf=${asOf}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data?.data ?? null);
    } catch {
      setError('Failed to load balance sheet');
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
      <PageHeader title="Balance Sheet">
        <ExportButton url={Constants.EXPORT_BALANCE_SHEET_URL} filename="balance-sheet.csv" />
        <button type="button" onClick={() => window.print()} className="px-3 py-1 text-sm border rounded">
          Print / Save PDF
        </button>
      </PageHeader>

      <div className="flex items-end gap-4 mb-4 print:hidden">
        <DateInput
          value={ymdStringToDate(asOf)}
          onChange={(d) => setAsOf(d ? dateToYmdString(d) : '')}
          label="As Of"
        />
        <button type="button" onClick={load} className="px-3 py-1 text-sm bg-purple-600 text-white rounded">
          Reload
        </button>
      </div>

      {loading && <p className="text-gray-500">Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {data && (
        <div className="space-y-4 text-sm">
          <div className="text-xs text-gray-400">As of {formatDate(data.asOf)}</div>

          <section className="border rounded p-4">
            <h2 className="font-medium mb-2">Assets</h2>
            <div className="ml-2 mb-2">
              <div className="text-xs text-gray-500 mb-1">Current Assets</div>
              <div className="flex justify-between">
                <span>Cash & Bank</span>
                <span>
                  <DrillLink to="/admin/settings/bank-accounts" title="View bank accounts">
                    {data.assets.current.cashAndBank.toFixed(2)}
                  </DrillLink>
                </span>
              </div>
              <div className="flex justify-between">
                <span>Accounts Receivable</span>
                <span>
                  <DrillLink
                    to="/admin/invoices"
                    params={{ endDate: asOf, status: AR_UNPAID_STATUSES, invoiceType: 'INVOICE' }}
                    title="View unpaid invoices"
                  >
                    {data.assets.current.receivables.toFixed(2)}
                  </DrillLink>
                </span>
              </div>
              <div className="flex justify-between">
                <span>Inventory</span>
                <span>
                  <DrillLink to="/admin/inventory" title="View inventory">
                    {data.assets.current.inventory.toFixed(2)}
                  </DrillLink>
                </span>
              </div>
            </div>
            <div className="ml-2 mb-2">
              <div className="text-xs text-gray-500 mb-1">Fixed Assets</div>
              <div className="flex justify-between">
                <span>Total Fixed Assets</span>
                <span>{data.assets.fixed.total.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex justify-between font-medium border-t pt-2 mt-2">
              <span>Total Assets</span>
              <span>{data.assets.total.toFixed(2)}</span>
            </div>
          </section>

          {data.bankBreakdown.length > 0 && (
            <section className="border rounded p-4 text-xs">
              <h3 className="font-medium mb-2 text-sm">Bank Breakdown</h3>
              {data.bankBreakdown.map((b) => (
                <div key={b.id} className="flex justify-between">
                  <span>{b.name}</span>
                  <span>
                    <DrillLink to="/admin/settings/bank-accounts" title="View bank accounts">
                      {b.balance.toFixed(2)}
                    </DrillLink>
                  </span>
                </div>
              ))}
            </section>
          )}

          <section className="border rounded p-4">
            <h2 className="font-medium mb-2">Liabilities</h2>
            <div className="ml-2 mb-2">
              <div className="text-xs text-gray-500 mb-1">Current Liabilities</div>
              <div className="flex justify-between">
                <span>Accounts Payable</span>
                <span>
                  <DrillLink
                    to="/admin/purchases"
                    params={{ endDate: asOf, status: AP_UNPAID_STATUSES }}
                    title="View pending purchases"
                  >
                    {data.liabilities.current.payables.toFixed(2)}
                  </DrillLink>
                </span>
              </div>
              <div className="flex justify-between">
                <span>Tax Liability</span>
                <span>{data.liabilities.current.taxLiability.toFixed(2)}</span>
              </div>
            </div>
            <div className="ml-2 mb-2">
              <div className="text-xs text-gray-500 mb-1">Long-term Liabilities</div>
              <div className="flex justify-between">
                <span>Total Long-term Liabilities</span>
                <span>{data.liabilities.longTerm.total.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex justify-between font-medium border-t pt-2 mt-2">
              <span>Total Liabilities</span>
              <span>{data.liabilities.total.toFixed(2)}</span>
            </div>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-medium mb-2">Equity</h2>
            <div className="flex justify-between">
              <span>Owner Equity</span>
              <span>{data.equity.ownerEquity.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Retained Earnings</span>
              <span>{data.equity.retainedEarnings.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-medium border-t pt-2 mt-2">
              <span>Total Equity</span>
              <span>{data.equity.total.toFixed(2)}</span>
            </div>
          </section>

          <section className="border-2 border-purple-600 rounded p-4 bg-purple-100">
            <div className="flex justify-between text-lg font-bold">
              <span>Total Liabilities + Equity</span>
              <span>{data.totalLiabilitiesAndEquity.toFixed(2)}</span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
