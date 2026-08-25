import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { toast } from 'sonner';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import { Button, Card, FormField, Select, fieldControlClasses } from '@components/ui';
import { PageHeader } from '@/context/PageHeaderContext';

type Provider = '' | 'twilio' | 'whatsapp_cloud';

interface FormState {
  whatsappEnabled: boolean;
  whatsappProvider: Provider;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioSender: string;
  cloudPhoneNumberId: string;
  cloudAccessToken: string;
  defaultTemplate: string;
}

const DEFAULT_TEMPLATE = 'Hi {customer}, your invoice {invoiceNumber} for {amount} is ready. {link}';

export default function MessagingSettings() {
  const token = useSelector((s: RootState) => s.auth.token);
  const [form, setForm] = useState<FormState>({
    whatsappEnabled: false,
    whatsappProvider: '',
    twilioAccountSid: '',
    twilioAuthToken: '',
    twilioSender: '',
    cloudPhoneNumberId: '',
    cloudAccessToken: '',
    defaultTemplate: DEFAULT_TEMPLATE,
  });
  const [loading, setLoading] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);

  async function load() {
    try {
      const r = await axios.get(Constants.GET_MESSAGING_CONFIG_URL, { headers: { Authorization: `Bearer ${token}` } });
      const cfg = r.data?.data?.config;
      if (cfg) {
        setForm((prev) => ({
          ...prev,
          whatsappEnabled: !!cfg.whatsappEnabled,
          whatsappProvider: (cfg.whatsappProvider ?? '') as Provider,
          defaultTemplate: cfg.defaultTemplate ?? DEFAULT_TEMPLATE,
        }));
        setHasCredentials(!!cfg.hasCredentials);
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setLoading(true);
    try {
      const whatsappConfig: Record<string, unknown> = {};
      if (form.whatsappProvider === 'twilio') {
        whatsappConfig.accountSid = form.twilioAccountSid;
        whatsappConfig.authToken = form.twilioAuthToken;
        whatsappConfig.sender = form.twilioSender;
      } else if (form.whatsappProvider === 'whatsapp_cloud') {
        whatsappConfig.phoneNumberId = form.cloudPhoneNumberId;
        whatsappConfig.accessToken = form.cloudAccessToken;
      }
      const body = {
        whatsappEnabled: form.whatsappEnabled,
        whatsappProvider: form.whatsappProvider || null,
        whatsappConfig,
        defaultTemplate: form.defaultTemplate,
      };
      await axios.put(Constants.UPSERT_MESSAGING_CONFIG_URL, body, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Messaging config saved');
      load();
    } catch (e) {
      toast.error(axios.isAxiosError(e) ? (e.response?.data as { message?: string })?.message ?? 'Save failed' : 'Save failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader title="Messaging (WhatsApp)">
        <Button
          type="button"
          variant="primary"
          onClick={handleSave}
          isLoading={loading}
          disabled={loading}
        >
          {loading ? 'Saving…' : 'Save'}
        </Button>
      </PageHeader>
      <p className="text-sm text-body mb-6">
        Configure WhatsApp delivery for invoices and reminders. If no provider is selected, sends fall back to a <code>wa.me</code> deep link
        which opens WhatsApp pre-filled. For automated provider delivery, choose Twilio or WhatsApp Cloud API.
      </p>

      <Card className="space-y-5">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.whatsappEnabled}
            onChange={(e) => update('whatsappEnabled', e.target.checked)}
          />
          <span className="text-sm font-medium text-heading">Enable WhatsApp messaging</span>
        </label>

        <Select
          label="Provider"
          value={form.whatsappProvider}
          onChange={(e) => update('whatsappProvider', e.target.value as Provider)}
          options={[
            { value: '', label: '(none — use wa.me link fallback)' },
            { value: 'twilio', label: 'Twilio' },
            { value: 'whatsapp_cloud', label: 'WhatsApp Cloud API (Meta)' },
          ]}
        />

        {form.whatsappProvider === 'twilio' && (
          <div className="space-y-3 border-l-2 border-purple-200 pl-3">
            <FormField
              label="Account SID"
              value={form.twilioAccountSid}
              onChange={(e) => update('twilioAccountSid', e.target.value)}
              placeholder={hasCredentials ? '(stored — leave blank to keep)' : ''}
            />
            <FormField
              label="Auth Token"
              type="password"
              value={form.twilioAuthToken}
              onChange={(e) => update('twilioAuthToken', e.target.value)}
              placeholder={hasCredentials ? '(stored — leave blank to keep)' : ''}
            />
            <FormField
              label="Sender (whatsapp:+14155238886)"
              value={form.twilioSender}
              onChange={(e) => update('twilioSender', e.target.value)}
            />
          </div>
        )}

        {form.whatsappProvider === 'whatsapp_cloud' && (
          <div className="space-y-3 border-l-2 border-purple-200 pl-3">
            <FormField
              label="Phone Number ID"
              value={form.cloudPhoneNumberId}
              onChange={(e) => update('cloudPhoneNumberId', e.target.value)}
              placeholder={hasCredentials ? '(stored — leave blank to keep)' : ''}
            />
            <FormField
              label="Access Token"
              type="password"
              value={form.cloudAccessToken}
              onChange={(e) => update('cloudAccessToken', e.target.value)}
              placeholder={hasCredentials ? '(stored — leave blank to keep)' : ''}
            />
          </div>
        )}

        <FormField
          label="Default invoice template"
          helper={
            <>
              Tokens: <code>{'{customer}'}</code>, <code>{'{invoiceNumber}'}</code>, <code>{'{amount}'}</code>, <code>{'{link}'}</code>
            </>
          }
        >
          {(field) => (
            <textarea
              id={field.id}
              rows={3}
              value={form.defaultTemplate}
              onChange={(e) => update('defaultTemplate', e.target.value)}
              className={fieldControlClasses(false)}
            />
          )}
        </FormField>
      </Card>
    </div>
  );
}
