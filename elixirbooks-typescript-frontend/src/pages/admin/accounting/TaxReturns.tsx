import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import useDateFormatter from '@hooks/useDateFormatter';
import { useCurrencyFormatter } from '@hooks/useCurrencyFormatter';
import { PageHeader } from '@/context/PageHeaderContext';
import DateInput from '@components/admin/DateInput';
import LoaderSpinner from '@components/admin/LoaderSpinner';
import { Button, Card } from '@components/ui';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';
import { downloadExport } from '@utils/downloadExport';
import MtdPanel from './MtdPanel';

/**
 * Regime-aware Tax Returns page.
 *
 * Renders the period tax-return *summary* (the official box/label values) for the
 * tenant's configured tax regime — UK VAT 9-box, AU BAS, NZ GST, EU VAT summary +
 * EC Sales List. Figures are GL-derived on the backend; this page only displays
 * and exports them. India keeps its dedicated GSTR pages (we link to those).
 */

// Broader than src/types/taxRate.ts (which only lists the India/generic set) —
// this page covers all server-supported regimes.
type TaxRegime =
  | 'GST_INDIA'
  | 'US_SALES_TAX'
  | 'VAT_UK'
  | 'VAT_EU'
  | 'GST_AU'
  | 'GST_NZ'
  | 'VAT_GENERIC'
  | 'NONE';

interface Period {
  from: string;
  to: string;
}

interface UkVatBoxes {
  box1: string;
  box2: string;
  box3: string;
  box4: string;
  box5: string;
  box6: string;
  box7: string;
  box8: string;
  box9: string;
}
interface UkVatResponse {
  boxes: UkVatBoxes;
  period: Period;
}

interface AuBasResponse {
  G1: string;
  '1A': string;
  '1B': string;
  netGst: string;
  period: Period;
}

interface NzGstResponse {
  totalSales: string;
  outputGst: string;
  totalPurchases: string;
  inputGst: string;
  netGst: string;
  period: Period;
}

interface EuVatResponse {
  outputVat: string;
  inputVat: string;
  netVat: string;
  salesExTax: string;
  purchasesExTax: string;
  period: Period;
}

interface EcSalesRow {
  customerVatNumber: string;
  country: string;
  netValue: string;
  indicator: string;
}
interface EcSalesResponse {
  rows: EcSalesRow[];
  total: string;
}

interface OssRow {
  country: string;
  rate: number | string;
  netValue: string;
  vatDue: string;
}
interface OssResponse {
  rows: OssRow[];
  totals: { netValue: string; vatDue: string };
  period: Period;
}

interface OssThresholdResponse {
  ytdB2cCrossBorder: string;
  threshold: number;
  exceeded: boolean;
  year: number;
}

const DISCLAIMER =
  'Summary for filing — figures are GL-derived; not submitted to the tax authority.';

const REGIME_LABELS: Record<TaxRegime, string> = {
  VAT_UK: 'UK VAT (9-box)',
  GST_AU: 'Australia BAS (GST)',
  GST_NZ: 'New Zealand GST',
  VAT_EU: 'EU VAT + EC Sales List',
  GST_INDIA: 'India GST (GSTR)',
  US_SALES_TAX: 'US Sales Tax',
  VAT_GENERIC: 'Generic VAT',
  NONE: 'No tax regime',
};

// Regimes that have a dedicated return on this page.
const SUPPORTED: TaxRegime[] = ['VAT_UK', 'GST_AU', 'GST_NZ', 'VAT_EU'];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Default the picker to the current calendar quarter. */
function currentQuarter(): Period {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3); // 0..3
  const from = new Date(now.getFullYear(), q * 3, 1);
  const to = new Date(now.getFullYear(), q * 3 + 3, 0); // last day of quarter
  return { from: isoDate(from), to: isoDate(to) };
}

export default function TaxReturns() {
  const token = useSelector((s: RootState) => s.auth.token);
  const user = useSelector((s: RootState) => s.auth.user);
  const { formatDate } = useDateFormatter();
  const { format: money } = useCurrencyFormatter(true);

  const q = currentQuarter();
  const [from, setFrom] = useState(q.from);
  const [to, setTo] = useState(q.to);

  const [regime, setRegime] = useState<TaxRegime>('NONE');
  const [data, setData] = useState<
    UkVatResponse | AuBasResponse | NzGstResponse | EuVatResponse | null
  >(null);
  const [ecSales, setEcSales] = useState<EcSalesResponse | null>(null);
  const [oss, setOss] = useState<OssResponse | null>(null);
  const [ossThreshold, setOssThreshold] = useState<OssThresholdResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Resolve the tenant's configured regime once.
  useEffect(() => {
    let cancelled = false;
    async function loadRegime() {
      if (!user?.id) return;
      try {
        const r = await axios.get(`${Constants.FETCH_COMPANY_SETTINGS_URL}/${user.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const resolved = r.data?.data?.taxRegime as TaxRegime | undefined;
        if (!cancelled && resolved && resolved in REGIME_LABELS) {
          setRegime(resolved);
        }
      } catch {
        // Non-critical: leave the regime selector at its default.
      }
    }
    loadRegime();
    return () => {
      cancelled = true;
    };
  }, [user?.id, token]);

  const endpointFor = useCallback((r: TaxRegime): string | null => {
    switch (r) {
      case 'VAT_UK':
        return Constants.GET_TAX_RETURN_UK_VAT_URL;
      case 'GST_AU':
        return Constants.GET_TAX_RETURN_AU_BAS_URL;
      case 'GST_NZ':
        return Constants.GET_TAX_RETURN_NZ_GST_URL;
      case 'VAT_EU':
        return Constants.GET_TAX_RETURN_EU_VAT_URL;
      default:
        return null;
    }
  }, []);

  const load = useCallback(async () => {
    const url = endpointFor(regime);
    if (!url) {
      setData(null);
      setEcSales(null);
      return;
    }
    setLoading(true);
    try {
      const r = await axios.get(`${url}?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data?.data ?? null);

      if (regime === 'VAT_EU') {
        const ec = await axios.get(
          `${Constants.GET_TAX_RETURN_EU_EC_SALES_LIST_URL}?from=${from}&to=${to}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        setEcSales(ec.data?.data ?? null);

        const ossRes = await axios.get(
          `${Constants.GET_TAX_RETURN_EU_OSS_URL}?from=${from}&to=${to}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        setOss(ossRes.data?.data ?? null);

        const year = Number(from.slice(0, 4)) || new Date().getFullYear();
        const thr = await axios.get(
          `${Constants.GET_TAX_RETURN_EU_OSS_THRESHOLD_URL}?year=${year}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        setOssThreshold(thr.data?.data ?? null);
      } else {
        setEcSales(null);
        setOss(null);
        setOssThreshold(null);
      }
    } catch {
      toast.error('Failed to load tax return');
      setData(null);
      setEcSales(null);
      setOss(null);
      setOssThreshold(null);
    } finally {
      setLoading(false);
    }
  }, [endpointFor, regime, from, to, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function exportCsv() {
    const url = endpointFor(regime);
    if (!url) return;
    try {
      await downloadExport(
        `${url}.csv?from=${from}&to=${to}`,
        `tax-return-${regime.toLowerCase()}-${from}_${to}.csv`,
      );
    } catch {
      toast.error('Failed to export CSV');
    }
  }

  async function exportEcSalesCsv() {
    try {
      await downloadExport(
        `${Constants.GET_TAX_RETURN_EU_EC_SALES_LIST_URL}.csv?from=${from}&to=${to}`,
        `ec-sales-list-${from}_${to}.csv`,
      );
    } catch {
      toast.error('Failed to export EC Sales List CSV');
    }
  }

  async function exportOssCsv() {
    try {
      await downloadExport(
        `${Constants.GET_TAX_RETURN_EU_OSS_URL}.csv?from=${from}&to=${to}`,
        `oss-return-${from}_${to}.csv`,
      );
    } catch {
      toast.error('Failed to export OSS return CSV');
    }
  }

  const supported = SUPPORTED.includes(regime);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="Tax Returns">
        {supported && (
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              Print / Save PDF
            </Button>
            <Button variant="primary" size="sm" onClick={exportCsv} className="ml-2">
              Export CSV
            </Button>
          </>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-end gap-4 mb-4 print:hidden">
        <div>
          <label className="block text-sm font-medium text-foreground pb-1">Return</label>
          <select
            value={regime}
            onChange={(e) => setRegime(e.target.value as TaxRegime)}
            className="border border-gray-300 rounded px-3 py-2 text-sm bg-white"
          >
            {(Object.keys(REGIME_LABELS) as TaxRegime[]).map((r) => (
              <option key={r} value={r}>
                {REGIME_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
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
        <Button variant="primary" size="md" onClick={load} isLoading={loading}>
          Reload
        </Button>
      </div>

      <p className="text-xs text-gray-500 mb-4">{DISCLAIMER}</p>

      {loading && (
        <div className="py-10">
          <LoaderSpinner />
        </div>
      )}

      {!loading && (
        <>
          {regime === 'GST_INDIA' && (
            <Card title="India GST">
              <p className="text-sm text-muted-foreground">
                India GST returns are filed on the dedicated GST filing pages.
              </p>
              <div className="mt-3 flex gap-3 text-sm">
                <Link className="text-primary hover:underline" to="/admin/accounting/reports/gstr-1">
                  Go to GSTR-1
                </Link>
                <Link className="text-primary hover:underline" to="/admin/accounting/reports/gstr-3b">
                  Go to GSTR-3B
                </Link>
              </div>
            </Card>
          )}

          {!supported && regime !== 'GST_INDIA' && (
            <Card title={REGIME_LABELS[regime]}>
              <p className="text-sm text-muted-foreground">
                No period tax return is available for the current tax regime. Configure a
                supported regime (UK VAT, AU BAS, NZ GST or EU VAT) in Company Settings, or
                pick one above.
              </p>
            </Card>
          )}

          {supported && data && (
            <div className="space-y-4">
              <div className="text-xs text-gray-400">
                Period: {formatDate(from)} — {formatDate(to)}
              </div>

              {regime === 'VAT_UK' && (
                <UkVatTable boxes={(data as UkVatResponse).boxes} money={money} />
              )}
              {regime === 'GST_AU' && <AuBasTable data={data as AuBasResponse} money={money} />}
              {regime === 'GST_NZ' && <NzGstTable data={data as NzGstResponse} money={money} />}
              {regime === 'VAT_EU' && (
                <>
                  <EuVatTable data={data as EuVatResponse} money={money} />
                  <Card
                    title="EC Sales List"
                    actions={
                      <Button variant="primary" size="sm" onClick={exportEcSalesCsv}>
                        Export CSV
                      </Button>
                    }
                  >
                    {!ecSales || ecSales.rows.length === 0 ? (
                      <p className="text-xs text-gray-400">
                        No cross-border reverse-charge sales in period.
                      </p>
                    ) : (
                      <div className="overflow-x-auto border border-border rounded-md">
                        <table className="w-full text-sm border-collapse">
                          <thead className="bg-gray-100 text-xs uppercase text-muted-foreground">
                            <tr>
                              <th className="px-4 py-3 text-left border-b border-border">Country</th>
                              <th className="px-4 py-3 text-left border-b border-border">Customer VAT #</th>
                              <th className="px-4 py-3 text-left border-b border-border">Indicator</th>
                              <th className="px-4 py-3 text-right border-b border-border">Net value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ecSales.rows.map((row, i) => (
                              <tr key={i} className="border-b border-border hover:bg-gray-50">
                                <td className="px-4 py-3">{row.country}</td>
                                <td className="px-4 py-3">{row.customerVatNumber}</td>
                                <td className="px-4 py-3">{row.indicator}</td>
                                <td className="px-4 py-3 text-right font-mono">
                                  {money(Number(row.netValue))}
                                </td>
                              </tr>
                            ))}
                            <tr className="font-semibold border-b border-border">
                              <td className="px-4 py-3" colSpan={3}>
                                Total
                              </td>
                              <td className="px-4 py-3 text-right font-mono">
                                {money(Number(ecSales.total))}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>

                  {ossThreshold && (
                    <div
                      className={`rounded-xl border px-4 py-3 text-sm ${
                        ossThreshold.exceeded
                          ? 'border-warning bg-warning-soft text-warning-strong'
                          : 'border-border bg-muted text-muted-foreground'
                      }`}
                    >
                      <span className="font-medium">
                        B2C cross-border YTD {money(Number(ossThreshold.ytdB2cCrossBorder))} /{' '}
                        {money(Number(ossThreshold.threshold))}
                      </span>
                      <span className="ml-2">
                        {ossThreshold.exceeded
                          ? `— distance-selling threshold exceeded for ${ossThreshold.year}. Destination-rate VAT (OSS) applies.`
                          : `— within the distance-selling threshold for ${ossThreshold.year}.`}
                      </span>
                    </div>
                  )}

                  <Card
                    title="OSS return (per destination country)"
                    actions={
                      <Button variant="primary" size="sm" onClick={exportOssCsv}>
                        Export CSV
                      </Button>
                    }
                  >
                    {!oss || oss.rows.length === 0 ? (
                      <p className="text-xs text-gray-400">
                        No B2C cross-border EU sales in period.
                      </p>
                    ) : (
                      <div className="overflow-x-auto border border-border rounded-md">
                        <table className="w-full text-sm border-collapse">
                          <thead className="bg-gray-100 text-xs uppercase text-muted-foreground">
                            <tr>
                              <th className="px-4 py-3 text-left border-b border-border">Country</th>
                              <th className="px-4 py-3 text-right border-b border-border">Rate</th>
                              <th className="px-4 py-3 text-right border-b border-border">Net</th>
                              <th className="px-4 py-3 text-right border-b border-border">VAT due</th>
                            </tr>
                          </thead>
                          <tbody>
                            {oss.rows.map((row, i) => (
                              <tr key={i} className="border-b border-border hover:bg-gray-50">
                                <td className="px-4 py-3">{row.country}</td>
                                <td className="px-4 py-3 text-right font-mono">{Number(row.rate)}%</td>
                                <td className="px-4 py-3 text-right font-mono">{money(Number(row.netValue))}</td>
                                <td className="px-4 py-3 text-right font-mono">{money(Number(row.vatDue))}</td>
                              </tr>
                            ))}
                            <tr className="font-semibold border-b border-border">
                              <td className="px-4 py-3" colSpan={2}>
                                Total
                              </td>
                              <td className="px-4 py-3 text-right font-mono">
                                {money(Number(oss.totals.netValue))}
                              </td>
                              <td className="px-4 py-3 text-right font-mono">
                                {money(Number(oss.totals.vatDue))}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                </>
              )}
            </div>
          )}

          {regime === 'VAT_UK' && (
            <div className="mt-6">
              <MtdPanel />
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Money = (n: number) => string;

function BoxTable({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; description?: string; value: string; emphasis?: boolean }[];
}) {
  return (
    <Card title={title}>
      <div className="overflow-x-auto border border-border rounded-md">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-100 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left border-b border-border w-24">Box</th>
              <th className="px-4 py-3 text-left border-b border-border">Description</th>
              <th className="px-4 py-3 text-right border-b border-border w-40">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={`border-b border-border hover:bg-gray-50 ${r.emphasis ? 'font-semibold' : ''}`}>
                <td className="px-4 py-3">{r.label}</td>
                <td className="px-4 py-3">{r.description ?? ''}</td>
                <td className="px-4 py-3 text-right font-mono">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function UkVatTable({ boxes, money }: { boxes: UkVatBoxes; money: Money }) {
  return (
    <BoxTable
      title="UK VAT Return (9-box)"
      rows={[
        { label: 'Box 1', description: 'VAT due on sales and other outputs', value: money(Number(boxes.box1)) },
        { label: 'Box 2', description: 'VAT due on acquisitions from EU member states', value: money(Number(boxes.box2)) },
        { label: 'Box 3', description: 'Total VAT due (Box 1 + Box 2)', value: money(Number(boxes.box3)) },
        { label: 'Box 4', description: 'VAT reclaimed on purchases and other inputs', value: money(Number(boxes.box4)) },
        { label: 'Box 5', description: 'Net VAT to pay or reclaim (Box 3 − Box 4)', value: money(Number(boxes.box5)), emphasis: true },
        { label: 'Box 6', description: 'Total value of sales excluding VAT', value: money(Number(boxes.box6)) },
        { label: 'Box 7', description: 'Total value of purchases excluding VAT', value: money(Number(boxes.box7)) },
        { label: 'Box 8', description: 'Total value of EU goods supplied', value: money(Number(boxes.box8)) },
        { label: 'Box 9', description: 'Total value of EU goods acquired', value: money(Number(boxes.box9)) },
      ]}
    />
  );
}

function AuBasTable({ data, money }: { data: AuBasResponse; money: Money }) {
  return (
    <BoxTable
      title="Australia BAS (GST)"
      rows={[
        { label: 'G1', description: 'Total sales (including GST)', value: money(Number(data.G1)) },
        { label: '1A', description: 'GST on sales', value: money(Number(data['1A'])) },
        { label: '1B', description: 'GST on purchases', value: money(Number(data['1B'])) },
        { label: 'Net GST', description: '1A − 1B', value: money(Number(data.netGst)), emphasis: true },
      ]}
    />
  );
}

function NzGstTable({ data, money }: { data: NzGstResponse; money: Money }) {
  return (
    <BoxTable
      title="New Zealand GST"
      rows={[
        { label: 'Total sales', description: 'Total sales and income (including GST)', value: money(Number(data.totalSales)) },
        { label: 'Output GST', description: 'GST collected on sales', value: money(Number(data.outputGst)) },
        { label: 'Total purchases', description: 'Total purchases and expenses (including GST)', value: money(Number(data.totalPurchases)) },
        { label: 'Input GST', description: 'GST paid on purchases', value: money(Number(data.inputGst)) },
        { label: 'Net GST', description: 'Output GST − Input GST', value: money(Number(data.netGst)), emphasis: true },
      ]}
    />
  );
}

function EuVatTable({ data, money }: { data: EuVatResponse; money: Money }) {
  return (
    <BoxTable
      title="EU VAT Summary"
      rows={[
        { label: 'Output VAT', description: 'VAT on sales', value: money(Number(data.outputVat)) },
        { label: 'Input VAT', description: 'VAT reclaimable on purchases', value: money(Number(data.inputVat)) },
        { label: 'Net VAT', description: 'Output VAT − Input VAT', value: money(Number(data.netVat)), emphasis: true },
        { label: 'Sales (ex-VAT)', description: 'Total sales excluding VAT', value: money(Number(data.salesExTax)) },
        { label: 'Purchases (ex-VAT)', description: 'Total purchases excluding VAT', value: money(Number(data.purchasesExTax)) },
      ]}
    />
  );
}
