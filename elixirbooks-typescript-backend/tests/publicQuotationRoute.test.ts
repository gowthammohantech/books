/**
 * tests/publicQuotationRoute.test.ts
 *
 * GET /api/public/quotations/:token — the public, token-gated quotation viewer.
 * Mirrors the invoice public route (routes/publicRoutes.ts, GET /invoices/:token):
 * 404 on a bad/short token, 404 when publicViewEnabled=false, 404 when
 * isDeleted=true, and a sanitized 200 payload (nested under `data.invoice` for
 * structural parity with the invoice endpoint) on a valid token.
 *
 * No existing test covers the invoice public route directly, so this mirrors
 * the mocking style from tests/companySettingsController.fkValidation.test.ts
 * (vi.mock('../lib/prisma', ...)) but drives the route itself (not a bare
 * controller function) via supertest + a minimal express app, since
 * routes/publicRoutes.ts defines the handler inline on the router.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockQuotationFindUnique,
  mockCompanySettingsFindUnique,
} = vi.hoisted(() => ({
  mockQuotationFindUnique: vi.fn(),
  mockCompanySettingsFindUnique: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    quotation: { findUnique: mockQuotationFindUnique },
    companySettings: { findUnique: mockCompanySettingsFindUnique },
  },
}));

const VALID_TOKEN = 'a'.repeat(64);

function baseQuotation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    userId: 'user-1',
    quotationId: 'QT-000001',
    quotationDate: new Date('2026-07-01T00:00:00.000Z'),
    expiryDate: new Date('2026-07-31T00:00:00.000Z'),
    status: 'sent',
    currencyCode: 'USD',
    // discount=15 means the STORED amount (85) differs from a naive qty*rate
    // recompute (100) — the payload must carry the stored figure. id/productId/
    // purchase_price are internal fields that must never reach the public payload.
    items: [{ id: 'item-1', productId: 'prod-1', name: 'Widget', qty: 2, rate: 50, discount: 15, tax: 5, amount: 85, purchase_price: 12 }],
    taxableAmount: 100,
    totalDiscount: 0,
    vat: 10,
    TotalAmount: 110,
    paymentTerms: 'Net 30',
    notes: 'Thanks for your interest.',
    termsAndCondition: 'Valid for 30 days.',
    publicViewToken: VALID_TOKEN,
    publicViewEnabled: true,
    isDeleted: false,
    contact: null,
    billToContact: null,
    billToCustomer: { name: 'Acme Co', email: 'acme@example.com', phone: '555-1234', billingAddress: '1 Main St' },
    customer: null,
    billFromUser: { firstName: 'Jane', lastName: 'Seller' },
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
    gstin: null,
    vatNumber: null,
    abn: null,
    nzGstNumber: null,
    taxRegime: 'NONE',
    siteLogo: '/uploads/company/logo.png',
  });
});

describe('GET /api/public/quotations/:token', () => {
  it('404s on a short/invalid token (never reaches the DB)', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/public/quotations/tooshort');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Not found' });
    expect(mockQuotationFindUnique).not.toHaveBeenCalled();
  });

  it('404s when the token does not match any quotation', async () => {
    mockQuotationFindUnique.mockResolvedValue(null);
    const app = await buildApp();
    const res = await request(app).get(`/api/public/quotations/${VALID_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Not found' });
  });

  it('404s when publicViewEnabled is false', async () => {
    mockQuotationFindUnique.mockResolvedValue(baseQuotation({ publicViewEnabled: false }));
    const app = await buildApp();
    const res = await request(app).get(`/api/public/quotations/${VALID_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Not found' });
  });

  it('404s when the quotation is soft-deleted', async () => {
    mockQuotationFindUnique.mockResolvedValue(baseQuotation({ isDeleted: true }));
    const app = await buildApp();
    const res = await request(app).get(`/api/public/quotations/${VALID_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Not found' });
  });

  it('returns a sanitized 200 payload on a valid, enabled, non-deleted token', async () => {
    mockQuotationFindUnique.mockResolvedValue(baseQuotation());
    const app = await buildApp();
    const res = await request(app).get(`/api/public/quotations/${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const quotation = res.body.data.invoice;
    expect(quotation.quotationNumber).toBe('QT-000001');
    expect(quotation.status).toBe('sent');
    expect(quotation.TotalAmount).toBe(110);
    expect(quotation.paymentTerms).toBe('Net 30');
    expect(quotation.customer).toEqual({
      name: 'Acme Co',
      email: 'acme@example.com',
      phone: '555-1234',
      billingAddress: '1 Main St',
    });
    expect(quotation.company).toEqual(
      expect.objectContaining({ companyName: 'Acme Sellers Inc' }),
    );

    // Sanitization: no internal/audit fields (id, userId, isDeleted, token itself) leak.
    expect(quotation).not.toHaveProperty('id');
    expect(quotation).not.toHaveProperty('userId');
    expect(quotation).not.toHaveProperty('isDeleted');
    expect(quotation).not.toHaveProperty('publicViewToken');

    expect(mockCompanySettingsFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('carries the STORED per-line amount (discount/tax-aware), not a naive qty*rate recompute', async () => {
    mockQuotationFindUnique.mockResolvedValue(baseQuotation());
    const app = await buildApp();
    const res = await request(app).get(`/api/public/quotations/${VALID_TOKEN}`);

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
    mockQuotationFindUnique.mockResolvedValue(baseQuotation());
    const app = await buildApp();
    const res = await request(app).get(`/api/public/quotations/${VALID_TOKEN}`);

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
      gstin: null,
      vatNumber: null,
      abn: null,
      nzGstNumber: null,
      taxRegime: 'NONE',
      siteLogo: '',
    });
    mockQuotationFindUnique.mockResolvedValue(baseQuotation());
    const app = await buildApp();
    const res = await request(app).get(`/api/public/quotations/${VALID_TOKEN}`);

    expect(res.body.data.invoice.company.siteLogo).toBeNull();
  });
});
