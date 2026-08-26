import { useEffect, useState } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';

import Constants from '@constants/api';
import type { GatewayConfigSummary, GatewayKind } from '@models/payment';
import type { RootState } from '@store/index';
import { Button, Badge, Card, FormField } from '@components/ui';
import { PageHeader } from '@/context/PageHeaderContext';

interface PaymentLinkMethod {
  id: string;
  name: string;
  defaultUrl: string | null;
  enabled: boolean;
  sortOrder: number;
}

function PaymentLinkMethodsSection() {
  const token = useSelector((s: RootState) => s.auth.token);
  const [methods, setMethods] = useState<PaymentLinkMethod[]>([]);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const load = () => {
    axios
      .get(Constants.PAYMENT_LINK_METHODS_URL, auth)
      .then((r) => setMethods(r.data?.data ?? []))
      .catch(() => setMethods([]));
  };

  useEffect(load, [token]);

  const add = async () => {
    if (!newName.trim()) {
      toast.warning('Enter a method name (e.g. Wise)');
      return;
    }
    try {
      setSaving(true);
      await axios.post(
        Constants.PAYMENT_LINK_METHODS_URL,
        { name: newName.trim(), defaultUrl: newUrl.trim() || null },
        auth,
      );
      setNewName('');
      setNewUrl('');
      toast.success('Payment method added');
      load();
    } catch {
      toast.error('Failed to add method');
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id: string, data: Partial<PaymentLinkMethod>) => {
    try {
      await axios.put(`${Constants.PAYMENT_LINK_METHODS_URL}/${id}`, data, auth);
    } catch {
      toast.error('Failed to update method');
      load();
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this payment method?')) return;
    try {
      await axios.delete(`${Constants.PAYMENT_LINK_METHODS_URL}/${id}`, auth);
      load();
    } catch {
      toast.error('Failed to delete method');
    }
  };

  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold text-heading mb-1">Payment links &amp; buttons</h2>
      <p className="text-sm text-body mb-4">
        Add link-based payment methods (Wise, Revolut, PayPal, a Stripe Payment Link, …). These appear
        as checkboxes on each invoice; the per-invoice URL you enter there becomes a "Pay with" button
        on the invoice's public view link. No API keys needed.
      </p>

      {/* Existing methods */}
      <div className="space-y-2 mb-4">
        {methods.length === 0 && (
          <p className="text-sm text-body">No link-based methods yet.</p>
        )}
        {methods.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-2 border border-border rounded-control p-2">
            <FormField
              defaultValue={m.name}
              onBlur={(e) => e.target.value.trim() !== m.name && patch(m.id, { name: e.target.value.trim() })}
              containerClassName="w-40"
              placeholder="Name (e.g. Wise)"
            />
            <FormField
              defaultValue={m.defaultUrl ?? ''}
              onBlur={(e) => (e.target.value.trim() || null) !== m.defaultUrl && patch(m.id, { defaultUrl: e.target.value.trim() || null })}
              containerClassName="flex-1 min-w-[220px]"
              placeholder="Default URL (optional)"
            />
            <label className="flex items-center gap-1 text-sm text-body">
              <input
                type="checkbox"
                defaultChecked={m.enabled}
                onChange={(e) => patch(m.id, { enabled: e.target.checked })}
              />
              Enabled
            </label>
            <Button
              type="button"
              variant="ghost"
              onClick={() => remove(m.id)}
              className="text-danger hover:bg-danger-soft p-1.5"
              title="Delete"
            >
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
      </div>

      {/* Add new */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <FormField
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          containerClassName="w-40"
          placeholder="Name (e.g. Wise)"
        />
        <FormField
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          containerClassName="flex-1 min-w-[220px]"
          placeholder="Default URL (optional)"
        />
        <Button
          type="button"
          variant="primary"
          onClick={add}
          disabled={saving}
        >
          Add method
        </Button>
      </div>
    </div>
  );
}

export default function PaymentGateways() {
  const token = useSelector((s: RootState) => s.auth.token);
  const [configs, setConfigs] = useState<GatewayConfigSummary[]>([]);

  useEffect(() => {
    axios
      .get(Constants.GET_GATEWAY_CONFIGS_URL, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setConfigs(r.data?.data?.gatewayConfigs ?? []))
      .catch(() => setConfigs([]));
  }, [token]);

  const status = (kind: GatewayKind) => configs.find((c) => c.kind === kind);

  const gateways: Array<{ kind: GatewayKind; name: string; note: string }> = [
    { kind: 'RAZORPAY', name: 'Razorpay', note: 'India-focused; supports UPI, cards, netbanking.' },
    { kind: 'STRIPE', name: 'Stripe', note: 'Global; supports cards, wallets, etc.' },
    { kind: 'OFFLINE', name: 'Offline / Manual', note: 'Record payments received outside the system.' },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Payment Gateways" />
      <p className="text-sm text-body mb-6">
        Configure how you accept payments.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {gateways.map((g) => {
          const c = status(g.kind);
          const enabled = !!c?.enabled;
          return (
            <Card
              key={g.kind}
              padded={false}
              header={
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                  <h2 className="text-lg font-semibold text-heading">{g.name}</h2>
                  <Badge color={enabled ? 'success' : 'gray'}>
                    {enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
              }
            >
              <div className="p-5">
                <p className="text-xs text-body mb-3">{g.note}</p>
                {g.kind === 'RAZORPAY' && (
                  <Link to="/admin/settings/payment-gateways/razorpay" className="text-sm text-purple-700 underline">
                    Configure
                  </Link>
                )}
                {g.kind === 'STRIPE' && (
                  <Link to="/admin/settings/payment-gateways/stripe" className="text-sm text-purple-700 underline">
                    Configure
                  </Link>
                )}
                {g.kind === 'OFFLINE' && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled
                    className="text-sm text-purple-700 underline disabled:opacity-50 p-0"
                  >
                    Always available
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <PaymentLinkMethodsSection />
    </div>
  );
}
