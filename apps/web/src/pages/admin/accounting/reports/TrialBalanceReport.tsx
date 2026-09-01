import api from '@lib/apiClient';
import { useEffect, useState } from 'react';

import { Printer, RotateCw } from 'lucide-react';

import Constants from '@constants/api';
import useDateFormatter from '@hooks/useDateFormatter';
import DrillLink from '@components/admin/DrillLink';
import NoRecords from '@components/admin/NoRecords';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { PageHeader } from '@/context/PageHeaderContext';
import ExportButton from '@components/admin/ExportButton';
import DateInput from '@components/admin/DateInput';
import { Button } from '@components/ui';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';

interface TrialBalanceRow {
  id: string;
  code: string;
  name: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  totalDebit: number;
  totalCredit: number;
  net: number;
}

interface TrialBalanceData {
  asOf: string;
  accounts: TrialBalanceRow[];
  totals: { debit: number; credit: number };
  balanced: boolean;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function TrialBalanceReport() {
  const { formatDate } = useDateFormatter();
  const today = isoDate(new Date());
  const [asOf, setAsOf] = useState(today);
  const [data, setData] = useState<TrialBalanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`${Constants.GET_TRIAL_BALANCE_URL}?asOf=${asOf}`);
      setData(r.data?.data ?? null);
    } catch {
      setError('Failed to load trial balance');
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
      <PageHeader title="Trial Balance">
        <ExportButton url={Constants.EXPORT_TRIAL_BALANCE_URL} filename="trial-balance.csv" />
        <Button type="button" variant="white" size="md" leftIcon={<Printer size={14} />} onClick={() => window.print()}>
          Print / Save PDF
        </Button>
      </PageHeader>

      <div className="flex items-end gap-4 mb-4 print:hidden">
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
      {error && <p className="text-destructive">{error}</p>}

      {data && (
        <>
          <div className="text-xs text-gray-400 mb-2">As of {formatDate(data.asOf)}</div>

          <div className="overflow-x-auto border border-border rounded-md">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-100 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left border-b border-border">Code</th>
                  <th className="px-4 py-3 text-left border-b border-border">Account</th>
                  <th className="px-4 py-3 text-left border-b border-border">Type</th>
                  <th className="px-4 py-3 text-right border-b border-border">Debit</th>
                  <th className="px-4 py-3 text-right border-b border-border">Credit</th>
                  <th className="px-4 py-3 text-right border-b border-border">Net</th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.length === 0 ? (
                  <NoRecords colSpan={6} message="No accounts found for this date." />
                ) : (
                  data.accounts.map((a) => (
                    <tr key={a.id} className="border-b border-border">
                      <td className="px-4 py-3 font-mono">{a.code}</td>
                      <td className="px-4 py-3">{a.name}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{a.accountType}</td>
                      <td className="px-4 py-3 text-right">
                        {a.totalDebit > 0
                          ? <DrillLink to="/admin/accounting/journal-entries" params={{ accountId: a.id, to: data.asOf.slice(0, 10) }} title="View journal entries for this account">{a.totalDebit.toFixed(2)}</DrillLink>
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {a.totalCredit > 0
                          ? <DrillLink to="/admin/accounting/journal-entries" params={{ accountId: a.id, to: data.asOf.slice(0, 10) }} title="View journal entries for this account">{a.totalCredit.toFixed(2)}</DrillLink>
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DrillLink to="/admin/accounting/journal-entries" params={{ accountId: a.id, to: data.asOf.slice(0, 10) }} title="View journal entries for this account">{a.net.toFixed(2)}</DrillLink>
                      </td>
                    </tr>
                  ))
                )}
                <tr className="border-t-2 border-border font-medium bg-gray-50">
                  <td className="px-4 py-3" colSpan={3}>
                    Totals
                  </td>
                  <td className="px-4 py-3 text-right">{data.totals.debit.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">{data.totals.credit.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={
                        data.balanced
                          ? 'text-success font-medium'
                          : 'text-destructive font-medium'
                      }
                    >
                      {data.balanced ? 'Balanced' : 'OUT OF BALANCE'}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
