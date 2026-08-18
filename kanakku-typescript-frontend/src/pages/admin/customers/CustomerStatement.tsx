import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { Printer, RotateCw } from 'lucide-react';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import { useCurrencies } from '@hooks/useCurrencies';
import useDateFormatter from '@hooks/useDateFormatter';
import { PageHeader } from '@/context/PageHeaderContext';
import DateInput from '@components/admin/DateInput';
import NoRecords from '@components/admin/NoRecords';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { Button } from '@components/ui';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';

interface StatementLine {
  date: string;
  kind: 'INVOICE' | 'PAYMENT';
  reference: string;
  description: string;
  debit: number;
  credit: number;
}

interface CurrencyStatement {
  currencyCode: string;
  openingBalance: number;
  lines: StatementLine[];
  totals: { debit: number; credit: number };
  closingBalance: number;
}

interface StatementData {
  customer: { id: string; name: string; email: string | null; phone: string | null; currencyCode?: string | null };
  period: { from: string; to: string };
  byCurrency: CurrencyStatement[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function CustomerStatement() {
  const { id } = useParams<{ id: string }>();
  const token = useSelector((s: RootState) => s.auth.token);
  const { resolveCurrency } = useCurrencies();
  const { formatDate } = useDateFormatter();

  const todayIso = isoDate(new Date());
  const nintyDaysAgoIso = isoDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));

  const [from, setFrom] = useState<string>(nintyDaysAgoIso);
  const [to, setTo] = useState<string>(todayIso);
  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${Constants.GET_CUSTOMER_STATEMENT_URL}/${id}/statement?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data?.data ?? null);
    } catch (e) {
      setError(axios.isAxiosError(e) && e.response?.status === 404 ? 'Customer not found' : 'Failed to load statement');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const moneyIn = (code: string) => {
    const sym = resolveCurrency(code).symbol;
    // Amounts can arrive as Decimal strings from the API — coerce before toFixed.
    return (n: number | string | null | undefined) => `${sym}${(Number(n) || 0).toFixed(2)}`;
  };

  return (
    <div className="p-6 max-w-5xl mx-auto bg-white">
      <PageHeader title="Customer Statement">
        <Button type="button" variant="white" size="md" leftIcon={<Printer size={14} />} onClick={() => window.print()}>
          Print / Save PDF
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
      {error && <p className="text-red-600">{error}</p>}

      {data && (
        <>
          <div className="border rounded p-4 mb-4">
            <div className="text-lg font-medium">{data.customer?.name ?? '—'}</div>
            <div className="text-sm text-gray-500">{data.customer?.email ?? ''}</div>
            <div className="text-sm text-gray-500">{data.customer?.phone ?? ''}</div>
            <div className="text-xs text-gray-400 mt-2">
              Period: {formatDate(data.period.from)} — {formatDate(data.period.to)}
            </div>
            {data.byCurrency.length > 1 && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                This customer transacts in multiple currencies — each is reconciled separately below (no conversion).
              </div>
            )}
          </div>

          {data.byCurrency.map((section) => {
            const money = moneyIn(section.currencyCode);
            const sym = resolveCurrency(section.currencyCode);
            let running = section.openingBalance;
            return (
              <div key={section.currencyCode} className="mb-8">
                <h2 className="text-base font-semibold mb-2">
                  Statement in {sym.code} ({sym.symbol})
                </h2>
                <div className="overflow-x-auto border border-border rounded-control">
                  <table className="w-full text-sm border-collapse">
                    <thead className="bg-gray-100 text-xs uppercase text-body">
                      <tr>
                        <th className="px-4 py-3 text-left border-b border-border">Date</th>
                        <th className="px-4 py-3 text-left border-b border-border">Reference</th>
                        <th className="px-4 py-3 text-left border-b border-border">Description</th>
                        <th className="px-4 py-3 text-right border-b border-border">Debit</th>
                        <th className="px-4 py-3 text-right border-b border-border">Credit</th>
                        <th className="px-4 py-3 text-right border-b border-border">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border font-medium bg-gray-50">
                        <td className="px-4 py-3" colSpan={5}>Opening Balance</td>
                        <td className="px-4 py-3 text-right">{money(section.openingBalance)}</td>
                      </tr>
                      {section.lines.length === 0 ? (
                        <NoRecords colSpan={6} message="No transactions in this period" />
                      ) : (
                        section.lines.map((line, idx) => {
                          running = running + line.debit - line.credit;
                          return (
                            <tr key={idx} className="border-b border-border hover:bg-gray-50">
                              <td className="px-4 py-3">{formatDate(line.date)}</td>
                              <td className="px-4 py-3">{line.reference}</td>
                              <td className="px-4 py-3">{line.description}</td>
                              <td className="px-4 py-3 text-right">{line.debit > 0 ? <span className="text-danger">{money(line.debit)}</span> : '—'}</td>
                              <td className="px-4 py-3 text-right">{line.credit > 0 ? <span className="text-success">{money(line.credit)}</span> : '—'}</td>
                              <td className="px-4 py-3 text-right">{money(running)}</td>
                            </tr>
                          );
                        })
                      )}
                      <tr className="border-t-2 border-border font-medium bg-gray-50">
                        <td className="px-4 py-3" colSpan={3}>Totals</td>
                        <td className="px-4 py-3 text-right">{money(section.totals.debit)}</td>
                        <td className="px-4 py-3 text-right">{money(section.totals.credit)}</td>
                        <td className="px-4 py-3 text-right">{money(section.closingBalance)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
