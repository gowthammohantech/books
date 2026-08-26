/**
 * tests/timeTracking/timeReport.test.ts
 *
 * Unit tests for the time summary report controller.
 *
 * Covers:
 *   - hours sum (total, billable split)
 *   - rate × hours amount (member rate wins, then project rate, then 0)
 *   - multi-project grouping (byProject)
 *   - multi-employee grouping (byEmployee)
 *   - non-privileged user sees only own employee data (scope clamping)
 *   - missing from/to → 400
 *   - invalid status → 400
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted prisma mocks.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  timeEntryFindMany: vi.fn(),
  projectMemberFindMany: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    timeEntry: { findMany: m.timeEntryFindMany },
    projectMember: { findMany: m.projectMemberFindMany },
  },
}));

import { getTimeSummaryReport } from '../../controllers/timeTracking/timeReportController';

// ---------------------------------------------------------------------------
// req/res helpers
// ---------------------------------------------------------------------------

interface ActorOpts {
  userId?: string;
  isOwner?: boolean;
  roleName?: string | null;
  othersView?: boolean;
}

function makeReq(opts: {
  actor?: ActorOpts;
  query?: Record<string, unknown>;
} = {}): any {
  const a = opts.actor ?? {};
  const perms = new Map<string, any>();
  perms.set('time-tracking', { view: true, create: true, edit: true, delete: true, allowAll: false });
  if (a.othersView) {
    perms.set('time-tracking-others', { view: true, edit: false, create: false, delete: false, allowAll: false });
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

// ---------------------------------------------------------------------------
// Shared entry builder
// ---------------------------------------------------------------------------

function entry(overrides: {
  id?: string;
  hours?: string;
  billable?: boolean;
  projectId?: string;
  projectName?: string;
  projectBillingRate?: string | null;
  employeeUserId?: string;
  firstName?: string;
  lastName?: string;
}): any {
  return {
    id: overrides.id ?? 'e1',
    timesheetId: 'ts1',
    projectId: overrides.projectId ?? 'proj-1',
    date: new Date('2026-06-23'),
    hours: overrides.hours ?? '8.00',
    billable: overrides.billable ?? true,
    note: null,
    timesheet: {
      employeeUserId: overrides.employeeUserId ?? 'emp-1',
      employee: {
        firstName: overrides.firstName ?? 'Alice',
        lastName: overrides.lastName ?? 'Smith',
      },
    },
    project: {
      id: overrides.projectId ?? 'proj-1',
      name: overrides.projectName ?? 'Project Alpha',
      billingRate: overrides.projectBillingRate ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  m.projectMemberFindMany.mockResolvedValue([]);
});

const BASE_QUERY = { from: '2026-06-01', to: '2026-06-30', status: 'APPROVED' };

describe('GET /time-reports/summary — validation', () => {
  it('400 when `from` is missing', async () => {
    const req = makeReq({ actor: { isOwner: true }, query: { to: '2026-06-30' } });
    const res = makeRes();
    await getTimeSummaryReport(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/from.*to/i);
  });

  it('400 when `to` is missing', async () => {
    const req = makeReq({ actor: { isOwner: true }, query: { from: '2026-06-01' } });
    const res = makeRes();
    await getTimeSummaryReport(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('400 when status is invalid', async () => {
    m.timeEntryFindMany.mockResolvedValue([]);
    const req = makeReq({
      actor: { isOwner: true },
      query: { ...BASE_QUERY, status: 'INVALID' },
    });
    const res = makeRes();
    await getTimeSummaryReport(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/status/i);
  });
});

describe('GET /time-reports/summary — empty result', () => {
  it('returns zeroed totals when no entries', async () => {
    m.timeEntryFindMany.mockResolvedValue([]);
    const req = makeReq({ actor: { isOwner: true }, query: BASE_QUERY });
    const res = makeRes();
    await getTimeSummaryReport(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.totals).toEqual({ hours: 0, billableHours: 0, amount: 0 });
    expect(res.body.data.byProject).toHaveLength(0);
    expect(res.body.data.byEmployee).toHaveLength(0);
  });
});

describe('GET /time-reports/summary — aggregation', () => {
  it('sums hours and splits billable correctly', async () => {
    m.timeEntryFindMany.mockResolvedValue([
      entry({ id: 'e1', hours: '6.00', billable: true }),
      entry({ id: 'e2', hours: '2.00', billable: false }),
    ]);
    const req = makeReq({ actor: { isOwner: true }, query: BASE_QUERY });
    const res = makeRes();
    await getTimeSummaryReport(req, res);

    const { totals } = res.body.data;
    expect(totals.hours).toBe(8);
    expect(totals.billableHours).toBe(6);
  });

  it('applies project billing rate when no member rate', async () => {
    m.timeEntryFindMany.mockResolvedValue([
      entry({ id: 'e1', hours: '4.00', billable: true, projectBillingRate: '50.00' }),
    ]);
    // projectMember has no billingRate for this pair.
    m.projectMemberFindMany.mockResolvedValue([
      { projectId: 'proj-1', employeeUserId: 'emp-1', billingRate: null },
    ]);
    const req = makeReq({ actor: { isOwner: true }, query: BASE_QUERY });
    const res = makeRes();
    await getTimeSummaryReport(req, res);

    expect(res.body.data.totals.amount).toBe(200); // 4h × 50
  });

  it('member rate wins over project rate', async () => {
    m.timeEntryFindMany.mockResolvedValue([
      entry({ id: 'e1', hours: '3.00', billable: true, projectBillingRate: '50.00' }),
    ]);
    m.projectMemberFindMany.mockResolvedValue([
      { projectId: 'proj-1', employeeUserId: 'emp-1', billingRate: '100.00' },
    ]);
    const req = makeReq({ actor: { isOwner: true }, query: BASE_QUERY });
    const res = makeRes();
    await getTimeSummaryReport(req, res);

    expect(res.body.data.totals.amount).toBe(300); // 3h × 100 (member rate)
  });

  it('amount is zero when no rate is configured', async () => {
    m.timeEntryFindMany.mockResolvedValue([
      entry({ id: 'e1', hours: '5.00', billable: true, projectBillingRate: null }),
    ]);
    const req = makeReq({ actor: { isOwner: true }, query: BASE_QUERY });
    const res = makeRes();
    await getTimeSummaryReport(req, res);

    expect(res.body.data.totals.amount).toBe(0);
  });

  it('groups entries by project', async () => {
    m.timeEntryFindMany.mockResolvedValue([
      entry({ id: 'e1', hours: '4.00', projectId: 'proj-1', projectName: 'Alpha', billable: true }),
      entry({ id: 'e2', hours: '3.00', projectId: 'proj-2', projectName: 'Beta', billable: false }),
    ]);
    const req = makeReq({ actor: { isOwner: true }, query: BASE_QUERY });
    const res = makeRes();
    await getTimeSummaryReport(req, res);

    const { byProject, totals } = res.body.data;
    expect(byProject).toHaveLength(2);
    const alpha = byProject.find((p: any) => p.projectId === 'proj-1');
    const beta = byProject.find((p: any) => p.projectId === 'proj-2');
    expect(alpha?.hours).toBe(4);
    expect(alpha?.billableHours).toBe(4);
    expect(beta?.hours).toBe(3);
    expect(beta?.billableHours).toBe(0);
    expect(totals.hours).toBe(7);
    expect(totals.billableHours).toBe(4);
  });

  it('groups entries by employee', async () => {
    m.timeEntryFindMany.mockResolvedValue([
      entry({ id: 'e1', hours: '5.00', employeeUserId: 'emp-1', firstName: 'Alice', lastName: 'A' }),
      entry({ id: 'e2', hours: '3.00', employeeUserId: 'emp-2', firstName: 'Bob', lastName: 'B' }),
    ]);
    const req = makeReq({ actor: { isOwner: true }, query: BASE_QUERY });
    const res = makeRes();
    await getTimeSummaryReport(req, res);

    const { byEmployee } = res.body.data;
    expect(byEmployee).toHaveLength(2);
    const alice = byEmployee.find((e: any) => e.employeeUserId === 'emp-1');
    const bob = byEmployee.find((e: any) => e.employeeUserId === 'emp-2');
    expect(alice?.hours).toBe(5);
    expect(alice?.employeeName).toBe('Alice A');
    expect(bob?.hours).toBe(3);
  });
});

describe('GET /time-reports/summary — data-scope (non-privileged user)', () => {
  it('non-privileged user is clamped to own employeeUserId even if another is requested', async () => {
    m.timeEntryFindMany.mockResolvedValue([]);
    const req = makeReq({
      actor: { userId: 'actor-1', isOwner: false, roleName: null },
      query: { ...BASE_QUERY, employeeUserId: 'emp-other' },
    });
    const res = makeRes();
    await getTimeSummaryReport(req, res);

    // The findMany call should have been scoped to actor-1, not emp-other.
    const whereArg = m.timeEntryFindMany.mock.calls[0][0].where;
    expect(whereArg.timesheet.employeeUserId).toBe('actor-1');
  });

  it('non-privileged user with no employeeUserId filter is still clamped to own', async () => {
    m.timeEntryFindMany.mockResolvedValue([]);
    const req = makeReq({
      actor: { userId: 'actor-1', isOwner: false, roleName: null },
      query: BASE_QUERY,
    });
    const res = makeRes();
    await getTimeSummaryReport(req, res);

    const whereArg = m.timeEntryFindMany.mock.calls[0][0].where;
    expect(whereArg.timesheet.employeeUserId).toBe('actor-1');
  });

  it('admin can query without employeeUserId restriction', async () => {
    m.timeEntryFindMany.mockResolvedValue([]);
    const req = makeReq({
      actor: { userId: 'actor-1', isOwner: false, roleName: 'Admin' },
      query: BASE_QUERY,
    });
    const res = makeRes();
    await getTimeSummaryReport(req, res);

    const whereArg = m.timeEntryFindMany.mock.calls[0][0].where;
    // No employeeUserId in the where means all employees are included.
    expect(whereArg.timesheet.employeeUserId).toBeUndefined();
  });

  it('time-tracking-others,view holder can query all employees', async () => {
    m.timeEntryFindMany.mockResolvedValue([]);
    const req = makeReq({
      actor: { userId: 'actor-1', isOwner: false, roleName: null, othersView: true },
      query: { ...BASE_QUERY, employeeUserId: 'emp-other' },
    });
    const res = makeRes();
    await getTimeSummaryReport(req, res);

    const whereArg = m.timeEntryFindMany.mock.calls[0][0].where;
    expect(whereArg.timesheet.employeeUserId).toBe('emp-other');
  });
});
