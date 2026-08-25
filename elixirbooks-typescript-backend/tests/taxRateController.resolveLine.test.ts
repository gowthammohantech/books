import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockCompanyFindUnique, mockTaxRateFindFirst, mockTaxRateFindMany, mockTaxRateCreate,
  mockTaxGroupFindUnique, mockCustomerFindFirst, mockSupplierFindFirst, mockStateFindUnique,
  mockContactFindFirst,
} = vi.hoisted(() => ({
  mockCompanyFindUnique: vi.fn(), mockTaxRateFindFirst: vi.fn(), mockTaxRateFindMany: vi.fn(),
  mockTaxRateCreate: vi.fn(), mockTaxGroupFindUnique: vi.fn(), mockCustomerFindFirst: vi.fn(),
  mockSupplierFindFirst: vi.fn(), mockStateFindUnique: vi.fn(), mockContactFindFirst: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    companySettings: { findUnique: mockCompanyFindUnique },
    taxRate: { findFirst: mockTaxRateFindFirst, findMany: mockTaxRateFindMany, create: mockTaxRateCreate },
    taxGroup: { findUnique: mockTaxGroupFindUnique },
    customer: { findFirst: mockCustomerFindFirst },
    supplier: { findFirst: mockSupplierFindFirst },
    state: { findUnique: mockStateFindUnique },
    contact: { findFirst: mockContactFindFirst },
  },
}));

import { resolveLine } from '../controllers/TaxRateController';

interface MockRes { statusCode: number; body: unknown; status(c: number): MockRes; json(p: unknown): MockRes }
function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 200, body: undefined,
    status(c: number) { res.statusCode = c; return res; },
    json(p: unknown) { res.body = p; return res; },
  };
  return res;
}
const makeReq = (body: Record<string, unknown>) =>
  ({ body, tenantId: 'tenant-1', user: 'tenant-1' }) as never;

const GST18 = {
  id: 'rate-gst18', userId: 'tenant-1', regime: 'GST_INDIA', taxKind: null,
  name: 'GST 18%', rate: 18, countryId: 'c-in', stateId: null,
  isActive: true, isDeleted: false, isSystemComponent: false,
  createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCompanyFindUnique.mockResolvedValue({
    userId: 'tenant-1', taxRegime: 'GST_INDIA', countryId: 'c-in', stateId: 'st-tn',
  });
  mockStateFindUnique.mockResolvedValue({ state_code: 'TN' });
  mockContactFindFirst.mockResolvedValue(null);
});

describe('resolveLine — taxRateId with a kind-less GST_INDIA rate', () => {
  it('intra-state: synthesizes CGST+SGST halves with provisioned component ids', async () => {
    mockTaxRateFindFirst.mockImplementation(async (args: { where?: { id?: string } }) =>
      (args?.where?.id === 'rate-gst18' ? GST18 : null)); // component rows missing → create
    mockTaxRateCreate.mockImplementation(async (args: { data: { taxKind: string } }) =>
      ({ id: `sys-${args.data.taxKind}` }));
    mockCustomerFindFirst.mockResolvedValue({ billingAddress: { countryId: 'c-in', stateId: 'st-tn' } });

    const res = makeRes();
    await resolveLine(makeReq({ taxableAmount: 100, taxRateId: 'rate-gst18', customerId: 'cust-1' }), res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        taxes: [
          { taxRateId: 'sys-CGST', name: 'CGST 9%', kind: 'CGST', percent: 9, amount: 9 },
          { taxRateId: 'sys-SGST', name: 'SGST 9%', kind: 'SGST', percent: 9, amount: 9 },
        ],
        totalTax: 18,
        partyStateMissing: false,
      },
    });
    // Provisioned rows are per-tenant hidden system components.
    expect(mockTaxRateCreate).toHaveBeenCalledTimes(2);
    for (const call of mockTaxRateCreate.mock.calls) {
      expect((call[0] as { data: object }).data).toMatchObject({
        userId: 'tenant-1', regime: 'GST_INDIA', isSystemComponent: true,
      });
    }
  });

  it('inter-state (no party): resolves to a single IGST component', async () => {
    mockTaxRateFindFirst.mockImplementation(async (args: { where?: { id?: string } }) =>
      (args?.where?.id === 'rate-gst18' ? GST18 : null));
    mockTaxRateCreate.mockImplementation(async (args: { data: { taxKind: string } }) =>
      ({ id: `sys-${args.data.taxKind}` }));

    const res = makeRes();
    await resolveLine(makeReq({ taxableAmount: 200, taxRateId: 'rate-gst18' }), res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        taxes: [{ taxRateId: 'sys-IGST', name: 'IGST 18%', kind: 'IGST', percent: 18, amount: 36 }],
        totalTax: 36,
        partyStateMissing: true,
      },
    });
  });
});

describe('resolveLine — taxRateId flat / kind-bearing paths', () => {
  it('flat regime rate resolves to a single component (VAT_UK 20)', async () => {
    mockTaxRateFindFirst.mockResolvedValue({
      ...GST18, id: 'rate-vat20', regime: 'VAT_UK', taxKind: 'VAT', name: 'VAT Standard 20%', rate: 20,
    });
    const res = makeRes();
    await resolveLine(makeReq({ taxableAmount: 100, taxRateId: 'rate-vat20' }), res as never);
    expect(res.body).toEqual({
      success: true,
      data: {
        taxes: [{ taxRateId: 'rate-vat20', name: 'VAT Standard 20%', kind: 'VAT', percent: 20, amount: 20 }],
        totalTax: 20,
        partyStateMissing: true,
      },
    });
    expect(mockTaxRateCreate).not.toHaveBeenCalled();
  });

  it('404s on an unknown/foreign taxRateId', async () => {
    mockTaxRateFindFirst.mockResolvedValue(null);
    const res = makeRes();
    await resolveLine(makeReq({ taxableAmount: 100, taxRateId: 'nope' }), res as never);
    expect(res.statusCode).toBe(404);
  });
});

describe('resolveLine — customerId/supplierId fall back to the unified Contact table', () => {
  it('customerId misses Customer but hits Contact (via legacyCustomerId) with intra-state address: CGST+SGST', async () => {
    mockTaxRateFindFirst.mockImplementation(async (args: { where?: { id?: string } }) =>
      (args?.where?.id === 'rate-gst18' ? GST18 : null)); // component rows missing → create
    mockTaxRateCreate.mockImplementation(async (args: { data: { taxKind: string } }) =>
      ({ id: `sys-${args.data.taxKind}` }));
    // Legacy Customer lookup misses the Contact id, but hits when re-queried
    // by the Contact's linked legacyCustomerId.
    mockCustomerFindFirst.mockImplementation(async (args: { where?: { id?: string } }) =>
      (args?.where?.id === 'legacy-cust-1'
        ? { billingAddress: { countryId: 'c-in', stateId: 'st-tn' } }
        : null));
    mockContactFindFirst.mockImplementation(async (args: { where?: { id?: string } }) =>
      (args?.where?.id === 'contact-1' ? { legacyCustomerId: 'legacy-cust-1', legacySupplierId: null, countryId: null, region: null } : null));

    const res = makeRes();
    await resolveLine(makeReq({ taxableAmount: 100, taxRateId: 'rate-gst18', customerId: 'contact-1' }), res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        taxes: [
          { taxRateId: 'sys-CGST', name: 'CGST 9%', kind: 'CGST', percent: 9, amount: 9 },
          { taxRateId: 'sys-SGST', name: 'SGST 9%', kind: 'SGST', percent: 9, amount: 9 },
        ],
        totalTax: 18,
        partyStateMissing: false,
      },
    });
  });

  it('supplierId misses Supplier but hits Contact (via legacySupplierId) with intra-state address: CGST+SGST', async () => {
    mockTaxRateFindFirst.mockImplementation(async (args: { where?: { id?: string } }) =>
      (args?.where?.id === 'rate-gst18' ? GST18 : null)); // component rows missing → create
    mockTaxRateCreate.mockImplementation(async (args: { data: { taxKind: string } }) =>
      ({ id: `sys-${args.data.taxKind}` }));
    mockSupplierFindFirst.mockImplementation(async (args: { where?: { id?: string } }) =>
      (args?.where?.id === 'legacy-supp-1' ? { id: 'legacy-supp-1', stateId: 'st-tn', countryId: 'c-in' } : null));
    mockContactFindFirst.mockImplementation(async (args: { where?: { id?: string } }) =>
      (args?.where?.id === 'contact-2' ? { legacyCustomerId: null, legacySupplierId: 'legacy-supp-1', countryId: null, region: null } : null));

    const res = makeRes();
    await resolveLine(makeReq({ taxableAmount: 100, taxRateId: 'rate-gst18', supplierId: 'contact-2' }), res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        taxes: [
          { taxRateId: 'sys-CGST', name: 'CGST 9%', kind: 'CGST', percent: 9, amount: 9 },
          { taxRateId: 'sys-SGST', name: 'SGST 9%', kind: 'SGST', percent: 9, amount: 9 },
        ],
        totalTax: 18,
        partyStateMissing: false,
      },
    });
  });

  it('404s "Customer not found" when both the legacy Customer AND Contact lookups miss', async () => {
    mockTaxRateFindFirst.mockResolvedValue(GST18);
    mockCustomerFindFirst.mockResolvedValue(null);
    mockContactFindFirst.mockResolvedValue(null);

    const res = makeRes();
    await resolveLine(makeReq({ taxableAmount: 100, taxRateId: 'rate-gst18', customerId: 'nope' }), res as never);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Customer not found' });
  });

  it('404s "Supplier not found" when both the legacy Supplier AND Contact lookups miss', async () => {
    mockTaxRateFindFirst.mockResolvedValue(GST18);
    mockSupplierFindFirst.mockResolvedValue(null);
    mockContactFindFirst.mockResolvedValue(null);

    const res = makeRes();
    await resolveLine(makeReq({ taxableAmount: 100, taxRateId: 'rate-gst18', supplierId: 'nope' }), res as never);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Supplier not found' });
  });
});

describe('resolveLine — legacy taxGroupId path (regression)', () => {
  it('still resolves a group intra-state via the library engine', async () => {
    const lib = [
      { id: 'cgst9', regime: 'GST_INDIA', taxKind: 'CGST', name: 'CGST 9%', rate: 9, isActive: true, isDeleted: false, stateId: null },
      { id: 'sgst9', regime: 'GST_INDIA', taxKind: 'SGST', name: 'SGST 9%', rate: 9, isActive: true, isDeleted: false, stateId: null },
      { id: 'igst18', regime: 'GST_INDIA', taxKind: 'IGST', name: 'IGST 18%', rate: 18, isActive: true, isDeleted: false, stateId: null },
    ];
    mockTaxGroupFindUnique.mockResolvedValue({ id: 'g1', tax_name: 'GST 18%', tax_rates: lib.slice(0, 2) });
    mockCustomerFindFirst.mockResolvedValue({ billingAddress: { countryId: 'c-in', stateId: 'st-tn' } });
    mockTaxRateFindMany.mockResolvedValue(lib);

    const res = makeRes();
    await resolveLine(makeReq({ taxableAmount: 100, taxGroupId: 'g1', customerId: 'cust-1' }), res as never);
    expect(res.statusCode).toBe(200);
    const data = (res.body as { data: { taxes: Array<{ kind: string }>; totalTax: number } }).data;
    expect(data.taxes.map((t) => t.kind).sort()).toEqual(['CGST', 'SGST']);
    expect(data.totalTax).toBe(18);
  });

  it('400s when neither taxRateId nor taxGroupId is sent', async () => {
    const res = makeRes();
    await resolveLine(makeReq({ taxableAmount: 100 }), res as never);
    expect(res.statusCode).toBe(400);
  });
});
