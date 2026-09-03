/**
 * tests/purchaseController.updateFxLanded.test.ts
 *
 * Task 5 (P1 bug 4): editing a purchase void+re-posted the GL with NO
 * currency/rate/dims and re-stocked at the raw item.rate (dropping landed
 * cost). An edited FX purchase therefore re-posted at BASE rate 1 and stripped
 * freight/duty from inventory valuation.
 *
 * The re-post now delegates to the shared postPurchaseLedger (same path
 * createPurchase uses), so it carries the purchase's currencyCode/exchangeRate
 * and cost-centre/project dims; and the re-stock now uses the landed unit cost.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { mocks, captured } = vi.hoisted(() => ({
  captured: {
    postArgs: undefined as Record<string, unknown> | undefined,
    stockCalls: [] as Record<string, unknown>[],
  },
  mocks: {
    postPurchaseReceived: vi.fn(),
    voidDocument: vi.fn(),
    reverseDocument: vi.fn(),
    applyStockAdjustment: vi.fn(),
    purchaseFindFirst: vi.fn(),
    purchaseUpdate: vi.fn(),
    contactFindFirst: vi.fn(),
    userFindUnique: vi.fn(),
    supplierFindFirst: vi.fn(),
    productFindUnique: vi.fn(),
    supplierPaymentAggregate: vi.fn(),
  },
}));

vi.mock('../lib/ledger/ledgerPosting', () => ({
  postPurchaseReceived: mocks.postPurchaseReceived.mockImplementation(async (_tx: unknown, p: Record<string, unknown>) => { captured.postArgs = p; }),
  reverseDocument: mocks.reverseDocument,
  voidDocument: mocks.voidDocument,
}));
vi.mock('../lib/inventory/stockAdjust', () => ({
  applyStockAdjustment: mocks.applyStockAdjustment.mockImplementation(async (_tx: unknown, p: Record<string, unknown>) => { captured.stockCalls.push(p); }),
}));
vi.mock('../utils/mailer', () => ({ sendMail: vi.fn() }));

vi.mock('../lib/prisma', () => {
  const tx: Record<string, unknown> = {
    product: { findFirst: mocks.productFindUnique },
    supplierPayment: { aggregate: mocks.supplierPaymentAggregate },
    purchase: { update: mocks.purchaseUpdate },
    customFieldValue: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  const db: Record<string, unknown> = {
    purchase: { findFirst: mocks.purchaseFindFirst },
    contact: { findFirst: mocks.contactFindFirst },
    user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindUnique },
    supplier: { findFirst: mocks.supplierFindFirst },
    $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  return { prisma: db };
});

import { updatePurchase } from '../controllers/Admin/Purchases/purchaseController';

const EXISTING = {
  id: 'pur-1',
  tenantId: TENANT_ID,
  isDeleted: false,
  approvalStatus: 'APPROVED',
  status: 'pending',
  contactId: 'c1',
  supplierId: null,
  currencyCode: 'USD',
  exchangeRate: new Prisma.Decimal('80'),
  costCenterId: 'cc1',
  projectId: 'pj1',
  landedCost: new Prisma.Decimal('50'),
  purchaseDate: new Date('2026-02-01'),
  items: [{ productId: 'p1', qty: 2, rate: 100, amount: 200 }],
  sign_type: 'none',
  totalAmount: new Prisma.Decimal('200'),
  totalTax: new Prisma.Decimal('0'),
  referenceNo: 'R1',
  notes: '',
  termsAndCondition: '',
  checkNumber: null,
  bankId: null,
  paymentModeId: null,
};

function makeReqRes(body: Record<string, unknown>) {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, params: {}, query: {}, body, file: undefined, files: [] } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  captured.postArgs = undefined;
  captured.stockCalls = [];
  mocks.purchaseFindFirst.mockResolvedValue({ ...EXISTING });
  mocks.contactFindFirst.mockResolvedValue({ id: 'c1', defaultTaxTreatment: null });
  mocks.userFindUnique.mockResolvedValue({ id: TENANT_ID });
  mocks.supplierFindFirst.mockResolvedValue(null);
  mocks.productFindUnique.mockResolvedValue({ item_type: 'Goods' });
  mocks.supplierPaymentAggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });
  // Persist merge: update returns existing ⊕ data so the re-post reads back the
  // purchase's currency/rate/dims/landed (none of which the edit changes here).
  mocks.purchaseUpdate.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({ ...EXISTING, ...arg.data, id: 'pur-1', purchaseId: 'PUR-1' }));
});

describe('updatePurchase — FX + landed re-post', () => {
  it('re-posts at the purchase document rate with dims, and re-stocks at the landed unit cost', async () => {
    const { req, res } = makeReqRes({
      id: 'pur-1',
      billFrom: TENANT_ID,
      status: 'pending',
      contactId: 'c1',
      items: [{ productId: 'p1', qty: 2, rate: 100, amount: 200 }],
    });

    await updatePurchase(req, res);

    // GL re-post carries FX + dimensions (previously rate 1, no dims).
    expect(captured.postArgs).toBeDefined();
    expect(captured.postArgs).toMatchObject({
      currencyCode: 'USD',
      costCenterId: 'cc1',
      projectId: 'pj1',
    });
    expect(String(captured.postArgs!.exchangeRate)).toBe('80');

    // Re-stock uses landed unit cost: rate 100 + (50 landed / 2 units) = 125.
    const stockIn = captured.stockCalls.find((c) => c.type === 'stock_in');
    expect(stockIn).toBeDefined();
    expect(Number(stockIn!.unitCost)).toBe(125);
  });
});
