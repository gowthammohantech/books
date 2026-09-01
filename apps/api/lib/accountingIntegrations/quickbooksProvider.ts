import type { IntegrationKind } from '@prisma/client';

import type { IntegrationProvider } from './xeroProvider';

export class QuickBooksProvider implements IntegrationProvider {
  readonly kind = 'QUICKBOOKS' as const;

  buildOAuthUrl(state: string, config: { clientId?: string; redirectUri?: string }): string {
    const clientId = config.clientId ?? '<QB_CLIENT_ID>';
    const redirectUri = config.redirectUri ?? 'http://localhost:8080/api/admin/accounting-integrations/quickbooks/callback';
    const scope = 'com.intuit.quickbooks.accounting';
    return `https://appcenter.intuit.com/connect/oauth2?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(_code: string, _config: unknown): Promise<{ accessToken: string; refreshToken: string; tenantId?: string }> {
    return { accessToken: 'stub_qb_access', refreshToken: 'stub_qb_refresh', tenantId: 'stub-realm' };
  }

  async syncInvoices(_config: unknown): Promise<{ pushed: number; pulled: number }> {
    return { pushed: 0, pulled: 0 };
  }
}

export const quickbooksProvider = new QuickBooksProvider();
