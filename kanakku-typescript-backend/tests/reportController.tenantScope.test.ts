/**
 * tests/reportController.tenantScope.test.ts
 *
 * P0-2a regression tripwire: controllers/reportController.ts's stock reports
 * (getInventoryReport, getBestSellerReport, getLowStockReport,
 * getOutStockReport, getStockHistoryReport) previously queried the shared
 * Product catalog first and only ever filtered Inventory by productId — with
 * no userId anywhere (one comment even said "NOT tenant scoped" explicitly).
 * Product itself has no tenant column in this schema (it's a shared catalog),
 * so scoping is done by inverting the query to Inventory-first (Inventory
 * DOES have userId) and reaching Product only via the include/relation.
 * These tests assert every prisma.inventory.* call carries userId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { mockInventoryFindMany, mockInventoryCount, mockProductFindMany } = vi.hoisted(() => ({
  mockInventoryFindMany: vi.fn(),
  mockInventoryCount: vi.fn(),
  mockProductFindMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    inventory: { findMany: mockInventoryFindMany, count: mockInventoryCount },
    product: { findMany: mockProductFindMany },
  },
}));

import {
  getInventoryStockSummary,
  getInventoryReport,
  getBestSellerReport,
  getLowStockReport,
  getOutStockReport,
  getStockHistoryReport,
} from '../controllers/reportController';

function makeReqRes() {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, query: {} } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInventoryFindMany.mockResolvedValue([]);
  mockInventoryCount.mockResolvedValue(0);
  mockProductFindMany.mockResolvedValue([]);
});

function expectAllInventoryCallsScoped() {
  expect(mockInventoryFindMany.mock.calls.length).toBeGreaterThan(0);
  for (const call of mockInventoryFindMany.mock.calls) {
    expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
  }
  for (const call of mockInventoryCount.mock.calls) {
    expect(call[0].where).toEqual(expect.objectContaining({ userId: TENANT_ID }));
  }
}

describe('reportController — tenant scoping (Inventory-first)', () => {
  it('getInventoryStockSummary scopes the inventory query by tenant', async () => {
    const { req, res } = makeReqRes();
    await getInventoryStockSummary(req, res);
    expect(res.status).not.toHaveBeenCalledWith(401);
    expectAllInventoryCallsScoped();
  });

  it('getInventoryReport scopes totals + paginated inventory queries by tenant', async () => {
    const { req, res } = makeReqRes();
    await getInventoryReport(req, res);
    expectAllInventoryCallsScoped();
  });

  it('getBestSellerReport scopes the inventory query/count by tenant', async () => {
    const { req, res } = makeReqRes();
    await getBestSellerReport(req, res);
    expectAllInventoryCallsScoped();
  });

  it('getLowStockReport scopes the inventory query by tenant', async () => {
    const { req, res } = makeReqRes();
    await getLowStockReport(req, res);
    expectAllInventoryCallsScoped();
  });

  it('getOutStockReport scopes the inventory query by tenant', async () => {
    const { req, res } = makeReqRes();
    await getOutStockReport(req, res);
    expectAllInventoryCallsScoped();
  });

  it('getStockHistoryReport scopes both inventory queries by tenant', async () => {
    const { req, res } = makeReqRes();
    await getStockHistoryReport(req, res);
    expectAllInventoryCallsScoped();
  });
});
