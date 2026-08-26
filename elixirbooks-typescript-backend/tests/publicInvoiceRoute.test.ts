/**
 * tests/publicInvoiceRoute.test.ts
 *
 * GET /api/public/invoices/:token — the public, token-gated invoice viewer (the
 * doc a CUSTOMER sees, no auth header). Mirrors tests/publicQuotationRoute.test.ts.
 *
 * Wave-3 Task 1 coverage: the payload must carry branding (company.siteLogo) and
 * a correct currency code (Invoice.currencyCode — previously hardcoded to null
 * behind a stale "schema has no currency column" comment), plus per-line amounts
 * taken from the STORED item JSON (discount/tax-aware) rather than a naive
 * qty*rate recompute. Absence assertions guard against leaking internal ids or
 * cost fields through the item allowlist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockInvoiceFindUnique,
  mockCompanySettingsFindUnique,
} = vi.hoisted(() => ({
  mockInvoiceFindUnique: vi.fn(),
  mockCompanySettingsFindUnique: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    invoice: { findUnique: mockInvoiceFindUnique },
    companySettings: { findUnique: mockCompanySettingsFindUnique },
  },
}));

const VALID_TOKEN = 'b'.repeat(64);

function baseInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    userId: 'user-1',
    invoiceNumber: 'INV-000001',
    invoiceType: 'INVOICE',
    invoiceDate: new Date('2026-07-01T00:00:00.000Z'),
    dueDate: new Date('2026-07-31T00:00:00.000Z'),
    status: 'sent',
    currencyCode: 'GBP',
    // discount=15 means the STORED amount (85) differs from a naive qty*rate
    // recompute (100) — the payload must carry the stored figure. id/productId/
    // purchase_price are internal fields that must never reach the public payload.
    items: [{ id: 'item-1', productId: 'prod-1', name: 'Widget', qty: 2, rate: 50, discount: 15, tax: 5, amount: 85, purchase_price: 12 }],
    taxableAmount: 100,
    totalDiscount: 15,
    vat: 5,
    TotalAmount: 90,
    paymentOptions: [],
    notes: 'Thanks for your business.',
    termsAndCondition: 'Due on receipt.',
    publicViewToken: VALID_TOKEN,
    publicViewEnabled: true,
    isDeleted: false,
    billToCustomer: { name: 'Acme Co', email: 'acme@example.com', phone: '555-1234', billingAddress: '1 Main St' },
    billFromUser: { firstName: 'Jane', lastName: 'Seller' },
    bank: null,
    ...overrides,
  };
}

async function buildApp() {
  // Imported after vi.mock('../lib/prisma', ...) is registered so the route
  // module picks up the mocked prisma singleton. routes/publicRoutes.ts is
  // CJS-style (`module.exports = router`, no `export default`); vitest's
  // ESM loader surfaces that as the module's `default`.
  const mod = (await import('../routes/publicRoutes')) as unknown as { default: express.Router };
  const app = express();
  app.use('/api/public', mod.default);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCompanySettingsFindUnique.mockResolvedValue({
    companyName: 'Acme Sellers Inc',
    email: 'billing@acmesellers.example',
    phone: '555-0000',
    address: '99 Seller Ave',
    publicBaseUrl: null,
    merchantUpiId: null,
    merchantName: null,
    gstin: null,
    vatNumber: null,
    abn: null,
    nzGstNumber: null,
    taxRegime: 'NONE',
    siteLogo: '/uploads/company/logo.png',
  });
});

describe('GET /api/public/invoices/:token', () => {
  it('404s on a short/invalid token (never reaches the DB)', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/public/invoices/tooshort');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Not found' });
    expect(mockInvoiceFindUnique).not.toHaveBeenCalled();
  });

  it('404s when the token does not match any invoice', async () => {
    mockInvoiceFindUnique.mockResolvedValue(null);
    const app = await buildApp();
    const res = await request(app).get(`/api/public/invoices/${VALID_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Not found' });
  });

  it('404s when publicViewEnabled is false', async () => {
    mockInvoiceFindUnique.mockResolvedValue(baseInvoice({ publicViewEnabled: false }));
    const app = await buildApp();
    const res = await request(app).get(`/api/public/invoices/${VALID_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Not found' });
  });

  it('404s when the invoice is soft-deleted', async () => {
    mockInvoiceFindUnique.mockResolvedValue(baseInvoice({ isDeleted: true }));
    const app = await buildApp();
    const res = await request(app).get(`/api/public/invoices/${VALID_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Not found' });
  });

  it('returns a sanitized 200 payload on a valid, enabled, non-deleted token', async () => {
    mockInvoiceFindUnique.mockResolvedValue(baseInvoice());
    const app = await buildApp();
    const res = await request(app).get(`/api/public/invoices/${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const invoice = res.body.data.invoice;
    expect(invoice.invoiceNumber).toBe('INV-000001');
    expect(invoice.status).toBe('sent');
    expect(invoice.TotalAmount).toBe(90);
    expect(invoice.customer).toEqual({
      name: 'Acme Co',
      email: 'acme@example.com',
      phone: '555-1234',
      billingAddress: '1 Main St',
    });
    expect(invoice.company).toEqual(
      expect.objectContaining({ companyName: 'Acme Sellers Inc' }),
    );

    // Sanitization: no internal/audit/tenant fields (id, userId, isDeleted, token itself) leak.
    expect(invoice).not.toHaveProperty('id');
    expect(invoice).not.toHaveProperty('userId');
    expect(invoice).not.toHaveProperty('isDeleted');
    expect(invoice).not.toHaveProperty('publicViewToken');

    expect(mockCompanySettingsFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('emits the real currency code — no stale hardcoded null', async () => {
    mockInvoiceFindUnique.mockResolvedValue(baseInvoice());
    const app = await buildApp();
    const res = await request(app).get(`/api/public/invoices/${VALID_TOKEN}`);

    expect(res.body.data.invoice.currency).toBe('GBP');
  });

  it('emits null currency when the invoice has none set', async () => {
    mockInvoiceFindUnique.mockResolvedValue(baseInvoice({ currencyCode: null }));
    const app = await buildApp();
    const res = await request(app).get(`/api/public/invoices/${VALID_TOKEN}`);

    expect(res.body.data.invoice.currency).toBeNull();
  });

  it('carries the STORED per-line amount (discount/tax-aware), not a naive qty*rate recompute', async () => {
    mockInvoiceFindUnique.mockResolvedValue(baseInvoice());
    const app = await buildApp();
    const res = await request(app).get(`/api/public/invoices/${VALID_TOKEN}`);

    const [item] = res.body.data.invoice.items;
    expect(item.amount).toBe(85); // stored amount, NOT qty(2) * rate(50) = 100
    expect(item.discount).toBe(15);
    expect(item.tax).toBe(5);

    // Allowlist: internal ids and cost fields never leak through the item mapping.
    expect(item).not.toHaveProperty('id');
    expect(item).not.toHaveProperty('productId');
    expect(item).not.toHaveProperty('purchase_price');
  });

  it('resolves siteLogo to an absolute URL off the request host', async () => {
    mockInvoiceFindUnique.mockResolvedValue(baseInvoice());
    const app = await buildApp();
    const res = await request(app).get(`/api/public/invoices/${VALID_TOKEN}`);

    expect(res.body.data.invoice.company.siteLogo).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/uploads\/company\/logo\.png$/,
    );
  });

  it('emits null siteLogo when the company has none configured', async () => {
    mockCompanySettingsFindUnique.mockResolvedValue({
      companyName: 'Acme Sellers Inc',
      email: 'billing@acmesellers.example',
      phone: '555-0000',
      address: '99 Seller Ave',
      publicBaseUrl: null,
      merchantUpiId: null,
      merchantName: null,
      gstin: null,
      vatNumber: null,
      abn: null,
      nzGstNumber: null,
      taxRegime: 'NONE',
      siteLogo: '',
    });
    mockInvoiceFindUnique.mockResolvedValue(baseInvoice());
    const app = await buildApp();
    const res = await request(app).get(`/api/public/invoices/${VALID_TOKEN}`);

    expect(res.body.data.invoice.company.siteLogo).toBeNull();
  });
});
