/**
 * tests/supplierPaymentController.tenantScope.test.ts
 *
 * P0-2b regression tripwire: controllers/Admin/Purchases/supplierPaymentController.ts
 * accepted a client-supplied `purchaseId` (and, for BANK payments, `bankId`)
 * with NO ownership check before creating a SupplierPayment against it,
 * updating that purchase's status, and posting GL entries — letting a caller
 * reference (and mutate) another tenant's Purchase/BankDetail. SupplierPayment
 * itself has no direct `userId` column, so ownership is checked via the
 * related Purchase's `userId`. PettyCash reads in this file are scoped with a
 * strict `{ userId }` match (no OR-null fallback) per the P0-2a PettyCash
 * tenant-scope work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const TENANT_ID = 'tenant-alpha';

const {
  mockPurchaseFindFirst,
  mockPurchaseUpdate,
  mockPurchaseFindUnique,
  mockContactFindFirst,
  mockBankDetailFindFirst,
  mockBankDetailUpdate,
  mockPettyCashFindFirst,
  mockPettyCashUpdate,
  mockSupplierPaymentFindFirst,
  mockSupplierPaymentCreate,
  mockSupplierPaymentUpdate,
  mockSupplierPaymentDelete,
  mockSupplierPaymentAggregate,
  mockSupplierPaymentFindMany,
  mockSupplierPaymentCount,
  mockBankTransactionCreate,
  mockPettyCashTransactionCreate,
  mockCompanySettingsFindFirst,
  mockPaymentModeFindUnique,
} = vi.hoisted(() => ({
  mockPurchaseFindFirst: vi.fn(),
  mockPurchaseUpdate: vi.fn(),
  mockPurchaseFindUnique: vi.fn(),
  mockContactFindFirst: vi.fn(),
  mockBankDetailFindFirst: vi.fn(),
  mockBankDetailUpdate: vi.fn(),
  mockPettyCashFindFirst: vi.fn(),
  mockPettyCashUpdate: vi.fn(),
  mockSupplierPaymentFindFirst: vi.fn(),
  mockSupplierPaymentCreate: vi.fn(),
  mockSupplierPaymentUpdate: vi.fn(),
  mockSupplierPaymentDelete: vi.fn(),
  mockSupplierPaymentAggregate: vi.fn(),
  mockSupplierPaymentFindMany: vi.fn(),
  mockSupplierPaymentCount: vi.fn(),
  mockBankTransactionCreate: vi.fn(),
  mockPettyCashTransactionCreate: vi.fn(),
  mockCompanySettingsFindFirst: vi.fn(),
  mockPaymentModeFindUnique: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const tx = {
    supplierPayment: {
      findFirst: mockSupplierPaymentFindFirst,
      create: mockSupplierPaymentCreate,
      update: mockSupplierPaymentUpdate,
      delete: mockSupplierPaymentDelete,
      aggregate: mockSupplierPaymentAggregate,
    },
    purchase: { update: mockPurchaseUpdate, findUnique: mockPurchaseFindUnique },
    bankDetail: { findFirst: mockBankDetailFindFirst, update: mockBankDetailUpdate },
    bankTransaction: { create: mockBankTransactionCreate },
    pettyCash: { findFirst: mockPettyCashFindFirst, update: mockPettyCashUpdate },
    pettyCashTransaction: { create: mockPettyCashTransactionCreate },
    companySettings: { findFirst: mockCompanySettingsFindFirst },
    paymentMode: { findUnique: mockPaymentModeFindUnique },
  };
  return {
    prisma: {
      purchase: { findFirst: mockPurchaseFindFirst, findUnique: mockPurchaseFindUnique },
      contact: { findFirst: mockContactFindFirst },
      bankDetail: { findFirst: mockBankDetailFindFirst },
      pettyCash: { findFirst: mockPettyCashFindFirst },
      supplierPayment: {
        findFirst: mockSupplierPaymentFindFirst,
        aggregate: mockSupplierPaymentAggregate,
        findMany: mockSupplierPaymentFindMany,
        count: mockSupplierPaymentCount,
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('../lib/ledger/ledgerPosting', () => ({
  postSupplierPayment: vi.fn().mockResolvedValue(undefined),
  reverseDocument: vi.fn().mockResolvedValue(undefined),
  voidDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/ledger/bankAccount', () => ({
  resolveBankGlAccountId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/ledger/postingGate', () => ({
  shouldPost: vi.fn().mockReturnValue(true),
}));

vi.mock('express-validator', () => ({
  validationResult: vi.fn(() => ({ isEmpty: () => true, array: () => [] })),
}));

import {
  createSupplierPayment,
  listSupplierPayments,
  updateSupplierPayment,
  deleteSupplierPayment,
} from '../controllers/Admin/Purchases/supplierPaymentController';

function makeReqRes(
  body: Record<string, unknown> = {},
  params: Record<string, unknown> = {},
  query: Record<string, unknown> = {},
) {
  const req = {
    tenantId: TENANT_ID,
    user: TENANT_ID,
    query,
    params,
    body,
    protocol: 'http',
    get: (_header: string) => 'localhost',
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

function assertNoNullUserIdBranch(value: unknown, path = 'where'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoNullUserIdBranch(v, `${path}[${i}]`));
    return;
  }
  const obj = value as Record<string, unknown>;
  if ('userId' in obj && obj.userId === null) {
    throw new Error(`found userId: null at ${path} — cross-tenant leak`);
  }
  for (const [key, val] of Object.entries(obj)) {
    assertNoNullUserIdBranch(val, `${path}.${key}`);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPurchaseFindFirst.mockResolvedValue(null);
  mockPurchaseFindUnique.mockResolvedValue(null);
  mockPurchaseUpdate.mockResolvedValue({});
  mockContactFindFirst.mockResolvedValue(null);
  mockBankDetailFindFirst.mockResolvedValue(null);
  mockBankDetailUpdate.mockResolvedValue({});
  mockPettyCashFindFirst.mockResolvedValue(null);
  mockPettyCashUpdate.mockResolvedValue({});
  mockSupplierPaymentFindFirst.mockResolvedValue(null);
  mockSupplierPaymentCreate.mockResolvedValue({
    id: 'sp-1',
    paymentDate: new Date(),
    amount: 100,
    paidAmount: 100,
    dueAmount: 0,
  });
  mockSupplierPaymentUpdate.mockResolvedValue({
    id: 'sp-1',
    purchaseId: 'purchase-1',
    sourceType: 'BANK',
    bankId: 'bank-1',
    paymentDate: new Date(),
    amount: 100,
    paidAmount: 100,
    dueAmount: 0,
  });
  mockSupplierPaymentDelete.mockResolvedValue({});
  // Default: no prior payments recorded against the purchase.
  mockSupplierPaymentAggregate.mockResolvedValue({ _sum: { paidAmount: null } });
  mockSupplierPaymentFindMany.mockResolvedValue([]);
  mockSupplierPaymentCount.mockResolvedValue(0);
  mockBankTransactionCreate.mockResolvedValue({});
  mockPettyCashTransactionCreate.mockResolvedValue({});
  mockCompanySettingsFindFirst.mockResolvedValue(null);
  mockPaymentModeFindUnique.mockResolvedValue({ id: 'pm-1', slug: 'cash' });
});

describe('supplierPaymentController — tenant scoping', () => {
  it('createSupplierPayment 404s when purchaseId belongs to another tenant', async () => {
    mockPurchaseFindFirst.mockResolvedValue(null); // simulates foreign-tenant purchase
    const { req, res } = makeReqRes({
      purchaseId: 'foreign-purchase',
      sourceType: 'BANK',
      bankId: 'bank-1',
      paymentMode: 'pm-1',
      amount: 100,
      paidAmount: 100,
      dueAmount: 0,
    });

    await createSupplierPayment(req, res);

    expect(mockPurchaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'foreign-purchase', userId: TENANT_ID }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockSupplierPaymentCreate).not.toHaveBeenCalled();
  });

  it('createSupplierPayment 400s when bankId belongs to another tenant (purchase owned)', async () => {
    mockPurchaseFindFirst.mockResolvedValue({
      id: 'purchase-1',
      userId: TENANT_ID,
      exchangeRate: null,
      totalAmount: 1000,
    });
    mockBankDetailFindFirst.mockResolvedValue(null); // simulates foreign-tenant bank

    const { req, res } = makeReqRes({
      purchaseId: 'purchase-1',
      sourceType: 'BANK',
      bankId: 'foreign-bank',
      paymentMode: 'pm-1',
      amount: 100,
      paidAmount: 100,
      dueAmount: 0,
    });

    await createSupplierPayment(req, res);

    expect(mockBankDetailFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'foreign-bank', userId: TENANT_ID } }),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSupplierPaymentCreate).not.toHaveBeenCalled();
  });

  it('createSupplierPayment scopes the PETTY_CASH balance check strictly by tenant', async () => {
    mockPurchaseFindFirst.mockResolvedValue({
      id: 'purchase-1',
      userId: TENANT_ID,
      exchangeRate: null,
      totalAmount: 1000,
    });
    mockPettyCashFindFirst.mockResolvedValue(null); // no petty cash for this tenant

    const { req, res } = makeReqRes({
      purchaseId: 'purchase-1',
      sourceType: 'PETTY_CASH',
      amount: 50,
      paidAmount: 50,
      dueAmount: 0,
    });

    await createSupplierPayment(req, res);

    expect(mockPettyCashFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: TENANT_ID }) }),
    );
    assertNoNullUserIdBranch(mockPettyCashFindFirst.mock.calls[0][0].where);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createSupplierPayment scopes generateNextPaymentNumber via the purchase relation', async () => {
    mockPurchaseFindFirst.mockResolvedValue({
      id: 'purchase-1',
      userId: TENANT_ID,
      exchangeRate: null,
      totalAmount: 1000,
    });
    mockBankDetailFindFirst.mockResolvedValue({ id: 'bank-1', currentBalance: 1000 });

    const { req, res } = makeReqRes({
      purchaseId: 'purchase-1',
      sourceType: 'BANK',
      bankId: 'bank-1',
      paymentMode: 'pm-1',
      amount: 100,
      paidAmount: 100,
      dueAmount: 0,
    });

    await createSupplierPayment(req, res);

    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(mockSupplierPaymentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paymentId: { not: null },
          purchase: { userId: TENANT_ID },
        }),
      }),
    );
    expect(mockSupplierPaymentCreate).toHaveBeenCalled();
  });

  it('createSupplierPayment numbering falls back to the install-wide highest + 1 when the tenant candidate clashes (paymentId is globally @unique)', async () => {
    mockPurchaseFindFirst.mockResolvedValue({
      id: 'purchase-1',
      userId: TENANT_ID,
      exchangeRate: null,
      totalAmount: 1000,
    });
    mockBankDetailFindFirst.mockResolvedValue({ id: 'bank-1', currentBalance: 1000 });
    mockSupplierPaymentFindFirst.mockImplementation(
      async (args: { where: Record<string, unknown> }) => {
        // Tenant-scoped sequence lookup → fresh tenant, no rows yet.
        if ('purchase' in args.where) return null;
        // Clash check: PAY-000001 already held by another tenant.
        if (args.where.paymentId === 'PAY-000001') return { id: 'sp-other-tenant' };
        // Install-wide highest lookup.
        return { paymentId: 'PAY-000007' };
      },
    );

    const { req, res } = makeReqRes({
      purchaseId: 'purchase-1',
      sourceType: 'BANK',
      bankId: 'bank-1',
      paymentMode: 'pm-1',
      amount: 100,
      paidAmount: 100,
      dueAmount: 0,
    });

    await createSupplierPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockSupplierPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentId: 'PAY-000008' }) }),
    );
  });

  it('createSupplierPayment inherits contactId from the purchase when body.contactId is absent', async () => {
    // Root-cause regression: previously the party was set ONLY from
    // body.contactId, so a payment created without it was saved with
    // contactId=null AND supplierId=null — orphaned, even though the purchase
    // it pays down carries a real party (e.g. "Pinnacle Distributors").
    mockPurchaseFindFirst.mockResolvedValue({
      id: 'purchase-1',
      userId: TENANT_ID,
      exchangeRate: null,
      totalAmount: 1000,
      contactId: 'contact-pinnacle',
      supplierId: null,
    });
    mockBankDetailFindFirst.mockResolvedValue({ id: 'bank-1', currentBalance: 1000 });

    const { req, res } = makeReqRes({
      purchaseId: 'purchase-1',
      sourceType: 'BANK',
      bankId: 'bank-1',
      paymentMode: 'pm-1',
      amount: 100,
      paidAmount: 100,
      dueAmount: 0,
      // no contactId in the body
    });

    await createSupplierPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockSupplierPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactId: 'contact-pinnacle', supplierId: null }),
      }),
    );
    // Tenant ownership of an explicitly-provided contactId is still checked
    // when one IS supplied — inheritance must not bypass that path.
    expect(mockContactFindFirst).not.toHaveBeenCalled();
  });

  it('listSupplierPayments falls back to the purchase party when the payment has no direct contact/supplier', async () => {
    // Root-cause regression: listSupplierPayments used to resolve the display
    // party from p.contact → p.supplier → null, with NO fallback to the
    // purchase's party. A payment with contactId=null/supplierId=null (e.g. an
    // older row created before the create-side inheritance fix) rendered as
    // "Deleted User" even though its purchase has a live contact.
    mockSupplierPaymentFindMany.mockResolvedValue([
      {
        id: 'sp-orphaned',
        paymentId: 'PAY-000001',
        referenceNumber: null,
        paymentDate: new Date('2026-01-01'),
        sourceType: 'BANK',
        amount: 100,
        paidAmount: 100,
        dueAmount: 0,
        currencyCode: null,
        notes: null,
        attachment: null,
        contact: null,
        supplier: null,
        purchase: {
          id: 'purchase-1',
          purchaseId: 'PUR-0001',
          totalAmount: 1000,
          purchaseDate: new Date('2026-01-01'),
          currencyCode: null,
          contact: {
            id: 'contact-pinnacle',
            firstName: null,
            lastName: null,
            organisation: 'Pinnacle Distributors',
            email: 'ap@pinnacle.test',
            mobile: null,
            telephone: null,
            image: null,
          },
          supplier: null,
        },
        bank: null,
        paymentMode: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ]);
    mockSupplierPaymentCount.mockResolvedValue(1);

    const { req, res } = makeReqRes({}, {}, {});

    await listSupplierPayments(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as {
      data: { payments: Array<{ supplier: { name: string } | null }> };
    };
    expect(payload.data.payments[0].supplier).not.toBeNull();
    expect(payload.data.payments[0].supplier?.name).toBe('Pinnacle Distributors');
  });

  it('updateSupplierPayment scopes the existing-payment lookup by purchase.userId (404 on foreign id)', async () => {
    mockSupplierPaymentFindFirst.mockResolvedValue(null); // foreign payment
    const { req, res } = makeReqRes({ paidAmount: 50, dueAmount: 50 }, { id: 'sp-foreign' });

    await updateSupplierPayment(req, res);

    expect(mockSupplierPaymentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'sp-foreign', purchase: { userId: TENANT_ID } }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('updateSupplierPayment 404s when re-pointing to a purchaseId owned by another tenant', async () => {
    mockSupplierPaymentFindFirst.mockResolvedValue({
      id: 'sp-1',
      purchaseId: 'purchase-1',
      paidAmount: 100,
      dueAmount: 0,
      attachment: null,
      referenceNumber: null,
      paymentDate: new Date(),
      paymentModeId: 'pm-1',
      amount: 100,
      notes: null,
      contactId: null,
    });
    mockPurchaseFindFirst.mockResolvedValue(null); // the NEW target purchase is foreign

    const { req, res } = makeReqRes(
      { purchaseId: 'foreign-purchase', paidAmount: 100, dueAmount: 0 },
      { id: 'sp-1' },
    );

    await updateSupplierPayment(req, res);

    expect(mockPurchaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'foreign-purchase', userId: TENANT_ID }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockSupplierPaymentUpdate).not.toHaveBeenCalled();
  });

  it('deleteSupplierPayment scopes the lookup by purchase.userId (404 on foreign id)', async () => {
    mockSupplierPaymentFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({}, { id: 'sp-foreign' });

    await deleteSupplierPayment(req, res);

    expect(mockSupplierPaymentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'sp-foreign', purchase: { userId: TENANT_ID } }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
