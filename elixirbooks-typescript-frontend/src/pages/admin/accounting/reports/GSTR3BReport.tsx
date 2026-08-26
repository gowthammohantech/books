import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import useDateFormatter from '@hooks/useDateFormatter';
import DrillLink from '@components/admin/DrillLink';
import { PageHeader } from '@/context/PageHeaderContext';
import DateInput from '@components/admin/DateInput';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';

interface TaxBlock {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

interface TaxPayable {
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

interface GSTR3BData {
  period: { from: string; to: string };
  '3.1_outwardSupplies': TaxBlock;
  '3.2_interStateUnregistered': { taxableValue: number };
  '4_itcEligible': TaxBlock;
  '6.1_taxPayable': TaxPayable;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthStart(d: Date): string {
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function TaxBlockRow({
  block,
  drill,
}: {
  block: TaxBlock;
  drill?: { to: string; params: Record<string, string>; title: string };
}) {
  const Cell = ({ value }: { value: number }) => (
    <DrillLink to={drill?.to} params={drill?.params} title={drill?.title}>
      {value.toFixed(2)}
    </DrillLink>
  );
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      <div>
        <div className="text-xs text-gray-500">Taxable Value</div>
        <div className="font-medium"><Cell value={block.taxableValue} /></div>
      </div>
      <div>
        <div className="text-xs text-gray-500">CGST</div>
        <div className="font-medium"><Cell value={block.cgst} /></div>
      </div>
      <div>
        <div className="text-xs text-gray-500">SGST</div>
        <div className="font-medium"><Cell value={block.sgst} /></div>
      </div>
      <div>
        <div className="text-xs text-gray-500">IGST</div>
        <div className="font-medium"><Cell value={block.igst} /></div>
      </div>
      <div>
        <div className="text-xs text-gray-500">CESS</div>
        <div className="font-medium"><Cell value={block.cess} /></div>
      </div>
    </div>
  );
}

export default function GSTR3BReport() {
  const token = useSelector((s: RootState) => s.auth.token);
  const { formatDate } = useDateFormatter();
  const today = isoDate(new Date());
  const start = monthStart(new Date());
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<GSTR3BData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await axios.get(`${Constants.GET_GSTR3B_URL}?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data?.data ?? null);
    } catch {
      setError('Failed to load GSTR-3B report');
    } finally {
      setLoading(false);
    }
  }

  async function download(format: 'json' | 'csv') {
    try {
      const res = await axios.get(
        `${Constants.EXPORT_GSTR3B_URL}?from=${from}&to=${to}&format=${format}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: 'blob',
        },
      );
      const blob = new Blob([res.data], { type: format === 'csv' ? 'text/csv' : 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gstr3b_${from}_${to}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(`Failed to download GSTR-3B ${format.toUpperCase()}`);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto bg-white">
      <PageHeader title="GSTR-3B">
        <button type="button" onClick={() => window.print()} className="px-3 py-1 text-sm border rounded">
          Print / Save PDF
        </button>
        <button type="button" onClick={() => download('json')} className="px-3 py-1 text-sm border rounded ml-2">
          Download JSON
        </button>
        <button type="button" onClick={() => download('csv')} className="px-3 py-1 text-sm border rounded ml-2">
          Download CSV
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
            <h2 className="font-medium mb-2">3.1 Outward Supplies</h2>
            <TaxBlockRow
              block={data['3.1_outwardSupplies']}
              drill={{
                to: '/admin/invoices',
                params: { startDate: from, endDate: to, invoiceType: 'INVOICE' },
                title: 'View source invoices',
              }}
            />
          </section>

          <section className="border rounded p-4">
            <h2 className="font-medium mb-2">3.2 Inter-State Supplies to Unregistered Persons</h2>
            <div className="flex justify-between">
              <span>Taxable Value</span>
              <span className="font-medium">{data['3.2_interStateUnregistered'].taxableValue.toFixed(2)}</span>
            </div>
          </section>

          <section className="border rounded p-4">
            <h2 className="font-medium mb-2">4. Eligible ITC (Input Tax Credit)</h2>
            <TaxBlockRow
              block={data['4_itcEligible']}
              drill={{
                to: '/admin/purchases',
                params: { startDate: from, endDate: to },
                title: 'View source purchases',
              }}
            />
          </section>

          <section className="border-2 border-purple-600 rounded p-4 bg-purple-100">
            <h2 className="font-medium mb-2">6.1 Tax Payable</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <div className="text-xs text-gray-500">CGST</div>
                <div className="font-medium">{data['6.1_taxPayable'].cgst.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">SGST</div>
                <div className="font-medium">{data['6.1_taxPayable'].sgst.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">IGST</div>
                <div className="font-medium">{data['6.1_taxPayable'].igst.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">CESS</div>
                <div className="font-medium">{data['6.1_taxPayable'].cess.toFixed(2)}</div>
              </div>
            </div>
            <div className="flex justify-between text-lg font-bold border-t pt-2 mt-3">
              <span>TOTAL Tax Payable</span>
              <span>
                {(
                  data['6.1_taxPayable'].cgst +
                  data['6.1_taxPayable'].sgst +
                  data['6.1_taxPayable'].igst +
                  data['6.1_taxPayable'].cess
                ).toFixed(2)}
              </span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
