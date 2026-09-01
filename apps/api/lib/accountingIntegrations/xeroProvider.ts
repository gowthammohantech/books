import type { IntegrationKind } from '@prisma/client';

export interface IntegrationProvider {
  kind: IntegrationKind;
  buildOAuthUrl(state: string, config: { clientId?: string; redirectUri?: string }): string;
  exchangeCode(code: string, config: unknown): Promise<{ accessToken: string; refreshToken: string; tenantId?: string }>;
  syncInvoices(config: unknown): Promise<{ pushed: number; pulled: number }>;
}

export class XeroProvider implements IntegrationProvider {
  readonly kind = 'XERO' as const;

  buildOAuthUrl(state: string, config: { clientId?: string; redirectUri?: string }): string {
    const clientId = config.clientId ?? '<XERO_CLIENT_ID>';
    const redirectUri = config.redirectUri ?? 'http://localhost:8080/api/admin/accounting-integrations/xero/callback';
    const scope = 'offline_access accounting.transactions accounting.contacts';
    return `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(_code: string, _config: unknown): Promise<{ accessToken: string; refreshToken: string; tenantId?: string }> {
    // STUB: real impl exchanges code at https://identity.xero.com/connect/token
    return { accessToken: 'stub_access_token', refreshToken: 'stub_refresh_token', tenantId: 'stub-tenant' };
  }

  async syncInvoices(_config: unknown): Promise<{ pushed: number; pulled: number }> {
    // STUB: real impl POSTs invoices to https://api.xero.com/api.xro/2.0/Invoices and fetches updates
    return { pushed: 0, pulled: 0 };
  }
}

export const xeroProvider = new XeroProvider();
