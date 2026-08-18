/**
 * tests/timeTracking/leaveRequest.test.ts
 *
 * Unit tests for the leave request core
 * (controllers/timeTracking/leaveRequestController).
 *
 * Strategy: mock lib/prisma so no DB is needed; drive the handlers with a
 * hand-rolled req/res (mirrors timesheet.test.ts). Behaviours covered:
 *   - create excludes weekends + holidays (totalDays only counts working days)
 *   - create overlapping an existing request -> 409
 *   - create a 0-working-day range -> 400
 *   - approve a paid request over remaining balance -> 409
 *   - approve an unpaid request ignores balance
 *   - non-privileged actor approving others -> 403
 *   - cancel a started/past APPROVED request -> 409
 *   - balances reflect approved leave days
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  holidayFindMany: vi.fn(),
  leaveTypeFindFirst: vi.fn(),
  leaveRequestFindFirst: vi.fn(),
  leaveRequestFindMany: vi.fn(),
  leaveRequestCount: vi.fn(),
  leaveRequestCreate: vi.fn(),
  leaveRequestUpdate: vi.fn(),
  leaveRequestDayCreateMany: vi.fn(),
  leaveAllocationFindMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    holiday: { findMany: m.holidayFindMany },
    leaveType: { findFirst: m.leaveTypeFindFirst },
    leaveRequest: {
      findFirst: m.leaveRequestFindFirst,
      findMany: m.leaveRequestFindMany,
      count: m.leaveRequestCount,
      create: m.leaveRequestCreate,
      update: m.leaveRequestUpdate,
    },
    leaveRequestDay: { createMany: m.leaveRequestDayCreateMany },
    leaveAllocation: { findMany: m.leaveAllocationFindMany },
    $transaction: m.transaction,
  },
}));

import {
  createLeaveRequest,
  approveLeaveRequest,
  cancelLeaveRequest,
  getLeaveBalances,
} from '../../controllers/timeTracking/leaveRequestController';

// ---------------------------------------------------------------------------
// req/res helpers
// ---------------------------------------------------------------------------

interface ActorOpts {
  userId?: string;
  isOwner?: boolean;
  roleName?: string | null;
  others?: { view?: boolean; edit?: boolean };
}

function makeReq(opts: {
  actor?: ActorOpts;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
} = {}): any {
  const a = opts.actor ?? {};
  const perms = new Map<string, any>();
  perms.set('time-tracking', { view: true, create: true, edit: true, delete: true, allowAll: false });
  if (a.others) {
    perms.set('time-tracking-others', {
      view: !!a.others.view,
      edit: !!a.others.edit,
      create: false,
      delete: false,
      allowAll: false,
    });
  }
  const userId = a.userId ?? 'actor-1';
  return {
    user: userId,
    tenantId: 'tenant-1',
    actor: {
      userId,
      tenantId: 'tenant-1',
      roleId: 'r1',
      roleName: a.roleName ?? null,
      isOwner: a.isOwner ?? false,
      perms,
    },
    params: opts.params ?? {},
    query: opts.query ?? {},
    body: opts.body ?? {},
  };
}

function makeRes(): any {
  const res: any = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = vi.fn((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.json = vi.fn((b: unknown) => {
    res.body = b;
    return res;
  });
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.holidayFindMany.mockResolvedValue([]);
  m.leaveTypeFindFirst.mockResolvedValue({ id: 'lt-1', isActive: true });
  m.leaveRequestFindFirst.mockResolvedValue(null);
  m.leaveRequestDayCreateMany.mockResolvedValue({ count: 0 });
  // $transaction(cb) runs the callback against a tx that mirrors the mocks.
  m.transaction.mockImplementation(async (cb: any) =>
    cb({
      leaveRequest: { create: m.leaveRequestCreate },
      leaveRequestDay: { createMany: m.leaveRequestDayCreateMany },
    }),
  );
});

// ---------------------------------------------------------------------------
// POST /leave-requests
// ---------------------------------------------------------------------------

describe('createLeaveRequest', () => {
  it('excludes weekends and holidays from totalDays', async () => {
    // 2026-06-22 (Mon) .. 2026-06-28 (Sun): Mon-Fri = 5 working days; mark
    // Wed 2026-06-24 a holiday -> 4 days.
    m.holidayFindMany.mockResolvedValue([
      { date: new Date(Date.UTC(2026, 5, 24)), recurringYearly: false },
    ]);
    m.leaveRequestCreate.mockResolvedValue({
      id: 'lr-1',
      employeeUserId: 'actor-1',
      leaveTypeId: 'lt-1',
      startDate: new Date(Date.UTC(2026, 5, 22)),
      endDate: new Date(Date.UTC(2026, 5, 28)),
      status: 'PENDING',
      reason: null,
      totalDays: 4,
      approvedById: null,
      approvedAt: null,
      rejectionNote: null,
    });

    const req = makeReq({
      body: { leaveTypeId: 'lt-1', startDate: '2026-06-22', endDate: '2026-06-28' },
    });
    const res = makeRes();
    await createLeaveRequest(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.data.totalDays).toBe(4); // 5 weekdays - 1 holiday
    expect(m.leaveRequestCreate).toHaveBeenCalledOnce();
  });

  it('409s when the request overlaps an existing non-cancelled request', async () => {
    m.leaveRequestFindFirst.mockResolvedValue({ id: 'lr-existing' });

    const req = makeReq({
      body: { leaveTypeId: 'lt-1', startDate: '2026-06-22', endDate: '2026-06-26' },
    });
    const res = makeRes();
    await createLeaveRequest(req, res);

    expect(res.statusCode).toBe(409);
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('400s when the range has no working days (all weekend)', async () => {
    // 2026-06-27 (Sat) .. 2026-06-28 (Sun)
    const req = makeReq({
      body: { leaveTypeId: 'lt-1', startDate: '2026-06-27', endDate: '2026-06-28' },
    });
    const res = makeRes();
    await createLeaveRequest(req, res);

    expect(res.statusCode).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /leave-requests/:id/approve
// ---------------------------------------------------------------------------

describe('approveLeaveRequest', () => {
  function pendingPaid(totalDays: number) {
    return {
      id: 'lr-1',
      employeeUserId: 'emp-2',
      leaveTypeId: 'lt-1',
      startDate: new Date(Date.UTC(2026, 5, 22)),
      endDate: new Date(Date.UTC(2026, 5, 26)),
      status: 'PENDING',
      reason: null,
      totalDays,
      approvedById: null,
      approvedAt: null,
      rejectionNote: null,
      leaveType: { id: 'lt-1', paid: true },
    };
  }

  it('409s for a paid request that exceeds remaining balance', async () => {
    m.leaveRequestFindFirst.mockResolvedValue(pendingPaid(5));
    // allocated 3 + carried 0, no prior approved -> remaining 3 < 5
    m.leaveAllocationFindMany.mockResolvedValue([
      { leaveTypeId: 'lt-1', allocatedDays: 3, carriedOverDays: 0 },
    ]);
    m.leaveRequestFindMany.mockResolvedValue([]); // no approved days yet

    const req = makeReq({
      params: { id: 'lr-1' },
      actor: { roleName: 'Admin', others: { edit: true } },
    });
    const res = makeRes();
    await approveLeaveRequest(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/Insufficient/i);
    expect(m.leaveRequestUpdate).not.toHaveBeenCalled();
  });

  it('approves an unpaid request without a balance check', async () => {
    const r = pendingPaid(99);
    r.leaveType = { id: 'lt-1', paid: false };
    m.leaveRequestFindFirst.mockResolvedValue(r);
    m.leaveRequestUpdate.mockResolvedValue({ ...r, status: 'APPROVED', approvedById: 'actor-1' });

    const req = makeReq({
      params: { id: 'lr-1' },
      actor: { roleName: 'Admin', others: { edit: true } },
    });
    const res = makeRes();
    await approveLeaveRequest(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.leaveRequest.status).toBe('APPROVED');
    expect(m.leaveAllocationFindMany).not.toHaveBeenCalled();
  });

  it('403s when a non-privileged actor approves another employee', async () => {
    m.leaveRequestFindFirst.mockResolvedValue(pendingPaid(1));
    const req = makeReq({ params: { id: 'lr-1' } }); // no others perm, not admin
    const res = makeRes();
    await approveLeaveRequest(req, res);

    expect(res.statusCode).toBe(403);
    expect(m.leaveRequestFindFirst).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /leave-requests/:id/cancel
// ---------------------------------------------------------------------------

describe('cancelLeaveRequest', () => {
  it('409s when cancelling an APPROVED request that already started (past)', async () => {
    m.leaveRequestFindFirst.mockResolvedValue({
      id: 'lr-1',
      employeeUserId: 'actor-1',
      leaveTypeId: 'lt-1',
      startDate: new Date(Date.UTC(2020, 0, 1)), // well in the past
      endDate: new Date(Date.UTC(2020, 0, 3)),
      status: 'APPROVED',
      reason: null,
      totalDays: 3,
      approvedById: 'mgr-1',
      approvedAt: new Date(),
      rejectionNote: null,
    });

    const req = makeReq({ params: { id: 'lr-1' } });
    const res = makeRes();
    await cancelLeaveRequest(req, res);

    expect(res.statusCode).toBe(409);
    expect(m.leaveRequestUpdate).not.toHaveBeenCalled();
  });

  it('cancels an APPROVED request that starts in the future', async () => {
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const base = {
      id: 'lr-1',
      employeeUserId: 'actor-1',
      leaveTypeId: 'lt-1',
      startDate: future,
      endDate: future,
      status: 'APPROVED',
      reason: null,
      totalDays: 1,
      approvedById: 'mgr-1',
      approvedAt: new Date(),
      rejectionNote: null,
    };
    m.leaveRequestFindFirst.mockResolvedValue(base);
    m.leaveRequestUpdate.mockResolvedValue({ ...base, status: 'CANCELLED' });

    const req = makeReq({ params: { id: 'lr-1' } });
    const res = makeRes();
    await cancelLeaveRequest(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.leaveRequest.status).toBe('CANCELLED');
  });
});

// ---------------------------------------------------------------------------
// GET /leave-balances
// ---------------------------------------------------------------------------

describe('getLeaveBalances', () => {
  it('reflects approved leave days in used/remaining', async () => {
    m.leaveAllocationFindMany.mockResolvedValue([
      {
        leaveTypeId: 'lt-1',
        allocatedDays: 20,
        carriedOverDays: 2,
        leaveType: { id: 'lt-1', name: 'Annual', paid: true },
      },
    ]);
    // 3 approved full days + 1 half day = 3.5 used in 2026.
    m.leaveRequestFindMany.mockResolvedValue([
      {
        leaveTypeId: 'lt-1',
        days: [
          { date: new Date(Date.UTC(2026, 5, 22)), portionDays: 1 },
          { date: new Date(Date.UTC(2026, 5, 23)), portionDays: 1 },
          { date: new Date(Date.UTC(2026, 5, 24)), portionDays: 1 },
          { date: new Date(Date.UTC(2026, 5, 25)), portionDays: 0.5 },
        ],
      },
    ]);

    const req = makeReq({ query: { year: '2026' } });
    const res = makeRes();
    await getLeaveBalances(req, res);

    expect(res.statusCode).toBe(200);
    const row = res.body.data.balances[0];
    expect(row.used).toBe(3.5);
    expect(row.remaining).toBe(18.5); // 20 + 2 - 3.5
    expect(row.leaveTypeName).toBe('Annual');
  });
});
