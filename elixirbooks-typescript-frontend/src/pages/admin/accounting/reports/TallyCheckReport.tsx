// src/pages/admin/accounting/reports/TallyCheckReport.tsx
import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { Printer, RotateCw } from 'lucide-react';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import { PageHeader } from '@/context/PageHeaderContext';
import DateInput from '@components/admin/DateInput';
import NoRecords from '@components/admin/NoRecords';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { Button, Badge } from '@components/ui';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';

interface TallyCheckAR {
  glControl: number;
  subledgerOpenInvoices: number;
  diff: number;
  tied: boolean;
}

interface TallyCheckAP {
  glControl: number;
  subledgerOpenBills: number;
  diff: number;
  tied: boolean;
}

interface TallyCheckBank {
  bankAccountId: string;
  name: string;
  glMatchAvailable: boolean;
  glBalance: number;
  currentBalance: number;
  sumExplained: number;
  currentVsExplainedTied: boolean;
  glVsCurrentTied: boolean | null;
  glVsExplainedTied: boolean | null;
  tied: boolean | null;
}

interface TallyCheckData {
  asOf: string;
  trialBalance: { totalDebit: number; totalCredit: number; balanced: boolean };
  ar: TallyCheckAR;
  ap: TallyCheckAP;
  bank: TallyCheckBank[];
  bankGlFullyMatched: boolean;
  overallTied: boolean;
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function TiedBadge({ ok }: { ok: boolean }) {
  return (
    <Badge color={ok ? 'success' : 'danger'} variant="soft">
      {ok ? '✓ Tied' : '✗ Diverges'}
    </Badge>
  );
}

function GlNaBadge() {
  return (
    <Badge color="gray" variant="soft">
      GL N/A
    </Badge>
  );
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function TallyCheckReport() {
  const token = useSelector((s: RootState) => s.auth.token);
  const today = isoDate(new Date());
  const [asOf, setAsOf] = useState(today);
  const [data, setData] = useState<TallyCheckData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await axios.get(`${Constants.GET_TALLY_CHECK_URL}?asOf=${asOf}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data?.data ?? null);
    } catch {
      setError('Failed to load tally check');
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
      <PageHeader title="Tally Check / Reconciliation">
        <Button type="button" variant="white" size="md" leftIcon={<Printer size={14} />} onClick={() => window.print()}>
          Print / Save PDF
        </Button>
      </PageHeader>

      {/* Controls */}
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
      {error && <p className="text-danger">{error}</p>}

      {data && (
        <>
          {/* Overall banner */}
          <div
            className={`mb-6 p-4 rounded-lg border text-center font-bold text-lg ${
              data.overallTied
                ? 'bg-success-soft border-success text-success'
                : 'bg-danger-soft border-danger text-danger'
            }`}
          >
            {data.overallTied
              ? '✓ All accounts tally — books are in balance'
              : '✗ Divergences detected — see details below'}
          </div>

          {/* Trial Balance */}
          <section className="mb-6">
            <h2 className="text-lg font-semibold mb-2">Trial Balance</h2>
            <div className="overflow-x-auto border border-border rounded-control">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-gray-100 text-xs uppercase text-body">
                  <tr>
                    <th className="px-4 py-3 text-left border-b border-border">Metric</th>
                    <th className="px-4 py-3 text-right border-b border-border">Amount</th>
                    <th className="px-4 py-3 text-center border-b border-border">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="px-4 py-3">Total Debit</td>
                    <td className="px-4 py-3 text-right">{fmt(data.trialBalance.totalDebit)}</td>
                    <td className="px-4 py-3 text-center" rowSpan={2}>
                      <TiedBadge ok={data.trialBalance.balanced} />
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-3">Total Credit</td>
                    <td className="px-4 py-3 text-right">{fmt(data.trialBalance.totalCredit)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* AR / AP Reconciliation */}
          <section className="mb-6">
            <h2 className="text-lg font-semibold mb-2">AR / AP Control vs Sub-Ledger</h2>
            <div className="overflow-x-auto border border-border rounded-control">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-gray-100 text-xs uppercase text-body">
                  <tr>
                    <th className="px-4 py-3 text-left border-b border-border">Control Account</th>
                    <th className="px-4 py-3 text-right border-b border-border">GL Balance</th>
                    <th className="px-4 py-3 text-right border-b border-border">Sub-Ledger</th>
                    <th className="px-4 py-3 text-right border-b border-border">Diff</th>
                    <th className="px-4 py-3 text-center border-b border-border">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={`border-b border-border ${data.ar.tied ? '' : 'bg-danger-soft'}`}>
                    <td className="px-4 py-3 font-medium">Accounts Receivable (AR)</td>
                    <td className="px-4 py-3 text-right">{fmt(data.ar.glControl)}</td>
                    <td className="px-4 py-3 text-right">{fmt(data.ar.subledgerOpenInvoices)}</td>
                    <td className={`px-4 py-3 text-right ${Math.abs(data.ar.diff) >= 0.01 ? 'text-danger font-semibold' : ''}`}>
                      {fmt(data.ar.diff)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <TiedBadge ok={data.ar.tied} />
                    </td>
                  </tr>
                  <tr className={`border-b border-border ${data.ap.tied ? '' : 'bg-danger-soft'}`}>
                    <td className="px-4 py-3 font-medium">Accounts Payable (AP)</td>
                    <td className="px-4 py-3 text-right">{fmt(data.ap.glControl)}</td>
                    <td className="px-4 py-3 text-right">{fmt(data.ap.subledgerOpenBills)}</td>
                    <td className={`px-4 py-3 text-right ${Math.abs(data.ap.diff) >= 0.01 ? 'text-danger font-semibold' : ''}`}>
                      {fmt(data.ap.diff)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <TiedBadge ok={data.ap.tied} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Bank Reconciliation */}
          <section className="mb-6">
            <h2 className="text-lg font-semibold mb-2">Bank Account Reconciliation</h2>
            <div className="overflow-x-auto border border-border rounded-control">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-gray-100 text-xs uppercase text-body">
                  <tr>
                    <th className="px-4 py-3 text-left border-b border-border">Account</th>
                    <th className="px-4 py-3 text-right border-b border-border">GL Balance</th>
                    <th className="px-4 py-3 text-right border-b border-border">Book Balance</th>
                    <th className="px-4 py-3 text-right border-b border-border">Explained Txns</th>
                    <th className="px-4 py-3 text-center border-b border-border">Book vs Explained</th>
                    <th className="px-4 py-3 text-center border-b border-border">GL vs Book</th>
                    <th className="px-4 py-3 text-center border-b border-border">GL vs Explained</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bank.length === 0 ? (
                    <NoRecords colSpan={7} message="No bank accounts found." />
                  ) : (
                    data.bank.map((b) => {
                      // Row is highlighted red only when a real check we ran diverges
                      const rowDiverges = !b.currentVsExplainedTied ||
                        (b.glMatchAvailable && b.tied === false);
                      return (
                        <tr key={b.bankAccountId} className={`border-b border-border ${rowDiverges ? 'bg-danger-soft' : ''}`}>
                          <td className="px-4 py-3 font-medium">{b.name}</td>
                          <td className="px-4 py-3 text-right">
                            {b.glMatchAvailable ? fmt(b.glBalance) : <span className="text-body">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">{fmt(b.currentBalance)}</td>
                          <td className="px-4 py-3 text-right">{fmt(b.sumExplained)}</td>
                          <td className="px-4 py-3 text-center">
                            <TiedBadge ok={b.currentVsExplainedTied} />
                          </td>
                          <td className="px-4 py-3 text-center">
                            {b.glMatchAvailable && b.glVsCurrentTied !== null
                              ? <TiedBadge ok={b.glVsCurrentTied} />
                              : <GlNaBadge />}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {b.glMatchAvailable && b.glVsExplainedTied !== null
                              ? <TiedBadge ok={b.glVsExplainedTied} />
                              : <GlNaBadge />}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {data.bank.length > 0 && !data.bankGlFullyMatched && (
              <p className="mt-2 text-xs text-body">
                * Per-account GL matching is not available in v1 (no Account FK on BankDetail).
                The combined GL BANK+CASH balance is shown on the first account only.
                All other accounts show GL N/A — this does not mean they are reconciled.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
