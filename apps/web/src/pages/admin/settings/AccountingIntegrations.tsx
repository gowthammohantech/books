import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import useDateFormatter from '@hooks/useDateFormatter';
import { Button, Badge, Card, FormField } from '@components/ui';
import { PageHeader } from '@/context/PageHeaderContext';

type Kind = 'XERO' | 'QUICKBOOKS';

interface Integration {
  id: string;
  kind: Kind;
  enabled: boolean;
  lastSyncedAt: string | null;
  syncStatus: string | null;
  errorMessage: string | null;
}

export default function AccountingIntegrations() {
  const token = useSelector((s: RootState) => s.auth.token);
  const { formatDateTime } = useDateFormatter();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [clientIds, setClientIds] = useState<Record<Kind, string>>({ XERO: '', QUICKBOOKS: '' });
  const [redirectUris, setRedirectUris] = useState<Record<Kind, string>>({
    XERO: typeof window !== 'undefined' ? `${window.location.origin}/admin/integrations/xero/callback` : '',
    QUICKBOOKS: typeof window !== 'undefined' ? `${window.location.origin}/admin/integrations/quickbooks/callback` : '',
  });

  async function load() {
    try {
      const r = await axios.get(Constants.GET_ACCOUNTING_INTEGRATIONS_URL, { headers: { Authorization: `Bearer ${token}` } });
      setIntegrations(r.data?.data?.integrations ?? []);
    } catch { /* ignore */ }
  }

  useEffect(() => { load();   }, []);

  function getStatus(kind: Kind) {
    return integrations.find((i) => i.kind === kind);
  }

  async function handleConnect(kind: Kind) {
    try {
      const r = await axios.post(
        `${Constants.CONNECT_ACCOUNTING_INTEGRATION_URL}/${kind}/connect`,
        { clientId: clientIds[kind], redirectUri: redirectUris[kind] },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const oauthUrl = r.data?.data?.oauthUrl;
      if (oauthUrl) {
        window.open(oauthUrl, '_blank');
        toast.success('Opened OAuth flow in new tab');
      }
    } catch {
      toast.error('Failed to start OAuth');
    }
  }

  async function handleSync(kind: Kind) {
    try {
      const r = await axios.post(
        `${Constants.SYNC_ACCOUNTING_INTEGRATION_URL}/${kind}/sync`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      toast.success(r.data?.message ?? 'Synced');
      load();
    } catch (e) {
      toast.error(axios.isAxiosError(e) ? (e.response?.data as { message?: string })?.message ?? 'Sync failed' : 'Sync failed');
    }
  }

  async function handleDisconnect(kind: Kind) {
    if (!window.confirm(`Disconnect ${kind}?`)) return;
    try {
      await axios.delete(`${Constants.DISCONNECT_ACCOUNTING_INTEGRATION_URL}/${kind}`, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Disconnected');
      load();
    } catch {
      toast.error('Failed to disconnect');
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader title="Accounting Integrations" />
      <p className="text-sm text-muted-foreground mb-6">Connect Elixir Books to Xero or QuickBooks for two-way invoice sync. Provider implementations are stubbed — real OAuth requires registering an app with the provider.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(['XERO', 'QUICKBOOKS'] as const).map((kind) => {
          const status = getStatus(kind);
          const enabled = !!status?.enabled;
          return (
            <Card
              key={kind}
              padded={false}
              header={
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                  <h2 className="text-lg font-semibold text-foreground">{kind === 'XERO' ? 'Xero' : 'QuickBooks Online'}</h2>
                  <Badge color={enabled ? 'success' : 'gray'}>
                    {enabled ? 'Connected' : 'Disconnected'}
                  </Badge>
                </div>
              }
            >
              <div className="p-5">
                {!enabled ? (
                  <div className="space-y-3">
                    <FormField
                      label="Client ID"
                      value={clientIds[kind]}
                      onChange={(e) => setClientIds((p) => ({ ...p, [kind]: e.target.value }))}
                    />
                    <FormField
                      label="Redirect URI"
                      value={redirectUris[kind]}
                      onChange={(e) => setRedirectUris((p) => ({ ...p, [kind]: e.target.value }))}
                    />
                    <Button variant="primary" onClick={() => handleConnect(kind)}>Connect</Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Last synced: {status?.lastSyncedAt ? formatDateTime(status.lastSyncedAt) : 'Never'}</p>
                    <p className="text-xs text-muted-foreground">Status: {status?.syncStatus ?? '—'}</p>
                    {status?.errorMessage && <p className="text-xs text-destructive">Error: {status.errorMessage}</p>}
                    <div className="flex gap-2">
                      <Button variant="primary" onClick={() => handleSync(kind)}>Sync Now</Button>
                      <Button variant="white" onClick={() => handleDisconnect(kind)}>Disconnect</Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
