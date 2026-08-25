// tests/recurringRunner.test.ts
//
// Unit tests for the schedule runner (Task 4 of the recurring-invoice rebuild).
//
// Strategy: the GL/inventory posting helpers and applyStockAdjustment are mocked
// so these tests focus on the runner's orchestration, not the (separately tested)
// ledger engine. We assert:
//   - due selection: only ACTIVE + nextRunDate<=today schedules run,
//   - generation links recurringScheduleId + invokes the posting helpers,
//   - collision-safe numbering retries on a P2002 invoiceNumber clash,
//   - advance updates the schedule and flips to COMPLETED on end conditions,
//   - one schedule's failure does not abort the rest.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

// --- Mock the posting + inventory side-effects --------------------------------
const postInvoiceIssued = vi.fn((..._a: unknown[]) => Promise.resolve());
const postSaleCogs = vi.fn((..._a: unknown[]) => Promise.resolve());
const applyStockAdjustment = vi.fn((..._a: unknown[]) => Promise.resolve(new Prisma.Decimal(0)));

vi.mock('../lib/ledger/ledgerPosting', () => ({
  postInvoiceIssued: (...a: unknown[]) => postInvoiceIssued(...a),
  postSaleCogs: (...a: unknown[]) => postSaleCogs(...a),
}));
vi.mock('../lib/inventory/stockAdjust', () => ({
  applyStockAdjustment: (...a: unknown[]) => applyStockAdjustment(...a),
}));
// The runner imports `prisma` at module load; give it a harmless stub (tests pass
// their own db/tx explicitly so this is never exercised).
vi.mock('../lib/prisma', () => ({ prisma: {} }));

import {
  generateInvoiceFromSchedule,
  runDueSchedules,
  type ScheduleTemplate,
  type RunnerTx,
} from '../lib/recurring/runner';

// --- Fixtures -----------------------------------------------------------------

function makeSchedule(over: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return {
    id: 'sch-1',
    userId: 'user-1',
    contactId: 'contact-1',
    currencyCode: 'INR',
    taxTreatment: null,
    items: [{ productId: 'prod-1', qty: 2, unit: 'pcs' }],
    taxableAmount: new Prisma.Decimal(100),
    totalDiscount: new Prisma.Decimal(0),
    totalTax: new Prisma.Decimal(18),
    TotalAmount: new Prisma.Decimal(118),
    notes: 'note',
    termsAndCondition: 'terms',
    signatureId: null,
    billFrom: 'biller-1',
    ...over,
  };
}

interface TxOpts {
  /** invoice.create throws P2002 this many times before succeeding (numbering retry). */
  createFailures?: number;
  productType?: string;
  hasInventory?: boolean;
}

function makeTx(opts: TxOpts = {}) {
  let createCalls = 0;
  const createdData: Array<Record<string, unknown>> = [];

  const tx = {
    generalSetting: {
      findUnique: vi.fn(async () => ({ key: 'invoicePrefix', value: 'INV-' })),
    },
    invoice: {
      findFirst: vi.fn(async () => ({ invoiceNumber: 'INV-000041' })),
      create: vi.fn(async (args: { data: Record<string, unknown>; select?: unknown }) => {
        createCalls++;
        if (opts.createFailures && createCalls <= opts.createFailures) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: ['invoiceNumber'] },
          });
        }
        createdData.push(args.data);
        return { id: `inv-${createCalls}`, invoiceNumber: args.data.invoiceNumber };
      }),
    },
    product: {
      findUnique: vi.fn(async () => ({ item_type: opts.productType ?? 'Product' })),
    },
    inventory: {
      findFirst: vi.fn(async () =>
        opts.hasInventory === false
          ? null
          : { id: 'inv-row', avgCost: new Prisma.Decimal(30), quantityOnHand: new Prisma.Decimal(10) },
      ),
    },
  };
  return { tx: tx as unknown as RunnerTx, createdData, getCreateCalls: () => createCalls, raw: tx };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- generateInvoiceFromSchedule ----------------------------------------------

describe('generateInvoiceFromSchedule', () => {
  it('creates a UNPAID INVOICE linked to the schedule and posts GL + COGS', async () => {
    const { tx, createdData } = makeTx();
    const schedule = makeSchedule();
    const runDate = new Date('2026-07-01T00:00:00.000Z');

    const result = await generateInvoiceFromSchedule(tx, schedule, runDate);

    expect(result.invoiceId).toBe('inv-1');
    expect(result.invoiceNumber).toBe('INV-000042'); // 41 + 1
    const data = createdData[0];
    expect(data.recurringScheduleId).toBe('sch-1');
    expect(data.status).toBe('UNPAID');
    expect(data.invoiceType).toBe('INVOICE');
    expect(data.billFrom).toBe('biller-1');
    expect(data.invoiceDate).toBe(runDate);

    expect(postInvoiceIssued).toHaveBeenCalledTimes(1);
    expect(postSaleCogs).toHaveBeenCalledTimes(1);
    // 2 units × avgCost 30 = 60 COGS
    expect(postSaleCogs.mock.calls[0][1]).toMatchObject({ cost: '60' });
  });

  it('deducts inventory (stock_out) for non-Service items', async () => {
    const { tx } = makeTx();
    await generateInvoiceFromSchedule(tx, makeSchedule(), new Date());
    expect(applyStockAdjustment).toHaveBeenCalledTimes(1);
    expect(applyStockAdjustment.mock.calls[0][1]).toMatchObject({
      qtyDelta: -2,
      type: 'stock_out',
      referenceType: 'invoice',
    });
  });

  it('skips inventory + COGS for Service items', async () => {
    const { tx } = makeTx({ productType: 'Service' });
    await generateInvoiceFromSchedule(tx, makeSchedule(), new Date());
    expect(applyStockAdjustment).not.toHaveBeenCalled();
    // COGS still posts (helper no-ops on 0) but with cost 0
    expect(postSaleCogs.mock.calls[0][1]).toMatchObject({ cost: '0' });
  });

  it('falls back to userId for billFrom when schedule.billFrom is null', async () => {
    const { tx, createdData } = makeTx();
    await generateInvoiceFromSchedule(tx, makeSchedule({ billFrom: null }), new Date());
    expect(createdData[0].billFrom).toBe('user-1');
  });

  it('retries on a P2002 invoiceNumber collision and bumps the number', async () => {
    const { tx, createdData, getCreateCalls } = makeTx({ createFailures: 2 });
    const result = await generateInvoiceFromSchedule(tx, makeSchedule(), new Date());
    expect(getCreateCalls()).toBe(3); // 2 failures + 1 success
    // offset 2 → 41 + 1 + 2 = 44
    expect(result.invoiceNumber).toBe('INV-000044');
    expect(createdData).toHaveLength(1);
  });
});

// --- runDueSchedules ----------------------------------------------------------

function makeDb(schedules: Array<Record<string, unknown>>, txFactory = () => makeTx()) {
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const db = {
    recurringInvoiceSchedule: {
      findMany: vi.fn(async () => schedules),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const { tx, raw } = txFactory();
      // Augment the tx with the schedule.update used inside the runner's tx.
      (raw as Record<string, unknown>).recurringInvoiceSchedule = {
        update: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
          updates.push(args);
          return { id: 'sch', ...args.data };
        }),
      };
      return fn(tx);
    }),
  };
  return { db: db as never, updates };
}

function dueSchedule(over: Record<string, unknown> = {}) {
  return {
    ...makeSchedule(),
    status: 'ACTIVE',
    nextRunDate: new Date('2026-06-01'),
    startOn: new Date('2026-01-01'),
    endsOn: null,
    neverExpire: true,
    maxOccurrences: null,
    occurrencesCount: 0,
    repeatEvery: 'month',
    customIntervalNumber: null,
    customIntervalType: null,
    ...over,
  };
}

describe('runDueSchedules', () => {
  const today = new Date('2026-07-01T00:00:00.000Z');

  it('processes due schedules and advances them (ACTIVE, next run computed)', async () => {
    const { db, updates } = makeDb([dueSchedule()]);
    const summary = await runDueSchedules(today, db);

    expect(summary.processed).toBe(1);
    expect(summary.successes).toHaveLength(1);
    expect(summary.failures).toHaveLength(0);
    expect(summary.successes[0]).toMatchObject({ scheduleId: 'sch-1', status: 'ACTIVE' });

    expect(updates).toHaveLength(1);
    expect(updates[0].data.occurrencesCount).toBe(1);
    expect(updates[0].data.status).toBe('ACTIVE');
    expect(updates[0].data.nextRunDate).toBeInstanceOf(Date);
    expect(updates[0].data.lastRunDate).toBe(today);
  });

  it('passes the ACTIVE + due filter to the query', async () => {
    const { db } = makeDb([]);
    await runDueSchedules(today, db);
    const arg = (db as never as {
      recurringInvoiceSchedule: { findMany: { mock: { calls: unknown[][] } } };
    }).recurringInvoiceSchedule.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).toMatchObject({ status: 'ACTIVE' });
    expect(arg.where.nextRunDate).toMatchObject({ lte: today });
  });

  it('flips to COMPLETED when maxOccurrences is reached', async () => {
    const { db, updates } = makeDb([
      dueSchedule({ maxOccurrences: 1, occurrencesCount: 0, neverExpire: false }),
    ]);
    const summary = await runDueSchedules(today, db);
    expect(summary.successes[0].status).toBe('COMPLETED');
    expect(updates[0].data.status).toBe('COMPLETED');
    expect(updates[0].data.nextRunDate).toBeNull();
  });

  it('flips to COMPLETED when the next run would pass endsOn', async () => {
    const { db, updates } = makeDb([
      dueSchedule({
        neverExpire: false,
        endsOn: new Date('2026-07-15'), // next monthly run (Aug 1) is past this
        maxOccurrences: null,
      }),
    ]);
    await runDueSchedules(today, db);
    expect(updates[0].data.status).toBe('COMPLETED');
    expect(updates[0].data.nextRunDate).toBeNull();
  });

  it('isolates a single failure and continues with the rest', async () => {
    const good = dueSchedule({ id: 'sch-good' });
    const bad = dueSchedule({ id: 'sch-bad' });

    let call = 0;
    const txFactory = () => {
      call++;
      // First tx (sch-good) succeeds; second (sch-bad) throws on create.
      return makeTx(call === 2 ? { createFailures: 99 } : {});
    };
    const { db } = makeDb([good, bad], txFactory);

    const summary = await runDueSchedules(today, db);
    expect(summary.processed).toBe(2);
    expect(summary.successes).toHaveLength(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.successes[0].scheduleId).toBe('sch-good');
    expect(summary.failures[0].scheduleId).toBe('sch-bad');
  });
});
