/**
 * tests/task7.supplierBalances.test.ts
 *
 * P1 Task 7, bug 2: supplier balances (AP subledger) must
 *  - only count POSTED bills (exclude status 'new'/'cancelled' AND
 *    approvalStatus PENDING/REJECTED),
 *  - only count non-cancelled debit notes, and
 *  - sum SupplierPayment.paidAmount (cash disbursed), not `amount`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const { mockPurchaseFindMany, mockSupplierPaymentFindMany, mockDebitNoteFindMany } = vi.hoisted(
  () => ({
    mockPurchaseFindMany: vi.fn(),
    mockSupplierPaymentFindMany: vi.fn(),
    mockDebitNoteFindMany: vi.fn(),
  }),
);

vi.mock('../lib/prisma', () => ({
  prisma: {
    purchase: { findMany: mockPurchaseFindMany },
    supplierPayment: { findMany: mockSupplierPaymentFindMany },
    debitNote: { findMany: mockDebitNoteFindMany },
  },
}));

import { supplierBalances } from '../controllers/supplierBalancesController';

function makeReqRes() {
  const req = { tenantId: TENANT_ID, query: {}, path: '/reports/supplier-balances', originalUrl: '/reports/supplier-balances' } as unknown as Request;
  const json = vi.fn().mockReturnThis();
  const res = { status: vi.fn().mockReturnThis(), json, setHeader: vi.fn(), send: vi.fn() } as unknown as Response;
  return { req, res, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPurchaseFindMany.mockResolvedValue([]);
  mockSupplierPaymentFindMany.mockResolvedValue([]);
  mockDebitNoteFindMany.mockResolvedValue([]);
});

describe('supplierBalances — bug 2 filters', () => {
  it('excludes draft/cancelled bills and approval-pending purchases via the WHERE clause', async () => {
    const { req, res } = makeReqRes();
    await supplierBalances(req, res);

    expect(mockPurchaseFindMany).toHaveBeenCalledTimes(1);
    const where = mockPurchaseFindMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ notIn: ['new', 'cancelled'] });
    expect(where.approvalStatus).toEqual({ in: ['NOT_REQUIRED', 'APPROVED'] });
  });

  it('excludes draft (new) and cancelled debit notes via the WHERE clause', async () => {
    const { req, res } = makeReqRes();
    await supplierBalances(req, res);

    // Only POSTED DNs reduce payable: a draft ('new') DN does not post to AP GL,
    // so the filter mirrors the bill posted-gate (finding 3).
    const where = mockDebitNoteFindMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ notIn: ['new', 'cancelled'] });
  });

  it('sums SupplierPayment.paidAmount (not amount) on the debit side', async () => {
    mockPurchaseFindMany.mockResolvedValue([
      { contactId: 'c1', totalAmount: 1000, contact: { firstName: 'Acme', lastName: null, organisation: null } },
    ]);
    mockSupplierPaymentFindMany.mockResolvedValue([
      // paidAmount is the real cash disbursed; `amount` carries the full bill
      // total from the legacy status-flip default and must be ignored.
      { contactId: 'c1', paidAmount: 300, amount: 1000, contact: { firstName: 'Acme', lastName: null, organisation: null } },
    ]);

    const { req, res, json } = makeReqRes();
    await supplierBalances(req, res);

    const payload = json.mock.calls[0][0];
    const row = payload.data.rows.find((r: { contactId: string }) => r.contactId === 'c1');
    expect(row.paymentsAndReturns).toBe('300');
    expect(row.balance).toBe('700'); // 1000 bills − 300 paid
    // The payment select must request paidAmount, not amount.
    expect(mockSupplierPaymentFindMany.mock.calls[0][0].select).toHaveProperty('paidAmount', true);
  });
});
