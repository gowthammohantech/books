/**
 * tests/timeTracking/leaveReport.test.ts
 *
 * Unit tests for the leave summary report controller.
 *
 * Covers:
 *   - missing from/to → 400
 *   - APPROVED leave days grouped byType + byEmployee + totals
 *   - non-privileged user clamped to own employeeUserId (scope clamp)
 *   - admin/owner may query any employee
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  leaveRequestDayFindMany: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    leaveRequestDay: { findMany: m.leaveRequestDayFindMany },
  },
}));

import { getLeaveSummaryReport } from '../../controllers/timeTracking/leaveReportController';

// ---------------------------------------------------------------------------
// req/res helpers
// ---------------------------------------------------------------------------

interface ActorOpts {
  userId?: string;
  isOwner?: boolean;
  roleName?: string | null;
  othersView?: boolean;
}

function makeReq(opts: { actor?: ActorOpts; query?: Record<string, unknown> } = {}): any {
  const a = opts.actor ?? {};
  const perms = new Map<string, any>();
  perms.set('time-tracking', { view: true, create: true, edit: true, delete: true, allowAll: false });
  if (a.othersView) {
    perms.set('time-tracking-others', {
      view: true,
      edit: false,
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
    query: opts.query ?? {},
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

function day(overrides: {
  portionDays?: string;
  employeeUserId?: string;
  leaveTypeId?: string;
  leaveTypeName?: string;
  firstName?: string;
  lastName?: string;
}): any {
  return {
    portionDays: overrides.portionDays ?? '1.0',
    leaveRequest: {
      employeeUserId: overrides.employeeUserId ?? 'emp-1',
      leaveTypeId: overrides.leaveTypeId ?? 'lt-1',
      leaveType: { name: overrides.leaveTypeName ?? 'Annual Leave' },
      employee: { firstName: overrides.firstName ?? 'Alice', lastName: overrides.lastName ?? 'Smith' },
    },
  };
}

const BASE_QUERY = { from: '2026-06-01', to: '2026-06-30' };

beforeEach(() => {
  vi.clearAllMocks();
  m.leaveRequestDayFindMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /leave-reports/summary — validation', () => {
  it('400 when `from` is missing', async () => {
    const req = makeReq({ actor: { isOwner: true }, query: { to: '2026-06-30' } });
    const res = makeRes();
    await getLeaveSummaryReport(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/from.*to/i);
  });

  it('400 when `to` is missing', async () => {
    const req = makeReq({ actor: { isOwner: true }, query: { from: '2026-06-01' } });
    const res = makeRes();
    await getLeaveSummaryReport(req, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /leave-reports/summary — aggregation', () => {
  it('groups byType + byEmployee + totals (APPROVED days)', async () => {
    m.leaveRequestDayFindMany.mockResolvedValue([
      day({ portionDays: '1.0', employeeUserId: 'emp-1', leaveTypeId: 'lt-1', leaveTypeName: 'Annual' }),
      day({ portionDays: '0.5', employeeUserId: 'emp-1', leaveTypeId: 'lt-1', leaveTypeName: 'Annual' }),
      day({
        portionDays: '1.0',
        employeeUserId: 'emp-2',
        leaveTypeId: 'lt-2',
        leaveTypeName: 'Sick',
        firstName: 'Bob',
        lastName: 'Jones',
      }),
    ]);
    const req = makeReq({ actor: { isOwner: true }, query: BASE_QUERY });
    const res = makeRes();
    await getLeaveSummaryReport(req, res);

    expect(res.statusCode).toBe(200);
    const { byType, byEmployee, totals } = res.body.data;
    expect(totals).toEqual({ days: 2.5 });
    expect(byType).toEqual(
      expect.arrayContaining([
        { leaveTypeId: 'lt-1', leaveTypeName: 'Annual', days: 1.5 },
        { leaveTypeId: 'lt-2', leaveTypeName: 'Sick', days: 1 },
      ]),
    );
    expect(byEmployee).toEqual(
      expect.arrayContaining([
        { employeeUserId: 'emp-1', employeeName: 'Alice Smith', days: 1.5 },
        { employeeUserId: 'emp-2', employeeName: 'Bob Jones', days: 1 },
      ]),
    );
  });

  it('only APPROVED rows are queried (status filter in where)', async () => {
    m.leaveRequestDayFindMany.mockResolvedValue([]);
    const req = makeReq({ actor: { isOwner: true }, query: BASE_QUERY });
    const res = makeRes();
    await getLeaveSummaryReport(req, res);
    const arg = m.leaveRequestDayFindMany.mock.calls[0][0];
    expect(arg.where.leaveRequest.status).toBe('APPROVED');
    expect(arg.where.leaveRequest.userId).toBe('tenant-1');
  });
});

describe('GET /leave-reports/summary — data-scope clamp', () => {
  it('non-privileged user is clamped to own employeeUserId regardless of param', async () => {
    m.leaveRequestDayFindMany.mockResolvedValue([]);
    const req = makeReq({
      actor: { userId: 'actor-1' }, // no others,view, not admin/owner
      query: { ...BASE_QUERY, employeeUserId: 'someone-else' },
    });
    const res = makeRes();
    await getLeaveSummaryReport(req, res);
    const arg = m.leaveRequestDayFindMany.mock.calls[0][0];
    expect(arg.where.leaveRequest.employeeUserId).toBe('actor-1');
  });

  it('non-privileged user with no param is still clamped to own id', async () => {
    m.leaveRequestDayFindMany.mockResolvedValue([]);
    const req = makeReq({ actor: { userId: 'actor-1' }, query: BASE_QUERY });
    const res = makeRes();
    await getLeaveSummaryReport(req, res);
    const arg = m.leaveRequestDayFindMany.mock.calls[0][0];
    expect(arg.where.leaveRequest.employeeUserId).toBe('actor-1');
  });

  it('admin/owner may query any employee (no clamp)', async () => {
    m.leaveRequestDayFindMany.mockResolvedValue([]);
    const req = makeReq({
      actor: { isOwner: true },
      query: { ...BASE_QUERY, employeeUserId: 'emp-9' },
    });
    const res = makeRes();
    await getLeaveSummaryReport(req, res);
    const arg = m.leaveRequestDayFindMany.mock.calls[0][0];
    expect(arg.where.leaveRequest.employeeUserId).toBe('emp-9');
  });

  it('time-tracking-others,view may query any employee (no clamp)', async () => {
    m.leaveRequestDayFindMany.mockResolvedValue([]);
    const req = makeReq({
      actor: { userId: 'actor-1', othersView: true },
      query: { ...BASE_QUERY, employeeUserId: 'emp-9' },
    });
    const res = makeRes();
    await getLeaveSummaryReport(req, res);
    const arg = m.leaveRequestDayFindMany.mock.calls[0][0];
    expect(arg.where.leaveRequest.employeeUserId).toBe('emp-9');
  });

  it('admin/owner with no employee filter → no employee constraint (all)', async () => {
    m.leaveRequestDayFindMany.mockResolvedValue([]);
    const req = makeReq({ actor: { isOwner: true }, query: BASE_QUERY });
    const res = makeRes();
    await getLeaveSummaryReport(req, res);
    const arg = m.leaveRequestDayFindMany.mock.calls[0][0];
    expect(arg.where.leaveRequest.employeeUserId).toBeUndefined();
  });
});
