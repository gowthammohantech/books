/**
 * tests/staffActivityController.test.ts
 *
 * New staff invoice-activity report (customer ask: "how many invoices has
 * each staff member processed?"). Aggregates AuditLog rows the global audit
 * extension already writes for Invoice create/update/delete.
 *
 * Coverage:
 *  - tenant scoping: the AuditLog query's userId filter is built ONLY from
 *    this tenant's staff (owner + ownerId == tenant) — never a global query.
 *    This mirrors the P0 cross-tenant-leak class of bug fixed elsewhere in
 *    this session, so it is asserted explicitly here.
 *  - a staff member with zero AuditLog activity still appears in `rows` with
 *    all-zero counts/value (a manager should see who did nothing too).
 *  - a deleted invoice is excluded from `totalValueCreated` but still counts
 *    toward `invoicesCreated` (created-then-deleted) and `invoicesDeleted`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';
const OTHER_TENANT_ID = 'tenant-beta';

const {
  mockUserFindMany,
  mockAuditLogFindMany,
  mockInvoiceFindMany,
} = vi.hoisted(() => ({
  mockUserFindMany: vi.fn(),
  mockAuditLogFindMany: vi.fn(),
  mockInvoiceFindMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: { findMany: mockUserFindMany },
    auditLog: { findMany: mockAuditLogFindMany },
    invoice: { findMany: mockInvoiceFindMany },
  },
}));

import { getStaffActivity } from '../controllers/staffActivityController';

function makeReqRes(query: Record<string, unknown> = {}) {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, query } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('staffActivityController — tenant scoping', () => {
  it('scopes the AuditLog query to only this tenant\'s staff userIds (owner + ownerId==tenant)', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: TENANT_ID, firstName: 'Owner', lastName: 'Boss', email: 'owner@t.test' },
      { id: 'staff-1', firstName: 'Staff', lastName: 'One', email: 'staff1@t.test' },
    ]);
    mockAuditLogFindMany.mockResolvedValue([]);
    mockInvoiceFindMany.mockResolvedValue([]);

    const { req, res } = makeReqRes();
    await getStaffActivity(req, res);

    // The staff-lookup query mirrors listStaffUsers's tenant OR-clause exactly.
    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ OR: [{ id: TENANT_ID }, { ownerId: TENANT_ID }] }],
        }),
      }),
    );

    // The AuditLog query's userId filter must be built from ONLY the resolved
    // tenant staff ids — never OTHER_TENANT_ID, never an unscoped query.
    const auditWhere = mockAuditLogFindMany.mock.calls[0][0].where;
    expect(auditWhere.userId.in).toEqual(expect.arrayContaining([TENANT_ID, 'staff-1']));
    expect(auditWhere.userId.in).not.toContain(OTHER_TENANT_ID);
    expect(auditWhere.entityType).toBe('Invoice');

    expect(res.status).not.toHaveBeenCalledWith(401);
  });

  it('includes a staff member with zero activity in rows, with all-zero counts/value', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: TENANT_ID, firstName: 'Owner', lastName: 'Boss', email: 'owner@t.test' },
      { id: 'staff-idle', firstName: 'Idle', lastName: 'Person', email: 'idle@t.test' },
    ]);
    // Only the owner has activity; staff-idle has none.
    mockAuditLogFindMany.mockResolvedValue([
      { userId: TENANT_ID, action: 'CREATE', entityId: 'inv-1' },
    ]);
    mockInvoiceFindMany.mockResolvedValue([{ id: 'inv-1', TotalAmount: 100 }]);

    const { req, res } = makeReqRes();
    await getStaffActivity(req, res);

    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      data: { rows: Array<{ userId: string; invoicesCreated: number; invoicesUpdated: number; invoicesDeleted: number; totalValueCreated: number }> };
    };
    const idleRow = body.data.rows.find((r) => r.userId === 'staff-idle');
    expect(idleRow).toBeDefined();
    expect(idleRow).toMatchObject({
      invoicesCreated: 0,
      invoicesUpdated: 0,
      invoicesDeleted: 0,
      totalValueCreated: 0,
    });
  });

  it('excludes a deleted invoice from totalValueCreated but still counts it in invoicesCreated and invoicesDeleted', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: TENANT_ID, firstName: 'Owner', lastName: 'Boss', email: 'owner@t.test' },
    ]);
    // The staff member created an invoice, then it was later deleted.
    mockAuditLogFindMany.mockResolvedValue([
      { userId: TENANT_ID, action: 'CREATE', entityId: 'inv-deleted' },
      { userId: TENANT_ID, action: 'DELETE', entityId: 'inv-deleted' },
      { userId: TENANT_ID, action: 'CREATE', entityId: 'inv-live' },
    ]);
    // Invoice.findMany is queried with isDeleted: false, so the deleted invoice
    // (inv-deleted) is never returned — only inv-live comes back.
    mockInvoiceFindMany.mockResolvedValue([{ id: 'inv-live', TotalAmount: 250.5 }]);

    const { req, res } = makeReqRes();
    await getStaffActivity(req, res);

    // Confirm the invoice value lookup excludes soft-deleted rows.
    expect(mockInvoiceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isDeleted: false }),
      }),
    );

    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      data: { rows: Array<{ userId: string; invoicesCreated: number; invoicesDeleted: number; totalValueCreated: number }> };
    };
    const row = body.data.rows.find((r) => r.userId === TENANT_ID)!;
    expect(row.invoicesCreated).toBe(2); // inv-deleted + inv-live both counted
    expect(row.invoicesDeleted).toBe(1);
    expect(row.totalValueCreated).toBe(250.5); // only inv-live's value
  });
});
