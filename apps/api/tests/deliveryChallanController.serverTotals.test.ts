/**
 * Server-authoritative document totals — delivery challans.
 *
 * Delivery challans were the gap in the Task 4 server-authoritative work.
 * createDeliveryChallan persisted body.subTotal / body.totalDiscount /
 * body.totalTax / body.grandTotal verbatim, and updateDeliveryChallan did the
 * same — the exact behaviour lib/documentTotals.ts says it exists to prevent.
 * Its validator checks only that each line has a name, rate and qty, and the
 * update route carries no validator at all.
 *
 * That mattered more here than a wrong preview elsewhere, because six other
 * document types recompute and discard the client figure. Nothing discarded
 * this one, so a discounted line's inflated tax became the stored tax.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { captured, mocks } = vi.hoisted(() => ({
  captured: {} as { challan?: Record<string, unknown>; update?: Record<string, unknown> },
  mocks: {
    challanFindFirst: vi.fn(),
    challanFindUnique: vi.fn(),
    challanCreate: vi.fn(),
    challanUpdate: vi.fn(),
    contactFindFirst: vi.fn(),
    userFindUnique: vi.fn(),
    currencyFindFirst: vi.fn(),
    costCenterFindMany: vi.fn(),
    taxGroupFindMany: vi.fn(),
    taxRateFindMany: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => {
  const db: Record<string, unknown> = {
    deliveryChallan: {
      findFirst: mocks.challanFindFirst,
      findUnique: mocks.challanFindUnique,
      create: mocks.challanCreate,
      update: mocks.challanUpdate,
    },
    contact: { findFirst: mocks.contactFindFirst },
    user: { findUnique: mocks.userFindUnique },
    customer: { findFirst: vi.fn().mockResolvedValue({ id: 'cust-1' }) },
    currency: { findFirst: mocks.currencyFindFirst },
    costCenter: { findMany: mocks.costCenterFindMany },
    taxGroup: { findMany: mocks.taxGroupFindMany },
    taxRate: { findMany: mocks.taxRateFindMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { prisma: db, prismaUnscoped: db };
});

import {
  createDeliveryChallan,
  updateDeliveryChallan,
} from '../controllers/Admin/Invoice/deliveryChallanController';

function makeReqRes(body: Record<string, unknown>, params: Record<string, string> = {}) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    params,
    query: {},
    body,
    file: undefined,
    files: [],
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  captured.challan = undefined;
  captured.update = undefined;
  mocks.contactFindFirst.mockResolvedValue({ id: 'c1', defaultTaxTreatment: null });
  mocks.userFindUnique.mockResolvedValue({ id: TENANT_ID, name: 'Owner' });
  mocks.currencyFindFirst.mockResolvedValue({ code: 'INR' });
  mocks.costCenterFindMany.mockResolvedValue([]);
  // normaliseItems drops taxes[]/tax_rate_id from a challan line, keeping only a
  // flat `tax` amount and tax_group_id — so the rate has to come from the group,
  // exactly as it does for purchase orders. tg-18 is CGST 9 + SGST 9.
  mocks.taxGroupFindMany.mockResolvedValue([
    { id: 'tg-18', tax_rates: [{ rate: 9, isActive: true, isDeleted: false }, { rate: 9, isActive: true, isDeleted: false }] },
    { id: 'tg-10', tax_rates: [{ rate: 10, isActive: true, isDeleted: false }] },
  ]);
  mocks.taxRateFindMany.mockResolvedValue([]);
  // generateNextChallanNumber reads the most recent number.
  mocks.challanFindFirst.mockResolvedValue(null);
  mocks.challanCreate.mockImplementation(async (arg: { data: Record<string, unknown> }) => {
    captured.challan = arg.data;
    return { id: 'dc-new', challanNumber: 'DC-000001', ...arg.data };
  });
  mocks.challanUpdate.mockImplementation(async (arg: { data: Record<string, unknown> }) => {
    captured.update = arg.data;
    return { id: 'dc-1', ...arg.data };
  });
});

describe('createDeliveryChallan — totals come from the lines, not the request', () => {
  it('ignores a bogus client grandTotal and persists the recomputed figures', async () => {
    // 2 x 100 = 200 base, tax group tg-18 (CGST 9 + SGST 9) = 36 tax -> 236.
    const { req, res } = makeReqRes({
      contactId: 'c1',
      billFrom: TENANT_ID,
      items: [{ name: 'Widget', qty: 2, rate: 100, tax_group_id: 'tg-18', tax: 0 }],
      // All four are fiction and all four must be discarded.
      subTotal: 5,
      totalDiscount: 0,
      totalTax: 0,
      grandTotal: 5,
    });

    await createDeliveryChallan(req, res);

    expect(captured.challan).toBeDefined();
    expect(Number(captured.challan!.taxableAmount)).toBe(200);
    expect(Number(captured.challan!.vat)).toBe(36);
    expect(Number(captured.challan!.totalDiscount)).toBe(0);
    expect(Number(captured.challan!.totalAmount)).toBe(236);
  });

  // This is the shape NewDeliveryChallan.tsx actually sent: it taxed rate x qty
  // rather than the discounted base, so the tax it reported was 18% of 200
  // instead of 18% of 150.
  it('taxes the DISCOUNTED base, not the gross the client taxed', async () => {
    const { req, res } = makeReqRes({
      contactId: 'c1',
      billFrom: TENANT_ID,
      items: [
        {
          name: 'Widget',
          qty: 2,
          rate: 100,
          discount_type: 'Percentage',
          discount_value: 25,
          tax_group_id: 'tg-18',
          tax: 36, // what the buggy page computed: 18% of the undiscounted 200
        },
      ],
      subTotal: 200,
      totalDiscount: 50,
      totalTax: 36,
      grandTotal: 186,
    });

    await createDeliveryChallan(req, res);

    expect(Number(captured.challan!.taxableAmount)).toBe(200);
    expect(Number(captured.challan!.totalDiscount)).toBe(50);
    expect(Number(captured.challan!.vat)).toBe(27); // 18% of 150
    expect(Number(captured.challan!.totalAmount)).toBe(177);
  });

  // A discount larger than the line was never clamped client-side, so it could
  // drive a line — and the document — negative.
  it('clamps a discount that exceeds the line total instead of going negative', async () => {
    const { req, res } = makeReqRes({
      contactId: 'c1',
      billFrom: TENANT_ID,
      items: [{ name: 'Widget', qty: 1, rate: 100, discount_type: 'Fixed', discount_value: 500 }],
      subTotal: 100,
      totalDiscount: 500,
      grandTotal: -400,
    });

    await createDeliveryChallan(req, res);

    expect(Number(captured.challan!.totalDiscount)).toBe(100);
    expect(Number(captured.challan!.totalAmount)).toBe(0);
  });
});

describe('updateDeliveryChallan — totals are rewritten whenever the lines are', () => {
  beforeEach(() => {
    mocks.challanFindUnique.mockResolvedValue({
      id: 'dc-1',
      tenantId: TENANT_ID,
      items: [],
      taxableAmount: 999,
      totalAmount: 999,
      vat: 999,
      totalDiscount: 0,
      challanDate: new Date(),
      contactId: null,
      taxTreatment: null,
      isDeleted: false,
    });
  });

  it('recomputes from the new lines and ignores the client totals', async () => {
    const { req, res } = makeReqRes(
      {
        items: [{ name: 'Widget', qty: 3, rate: 50, tax_group_id: 'tg-10', tax: 0 }],
        subTotal: 1,
        totalDiscount: 0,
        totalTax: 1,
        grandTotal: 1,
      },
      { id: 'dc-1' },
    );

    await updateDeliveryChallan(req, res);

    expect(captured.update).toBeDefined();
    expect(Number(captured.update!.taxableAmount)).toBe(150);
    expect(Number(captured.update!.vat)).toBe(15);
    expect(Number(captured.update!.totalAmount)).toBe(165);
  });

  // Without lines there is nothing to derive from, so the stored figures stand
  // rather than being replaced by whatever the client asserted.
  it('leaves the stored totals alone when no lines are supplied', async () => {
    const { req, res } = makeReqRes(
      { notes: 'just a note', grandTotal: 1, totalTax: 1, subTotal: 1 },
      { id: 'dc-1' },
    );

    await updateDeliveryChallan(req, res);

    expect(captured.update).toBeDefined();
    expect(captured.update!.taxableAmount).toBeUndefined();
    expect(captured.update!.totalAmount).toBeUndefined();
  });
});
