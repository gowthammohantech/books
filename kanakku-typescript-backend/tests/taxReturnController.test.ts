// tests/taxReturnController.test.ts
//
// Unit tests for the country tax-return SUMMARY endpoints (Task 2):
//   - UK VAT 9-box, AU BAS (GST portion), NZ GST.
//
// Strategy: mock lib/reports/taxReturns#loadTaxFigures with a KNOWN set of GL
// figures and assert (a) the box/label mapping for each authority and (b) the
// rounding convention (HMRC box6/7 round DOWN to whole; box5 + all AU/NZ money
// to 2dp). requireUserId is exercised via a tenant-stamped req. The Decimal math
// is asserted via the pure buildXBoxes() builders too, so no float drift.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { TaxFigures } from '../lib/reports/taxReturns';

// ---------------------------------------------------------------------------
// Hoisted mock for loadTaxFigures.
// ---------------------------------------------------------------------------
const { mockLoadTaxFigures } = vi.hoisted(() => ({
  mockLoadTaxFigures: vi.fn(),
}));

// Override loadTaxFigures only; keep the real OSS helpers (resolveOssSupplierCountry,
// resolveOssDestination, isOssQualifyingSale, loadIso2ById, loadOssThreshold) so
// the OSS return + threshold paths exercise the real classification logic against
// the mocked prisma client.
vi.mock('../lib/reports/taxReturns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/reports/taxReturns')>();
  return { ...actual, loadTaxFigures: mockLoadTaxFigures };
});

// Hoisted mock for the prisma slice the EC Sales List + OSS handlers touch
// (invoice.findMany + country.findMany + companySettings.findUnique), so the
// handlers run without a DB.
const { mockInvoiceFindMany, mockCountryFindMany, mockCompanySettingsFindUnique } = vi.hoisted(() => ({
  mockInvoiceFindMany: vi.fn(),
  mockCountryFindMany: vi.fn(),
  mockCompanySettingsFindUnique: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    invoice: { findMany: mockInvoiceFindMany },
    country: { findMany: mockCountryFindMany },
    companySettings: { findUnique: mockCompanySettingsFindUnique },
  },
}));

import {
  ukVatReturn,
  auBasReturn,
  nzGstReturn,
  euVatReturn,
  euEcSalesList,
  euOssReturn,
  euOssThreshold,
  buildUkVatBoxes,
  buildAuBasBoxes,
  buildNzGstBoxes,
  buildEuVatSummary,
  buildEcSalesList,
  buildOssReturn,
  type EcSalesInvoice,
} from '../controllers/taxReturnController';
import type { OssInvoice } from '../lib/reports/taxReturns';

const D = (v: number | string) => new Prisma.Decimal(v);

// A known figures fixture with fractional values to exercise rounding:
//   outputTax 1234.567, inputTax 345.121, salesExTax 9876.99, purchasesExTax 4321.49
const FIG: TaxFigures = {
  outputTax: D('1234.567'),
  inputTax: D('345.121'),
  salesExTax: D('9876.99'),
  purchasesExTax: D('4321.49'),
  salesInclTax: D('9876.99').plus(D('1234.567')), // 11111.557
  purchasesInclTax: D('4321.49').plus(D('345.121')), // 4666.611
};

interface MockRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  sent: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
  setHeader: (k: string, v: string) => void;
  send: (b: unknown) => MockRes;
}

function makeRes(): MockRes {
  const res: Partial<MockRes> = {
    statusCode: 200,
    headers: {},
    status(c: number) {
      res.statusCode = c;
      return res as MockRes;
    },
    json(b: unknown) {
      res.body = b;
      return res as MockRes;
    },
    setHeader(k: string, v: string) {
      (res.headers as Record<string, string>)[k] = v;
    },
    send(b: unknown) {
      res.sent = b;
      return res as MockRes;
    },
  };
  return res as MockRes;
}

function makeReq(query: Record<string, unknown>, path = '/tax-returns/uk-vat'): any {
  return {
    query,
    path,
    // requireUserId returns req.tenantId (ownerId ?? id, set by protect).
    tenantId: 'tenant-1',
    user: 'tenant-1',
  };
}

beforeEach(() => {
  mockLoadTaxFigures.mockReset();
  mockLoadTaxFigures.mockResolvedValue(FIG);
  mockInvoiceFindMany.mockReset();
  mockCountryFindMany.mockReset();
  mockCountryFindMany.mockResolvedValue([]);
  mockCompanySettingsFindUnique.mockReset();
  mockCompanySettingsFindUnique.mockResolvedValue({ countryCode: 'DE', countryId: null, country: null });
});

// ===========================================================================
// Pure builders — box mapping + rounding (no req/res).
// ===========================================================================
describe('buildUkVatBoxes (HMRC 9-box)', () => {
  it('maps boxes and applies HMRC rounding (box6/7 floor, box5 2dp)', () => {
    const b = buildUkVatBoxes(FIG);
    expect(b.box1).toBe('1234.57'); // outputTax → 2dp
    expect(b.box2).toBe('0.00');
    expect(b.box3).toBe('1234.57'); // box1+box2
    expect(b.box4).toBe('345.12'); // inputTax → 2dp
    expect(b.box5).toBe('889.45'); // |1234.57 − 345.12|
    expect(b.box6).toBe('9876'); // salesExTax floored to whole
    expect(b.box7).toBe('4321'); // purchasesExTax floored to whole
    expect(b.box8).toBe('0');
    expect(b.box9).toBe('0');
  });

  it('box5 is the absolute net (reclaim case stays positive)', () => {
    const reclaim: TaxFigures = { ...FIG, outputTax: D('100'), inputTax: D('250') };
    const b = buildUkVatBoxes(reclaim);
    expect(b.box5).toBe('150.00');
  });
});

describe('buildAuBasBoxes (BAS GST portion)', () => {
  it('maps G1/1A/1B/netGst with 2dp', () => {
    const b = buildAuBasBoxes(FIG);
    expect(b.G1).toBe('11111.56'); // salesInclTax → 2dp
    expect(b['1A']).toBe('1234.57'); // outputTax
    expect(b['1B']).toBe('345.12'); // inputTax
    expect(b.netGst).toBe('889.45'); // 1A − 1B
  });
});

describe('buildNzGstBoxes', () => {
  it('maps totals + net with 2dp', () => {
    const b = buildNzGstBoxes(FIG);
    expect(b.totalSales).toBe('11111.56');
    expect(b.outputGst).toBe('1234.57');
    expect(b.totalPurchases).toBe('4666.61'); // 4321.49 + 345.121 → 4666.611 → 4666.61
    expect(b.inputGst).toBe('345.12');
    expect(b.netGst).toBe('889.45');
  });
});

// ===========================================================================
// Handlers — JSON, CSV variant, and 400 on bad period.
// ===========================================================================
describe('ukVatReturn handler', () => {
  it('returns JSON boxes + period for a valid period', async () => {
    const req = makeReq({ from: '2026-01-01', to: '2026-03-31' });
    const res = makeRes();
    await ukVatReturn(req, res as any);
    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.success).toBe(true);
    expect(body.data.box1).toBe('1234.57');
    expect(body.data.box6).toBe('9876');
    expect(body.data.period).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    // tenant-scoped + inclusive-to-end-of-day call.
    expect(mockLoadTaxFigures).toHaveBeenCalledWith('tenant-1', expect.any(Date), expect.any(Date));
    const [, from, to] = mockLoadTaxFigures.mock.calls[0];
    expect((from as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect((to as Date).toISOString()).toBe('2026-03-31T23:59:59.999Z');
  });

  it('streams CSV via ?format=csv', async () => {
    const req = makeReq({ from: '2026-01-01', to: '2026-03-31', format: 'csv' });
    const res = makeRes();
    await ukVatReturn(req, res as any);
    expect(res.headers['Content-Type']).toContain('text/csv');
    expect(res.headers['Content-Disposition']).toContain('attachment');
    expect(String(res.sent)).toContain('Box,Value');
    expect(String(res.sent)).toContain('box6,9876');
  });

  it('streams CSV via a .csv path', async () => {
    const req = makeReq({ from: '2026-01-01', to: '2026-03-31' }, '/tax-returns/uk-vat.csv');
    const res = makeRes();
    await ukVatReturn(req, res as any);
    expect(res.headers['Content-Type']).toContain('text/csv');
    expect(String(res.sent)).toContain('box1,1234.57');
  });

  it('400 when from/to missing', async () => {
    const req = makeReq({});
    const res = makeRes();
    await ukVatReturn(req, res as any);
    expect(res.statusCode).toBe(400);
  });

  it('400 when date is invalid', async () => {
    const req = makeReq({ from: '2026-02-30', to: '2026-03-31' });
    const res = makeRes();
    await ukVatReturn(req, res as any);
    expect(res.statusCode).toBe(400);
  });

  it('400 when from is after to', async () => {
    const req = makeReq({ from: '2026-04-01', to: '2026-03-31' });
    const res = makeRes();
    await ukVatReturn(req, res as any);
    expect(res.statusCode).toBe(400);
  });
});

describe('auBasReturn handler', () => {
  it('returns BAS labels + period', async () => {
    const req = makeReq({ from: '2026-01-01', to: '2026-03-31' }, '/tax-returns/au-bas');
    const res = makeRes();
    await auBasReturn(req, res as any);
    const body = res.body as any;
    expect(body.data.G1).toBe('11111.56');
    expect(body.data['1A']).toBe('1234.57');
    expect(body.data.netGst).toBe('889.45');
    expect(body.data.period.to).toBe('2026-03-31');
  });
});

describe('nzGstReturn handler', () => {
  it('returns NZ GST labels + period', async () => {
    const req = makeReq({ from: '2026-01-01', to: '2026-03-31' }, '/tax-returns/nz-gst');
    const res = makeRes();
    await nzGstReturn(req, res as any);
    const body = res.body as any;
    expect(body.data.outputGst).toBe('1234.57');
    expect(body.data.inputGst).toBe('345.12');
    expect(body.data.netGst).toBe('889.45');
  });
});

// ===========================================================================
// EU VAT summary — box mapping (mock loadTaxFigures).
// ===========================================================================
describe('buildEuVatSummary', () => {
  it('maps outputVat/inputVat/netVat + ex-tax totals to 2dp', () => {
    const s = buildEuVatSummary(FIG);
    expect(s.outputVat).toBe('1234.57'); // outputTax → 2dp
    expect(s.inputVat).toBe('345.12'); // inputTax → 2dp
    expect(s.netVat).toBe('889.45'); // outputVat − inputVat
    expect(s.salesExTax).toBe('9876.99');
    expect(s.purchasesExTax).toBe('4321.49');
  });

  it('netVat is signed (refund position is negative)', () => {
    const refund: TaxFigures = { ...FIG, outputTax: D('100'), inputTax: D('250') };
    expect(buildEuVatSummary(refund).netVat).toBe('-150.00');
  });
});

describe('euVatReturn handler', () => {
  it('returns EU VAT summary + period for a valid period', async () => {
    const req = makeReq({ from: '2026-01-01', to: '2026-03-31' }, '/tax-returns/eu-vat');
    const res = makeRes();
    await euVatReturn(req, res as any);
    const body = res.body as any;
    expect(body.success).toBe(true);
    expect(body.data.outputVat).toBe('1234.57');
    expect(body.data.netVat).toBe('889.45');
    expect(body.data.period).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(mockLoadTaxFigures).toHaveBeenCalledWith('tenant-1', expect.any(Date), expect.any(Date));
  });

  it('streams CSV via ?format=csv', async () => {
    const req = makeReq({ from: '2026-01-01', to: '2026-03-31', format: 'csv' }, '/tax-returns/eu-vat');
    const res = makeRes();
    await euVatReturn(req, res as any);
    expect(res.headers['Content-Type']).toContain('text/csv');
    expect(String(res.sent)).toContain('outputVat,1234.57');
  });
});

// ===========================================================================
// EC Sales List — grouping + total from reverse-charge invoices.
// ===========================================================================
const ecInv = (
  taxable: string,
  contact: Partial<EcSalesInvoice['contact']> | null,
): EcSalesInvoice => ({
  taxableAmount: D(taxable),
  contact: contact
    ? { vatNumber: null, vatRegNumber: null, country: null, countryId: null, ...contact }
    : null,
});

describe('buildEcSalesList (pure grouping + total)', () => {
  it('groups by (customerVatNumber, country) and sums net ex-tax', () => {
    const invoices: EcSalesInvoice[] = [
      ecInv('100.00', { vatNumber: 'DE123', country: 'DE' }),
      ecInv('50.50', { vatNumber: 'DE123', country: 'DE' }), // same group
      ecInv('200.00', { vatNumber: 'FR999', country: 'FR' }),
    ];
    const { rows, total } = buildEcSalesList(invoices, new Map());
    expect(rows).toHaveLength(2);
    // sorted by country then vat: DE first
    expect(rows[0]).toEqual({
      customerVatNumber: 'DE123',
      country: 'DE',
      netValue: '150.50',
      indicator: 'services',
    });
    expect(rows[1].country).toBe('FR');
    expect(rows[1].netValue).toBe('200.00');
    expect(total).toBe('350.50');
  });

  it('falls back to vatRegNumber + countryId→iso2 (legacy fields)', () => {
    const iso2 = new Map([['ctry-it', 'IT']]);
    const invoices: EcSalesInvoice[] = [
      ecInv('80.00', { vatRegNumber: 'IT777', countryId: 'ctry-it' }),
    ];
    const { rows, total } = buildEcSalesList(invoices, iso2);
    expect(rows[0]).toEqual({
      customerVatNumber: 'IT777',
      country: 'IT',
      netValue: '80.00',
      indicator: 'services',
    });
    expect(total).toBe('80.00');
  });

  it('prefers modern Contact.vatNumber/country over legacy fields', () => {
    const invoices: EcSalesInvoice[] = [
      ecInv('10.00', {
        vatNumber: 'NL111',
        country: 'NL',
        vatRegNumber: 'OLD',
        countryId: 'ctry-x',
      }),
    ];
    const { rows } = buildEcSalesList(invoices, new Map([['ctry-x', 'XX']]));
    expect(rows[0].customerVatNumber).toBe('NL111');
    expect(rows[0].country).toBe('NL');
  });

  it('resolves VAT#/country from the billing contact when it has a VAT number', () => {
    const invoices: EcSalesInvoice[] = [
      {
        taxableAmount: D('120.00'),
        // primary contact has its own (different) VAT number...
        contact: { vatNumber: 'DE123', vatRegNumber: null, country: 'DE', countryId: null },
        // ...but the billing contact holds the actual VAT registration.
        billToContact: { vatNumber: 'FR999', vatRegNumber: null, country: 'FR', countryId: null },
      },
    ];
    const { rows } = buildEcSalesList(invoices, new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0].customerVatNumber).toBe('FR999');
    expect(rows[0].country).toBe('FR');
  });

  it('falls back to the primary contact when the billing contact has no VAT number', () => {
    const invoices: EcSalesInvoice[] = [
      {
        taxableAmount: D('60.00'),
        contact: { vatNumber: 'DE123', vatRegNumber: null, country: 'DE', countryId: null },
        billToContact: { vatNumber: null, vatRegNumber: null, country: 'FR', countryId: null },
      },
    ];
    const { rows } = buildEcSalesList(invoices, new Map());
    expect(rows[0].customerVatNumber).toBe('DE123');
    expect(rows[0].country).toBe('DE');
  });

  it('empty set → no rows, zero total', () => {
    const { rows, total } = buildEcSalesList([], new Map());
    expect(rows).toHaveLength(0);
    expect(total).toBe('0.00');
  });
});

describe('euEcSalesList handler', () => {
  it('returns grouped rows + total + period and queries tenant-scoped reverse-charge sales', async () => {
    mockInvoiceFindMany.mockResolvedValue([
      ecInv('100.00', { vatNumber: 'DE123', country: 'DE' }),
      ecInv('25.00', { vatNumber: 'DE123', country: 'DE' }),
    ]);
    const req = makeReq({ from: '2026-01-01', to: '2026-03-31' }, '/tax-returns/eu-ec-sales-list');
    const res = makeRes();
    await euEcSalesList(req, res as any);

    const body = res.body as any;
    expect(body.success).toBe(true);
    expect(body.data.rows).toHaveLength(1);
    expect(body.data.rows[0].netValue).toBe('125.00');
    expect(body.data.total).toBe('125.00');
    expect(body.data.period).toEqual({ from: '2026-01-01', to: '2026-03-31' });

    // tenant-scoped + reverse-charge + period-bounded query.
    const where = mockInvoiceFindMany.mock.calls[0][0].where;
    expect(where.userId).toBe('tenant-1');
    expect(where.reverseCharge).toBe(true);
    expect(where.isDeleted).toBe(false);
    expect(where.invoiceDate.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(where.invoiceDate.lte.toISOString()).toBe('2026-03-31T23:59:59.999Z');
  });

  it('streams CSV with the EC Sales List columns', async () => {
    mockInvoiceFindMany.mockResolvedValue([
      ecInv('200.00', { vatNumber: 'FR999', country: 'FR' }),
    ]);
    const req = makeReq(
      { from: '2026-01-01', to: '2026-03-31', format: 'csv' },
      '/tax-returns/eu-ec-sales-list',
    );
    const res = makeRes();
    await euEcSalesList(req, res as any);
    expect(res.headers['Content-Type']).toContain('text/csv');
    expect(String(res.sent)).toContain('Country,Customer VAT Number,Net Value,Indicator');
    expect(String(res.sent)).toContain('FR,FR999,200.00,services');
  });

  it('400 when period missing', async () => {
    const req = makeReq({}, '/tax-returns/eu-ec-sales-list');
    const res = makeRes();
    await euEcSalesList(req, res as any);
    expect(res.statusCode).toBe(400);
  });
});

// ===========================================================================
// EU OSS return — B2C cross-border destination-rate VAT, grouped per country.
// ===========================================================================

/** Build an OSS invoice fixture (supplier defaults DE; override contact fields). */
const ossInv = (
  taxable: string,
  contact: Partial<OssInvoice['contact']> | null,
  reverseCharge = false,
): OssInvoice => ({
  taxableAmount: D(taxable),
  reverseCharge,
  contact: contact
    ? { vatNumber: null, vatRegNumber: null, country: null, countryId: null, ...contact }
    : null,
});

describe('buildOssReturn (pure: destination-rate VAT per country)', () => {
  const SUPPLIER = 'DE';

  it('groups B2C cross-border sales by destination + VAT at the DESTINATION rate', () => {
    const invoices: OssInvoice[] = [
      ossInv('100.00', { country: 'FR' }), // FR B2C: 20% → 20.00
      ossInv('50.00', { country: 'FR' }), // same dest → grouped: net 150 → 30.00
      ossInv('200.00', { country: 'IT' }), // IT B2C: 22% → 44.00
    ];
    const { rows, totals } = buildOssReturn(invoices, SUPPLIER, new Map());
    expect(rows).toHaveLength(2);
    // sorted by country: FR before IT
    expect(rows[0]).toEqual({ country: 'FR', rate: '20', netValue: '150.00', vatDue: '30.00' });
    expect(rows[1]).toEqual({ country: 'IT', rate: '22', netValue: '200.00', vatDue: '44.00' });
    expect(totals).toEqual({ netValue: '350.00', vatDue: '74.00' });
  });

  it('EXCLUDES a B2B reverse-charge invoice', () => {
    const invoices: OssInvoice[] = [
      ossInv('100.00', { country: 'FR', vatNumber: 'FR12345678901' }, true), // reverse-charge B2B
    ];
    const { rows, totals } = buildOssReturn(invoices, SUPPLIER, new Map());
    expect(rows).toHaveLength(0);
    expect(totals).toEqual({ netValue: '0.00', vatDue: '0.00' });
  });

  it('EXCLUDES a B2C sale to a customer with a VALID VAT number (treated as B2B)', () => {
    // valid FR VAT body = 2 alnum + 9 digits → FR + 'AA' + 9 digits
    const invoices: OssInvoice[] = [
      ossInv('100.00', { country: 'FR', vatNumber: 'FRAA123456789' }),
    ];
    const { rows } = buildOssReturn(invoices, SUPPLIER, new Map());
    expect(rows).toHaveLength(0);
  });

  it('EXCLUDES a domestic (same-country) sale', () => {
    const invoices: OssInvoice[] = [ossInv('100.00', { country: 'DE' })];
    const { rows } = buildOssReturn(invoices, SUPPLIER, new Map());
    expect(rows).toHaveLength(0);
  });

  it('EXCLUDES a non-EU customer', () => {
    const invoices: OssInvoice[] = [
      ossInv('100.00', { country: 'US' }),
      ossInv('100.00', { country: 'GB' }), // GB is NOT an EU member post-Brexit
    ];
    const { rows } = buildOssReturn(invoices, SUPPLIER, new Map());
    expect(rows).toHaveLength(0);
  });

  it('resolves the destination via legacy countryId→iso2 fallback', () => {
    const iso2 = new Map([['ctry-fr', 'FR']]);
    const invoices: OssInvoice[] = [ossInv('100.00', { countryId: 'ctry-fr' })];
    const { rows } = buildOssReturn(invoices, SUPPLIER, iso2);
    expect(rows[0]).toEqual({ country: 'FR', rate: '20', netValue: '100.00', vatDue: '20.00' });
  });

  it('returns out-of-scope when the supplier is not an EU member', () => {
    const invoices: OssInvoice[] = [ossInv('100.00', { country: 'FR' })];
    const { rows } = buildOssReturn(invoices, 'GB', new Map());
    expect(rows).toHaveLength(0);
  });
});

describe('euOssReturn handler', () => {
  it('returns grouped destination rows + totals + period, tenant-scoped', async () => {
    mockInvoiceFindMany.mockResolvedValue([
      ossInv('100.00', { country: 'FR' }),
      ossInv('200.00', { country: 'IT' }),
    ]);
    const req = makeReq({ from: '2026-01-01', to: '2026-03-31' }, '/tax-returns/eu-oss');
    const res = makeRes();
    await euOssReturn(req, res as any);

    const body = res.body as any;
    expect(body.success).toBe(true);
    expect(body.data.rows).toHaveLength(2);
    expect(body.data.rows[0]).toEqual({ country: 'FR', rate: '20', netValue: '100.00', vatDue: '20.00' });
    expect(body.data.totals).toEqual({ netValue: '300.00', vatDue: '64.00' });
    expect(body.data.period).toEqual({ from: '2026-01-01', to: '2026-03-31' });

    const where = mockInvoiceFindMany.mock.calls[0][0].where;
    expect(where.userId).toBe('tenant-1');
    expect(where.isDeleted).toBe(false);
    expect(where.invoiceDate.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(where.invoiceDate.lte.toISOString()).toBe('2026-03-31T23:59:59.999Z');
    // supplier country resolved from CompanySettings, tenant-scoped.
    expect(mockCompanySettingsFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'tenant-1' } }),
    );
  });

  it('streams CSV with the OSS columns', async () => {
    mockInvoiceFindMany.mockResolvedValue([ossInv('100.00', { country: 'FR' })]);
    const req = makeReq({ from: '2026-01-01', to: '2026-03-31', format: 'csv' }, '/tax-returns/eu-oss');
    const res = makeRes();
    await euOssReturn(req, res as any);
    expect(res.headers['Content-Type']).toContain('text/csv');
    expect(String(res.sent)).toContain('Country,Rate,Net Value,VAT Due');
    expect(String(res.sent)).toContain('FR,20,100.00,20.00');
  });

  it('400 when period missing', async () => {
    const req = makeReq({}, '/tax-returns/eu-oss');
    const res = makeRes();
    await euOssReturn(req, res as any);
    expect(res.statusCode).toBe(400);
  });
});

describe('euOssThreshold handler (loadOssThreshold against mocked prisma)', () => {
  it('reports exceeded=false when YTD B2C cross-border is under €10,000', async () => {
    mockInvoiceFindMany.mockResolvedValue([
      ossInv('4000.00', { country: 'FR' }),
      ossInv('1000.00', { country: 'IT' }),
      ossInv('9999.00', { country: 'DE' }), // domestic → excluded
    ]);
    const req = makeReq({ year: '2026' }, '/tax-returns/eu-oss/threshold');
    const res = makeRes();
    await euOssThreshold(req, res as any);

    const body = res.body as any;
    expect(body.success).toBe(true);
    expect(body.data.ytdB2cCrossBorder).toBe('5000.00');
    expect(body.data.threshold).toBe(10000);
    expect(body.data.exceeded).toBe(false);
    expect(body.data.year).toBe(2026);

    // calendar-year window, tenant-scoped.
    const where = mockInvoiceFindMany.mock.calls[0][0].where;
    expect(where.userId).toBe('tenant-1');
    expect(where.invoiceDate.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(where.invoiceDate.lte.toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });

  it('reports exceeded=true once YTD B2C cross-border passes €10,000', async () => {
    mockInvoiceFindMany.mockResolvedValue([
      ossInv('8000.00', { country: 'FR' }),
      ossInv('3000.00', { country: 'IT' }),
      ossInv('5000.00', { country: 'FR', vatNumber: 'FRAA123456789' }), // valid VAT B2B → excluded
    ]);
    const req = makeReq({ year: '2026' }, '/tax-returns/eu-oss/threshold');
    const res = makeRes();
    await euOssThreshold(req, res as any);
    const body = res.body as any;
    expect(body.data.ytdB2cCrossBorder).toBe('11000.00');
    expect(body.data.exceeded).toBe(true);
  });

  it('400 when year is missing/invalid', async () => {
    const req = makeReq({}, '/tax-returns/eu-oss/threshold');
    const res = makeRes();
    await euOssThreshold(req, res as any);
    expect(res.statusCode).toBe(400);
  });
});
