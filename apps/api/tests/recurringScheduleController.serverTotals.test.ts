/**
 * Server-authoritative document totals — recurring invoice schedules.
 *
 * Schedules were the second gap in the Task 4 work: createSchedule and
 * updateSchedule wrote body.taxableAmount / totalDiscount / totalTax /
 * TotalAmount straight through.
 *
 * This one compounds. A schedule is an invoice TEMPLATE, and
 * lib/recurring/runner.ts copies `schedule.TotalAmount` and `schedule.totalTax`
 * onto each generated invoice rather than recomputing — so a wrong figure here
 * bypasses invoiceController's own authoritative path and is re-minted on every
 * run, for as long as the schedule is active.
 *
 * `roundOff` is deliberately still client-supplied: it is a presentational
 * adjustment the totals engine has no view on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { captured, mocks } = vi.hoisted(() => ({
  captured: {} as { create?: Record<string, unknown>; update?: Record<string, unknown> },
  mocks: {
    scheduleCreate: vi.fn(),
    scheduleUpdate: vi.fn(),
    scheduleFindFirst: vi.fn(),
    taxGroupFindMany: vi.fn(),
    taxRateFindMany: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => {
  const db: Record<string, unknown> = {
    recurringInvoiceSchedule: {
      create: mocks.scheduleCreate,
      update: mocks.scheduleUpdate,
      findFirst: mocks.scheduleFindFirst,
    },
    taxGroup: { findMany: mocks.taxGroupFindMany },
    taxRate: { findMany: mocks.taxRateFindMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { prisma: db, prismaUnscoped: db };
});

import { createSchedule, updateSchedule } from '../controllers/recurringScheduleController';

function makeReqRes(body: Record<string, unknown>, params: Record<string, string> = {}) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    params,
    query: {},
    body,
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

const BASE = { startOn: '2026-01-01', repeatEvery: 'month' };

beforeEach(() => {
  vi.clearAllMocks();
  captured.create = undefined;
  captured.update = undefined;
  mocks.taxGroupFindMany.mockResolvedValue([]);
  mocks.taxRateFindMany.mockResolvedValue([]);
  mocks.scheduleFindFirst.mockResolvedValue({
    id: 'sch-1',
    tenantId: TENANT_ID,
    status: 'ACTIVE',
    items: [],
    taxableAmount: 999,
    totalDiscount: 0,
    totalTax: 999,
    TotalAmount: 999,
    roundOff: null,
  });
  mocks.scheduleCreate.mockImplementation(async (arg: { data: Record<string, unknown> }) => {
    captured.create = arg.data;
    return { id: 'sch-new', ...arg.data };
  });
  mocks.scheduleUpdate.mockImplementation(async (arg: { data: Record<string, unknown> }) => {
    captured.update = arg.data;
    return { id: 'sch-1', ...arg.data };
  });
});

describe('createSchedule — the template stores derived totals, not asserted ones', () => {
  it('ignores a bogus client TotalAmount and persists the recomputed figures', async () => {
    // 2 x 100 = 200 base, CGST 9% + SGST 9% = 36 -> 236.
    const { req, res } = makeReqRes({
      ...BASE,
      items: [{ name: 'Widget', qty: 2, rate: 100, taxes: [{ percent: 9 }, { percent: 9 }] }],
      taxableAmount: 5,
      totalDiscount: 0,
      totalTax: 0,
      TotalAmount: 5,
    });

    await createSchedule(req, res);

    expect(captured.create).toBeDefined();
    expect(Number(captured.create!.taxableAmount)).toBe(200);
    expect(Number(captured.create!.totalTax)).toBe(36);
    expect(Number(captured.create!.totalDiscount)).toBe(0);
    expect(Number(captured.create!.TotalAmount)).toBe(236);
  });

  it('taxes the discounted base and clamps an over-large discount', async () => {
    const { req, res } = makeReqRes({
      ...BASE,
      items: [
        { name: 'A', qty: 2, rate: 100, discount_type: 'Percentage', discount_value: 25, taxes: [{ percent: 18 }] },
        { name: 'B', qty: 1, rate: 100, discount_type: 'Fixed', discount_value: 500 },
      ],
      TotalAmount: 1,
    });

    await createSchedule(req, res);

    // A: 200 gross, 50 discount, 18% of 150 = 27.  B: 100 gross, discount clamped to 100.
    expect(Number(captured.create!.taxableAmount)).toBe(300);
    expect(Number(captured.create!.totalDiscount)).toBe(150);
    expect(Number(captured.create!.totalTax)).toBe(27);
    expect(Number(captured.create!.TotalAmount)).toBe(177);
  });

  it('still takes roundOff from the client', async () => {
    const { req, res } = makeReqRes({
      ...BASE,
      items: [{ name: 'Widget', qty: 1, rate: 100 }],
      roundOff: 0.4,
      TotalAmount: 100,
    });

    await createSchedule(req, res);

    expect(Number(captured.create!.roundOff)).toBe(0.4);
  });
});

describe('updateSchedule — totals move only with the lines', () => {
  it('recomputes from the new lines and ignores the client totals', async () => {
    const { req, res } = makeReqRes(
      {
        items: [{ name: 'Widget', qty: 3, rate: 50, taxes: [{ percent: 10 }] }],
        taxableAmount: 1,
        totalTax: 1,
        TotalAmount: 1,
      },
      { id: 'sch-1' },
    );

    await updateSchedule(req, res);

    expect(captured.update).toBeDefined();
    expect(Number(captured.update!.taxableAmount)).toBe(150);
    expect(Number(captured.update!.totalTax)).toBe(15);
    expect(Number(captured.update!.TotalAmount)).toBe(165);
  });

  // Totals asserted without lines are no longer a way in.
  it('does not write totals when the request carries no lines', async () => {
    const { req, res } = makeReqRes(
      { name: 'renamed', taxableAmount: 1, totalTax: 1, TotalAmount: 1 },
      { id: 'sch-1' },
    );

    await updateSchedule(req, res);

    expect(captured.update).toBeDefined();
    expect(captured.update!.taxableAmount).toBeUndefined();
    expect(captured.update!.totalTax).toBeUndefined();
    expect(captured.update!.TotalAmount).toBeUndefined();
    expect(captured.update!.name).toBe('renamed');
  });
});
