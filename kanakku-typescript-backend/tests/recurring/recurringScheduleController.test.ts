/**
 * tests/recurring/recurringScheduleController.test.ts
 *
 * Unit tests for the recurring-invoice SCHEDULE CRUD + lifecycle controller
 * (rebuild Task 3).
 *
 * Strategy: mock `../../lib/prisma` so no DB is needed; assert on the data
 * passed to prisma + the HTTP response. Covers:
 *   - create sets nextRunDate = startOn, status ACTIVE (or DRAFT)
 *   - pause/resume transitions (resume re-anchors a stale nextRunDate)
 *   - end is terminal from ACTIVE/PAUSED, 409 otherwise
 *   - list response shape (resolved customer name, cadence, totals)
 *
 * Invariant under test: NONE of these handlers post to the GL or touch
 * inventory — the controller never imports a posting helper, so we simply assert
 * the only prisma model it writes is `recurringInvoiceSchedule`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockCreate,
  mockFindMany,
  mockCount,
  mockFindFirst,
  mockUpdate,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    recurringInvoiceSchedule: {
      create: mockCreate,
      findMany: mockFindMany,
      count: mockCount,
      findFirst: mockFindFirst,
      update: mockUpdate,
    },
    invoice: { findMany: vi.fn() },
  },
}));

import {
  createSchedule,
  listSchedules,
  pauseSchedule,
  resumeSchedule,
  endSchedule,
} from '../../controllers/recurringScheduleController';

// ---------------------------------------------------------------------------
// Fake req/res
// ---------------------------------------------------------------------------

function makeRes() {
  const res: { statusCode: number; body: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res } = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

function makeReq(opts: { body?: unknown; params?: unknown } = {}) {
  return {
    tenantId: 'tenant-1',
    user: 'tenant-1',
    body: opts.body ?? {},
    params: opts.params ?? {},
    query: {},
  } as unknown as import('express').Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('createSchedule', () => {
  it('sets nextRunDate = startOn, status ACTIVE, occurrencesCount 0', async () => {
    mockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'sch-1',
      ...data,
    }));

    const req = makeReq({
      body: {
        name: 'Monthly hosting',
        contactId: 'c-1',
        items: [{ name: 'Hosting', amount: 100 }],
        taxableAmount: 100,
        TotalAmount: 118,
        repeatEvery: 'month',
        startOn: '2026-07-01T00:00:00Z',
      },
    });
    const res = makeRes();

    await createSchedule(req, res as unknown as import('express').Response);

    expect(res.statusCode).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.userId).toBe('tenant-1');
    expect(data.status).toBe('ACTIVE');
    expect(data.occurrencesCount).toBe(0);
    // nextRunDate is set equal to startOn
    expect((data.nextRunDate as Date).getTime()).toBe(new Date('2026-07-01T00:00:00Z').getTime());
    expect((data.startOn as Date).getTime()).toBe((data.nextRunDate as Date).getTime());
  });

  it('honours an explicit DRAFT status', async () => {
    mockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'sch-2', ...data }));
    const req = makeReq({
      body: {
        items: [{ name: 'x' }],
        taxableAmount: 10,
        TotalAmount: 10,
        startOn: '2026-07-01T00:00:00Z',
        status: 'draft',
      },
    });
    const res = makeRes();
    await createSchedule(req, res as unknown as import('express').Response);
    expect(res.statusCode).toBe(201);
    expect(mockCreate.mock.calls[0][0].data.status).toBe('DRAFT');
  });

  it('400s when startOn missing', async () => {
    const req = makeReq({ body: { items: [{}], taxableAmount: 1, TotalAmount: 1 } });
    const res = makeRes();
    await createSchedule(req, res as unknown as import('express').Response);
    expect(res.statusCode).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('400s on custom cadence without interval number/type', async () => {
    const req = makeReq({
      body: { items: [{}], taxableAmount: 1, TotalAmount: 1, startOn: '2026-07-01T00:00:00Z', repeatEvery: 'custom' },
    });
    const res = makeRes();
    await createSchedule(req, res as unknown as import('express').Response);
    expect(res.statusCode).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('listSchedules', () => {
  it('returns resolved customer name + cadence + totals + pagination', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'sch-1',
        name: 'Monthly',
        contact: { id: 'c-1', firstName: 'Jane', lastName: 'Doe', organisation: null },
        repeatEvery: 'month',
        customIntervalNumber: null,
        customIntervalType: null,
        nextRunDate: new Date('2026-08-01T00:00:00Z'),
        lastRunDate: null,
        status: 'ACTIVE',
        occurrencesCount: 3,
        TotalAmount: '118.0000',
      },
    ]);
    mockCount.mockResolvedValue(1);

    const req = makeReq();
    const res = makeRes();
    await listSchedules(req, res as unknown as import('express').Response);

    expect(res.statusCode).toBe(200);
    const body = res.body as { success: boolean; data: { schedules: Array<Record<string, unknown>>; pagination: Record<string, number> } };
    expect(body.success).toBe(true);
    const row = body.data.schedules[0];
    expect((row.customer as { name: string }).name).toBe('Jane Doe');
    expect(row.repeatEvery).toBe('month');
    expect(row.occurrencesCount).toBe(3);
    expect(row.TotalAmount).toBe('118.0000');
    expect(body.data.pagination.totalPages).toBe(1);
    // tenant scoping
    expect(mockFindMany.mock.calls[0][0].where.userId).toBe('tenant-1');
  });
});

// ---------------------------------------------------------------------------
// pause / resume
// ---------------------------------------------------------------------------

describe('pauseSchedule', () => {
  it('ACTIVE -> PAUSED', async () => {
    mockFindFirst.mockResolvedValue({ id: 'sch-1', status: 'ACTIVE' });
    mockUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'sch-1', ...data }));
    const res = makeRes();
    await pauseSchedule(makeReq({ params: { id: 'sch-1' } }), res as unknown as import('express').Response);
    expect(res.statusCode).toBe(200);
    expect(mockUpdate.mock.calls[0][0].data.status).toBe('PAUSED');
  });

  it('409 when not ACTIVE', async () => {
    mockFindFirst.mockResolvedValue({ id: 'sch-1', status: 'PAUSED' });
    const res = makeRes();
    await pauseSchedule(makeReq({ params: { id: 'sch-1' } }), res as unknown as import('express').Response);
    expect(res.statusCode).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('resumeSchedule', () => {
  it('PAUSED -> ACTIVE and re-anchors a stale nextRunDate forward (no backfire)', async () => {
    const stale = new Date('2020-01-01T00:00:00Z'); // far in the past
    mockFindFirst.mockResolvedValue({
      id: 'sch-1',
      status: 'PAUSED',
      nextRunDate: stale,
      repeatEvery: 'month',
      customIntervalNumber: null,
      customIntervalType: null,
    });
    mockUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'sch-1', ...data }));
    const res = makeRes();
    await resumeSchedule(makeReq({ params: { id: 'sch-1' } }), res as unknown as import('express').Response);

    expect(res.statusCode).toBe(200);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('ACTIVE');
    // Re-anchored: the new nextRunDate must be in the future, not the stale 2020 date.
    expect((data.nextRunDate as Date).getTime()).toBeGreaterThan(stale.getTime());
    expect((data.nextRunDate as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('keeps a future nextRunDate as-is on resume', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // ~30 days out
    mockFindFirst.mockResolvedValue({
      id: 'sch-1',
      status: 'PAUSED',
      nextRunDate: future,
      repeatEvery: 'month',
      customIntervalNumber: null,
      customIntervalType: null,
    });
    mockUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'sch-1', ...data }));
    const res = makeRes();
    await resumeSchedule(makeReq({ params: { id: 'sch-1' } }), res as unknown as import('express').Response);
    expect((mockUpdate.mock.calls[0][0].data.nextRunDate as Date).getTime()).toBe(future.getTime());
  });

  it('409 when not PAUSED', async () => {
    mockFindFirst.mockResolvedValue({ id: 'sch-1', status: 'ACTIVE' });
    const res = makeRes();
    await resumeSchedule(makeReq({ params: { id: 'sch-1' } }), res as unknown as import('express').Response);
    expect(res.statusCode).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// end (terminal)
// ---------------------------------------------------------------------------

describe('endSchedule', () => {
  it('ACTIVE -> ENDED and clears nextRunDate', async () => {
    mockFindFirst.mockResolvedValue({ id: 'sch-1', status: 'ACTIVE' });
    mockUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'sch-1', ...data }));
    const res = makeRes();
    await endSchedule(makeReq({ params: { id: 'sch-1' } }), res as unknown as import('express').Response);
    expect(res.statusCode).toBe(200);
    expect(mockUpdate.mock.calls[0][0].data.status).toBe('ENDED');
    expect(mockUpdate.mock.calls[0][0].data.nextRunDate).toBeNull();
  });

  it('PAUSED -> ENDED allowed', async () => {
    mockFindFirst.mockResolvedValue({ id: 'sch-1', status: 'PAUSED' });
    mockUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'sch-1', ...data }));
    const res = makeRes();
    await endSchedule(makeReq({ params: { id: 'sch-1' } }), res as unknown as import('express').Response);
    expect(res.statusCode).toBe(200);
    expect(mockUpdate.mock.calls[0][0].data.status).toBe('ENDED');
  });

  it('409 from a terminal status (ENDED/COMPLETED)', async () => {
    mockFindFirst.mockResolvedValue({ id: 'sch-1', status: 'COMPLETED' });
    const res = makeRes();
    await endSchedule(makeReq({ params: { id: 'sch-1' } }), res as unknown as import('express').Response);
    expect(res.statusCode).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
