import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import useDateFormatter from '@hooks/useDateFormatter';
import { Badge, Button, Card } from '@components/ui';
import NoRecords from '@components/admin/NoRecords';

/**
 * HMRC Making Tax Digital (MTD) VAT panel.
 *
 * Shown on the UK Tax Returns view. Lets the operator supply their own HMRC
 * software-vendor credentials (BYOK), connect via OAuth, list VAT obligations
 * and submit the 9-box return. When the feature is not configured/enabled the
 * backend runs in MOCK mode (deterministic data, no real filing) — surfaced
 * here with a clear banner.
 *
 * Config (PUT /mtd/config) is gated to the workspace OWNER, read from the
 * active membership rather than from the user record: ownership is a property
 * of a membership now, so the same person can be an owner in one company and
 * an ordinary member in another.
 */

interface MtdConfig {
  enabled: boolean;
  useSandbox: boolean;
  vrn: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
  connected: boolean;
}

interface Obligation {
  periodKey: string;
  start: string;
  end: string;
  due: string;
  status: string; // 'O' (open) | 'F' (fulfilled) etc.
}

interface SubmitReceipt {
  formBundleNumber?: string;
  processingDate?: string;
  [k: string]: unknown;
}

/** Default the obligations window to the current calendar year. */
function currentYearRange(): { from: string; to: string } {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export default function MtdPanel() {
  const token = useSelector((s: RootState) => s.auth.token);
  const activeTenant = useSelector((s: RootState) => s.auth.activeTenant);
  const { formatDate } = useDateFormatter();
  const isOwner = !!activeTenant?.isOwner;

  const authHeader = { headers: { Authorization: `Bearer ${token}` } };

  const [config, setConfig] = useState<MtdConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);

  // Config form state (BYOK).
  const [vrn, setVrn] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [useSandbox, setUseSandbox] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const [connecting, setConnecting] = useState(false);

  const { from: yFrom, to: yTo } = currentYearRange();
  const [from, setFrom] = useState(yFrom);
  const [to, setTo] = useState(yTo);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [obligationMode, setObligationMode] = useState<'mock' | 'live' | null>(null);
  const [loadingObligations, setLoadingObligations] = useState(false);
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SubmitReceipt | null>(null);

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const r = await axios.get(Constants.MTD_CONFIG_URL, authHeader);
      const cfg = r.data?.data as MtdConfig | undefined;
      if (cfg) {
        setConfig(cfg);
        setVrn(cfg.vrn ?? '');
        setUseSandbox(!!cfg.useSandbox);
        setEnabled(!!cfg.enabled);
      }
    } catch {
      // Non-critical: the panel still renders in mock mode.
    } finally {
      setLoadingConfig(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Mock mode when the feature is off or no client id is stored.
  const mockMode = !config?.enabled || !config?.hasClientId;

  async function saveConfig() {
    setSaving(true);
    try {
      await axios.put(
        Constants.MTD_CONFIG_URL,
        { enabled, useSandbox, vrn, clientId, clientSecret },
        authHeader,
      );
      toast.success('MTD settings saved');
      setClientSecret(''); // never keep the secret in component state after save
      setClientId('');
      await loadConfig();
    } catch {
      toast.error('Failed to save MTD settings');
    } finally {
      setSaving(false);
    }
  }

  async function connect() {
    setConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/admin/accounting/reports/tax-returns`;
      const r = await axios.get(
        `${Constants.MTD_AUTH_URL}?redirectUri=${encodeURIComponent(redirectUri)}`,
        authHeader,
      );
      const url = r.data?.data?.url as string | undefined;
      const note = r.data?.data?.note as string | undefined;
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        toast.info(note ?? 'Mock mode — configure HMRC credentials to connect for real.');
      }
    } catch {
      toast.error('Failed to start HMRC connection');
    } finally {
      setConnecting(false);
    }
  }

  const loadObligations = useCallback(async () => {
    setLoadingObligations(true);
    try {
      const r = await axios.get(
        `${Constants.MTD_OBLIGATIONS_URL}?from=${from}&to=${to}`,
        authHeader,
      );
      const payload = r.data?.data as
        | { mode?: 'mock' | 'live'; obligations?: Obligation[] }
        | undefined;
      setObligations(payload?.obligations ?? []);
      setObligationMode(payload?.mode ?? null);
    } catch {
      toast.error('Failed to load obligations');
      setObligations([]);
      setObligationMode(null);
    } finally {
      setLoadingObligations(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, token]);

  async function submitReturn(ob: Obligation) {
    setSubmittingKey(ob.periodKey);
    try {
      const r = await axios.post(
        Constants.MTD_SUBMIT_URL,
        { periodKey: ob.periodKey, from: ob.start, to: ob.end },
        authHeader,
      );
      const rec = r.data?.data as SubmitReceipt | undefined;
      setReceipt(rec ?? null);
      toast.success(
        rec?.formBundleNumber
          ? `VAT return submitted — bundle ${rec.formBundleNumber}`
          : 'VAT return submitted',
      );
      await loadObligations();
    } catch {
      toast.error('Failed to submit VAT return');
    } finally {
      setSubmittingKey(null);
    }
  }

  const statusBadge = (status: string) =>
    status === 'O' ? (
      <Badge color="warning" variant="soft">Open</Badge>
    ) : status === 'F' ? (
      <Badge color="success" variant="soft">Fulfilled</Badge>
    ) : (
      <Badge color="gray" variant="soft">{status}</Badge>
    );

  return (
    <div className="space-y-4">
      <Card
        title="HMRC Making Tax Digital"
        actions={
          config?.connected ? (
            <Badge color="success" variant="soft">Connected</Badge>
          ) : (
            <Badge color="gray" variant="soft">Not connected</Badge>
          )
        }
      >
        {/* Mode banner */}
        {mockMode && (
          <div className="rounded-xl border border-warning bg-warning-soft text-warning-strong px-4 py-3 text-sm mb-4">
            <span className="font-medium">Demo / mock mode</span> — returns are not filed with
            HMRC. Enter your HMRC software-vendor credentials and enable to file for real
            (requires HMRC recognition).
          </div>
        )}

        {/* Connect + status */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Button variant="outline" size="sm" onClick={connect} isLoading={connecting}>
            Connect to HMRC
          </Button>
          <span className="text-xs text-gray-500">
            {config?.connected
              ? 'OAuth tokens stored. You can fetch obligations and submit returns.'
              : 'Authorise Elixir Books with HMRC to enable live filing.'}
            {config?.useSandbox ? ' (Sandbox)' : ''}
          </span>
        </div>

        {/* Config form (Owner only) */}
        {isOwner ? (
          <div className="border-t border-border pt-4">
            <h4 className="text-sm font-semibold text-foreground mb-3">HMRC credentials (BYOK)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground pb-1">
                  VAT registration number (VRN)
                </label>
                <input
                  type="text"
                  value={vrn}
                  onChange={(e) => setVrn(e.target.value)}
                  placeholder="123456789"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground pb-1">Client ID</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder={config?.hasClientId ? 'stored — leave blank to keep' : ''}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground pb-1">
                  Client Secret{' '}
                  {config?.hasClientSecret && (
                    <span className="text-gray-400">(saved — leave blank to keep)</span>
                  )}
                </label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  autoComplete="new-password"
                  placeholder={config?.hasClientSecret ? '••••••••' : ''}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                />
              </div>
              <div className="flex items-end gap-6">
                <label className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={useSandbox}
                    onChange={(e) => setUseSandbox(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Use sandbox
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Enabled
                </label>
              </div>
            </div>
            <div className="mt-4">
              <Button variant="primary" size="sm" onClick={saveConfig} isLoading={saving}>
                Save MTD settings
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400 border-t border-border pt-4">
            Only the account owner can configure HMRC credentials.
          </p>
        )}
      </Card>

      {/* Obligations + submit */}
      <Card
        title="VAT obligations"
        actions={
          <div className="flex items-center gap-2">
            {obligationMode && (
              <Badge color={obligationMode === 'live' ? 'success' : 'gray'} variant="soft">
                {obligationMode === 'live' ? 'Live' : 'Mock'}
              </Badge>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={loadObligations}
              isLoading={loadingObligations}
            >
              Refresh obligations
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-foreground pb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground pb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm bg-white"
            />
          </div>
        </div>

        <div className="overflow-x-auto border border-border rounded-md">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-100 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left border-b border-border">Period key</th>
                <th className="px-4 py-3 text-left border-b border-border">Period</th>
                <th className="px-4 py-3 text-left border-b border-border">Due</th>
                <th className="px-4 py-3 text-left border-b border-border">Status</th>
                <th className="px-4 py-3 text-right border-b border-border">Action</th>
              </tr>
            </thead>
            <tbody>
              {obligations.length === 0 ? (
                <NoRecords
                  colSpan={5}
                  message="No obligations loaded. Use “Refresh obligations” to fetch VAT periods."
                />
              ) : (
                obligations.map((ob) => (
                  <tr key={ob.periodKey} className="border-b border-border hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono">{ob.periodKey}</td>
                    <td className="px-4 py-3">
                      {formatDate(ob.start)} — {formatDate(ob.end)}
                    </td>
                    <td className="px-4 py-3">{formatDate(ob.due)}</td>
                    <td className="px-4 py-3">{statusBadge(ob.status)}</td>
                    <td className="px-4 py-3 text-right">
                      {ob.status === 'O' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => submitReturn(ob)}
                          isLoading={submittingKey === ob.periodKey}
                        >
                          Submit VAT return
                        </Button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Submission receipt */}
      {receipt && (
        <Card
          title="Last submission receipt"
          actions={
            <Button variant="white" size="sm" onClick={() => setReceipt(null)}>
              Dismiss
            </Button>
          }
        >
          <dl className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <dt className="text-gray-500">Form bundle number</dt>
              <dd className="font-mono">{receipt.formBundleNumber ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Processing date</dt>
              <dd>{receipt.processingDate ? formatDate(receipt.processingDate) : '—'}</dd>
            </div>
          </dl>
          {mockMode && (
            <p className="text-xs text-warning mt-3">
              Mock receipt — this return was not filed with HMRC.
            </p>
          )}
        </Card>
      )}

      {loadingConfig && <p className="text-xs text-gray-400">Loading MTD configuration…</p>}
    </div>
  );
}
