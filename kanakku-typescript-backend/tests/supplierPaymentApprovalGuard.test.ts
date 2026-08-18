import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Guard: a supplier payment must not post an AP debit against a purchase whose
// bill AP credit isn't posted yet (approvalStatus PENDING/REJECTED) — that would
// leave AP net-negative (the "negative AP aging with nothing due" bug).
const mockPurchaseFindFirst = vi.fn();
vi.mock('../lib/prisma', () => ({
  prisma: {
    purchase: { findFirst: mockPurchaseFindFirst },
  },
}));

const { createSupplierPayment } = await import('../controllers/Admin/Purchases/supplierPaymentController');

function makeReqRes(body: Record<string, unknown>) {
  const req = { user: 'tenant-1', tenantId: 'tenant-1', body, query: {} } as unknown as Request;
  const statusMock = vi.fn().mockReturnThis();
  const jsonMock = vi.fn().mockReturnThis();
  const res = { status: statusMock, json: jsonMock } as unknown as Response;
  return { req, res, statusMock, jsonMock };
}

const body = {
  purchaseId: 'purchase-1', paymentDate: '2026-07-05', amount: 100,
  paidAmount: 100, dueAmount: 0, sourceType: 'BANK', bankId: 'bank-1', paymentMode: 'mode-1',
};

beforeEach(() => vi.clearAllMocks());

describe('createSupplierPayment — bill-posted guard', () => {
  it('rejects payment against a PENDING (awaiting-approval) purchase with 400', async () => {
    mockPurchaseFindFirst.mockResolvedValue({ id: 'purchase-1', approvalStatus: 'PENDING', totalAmount: 100 });
    const { req, res, statusMock, jsonMock } = makeReqRes(body);
    await createSupplierPayment(req, res);
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect((jsonMock.mock.calls[0][0] as { message: string }).message).toMatch(/awaiting approval/i);
  });

  it('rejects payment against a REJECTED purchase with 400', async () => {
    mockPurchaseFindFirst.mockResolvedValue({ id: 'purchase-1', approvalStatus: 'REJECTED', totalAmount: 100 });
    const { req, res, statusMock, jsonMock } = makeReqRes(body);
    await createSupplierPayment(req, res);
    expect(statusMock).toHaveBeenCalledWith(400);
    expect((jsonMock.mock.calls[0][0] as { message: string }).message).toMatch(/rejected/i);
  });
});
