import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import { Button, Card, FormField } from '@components/ui';
import { PageHeader } from '@/context/PageHeaderContext';

interface StripeFormData {
  enabled: boolean;
  livemode: boolean;
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  successUrl: string;
  cancelUrl: string;
}

const initial: StripeFormData = {
  enabled: false,
  livemode: false,
  secretKey: '',
  publishableKey: '',
  webhookSecret: '',
  successUrl: '',
  cancelUrl: '',
};

export default function StripeConfig() {
  const token = useSelector((s: RootState) => s.auth.token);
  const [data, setData] = useState<StripeFormData>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios
      .get(`${Constants.GET_GATEWAY_CONFIGS_URL}/STRIPE?reveal=true`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        const cfg = r.data?.data?.gatewayConfig;
        if (!cfg) return;
        const c = (cfg.config ?? {}) as Record<string, string | undefined>;
        setData({
          enabled: cfg.enabled ?? false,
          livemode: cfg.livemode ?? false,
          secretKey: c.secretKey ?? '',
          publishableKey: c.publishableKey ?? '',
          webhookSecret: c.webhookSecret ?? '',
          successUrl: c.successUrl ?? '',
          cancelUrl: c.cancelUrl ?? '',
        });
      })
      .catch(() => { /* not configured yet */ });
  }, [token]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.put(
        `${Constants.UPSERT_GATEWAY_CONFIG_URL}/STRIPE`,
        {
          enabled: data.enabled,
          livemode: data.livemode,
          config: {
            secretKey: data.secretKey,
            publishableKey: data.publishableKey,
            webhookSecret: data.webhookSecret,
            successUrl: data.successUrl || undefined,
            cancelUrl: data.cancelUrl || undefined,
          },
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      toast.success('Stripe config saved');
    } catch {
      toast.error('Failed to save config');
    } finally {
      setSaving(false);
    }
  }

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/public/stripe/webhook` : '';

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="Stripe Configuration">
        <Button
          type="submit"
          form="stripe-config-form"
          variant="primary"
          isLoading={saving}
          disabled={saving}
        >
          {saving ? 'Saving' : 'Save'}
        </Button>
      </PageHeader>
      <p className="text-sm text-body mb-6">
        Enter your Stripe API credentials. Use test-mode keys for development, then flip the Live mode toggle when ready for production.
      </p>
      <form id="stripe-config-form" onSubmit={handleSave}>
        <Card className="space-y-4">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={data.enabled} onChange={(e) => setData((p) => ({ ...p, enabled: e.target.checked }))} />
              <span className="text-sm text-heading">Enabled</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={data.livemode} onChange={(e) => setData((p) => ({ ...p, livemode: e.target.checked }))} />
              <span className="text-sm text-heading">Live mode</span>
            </label>
          </div>
          <FormField
            label="Secret Key"
            type="password"
            value={data.secretKey}
            onChange={(e) => setData((p) => ({ ...p, secretKey: e.target.value }))}
            placeholder="sk_test_..."
          />
          <FormField
            label="Publishable Key"
            value={data.publishableKey}
            onChange={(e) => setData((p) => ({ ...p, publishableKey: e.target.value }))}
            placeholder="pk_test_..."
          />
          <FormField
            label="Webhook Secret"
            type="password"
            value={data.webhookSecret}
            onChange={(e) => setData((p) => ({ ...p, webhookSecret: e.target.value }))}
            placeholder="whsec_..."
            helper={
              <>
                Register this webhook URL in Stripe dashboard:{' '}
                <code className="bg-surface px-2 py-1 rounded-control">{webhookUrl}</code>
              </>
            }
          />
          <FormField
            label={<>Success URL <span className="text-body">(optional)</span></>}
            type="url"
            value={data.successUrl}
            onChange={(e) => setData((p) => ({ ...p, successUrl: e.target.value }))}
            placeholder="Defaults to /admin/invoices"
          />
          <FormField
            label={<>Cancel URL <span className="text-body">(optional)</span></>}
            type="url"
            value={data.cancelUrl}
            onChange={(e) => setData((p) => ({ ...p, cancelUrl: e.target.value }))}
            placeholder="Defaults to /admin/invoices"
          />
        </Card>
      </form>
    </div>
  );
}
