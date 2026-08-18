/**
 * tests/expenseController.contactFirst.test.ts
 *
 * Bug: new-flow expenses leave the legacy `supplier` relation null and only
 * set the unified `contactId`. getRecurringExpenses read only `exp.supplier`
 * for the party name, so contact-linked rows rendered a blank/"Deleted User"
 * supplier. Fixed by resolving contact-first (see accountingReportController's
 * getPurchaseReport for the reference pattern), matching the tripwire in
 * tests/accountingReportController.tenantScope.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { mockExpenseFindMany, mockExpenseCount } = vi.hoisted(() => ({
  mockExpenseFindMany: vi.fn(),
  mockExpenseCount: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    expense: { findMany: mockExpenseFindMany, count: mockExpenseCount },
  },
}));

import { getRecurringExpenses } from '../controllers/expenseController';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';

function makeReqRes() {
  const req = { tenantId: TENANT_ID, user: TENANT_ID, query: {} } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExpenseFindMany.mockResolvedValue([]);
  mockExpenseCount.mockResolvedValue(0);
});

describe('expenseController — contact-first party resolution', () => {
  it('getRecurringExpenses resolves the supplier name from the unified contact when the legacy supplier is null (no "Deleted User")', async () => {
    const contact = {
      id: 'contact-1', firstName: 'Jane', lastName: 'Smith', organisation: null,
      email: 'jane@acme.test', mobile: '555-2', telephone: null, image: null,
    };
    const row = {
      id: 'exp-1', referenceNo: 'REF-1', amount: 100,
      supplier: null, contact, expenseCategory: null,
      _count: { children: 0 },
      repeatEvery: 'MONTHLY', customIntervalNumber: null, customIntervalType: null,
      startOn: new Date('2026-01-01'), endsOn: null, neverExpire: true, stopped: false,
      lastRecurringDate: null, nextRecurringDate: new Date('2026-08-01'),
    };
    mockExpenseFindMany.mockResolvedValue([row]);
    mockExpenseCount.mockResolvedValue(1);

    const { req, res } = makeReqRes();
    await getRecurringExpenses(req, res);

    expect(res.status).not.toHaveBeenCalledWith(401);
    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      data: { recurringExpenses: { supplier: { name: string } | null }[] };
    };
    const name = body.data.recurringExpenses[0].supplier?.name;
    expect(name).toBe(resolveDisplayName(contact));
    expect(name).not.toBe('');
  });
});
