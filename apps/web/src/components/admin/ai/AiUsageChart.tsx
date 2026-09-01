/**
 * AI usage chart + summary cards (Cluster H, slice H.4).
 *
 * Renders a stacked bar chart of the last 30 days of AI calls (extraction +
 * chat) plus three headline cards (calls last 24h / this month / cost this
 * month). Self-fetches from the usage reporting endpoints. Embedded in the
 * AI settings page below the config form.
 */
import api from '@lib/apiClient';
import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import { themeColor } from "@lib/designTokens";

import { EmptyState } from "@components/ui";

interface UsageDay {
  date: string;
  callsExtraction: number;
  callsChat: number;
  totalCostUsd: number;
}

interface UsageSummary {
  callsLast24h: number;
  callsThisMonth: number;
  totalCostThisMonth: number;
}

const EXTRACTION_COLOR = themeColor("primary"); // brand
const CHAT_COLOR = themeColor("info"); // info/cyan

function formatTick(date: string): string {
  // YYYY-MM-DD -> "DD/MM"
  const parts = date.split('-');
  if (parts.length !== 3) return date;
  return `${parts[2]}/${parts[1]}`;
}

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-950">{value}</p>
    </div>
  );
}

export default function AiUsageChart() {
  const token = useSelector((s: RootState) => s.auth.token);
  const [usage, setUsage] = useState<UsageDay[]>([]);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const headers = {};
      const [usageRes, summaryRes] = await Promise.all([
        api.get(Constants.AI_USAGE_URL, { headers }),
        api.get(Constants.AI_USAGE_SUMMARY_URL, { headers }),
      ]);
      setUsage(usageRes.data?.data?.usage ?? []);
      setSummary(summaryRes.data?.data?.summary ?? null);
    } catch (e) {
      const msg = axios.isAxiosError(e)
        ? (e.response?.data as { message?: string })?.message ?? 'Failed to load usage'
        : 'Failed to load usage';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasAnyCalls = usage.some((d) => d.callsExtraction > 0 || d.callsChat > 0);

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-lg font-semibold text-gray-950">Usage &amp; cost</h2>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Calls (last 24h)" value={summary?.callsLast24h ?? 0} />
        <SummaryCard label="Calls (this month)" value={summary?.callsThisMonth ?? 0} />
        <SummaryCard
          label="Cost (this month)"
          value={formatUsd(summary?.totalCostThisMonth ?? 0)}
        />
      </div>

      {/* Chart */}
      <div className="mt-4 rounded-md border border-gray-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">Last 30 days</p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs text-primary hover:underline"
          >
            Refresh
          </button>
        </div>

        {error ? (
          <div className="py-12 text-center text-sm text-destructive">{error}</div>
        ) : loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading usage…</div>
        ) : !hasAnyCalls ? (
          <EmptyState
            art="analysis"
            title="No AI usage yet"
            description="Scan a bill or chat with the co-pilot to see activity here."
          />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={usage} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={themeColor("border")} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatTick}
                  tick={{ fontSize: 11, fill: themeColor("muted-foreground") }}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: themeColor("muted-foreground") }} />
                <Tooltip
                  labelFormatter={(label) => `Date: ${label}`}
                  formatter={(value: number, name: string) => [value, name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="callsExtraction"
                  name="Bill scans"
                  stackId="calls"
                  fill={EXTRACTION_COLOR}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="callsChat"
                  name="Chat replies"
                  stackId="calls"
                  fill={CHAT_COLOR}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
