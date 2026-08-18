import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindMany, mockCount } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: { taxRate: { findMany: mockFindMany, count: mockCount } },
}));

import { getAllTaxRates } from '../controllers/TaxRateController';

interface MockRes { statusCode: number; body: unknown; status(c: number): MockRes; json(p: unknown): MockRes }
function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 200, body: undefined,
    status(c: number) { res.statusCode = c; return res; },
    json(p: unknown) { res.body = p; return res; },
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAllTaxRates — unified Taxes list', () => {
  it('always excludes engine-provisioned system-component rows', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    const res = makeRes();
    await getAllTaxRates({ query: {}, tenantId: 'tenant-1', user: 'tenant-1' } as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isSystemComponent: false }) }),
    );
    expect(mockCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isSystemComponent: false }) }),
    );
  });

  it('keeps tenant scoping intact alongside the new filter', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    const res = makeRes();
    await getAllTaxRates({ query: {}, tenantId: 'tenant-1', user: 'tenant-1' } as never, res as never);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'tenant-1', isDeleted: false }),
      }),
    );
  });
});
