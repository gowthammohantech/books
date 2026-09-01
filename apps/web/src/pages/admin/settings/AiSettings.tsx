import api from '@lib/apiClient';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Sparkles, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

import Constants from '@constants/api';
import AiUsageChart from '@components/admin/ai/AiUsageChart';
import { Button, Card, FormField, Select } from '@components/ui';
import { PageHeader } from '@/context/PageHeaderContext';

type Provider = 'CLAUDE' | 'OPENAI' | 'MOCK';

interface ConfigState {
  provider: Provider;
  enabled: boolean;
  apiKey: string;
  apiKeyHint: string | null;
  hasApiKey: boolean;
  extractionModel: string;
  chatModel: string;
  monthlyBudgetUsd: number;
}

interface TestResult {
  ok: boolean;
  error?: string;
}

// Model dropdowns. Lists kept short — full set lands with provider work
// in H.2/H.3 and via free-form override in the API (extractionModel/
// chatModel are stored as strings on the server).
const MODEL_OPTIONS: Record<Provider, { extraction: string[]; chat: string[] }> = {
  CLAUDE: {
    extraction: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
    chat: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']
  },
  OPENAI: {
    extraction: ['gpt-4o-mini', 'gpt-4o'],
    chat: ['gpt-4o', 'gpt-4o-mini']
  },
  MOCK: {
    extraction: ['mock-extract-v1'],
    chat: ['mock-chat-v1']
  }
};

const DEFAULTS: Record<Provider, { extraction: string; chat: string }> = {
  CLAUDE: { extraction: 'claude-haiku-4-5-20251001', chat: 'claude-sonnet-4-6' },
  OPENAI: { extraction: 'gpt-4o-mini', chat: 'gpt-4o' },
  MOCK: { extraction: 'mock-extract-v1', chat: 'mock-chat-v1' }
};

const HELP_TEXT =
  'Elixir Books ships with optional AI features. Bring your own Anthropic Claude or OpenAI key — billing goes to your account, no markup. Typical costs: ~$0.003 per bill scan, ~$0.005 per chat reply. The Mock provider returns canned data for demos without any external calls.';

export default function AiSettings() {
  const [form, setForm] = useState<ConfigState>({
    provider: 'MOCK',
    enabled: false,
    apiKey: '',
    apiKeyHint: null,
    hasApiKey: false,
    extractionModel: DEFAULTS.MOCK.extraction,
    chatModel: DEFAULTS.MOCK.chat,
    monthlyBudgetUsd: 0
  });
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  function authHeader() {
    return {};
  }

  async function load() {
    try {
      const r = await api.get(Constants.AI_CONFIG_URL, { headers: authHeader() });
      const cfg = r.data?.data?.config;
      if (cfg) {
        const provider = (cfg.provider ?? 'MOCK') as Provider;
        setForm({
          provider,
          enabled: !!cfg.enabled,
          apiKey: '',
          apiKeyHint: cfg.apiKeyHint ?? null,
          hasApiKey: !!cfg.hasApiKey,
          extractionModel: cfg.extractionModel ?? DEFAULTS[provider].extraction,
          chatModel: cfg.chatModel ?? DEFAULTS[provider].chat,
          monthlyBudgetUsd: Number(cfg.monthlyBudgetUsd ?? 0)
        });
      }
    } catch {
      /* first load — ignore */
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof ConfigState>(key: K, value: ConfigState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  }

  function handleProviderChange(next: Provider) {
    setForm((prev) => ({
      ...prev,
      provider: next,
      // Reset model selections to provider defaults so the dropdowns
      // never show an option that doesn't belong to the active provider.
      extractionModel: DEFAULTS[next].extraction,
      chatModel: DEFAULTS[next].chat
    }));
    setTestResult(null);
  }

  async function handleSave() {
    setLoading(true);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {
        provider: form.provider,
        enabled: form.enabled,
        extractionModel: form.extractionModel,
        chatModel: form.chatModel,
        monthlyBudgetUsd: form.monthlyBudgetUsd
      };
      if (form.apiKey.trim().length > 0) {
        body.apiKey = form.apiKey.trim();
      }
      const r = await api.put(Constants.AI_CONFIG_URL, body, { headers: authHeader() });
      const cfg = r.data?.data?.config;
      if (cfg) {
        setForm((prev) => ({
          ...prev,
          apiKey: '',
          apiKeyHint: cfg.apiKeyHint ?? null,
          hasApiKey: !!cfg.hasApiKey,
          extractionModel: cfg.extractionModel ?? prev.extractionModel,
          chatModel: cfg.chatModel ?? prev.chatModel,
          monthlyBudgetUsd: Number(cfg.monthlyBudgetUsd ?? 0)
        }));
      }
      toast.success('AI configuration saved');
    } catch (e) {
      const msg = axios.isAxiosError(e)
        ? (e.response?.data as { message?: string })?.message ?? 'Save failed'
        : 'Save failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.post(Constants.AI_CONFIG_TEST_URL, {}, { headers: authHeader() });
      const data = r.data?.data as TestResult;
      setTestResult(data);
      if (data?.ok) toast.success('Provider responded successfully');
      else toast.error(data?.error ?? 'Provider rejected the request');
    } catch (e) {
      const msg = axios.isAxiosError(e)
        ? (e.response?.data as { message?: string })?.message ?? 'Test failed'
        : 'Test failed';
      setTestResult({ ok: false, error: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  }

  async function handleDisable() {
    if (!window.confirm('Disable AI features and clear the stored API key?')) return;
    setDisabling(true);
    setTestResult(null);
    try {
      const r = await api.delete(Constants.AI_CONFIG_URL, { headers: authHeader() });
      const cfg = r.data?.data?.config;
      if (cfg) {
        setForm((prev) => ({
          ...prev,
          enabled: false,
          apiKey: '',
          apiKeyHint: null,
          hasApiKey: false,
          provider: (cfg.provider ?? prev.provider) as Provider
        }));
      }
      toast.success('AI features disabled');
    } catch (e) {
      const msg = axios.isAxiosError(e)
        ? (e.response?.data as { message?: string })?.message ?? 'Disable failed'
        : 'Disable failed';
      toast.error(msg);
    } finally {
      setDisabling(false);
    }
  }

  const showApiKeyField = form.provider !== 'MOCK';
  const models = MODEL_OPTIONS[form.provider];

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="text-primary" size={22} />
            AI Settings
          </span>
        }
      >
        <Button
          type="button"
          variant="outline"
          onClick={handleTest}
          isLoading={testing}
          disabled={testing || (form.provider !== 'MOCK' && !form.hasApiKey && !form.apiKey)}
        >
          {testing ? 'Testing…' : 'Test Connection'}
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={handleDisable}
          isLoading={disabling}
          disabled={disabling || (!form.enabled && !form.hasApiKey)}
        >
          {disabling ? 'Disabling…' : 'Disable AI'}
        </Button>
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
      <p className="text-sm text-muted-foreground mb-5 leading-relaxed">{HELP_TEXT}</p>

      <Card className="space-y-5">
        {/* Provider radio */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Provider</label>
          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="ai-provider"
                value="CLAUDE"
                checked={form.provider === 'CLAUDE'}
                onChange={() => handleProviderChange('CLAUDE')}
                className="mt-1"
              />
              <div>
                <div className="text-sm font-medium text-foreground">Anthropic Claude</div>
                <div className="text-xs text-muted-foreground">
                  Recommended. Bring your own key from console.anthropic.com.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="ai-provider"
                value="OPENAI"
                checked={form.provider === 'OPENAI'}
                onChange={() => handleProviderChange('OPENAI')}
                className="mt-1"
              />
              <div>
                <div className="text-sm font-medium text-foreground">OpenAI</div>
                <div className="text-xs text-muted-foreground">
                  GPT-4o family. Bring your own key from platform.openai.com.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="ai-provider"
                value="MOCK"
                checked={form.provider === 'MOCK'}
                onChange={() => handleProviderChange('MOCK')}
                className="mt-1"
              />
              <div>
                <div className="text-sm font-medium text-foreground">Mock (demo / disabled)</div>
                <div className="text-xs text-muted-foreground">
                  No external calls. Returns canned data — useful for demos and to disable AI
                  entirely.
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* API key */}
        {showApiKeyField && (
          <FormField
            label="API key"
            helper={
              <>
                {form.hasApiKey && <span>(stored — leave blank to keep) </span>}
                Encrypted at rest with AES-256-GCM. Never returned in API responses.
              </>
            }
            type="password"
            autoComplete="off"
            value={form.apiKey}
            onChange={(e) => update('apiKey', e.target.value)}
            placeholder={form.hasApiKey ? form.apiKeyHint ?? 'sk-...' : 'sk-...'}
            className="font-mono"
          />
        )}

        {/* Models */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select
            label="Extraction model"
            value={form.extractionModel}
            onChange={(e) => update('extractionModel', e.target.value)}
            options={models.extraction.map((m) => ({ value: m, label: m }))}
          />
          <Select
            label="Chat model"
            value={form.chatModel}
            onChange={(e) => update('chatModel', e.target.value)}
            options={models.chat.map((m) => ({ value: m, label: m }))}
          />
        </div>

        {/* Budget */}
        <FormField
          label="Monthly budget (USD, soft cap)"
          type="number"
          min={0}
          step="0.01"
          value={form.monthlyBudgetUsd}
          onChange={(e) => update('monthlyBudgetUsd', Number(e.target.value))}
          helper="Informational soft cap. See your actual spend in the usage chart below."
        />

        {/* Enabled toggle */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => update('enabled', e.target.checked)}
          />
          <span className="text-sm font-medium text-foreground">Enable AI features</span>
        </label>

        {/* Test result banner */}
        {testResult && (
          <div
            className={`flex items-start gap-2 p-3 rounded-md text-sm ${
              testResult.ok
                ? 'bg-success-soft border border-success text-success-strong'
                : 'bg-destructive-soft border border-destructive text-destructive-strong'
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 size={18} className="text-success mt-0.5" />
            ) : (
              <XCircle size={18} className="text-destructive mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              {testResult.ok ? (
                <span>Provider responded successfully.</span>
              ) : (
                <>
                  <div className="font-medium">Provider test failed</div>
                  <div className="text-xs break-all">{testResult.error}</div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Footer hint */}
        {form.provider !== 'MOCK' && !form.hasApiKey && (
          <div className="flex items-center pt-2 border-t border-border">
            <span className="text-xs text-warning flex items-center gap-1">
              <AlertTriangle size={14} />
              Save a key before testing
            </span>
          </div>
        )}
      </Card>

      {/* Usage chart + cost summary (H.4) */}
      <AiUsageChart />
    </div>
  );
}
