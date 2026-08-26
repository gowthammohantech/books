import type { Router } from 'express';

// Auto-generates OpenAPI path stubs from the live Express routers so EVERY
// endpoint shows up in /api/docs, even the ones without hand-written @swagger
// JSDoc. Hand-written docs (from swagger-jsdoc) always win on merge.

export interface RouterMount {
  base: string; // mount path WITHOUT the /api prefix (servers url already = /api)
  router: Router;
  secured: boolean; // requires bearer auth
  tag?: string; // force a single tag for every route under this mount
}

// Nicer tag names for known path prefixes; anything else is Title-Cased.
const TAG_OVERRIDES: Record<string, string> = {
  auth: 'Auth',
  login: 'Auth',
  customers: 'Customers',
  invoices: 'Invoices',
  'recurring-invoices': 'Invoices',
  'invoice-templates': 'Invoices',
  quotations: 'Quotations',
  payments: 'Payments',
  'payment-transactions': 'Payments',
  gateway: 'Payments',
  'supplier-payments': 'Purchases',
  suppliers: 'Purchases',
  purchases: 'Purchases',
  'purchase-orders': 'Purchases',
  'debit-notes': 'Purchases',
  'credit-notes': 'Invoices',
  products: 'Products',
  categories: 'Products',
  brands: 'Products',
  units: 'Products',
  inventory: 'Inventory',
  accounting: 'Accounting',
  accounts: 'Accounting',
  'journal-entries': 'Accounting',
  reports: 'Reports',
  report: 'Reports',
  dashboard: 'Dashboard',
  banking: 'Banking',
  'bank-accounts': 'Banking',
  'bank-petty': 'Banking',
  transactions: 'Banking',
  expenses: 'Expenses',
  'recurring-expenses': 'Expenses',
  'expense-category': 'Expenses',
  'petty-cash': 'Expenses',
  budgets: 'Reports',
  'cost-centers': 'Reports',
  projects: 'Reports',
  'pnl-by-cost-center': 'Reports',
  'pnl-by-project': 'Reports',
  // settings / config / localization
  currency: 'Settings',
  countries: 'Settings',
  country: 'Settings',
  states: 'Settings',
  state: 'Settings',
  cities: 'Settings',
  city: 'Settings',
  localization: 'Settings',
  localizations: 'Settings',
  'settings-dropdown': 'Settings',
  'system-settings': 'Settings',
  company: 'Settings',
  'company-details': 'Settings',
  'create-general-settings': 'Settings',
  'general-settings': 'Settings',
  'general-settings-list': 'Settings',
  'document-defaults': 'Settings',
  'app-version': 'Settings',
  'module-hierarchy': 'Settings',
  module: 'Settings',
  paymentmode: 'Settings',
  signatures: 'Settings',
  signaturesrecent: 'Settings',
  'custom-field': 'Settings',
  'custom-fields': 'Settings',
  customfields: 'Settings',
  'custom-field-data-types': 'Settings',
  'field-types': 'Settings',
  email: 'Settings',
  'email-template': 'Settings',
  'email-settings': 'Settings',
  'notification-types': 'Settings',
  profile: 'Settings',
  // tax
  'tax-rates': 'Tax & GST',
  'tax-groups': 'Tax & GST',
  'tax-group': 'Tax & GST',
  'tax-group-details': 'Tax & GST',
  'tax-engine': 'Tax & GST',
  tax: 'Tax & GST',
  gstr: 'Tax & GST',
  'gst-filing': 'Tax & GST',
  'e-invoices': 'E-Invoice',
  // integrations / payments
  messaging: 'Integrations',
  'accounting-integrations': 'Integrations',
  razorpay: 'Payments',
  stripe: 'Payments',
  refunds: 'Payments',
  'gateway-configs': 'Payments',
  // accounting extras
  'accounting-periods': 'Accounting',
  'exchange-rates': 'Accounting',
  ledger: 'Accounting',
  'fixed-assets': 'Accounting',
  approvals: 'Accounting',
  // purchases extras
  debitnote: 'Purchases',
  supplierpayments: 'Purchases',
  // hyphenated route families
  'product-categories': 'Products',
  'product-brands': 'Products',
  'product-units': 'Products',
  'product-taxes': 'Products',
  'purchases-minimal': 'Purchases',
  'purchases-pending': 'Purchases',
  'purchase-order': 'Purchases',
  'purchase-order-convert': 'Purchases',
  'purchase-minimal': 'Purchases',
  'bank-reconcile': 'Banking',
  'bank-transactions': 'Banking',
  'bank-transactions-reconcile': 'Banking',
  'bank-transactions-details': 'Banking',
  'bank-petty-chart': 'Banking',
  'customers-all': 'Customers',
  'quotations-minimal': 'Quotations',
  'quotations-status': 'Quotations',
  'quotation-convert-to-invoice': 'Quotations',
  'invoice-template': 'Invoices',
  invoice: 'Invoices',
  'invoices-minimal': 'Invoices',
  'invoice-payment-details': 'Invoices',
  'invoices-recurring': 'Invoices',
  'invoices-minimal-delivery': 'Invoices',
  'roles-minimal': 'Users & Roles',
  'expense-category-minimal': 'Expenses',
  'petty-cash-transaction': 'Expenses',
  // recents / misc
  productsrecent: 'Products',
  bankdetailsrecent: 'Banking',
  vehicles: 'Customers',
  'delivery-challan': 'Invoices',
  reminders: 'Reminders',
  conversation: 'AI',
  ai: 'AI',
  'activity-logs': 'Audit',
  security: 'Users & Roles',
  staff: 'Users & Roles',
  roles: 'Users & Roles',
  'user-by-role': 'Users & Roles',
  permissions: 'Users & Roles',
  user: 'Users & Roles',
  sso: 'Auth',
  public: 'Public',
};

function titleCase(seg: string): string {
  return seg
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function tagFor(routePath: string): string {
  const first = routePath.split('/').filter(Boolean)[0] || 'General';
  const key = first.replace(/[{}:].*$/, '').toLowerCase();
  return TAG_OVERRIDES[key] ?? titleCase(key);
}

function expressToOpenApi(p: string): string {
  return p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function pathParams(p: string) {
  return [...p.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

export function generateOpenApiPaths(mounts: RouterMount[]): Record<string, any> {
  const paths: Record<string, any> = {};

  for (const { base, router, secured, tag: forcedTag } of mounts) {
    const stack: any[] = (router as any)?.stack ?? [];
    for (const layer of stack) {
      const route = layer?.route;
      if (!route || !route.path) continue;
      const routePaths: string[] = Array.isArray(route.path) ? route.path : [route.path];

      for (const rp of routePaths) {
        const full = `${base}${rp}`;
        const oapiPath = expressToOpenApi(full);
        const params = pathParams(full);
        const tag = forcedTag ?? tagFor(rp);
        const methods = Object.keys(route.methods || {}).filter((m) => m !== '_all');

        for (const method of methods) {
          paths[oapiPath] = paths[oapiPath] ?? {};
          if (paths[oapiPath][method]) continue; // never clobber an existing op
          paths[oapiPath][method] = {
            tags: [tag],
            summary: `${method.toUpperCase()} ${full}`,
            ...(params.length ? { parameters: params } : {}),
            security: secured ? [{ bearerAuth: [] }] : [],
            responses: {
              '200': { description: 'Successful response' },
              ...(secured ? { '401': { $ref: '#/components/responses/Unauthorized' } } : {}),
              '500': { $ref: '#/components/responses/ServerError' },
            },
          };
        }
      }
    }
  }
  return paths;
}

/**
 * Merge auto-generated paths into an existing OpenAPI spec. Hand-written
 * operations (already present in spec.paths) are preserved; only missing
 * path+method combinations are added.
 */
export function mergeGeneratedPaths(
  spec: any,
  mounts: RouterMount[],
): { added: number; total: number } {
  const generated = generateOpenApiPaths(mounts);
  spec.paths = spec.paths ?? {};
  let added = 0;
  for (const [p, ops] of Object.entries(generated)) {
    spec.paths[p] = spec.paths[p] ?? {};
    for (const [method, op] of Object.entries(ops as Record<string, unknown>)) {
      if (!spec.paths[p][method]) {
        spec.paths[p][method] = op;
        added++;
      }
    }
  }
  const total = Object.values(spec.paths).reduce(
    (n: number, ops: any) => n + Object.keys(ops).length,
    0,
  );
  return { added, total };
}

module.exports = { generateOpenApiPaths, mergeGeneratedPaths };
module.exports.generateOpenApiPaths = generateOpenApiPaths;
module.exports.mergeGeneratedPaths = mergeGeneratedPaths;
