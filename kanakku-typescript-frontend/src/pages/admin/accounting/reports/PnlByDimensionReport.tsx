import { useEffect, useState, type SyntheticEvent } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import SearchableDropdown from '@components/admin/SearchableDropdown';
import useDateFormatter from '@hooks/useDateFormatter';
import { PageHeader } from '@/context/PageHeaderContext';
import DateInput from '@components/admin/DateInput';
import { ymdStringToDate, dateToYmdString } from '@utils/converters';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface DimensionOption {
  id: string;
  name: string;
  code?: string;
}

interface DimensionInfo {
  id?: string;
  code?: string;
  name?: string;
}

interface PnlData {
  period?: string;
  costCenter?: DimensionInfo | null;
  project?: DimensionInfo | null;
  revenue?: number | string;
  expenses?: number | string;
  net?: number | string;
}

type DimensionType = 'cost-center' | 'project';

export default function PnlByDimensionReport() {
  const token = useSelector((s: RootState) => s.auth.token);
  const { formatDate } = useDateFormatter();
  const today = isoDate(new Date());
  const yearStart = isoDate(new Date(new Date().getFullYear(), 0, 1));

  const [dimension, setDimension] = useState<DimensionType>('cost-center');
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(today);
  const [options, setOptions] = useState<DimensionOption[]>([]);
  const [selected, setSelected] = useState<DimensionOption | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [data, setData] = useState<PnlData | null>(null);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);

  // Load dimension options when dimension tab changes
  async function loadOptions(dim: DimensionType) {
    setListLoading(true);
    setSelected(null);
    setInputValue('');
    setData(null);
    try {
      const url = dim === 'cost-center' ? Constants.FETCH_COST_CENTERS_URL : Constants.FETCH_PROJECTS_URL;
      const r = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      const raw: DimensionOption[] = r.data?.data ?? [];
      // Ensure each item has an id and name
      setOptions(raw.map((item) => ({
        id: String(item.id),
        name: item.name ?? item.code ?? String(item.id),
        code: item.code,
      })));
    } catch {
      toast.error(`Failed to load ${dim === 'cost-center' ? 'cost centers' : 'projects'}`);
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    loadOptions(dimension);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimension]);

  async function load() {
    if (!selected) {
      toast.error(`Please select a ${dimension === 'cost-center' ? 'cost center' : 'project'} first.`);
      return;
    }
    setLoading(true);
    try {
      const baseUrl = dimension === 'cost-center'
        ? Constants.FETCH_PNL_BY_COST_CENTER_URL
        : Constants.FETCH_PNL_BY_PROJECT_URL;
      const paramKey = dimension === 'cost-center' ? 'costCenterId' : 'projectId';
      const r = await axios.get(`${baseUrl}?from=${from}&to=${to}&${paramKey}=${selected.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data?.data ?? null);
    } catch {
      toast.error('Failed to load P&L report');
    } finally {
      setLoading(false);
    }
  }

  function handleDimensionChange(dim: DimensionType) {
    setDimension(dim);
    setData(null);
  }

  const toNum = (v: number | string | undefined): number | null => {
    if (v === undefined || v === null || v === '') return null;
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  };

  const revenue = toNum(data?.revenue);
  const expense = toNum(data?.expenses);
  const net = toNum(data?.net);

  // Dimension header label (e.g. "CC-100 — Marketing")
  const dim = data ? (dimension === 'cost-center' ? data.costCenter : data.project) : null;
  const dimLabel = dim
    ? [dim.code, dim.name].filter(Boolean).join(' — ')
    : selected?.name ?? '';

  return (
    <div className="p-6 max-w-4xl mx-auto bg-white">
      <PageHeader title="P&L by Dimension">
        <button type="button" onClick={() => window.print()} className="px-3 py-1 text-sm border rounded">
          Print / Save PDF
        </button>
      </PageHeader>

      {/* Dimension toggle */}
      <div className="flex gap-2 mb-6 print:hidden">
        <button
          type="button"
          onClick={() => handleDimensionChange('cost-center')}
          className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${
            dimension === 'cost-center'
              ? 'bg-purple-600 text-white border-purple-600'
              : 'text-gray-600 border-gray-300 hover:border-purple-400'
          }`}
        >
          Cost Center
        </button>
        <button
          type="button"
          onClick={() => handleDimensionChange('project')}
          className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${
            dimension === 'project'
              ? 'bg-purple-600 text-white border-purple-600'
              : 'text-gray-600 border-gray-300 hover:border-purple-400'
          }`}
        >
          Project
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-4 mb-6 print:hidden">
        <div className="min-w-[200px]">
          <SearchableDropdown
            label={dimension === 'cost-center' ? 'Cost Center' : 'Project'}
            value={selected}
            options={options}
            inputValue={inputValue}
            onInputChange={(_e: SyntheticEvent, v: string) => setInputValue(v)}
            onChange={(_e: SyntheticEvent, v: DimensionOption | null) => setSelected(v)}
            loading={listLoading}
            placeholder={`Select ${dimension === 'cost-center' ? 'cost center' : 'project'}`}
          />
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
        <button
          type="button"
          onClick={load}
          disabled={loading || !selected}
          className="px-3 py-1 text-sm bg-purple-600 text-white rounded disabled:opacity-50"
        >
          Run Report
        </button>
      </div>

      {loading && <p className="text-gray-500">Loading…</p>}

      {!loading && data && (
        <div className="space-y-3 text-sm">
          <div className="mb-2">
            <div className="text-base font-semibold text-gray-700">
              {dimLabel || (dimension === 'cost-center' ? 'Cost Center' : 'Project')}
            </div>
            <div className="text-xs text-gray-400">
              {formatDate(from)} to {formatDate(to)}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded p-4">
              <div className="text-xs text-gray-500 mb-1">Revenue</div>
              <div className="text-lg font-semibold text-green-700">{revenue !== null ? fmt(revenue) : '—'}</div>
            </div>
            <div className="border rounded p-4">
              <div className="text-xs text-gray-500 mb-1">Expense</div>
              <div className="text-lg font-semibold text-red-600">{expense !== null ? fmt(expense) : '—'}</div>
            </div>
            <div className={`border-2 rounded p-4 ${net !== null && net >= 0 ? 'border-green-500 bg-green-50' : 'border-red-400 bg-red-50'}`}>
              <div className="text-xs text-gray-500 mb-1">Net</div>
              <div className={`text-lg font-bold ${net !== null && net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {net !== null ? fmt(net) : '—'}
              </div>
            </div>
          </div>

        </div>
      )}

      {!loading && !data && (
        <p className="text-sm text-gray-400">
          Select a {dimension === 'cost-center' ? 'cost center' : 'project'} and run the report to view its profit &amp; loss.
        </p>
      )}
    </div>
  );
}
