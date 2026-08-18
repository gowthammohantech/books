/**
 * tests/applyBillPayment.tenantScope.test.ts
 *
 * Task 3 (P0-2b) item 6: lib/ledger/applyBillPayment.ts's payment-numbering
 * lookup (`generatePaymentId` → `db.supplierPayment.findFirst`) previously
 * scanned `{ paymentId: { not: null } }` with no tenant filter — a
 * cross-tenant sequence bleed (and, since it's the only ownership check on
 * the numbering path, worth pinning down explicitly). SupplierPayment has no
 * direct userId column, so scoping goes through the `purchase` relation:
 * `{ paymentId: { not: null }, purchase: { userId } }`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyBillPayment, type ApplyBillPaymentDb } from '../lib/ledger/applyBillPayment';

const TENANT_ID = 'tenant-alpha';

function makeDb(overrides: Partial<ApplyBillPaymentDb> = {}): ApplyBillPaymentDb {
  const base: ApplyBillPaymentDb = {
    purchase: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'purch-1',
        totalAmount: 1000,
        paidAmount: 0,
        balanceAmount: 1000,
        status: 'pending',
        userId: TENANT_ID,
        supplierId: 'sup-1',
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    supplierPayment: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      create: vi.fn().mockResolvedValue({ id: 'sp-1' }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    companySettings: { findFirst: vi.fn().mockResolvedValue(null) }, // shouldPost() gate → false, skips journalEntry/ledgerAccountMapping/accountingPeriod
    ledgerAccountMapping: { findMany: vi.fn().mockResolvedValue([]) },
    journalEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'je-1' }),
      update: vi.fn().mockResolvedValue({ id: 'je-1' }),
    },
    accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('applyBillPayment — payment-numbering tenant scope', () => {
  it('scopes generatePaymentId lookup by purchase.userId (via SupplierPayment.purchase relation)', async () => {
    const db = makeDb();

    await applyBillPayment(db, {
      userId: TENANT_ID,
      purchaseId: 'purch-1',
      amount: '100',
      date: new Date('2026-01-01'),
      bankAccountId: 'bank-1',
    });

    expect(db.supplierPayment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paymentId: { not: null },
          purchase: { userId: TENANT_ID },
        }),
      }),
    );
  });

  it('also scopes the initial purchase load by userId (404-equivalent: throws BILL_NOT_FOUND on miss)', async () => {
    const db = makeDb({
      purchase: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    });

    await expect(
      applyBillPayment(db, {
        userId: TENANT_ID,
        purchaseId: 'purch-foreign',
        amount: '100',
        date: new Date('2026-01-01'),
        bankAccountId: 'bank-1',
      }),
    ).rejects.toThrow('BILL_NOT_FOUND');

    expect(db.purchase.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'purch-foreign', userId: TENANT_ID }),
      }),
    );
  });

  it('uses the tenant-scoped candidate when no other tenant holds it', async () => {
    const db = makeDb();
    // tenant lookup → null (fresh tenant), clash check → null (number free)
    (db.supplierPayment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await applyBillPayment(db, {
      userId: TENANT_ID,
      purchaseId: 'purch-1',
      amount: '100',
      date: new Date('2026-01-01'),
      bankAccountId: 'bank-1',
    });

    expect(db.supplierPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentId: 'PAY-000001' }) }),
    );
  });

  it('falls back to the install-wide highest + 1 when the tenant candidate clashes (paymentId is globally @unique)', async () => {
    const db = makeDb();
    (db.supplierPayment.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { where: Record<string, unknown> }) => {
        // Tenant-scoped sequence lookup → fresh tenant, no rows.
        if ('purchase' in args.where) return null;
        // Clash check for PAY-000001 → held by another tenant.
        if (args.where.paymentId === 'PAY-000001') return { id: 'sp-other-tenant' };
        // Install-wide highest lookup.
        return { paymentId: 'PAY-000123' };
      },
    );

    await applyBillPayment(db, {
      userId: TENANT_ID,
      purchaseId: 'purch-1',
      amount: '100',
      date: new Date('2026-01-01'),
      bankAccountId: 'bank-1',
    });

    // Candidate PAY-000001 clashed → global max 123 + 1.
    expect(db.supplierPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentId: 'PAY-000124' }) }),
    );
  });
});
