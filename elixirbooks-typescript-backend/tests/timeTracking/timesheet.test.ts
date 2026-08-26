/**
 * tests/timeTracking/timesheet.test.ts
 *
 * Unit tests for the timesheet core (controllers/timeTracking/timesheetController).
 *
 * Strategy: mock lib/prisma so no DB is needed; drive the handlers with a
 * hand-rolled req/res. We cover the behaviours the plan calls out:
 *   - GET week get-or-create idempotency (returns existing without re-creating)
 *   - PUT entries rejected (409) when status is SUBMITTED
 *   - submit / approve / reject status transitions
 *   - non-manager approving another employee -> 403
 *   - logging to a non-member project -> 400
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted prisma mocks.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  timesheetFindUnique: vi.fn(),
  timesheetFindFirst: vi.fn(),
  timesheetCreate: vi.fn(),
  timesheetUpdate: vi.fn(),
  timesheetCount: vi.fn(),
  timesheetFindMany: vi.fn(),
  timeEntryFindMany: vi.fn(),
  timeEntryDeleteMany: vi.fn(),
  timeEntryCreateMany: vi.fn(),
  projectMemberFindMany: vi.fn(),
  userFindFirst: vi.fn(),
  holidayFindMany: vi.fn(),
  leaveRequestDayFindMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    timesheet: {
      findUnique: m.timesheetFindUnique,
      findFirst: m.timesheetFindFirst,
      create: m.timesheetCreate,
      update: m.timesheetUpdate,
      count: m.timesheetCount,
      findMany: m.timesheetFindMany,
    },
    timeEntry: {
      findMany: m.timeEntryFindMany,
      deleteMany: m.timeEntryDeleteMany,
      createMany: m.timeEntryCreateMany,
    },
    projectMember: { findMany: m.projectMemberFindMany },
    user: { findFirst: m.userFindFirst },
    holiday: { findMany: m.holidayFindMany },
    leaveRequestDay: { findMany: m.leaveRequestDayFindMany },
    $transaction: m.transaction,
  },
}));

import {
  getOrCreateWeek,
  replaceEntries,
  submitTimesheet,
  approveTimesheet,
  rejectTimesheet,
} from '../../controllers/timeTracking/timesheetController';

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

const MONDAY = new Date(Date.UTC(2026, 5, 22, 0, 0, 0, 0)); // 2026-06-22 is a Monday

beforeEach(() => {
  vi.clearAllMocks();
  // Default: target is valid tenant staff.
  m.userFindFirst.mockResolvedValue({ id: 'actor-1' });
  // Default: $transaction runs an array (return resolved array).
  m.transaction.mockResolvedValue([{ count: 0 }, { count: 0 }]);
  // Phase C: default no holidays / leave days in the week.
  m.holidayFindMany.mockResolvedValue([]);
  m.leaveRequestDayFindMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// GET /timesheets/week — get-or-create idempotency
// ---------------------------------------------------------------------------

describe('getOrCreateWeek', () => {
  it('returns the existing timesheet WITHOUT creating (idempotent)', async () => {
    const existing = {
      id: 'ts-1',
      userId: 'tenant-1',
      employeeUserId: 'actor-1',
      weekStartDate: MONDAY,
      status: 'DRAFT',
      submittedAt: null,
      approvedById: null,
      approvedAt: null,
      rejectionNote: null,
      entries: [],
    };
    m.timesheetFindUnique.mockResolvedValue(existing);
    m.projectMemberFindMany.mockResolvedValue([]);

    const req = makeReq({ query: { weekStart: '2026-06-24' } }); // a Wednesday
    const res = makeRes();
    await getOrCreateWeek(req, res);

    expect(m.timesheetCreate).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.timesheet.id).toBe('ts-1');
    // weekStart normalized to the Monday of that week.
    expect(m.timesheetFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { employeeUserId_weekStartDate: { employeeUserId: 'actor-1', weekStartDate: MONDAY } },
      }),
    );
  });

  it('creates a DRAFT when none exists', async () => {
    m.timesheetFindUnique.mockResolvedValue(null);
    m.timesheetCreate.mockResolvedValue({
      id: 'ts-new',
      userId: 'tenant-1',
      employeeUserId: 'actor-1',
      weekStartDate: MONDAY,
      status: 'DRAFT',
      submittedAt: null,
      approvedById: null,
      approvedAt: null,
      rejectionNote: null,
      entries: [],
    });
    m.projectMemberFindMany.mockResolvedValue([]);

    const req = makeReq({ query: { weekStart: '2026-06-22' } });
    const res = makeRes();
    await getOrCreateWeek(req, res);

    expect(m.timesheetCreate).toHaveBeenCalledOnce();
    expect(res.body.data.timesheet.id).toBe('ts-new');
  });

  it('400s when weekStart is missing', async () => {
    const req = makeReq({ query: {} });
    const res = makeRes();
    await getOrCreateWeek(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('Phase C: keeps existing keys AND adds holidays + leaveDays markers', async () => {
    m.timesheetFindUnique.mockResolvedValue({
      id: 'ts-1',
      userId: 'tenant-1',
      employeeUserId: 'actor-1',
      weekStartDate: MONDAY,
      status: 'DRAFT',
      submittedAt: null,
      approvedById: null,
      approvedAt: null,
      rejectionNote: null,
      entries: [],
    });
    m.projectMemberFindMany.mockResolvedValue([]);
    // A non-recurring holiday on Wed 2026-06-24 (in the week) + a recurring one
    // stored under a different year but matching month+day (Thu 2026-06-25).
    m.holidayFindMany.mockResolvedValue([
      { date: new Date(Date.UTC(2026, 5, 24)), name: 'Company Day', recurringYearly: false },
      { date: new Date(Date.UTC(2020, 5, 25)), name: 'Founders Day', recurringYearly: true },
      // Out of week (next Monday) — must be excluded.
      { date: new Date(Date.UTC(2026, 5, 29)), name: 'Other', recurringYearly: false },
    ]);
    m.leaveRequestDayFindMany.mockResolvedValue([
      {
        date: new Date(Date.UTC(2026, 5, 23)),
        portion: 'AM',
        leaveRequest: { leaveType: { name: 'Sick Leave' } },
      },
    ]);

    const req = makeReq({ query: { weekStart: '2026-06-22' } });
    const res = makeRes();
    await getOrCreateWeek(req, res);

    expect(res.statusCode).toBe(200);
    const { data } = res.body;
    // Existing Phase-1 keys unchanged.
    expect(data.timesheet).toBeDefined();
    expect(data.timesheet.id).toBe('ts-1');
    expect(Array.isArray(data.entries)).toBe(true);
    expect(Array.isArray(data.projects)).toBe(true);
    // New Phase C keys populated.
    expect(data.holidays).toEqual([
      { date: '2026-06-24', name: 'Company Day' },
      { date: '2026-06-25', name: 'Founders Day' },
    ]);
    expect(data.leaveDays).toEqual([
      { date: '2026-06-23', portion: 'AM', leaveTypeName: 'Sick Leave' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// PUT /timesheets/:id/entries
// ---------------------------------------------------------------------------

describe('replaceEntries', () => {
  it('409s when the timesheet is SUBMITTED', async () => {
    m.timesheetFindFirst.mockResolvedValue({
      id: 'ts-1',
      userId: 'tenant-1',
      employeeUserId: 'actor-1',
      weekStartDate: MONDAY,
      status: 'SUBMITTED',
      submittedAt: new Date(),
      approvedById: null,
      approvedAt: null,
      rejectionNote: null,
      entries: [],
    });

    const req = makeReq({
      params: { id: 'ts-1' },
      body: { entries: [{ projectId: 'p1', date: '2026-06-22', hours: 8 }] },
    });
    const res = makeRes();
    await replaceEntries(req, res);

    expect(res.statusCode).toBe(409);
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('400s when logging to a project the employee is not a member of', async () => {
    m.timesheetFindFirst.mockResolvedValue({
      id: 'ts-1',
      userId: 'tenant-1',
      employeeUserId: 'actor-1',
      weekStartDate: MONDAY,
      status: 'DRAFT',
      submittedAt: null,
      approvedById: null,
      approvedAt: null,
      rejectionNote: null,
      entries: [],
    });
    // employee is a member of p1 only; entry targets p-other.
    m.projectMemberFindMany.mockResolvedValue([
      { project: { id: 'p1', name: 'P1', billingRate: null }, billingRate: null, role: 'MEMBER' },
    ]);

    const req = makeReq({
      params: { id: 'ts-1' },
      body: { entries: [{ projectId: 'p-other', date: '2026-06-22', hours: 8 }] },
    });
    const res = makeRes();
    await replaceEntries(req, res);

    expect(res.statusCode).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('replaces entries on a DRAFT (member project)', async () => {
    m.timesheetFindFirst.mockResolvedValue({
      id: 'ts-1',
      userId: 'tenant-1',
      employeeUserId: 'actor-1',
      weekStartDate: MONDAY,
      status: 'DRAFT',
      submittedAt: null,
      approvedById: null,
      approvedAt: null,
      rejectionNote: null,
      entries: [],
    });
    m.projectMemberFindMany.mockResolvedValue([
      { project: { id: 'p1', name: 'P1', billingRate: null }, billingRate: null, role: 'MEMBER' },
    ]);
    m.timeEntryFindMany.mockResolvedValue([
      { id: 'e1', timesheetId: 'ts-1', projectId: 'p1', date: MONDAY, hours: 8, billable: true, note: null },
    ]);

    const req = makeReq({
      params: { id: 'ts-1' },
      body: { entries: [{ projectId: 'p1', date: '2026-06-22', hours: 8 }] },
    });
    const res = makeRes();
    await replaceEntries(req, res);

    expect(res.statusCode).toBe(200);
    expect(m.transaction).toHaveBeenCalledOnce();
    expect(res.body.data.entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// submit / approve / reject transitions
// ---------------------------------------------------------------------------

describe('submitTimesheet', () => {
  it('DRAFT -> SUBMITTED for the owner of the sheet', async () => {
    m.timesheetFindFirst.mockResolvedValue({
      id: 'ts-1',
      userId: 'tenant-1',
      employeeUserId: 'actor-1',
      weekStartDate: MONDAY,
      status: 'DRAFT',
      submittedAt: null,
      approvedById: null,
      approvedAt: null,
      rejectionNote: null,
      entries: [],
    });
    m.timesheetUpdate.mockResolvedValue({
      id: 'ts-1',
      userId: 'tenant-1',
      employeeUserId: 'actor-1',
      weekStartDate: MONDAY,
      status: 'SUBMITTED',
      submittedAt: new Date(),
      approvedById: null,
      approvedAt: null,
      rejectionNote: null,
    });

    const req = makeReq({ params: { id: 'ts-1' } });
    const res = makeRes();
    await submitTimesheet(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.timesheet.status).toBe('SUBMITTED');
    expect(m.timesheetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED' }) }),
    );
  });

  it('409s when the timesheet is already SUBMITTED', async () => {
    m.timesheetFindFirst.mockResolvedValue({
      id: 'ts-1', userId: 'tenant-1', employeeUserId: 'actor-1', weekStartDate: MONDAY,
      status: 'SUBMITTED', submittedAt: new Date(), approvedById: null, approvedAt: null,
      rejectionNote: null, entries: [],
    });
    const req = makeReq({ params: { id: 'ts-1' } });
    const res = makeRes();
    await submitTimesheet(req, res);
    expect(res.statusCode).toBe(409);
  });
});

describe('approveTimesheet', () => {
  it('SUBMITTED -> APPROVED for an admin', async () => {
    m.timesheetFindFirst.mockResolvedValue({
      id: 'ts-1', userId: 'tenant-1', employeeUserId: 'emp-2', weekStartDate: MONDAY,
      status: 'SUBMITTED', submittedAt: new Date(), approvedById: null, approvedAt: null,
      rejectionNote: null, entries: [{ projectId: 'p1' }],
    });
    m.timesheetUpdate.mockResolvedValue({
      id: 'ts-1', userId: 'tenant-1', employeeUserId: 'emp-2', weekStartDate: MONDAY,
      status: 'APPROVED', submittedAt: new Date(), approvedById: 'actor-1', approvedAt: new Date(),
      rejectionNote: null,
    });

    const req = makeReq({
      params: { id: 'ts-1' },
      actor: { roleName: 'Admin', others: { edit: true } },
    });
    const res = makeRes();
    await approveTimesheet(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.timesheet.status).toBe('APPROVED');
    expect(res.body.data.timesheet.approvedById).toBe('actor-1');
  });

  it('403s when a non-manager tries to approve another employee', async () => {
    m.timesheetFindFirst.mockResolvedValue({
      id: 'ts-1', userId: 'tenant-1', employeeUserId: 'emp-2', weekStartDate: MONDAY,
      status: 'SUBMITTED', submittedAt: new Date(), approvedById: null, approvedAt: null,
      rejectionNote: null, entries: [{ projectId: 'p1' }],
    });
    // actor has time-tracking-others.edit but is NOT a manager of p1 -> scope throws.
    m.projectMemberFindMany.mockResolvedValue([]); // no managed projects

    const req = makeReq({
      params: { id: 'ts-1' },
      actor: { others: { edit: true } }, // not admin/owner
    });
    const res = makeRes();
    await approveTimesheet(req, res);

    expect(res.statusCode).toBe(403);
    expect(m.timesheetUpdate).not.toHaveBeenCalled();
  });

  it('403s when actor lacks time-tracking-others entirely', async () => {
    m.timesheetFindFirst.mockResolvedValue({
      id: 'ts-1', userId: 'tenant-1', employeeUserId: 'emp-2', weekStartDate: MONDAY,
      status: 'SUBMITTED', submittedAt: new Date(), approvedById: null, approvedAt: null,
      rejectionNote: null, entries: [{ projectId: 'p1' }],
    });
    const req = makeReq({ params: { id: 'ts-1' } }); // no others perm
    const res = makeRes();
    await approveTimesheet(req, res);
    expect(res.statusCode).toBe(403);
  });

  it('409s when the timesheet is not SUBMITTED', async () => {
    m.timesheetFindFirst.mockResolvedValue({
      id: 'ts-1', userId: 'tenant-1', employeeUserId: 'emp-2', weekStartDate: MONDAY,
      status: 'DRAFT', submittedAt: null, approvedById: null, approvedAt: null,
      rejectionNote: null, entries: [],
    });
    const req = makeReq({
      params: { id: 'ts-1' },
      actor: { roleName: 'Admin', others: { edit: true } },
    });
    const res = makeRes();
    await approveTimesheet(req, res);
    expect(res.statusCode).toBe(409);
  });
});

describe('rejectTimesheet', () => {
  it('SUBMITTED -> REJECTED with note for an owner', async () => {
    m.timesheetFindFirst.mockResolvedValue({
      id: 'ts-1', userId: 'tenant-1', employeeUserId: 'emp-2', weekStartDate: MONDAY,
      status: 'SUBMITTED', submittedAt: new Date(), approvedById: null, approvedAt: null,
      rejectionNote: null, entries: [{ projectId: 'p1' }],
    });
    m.timesheetUpdate.mockResolvedValue({
      id: 'ts-1', userId: 'tenant-1', employeeUserId: 'emp-2', weekStartDate: MONDAY,
      status: 'REJECTED', submittedAt: new Date(), approvedById: null, approvedAt: null,
      rejectionNote: 'fix it',
    });

    const req = makeReq({
      params: { id: 'ts-1' },
      actor: { isOwner: true, others: { edit: true } },
      body: { rejectionNote: 'fix it' },
    });
    const res = makeRes();
    await rejectTimesheet(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.timesheet.status).toBe('REJECTED');
    expect(res.body.data.timesheet.rejectionNote).toBe('fix it');
  });
});
