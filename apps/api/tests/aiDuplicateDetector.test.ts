/**
 * tests/aiDuplicateDetector.test.ts
 *
 * Covers the Prisma port of services/ai/duplicateDetector, the guard that warns
 * before the AI creates a document it has probably already created. It queried
 * a Mongo instance that no longer exists, so it reported `hasDuplicates: false`
 * unconditionally and never fired.
 *
 * The properties worth pinning: the ±5% amount window and 30-day lookback are
 * the whole heuristic; every query is tenant-scoped; and amounts must be
 * coerced out of Prisma's Decimal before the similarity arithmetic, which would
 * otherwise yield NaN and quietly rank every match as "not similar".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.hoisted(() => ({
  invoice: vi.fn(),
  purchaseOrder: vi.fn(),
  quotation: vi.fn(),
  expense: vi.fn(),
}));

vi.mock('../lib/prisma', () => {
  const client = Object.fromEntries(
    Object.entries(findMany).map(([model, fn]) => [model, { findMany: fn }]),
  );
  return { prisma: client, prismaUnscoped: client };
});

import { checkDuplicates } from '../services/ai/duplicateDetector';

const TENANT = 'tenant-a';

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(findMany)) fn.mockResolvedValue([]);
});

describe('checkDuplicates — query construction', () => {
  it('scopes to the tenant, excludes deleted rows and looks back 30 days', async () => {
    const before = Date.now();
    await checkDuplicates('invoice', { TotalAmount: 1000, customerId: 'cus-1' }, TENANT);

    const { where } = findMany.invoice.mock.calls[0][0];
    expect(where).toMatchObject({ tenantId: TENANT, isDeleted: false });

    const lookbackDays = (before - new Date(where.createdAt.gte).getTime()) / 86_400_000;
    expect(lookbackDays).toBeCloseTo(30, 1);
  });

  it('applies a ±5% amount window around the extracted total', async () => {
    await checkDuplicates('quotation', { TotalAmount: 1000 }, TENANT);

    const { where } = findMany.quotation.mock.calls[0][0];
    expect(where.TotalAmount).toEqual({ gte: 950, lte: 1050 });
  });

  it('matches an invoice on either party column when a counterparty is known', async () => {
    await checkDuplicates('invoice', { TotalAmount: 500, customerId: 'cus-1' }, TENANT);

    const { where } = findMany.invoice.mock.calls[0][0];
    expect(where.OR).toEqual([{ customerId: 'cus-1' }, { billTo: 'cus-1' }]);
    expect(where.TotalAmount).toEqual({ gte: 475, lte: 525 });
  });

  it('omits the party and amount constraints when no counterparty was extracted', async () => {
    // Preserves the original's behaviour: with nobody to match against it lists
    // the tenant's recent invoices rather than filtering on value alone.
    await checkDuplicates('invoice', { TotalAmount: 500 }, TENANT);

    const { where } = findMany.invoice.mock.calls[0][0];
    expect(where).not.toHaveProperty('OR');
    expect(where).not.toHaveProperty('TotalAmount');
  });

  it('filters expenses by category when one was extracted', async () => {
    await checkDuplicates('expense', { amount: 200, expenseCategoryId: 'cat-1' }, TENANT);

    const { where } = findMany.expense.mock.calls[0][0];
    expect(where).toMatchObject({ expenseCategoryId: 'cat-1' });
    expect(where.amount).toEqual({ gte: 190, lte: 210 });
  });

  it('returns no duplicates for an unrecognised document type without querying', async () => {
    const result = await checkDuplicates('credit_note', { TotalAmount: 10 }, TENANT);

    expect(result).toEqual({ hasDuplicates: false, duplicates: [] });
    for (const fn of Object.values(findMany)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('checkDuplicates — results', () => {
  it('scores similarity on numbers, not Decimals, and reports the customer name', async () => {
    // Prisma hands money back as Decimal; the service must coerce it or the
    // similarity arithmetic produces NaN.
    findMany.invoice.mockResolvedValue([
      {
        id: 'inv-1',
        invoiceNumber: 'INV-000123',
        TotalAmount: '1000.0000',
        status: 'SENT',
        invoiceDate: new Date('2026-08-01'),
        customer: { name: 'Acme Ltd' },
      },
    ]);

    const result = await checkDuplicates('invoice', { TotalAmount: 1000, billTo: 'cus-1' }, TENANT);

    expect(result.hasDuplicates).toBe(true);
    expect(result.duplicates[0]).toMatchObject({
      type: 'Invoice',
      id: 'inv-1',
      number: 'INV-000123',
      amount: 1000,
      customer: 'Acme Ltd',
      similarity: 1,
    });
    expect(Number.isNaN(result.duplicates[0].similarity)).toBe(false);
  });

  it('scores a near-miss below an exact match', async () => {
    findMany.expense.mockResolvedValue([
      {
        id: 'exp-1',
        expenseId: 'EXP-1',
        amount: '1040.0000',
        paymentStatus: 'PENDING',
        expenseDate: new Date('2026-08-01'),
        description: 'Office chairs',
      },
    ]);

    const result = await checkDuplicates('expense', { amount: 1000 }, TENANT);

    expect(result.duplicates[0].similarity).toBeLessThan(1);
    expect(result.duplicates[0].similarity).toBeGreaterThan(0.9);
  });

  it('falls back to "Unknown" when the matched invoice has no customer relation', async () => {
    findMany.invoice.mockResolvedValue([
      {
        id: 'inv-2',
        invoiceNumber: null,
        TotalAmount: '10.0000',
        status: 'DRAFT',
        invoiceDate: new Date('2026-08-01'),
        customer: null,
      },
    ]);

    const result = await checkDuplicates('invoice', { TotalAmount: 10 }, TENANT);

    expect(result.duplicates[0].customer).toBe('Unknown');
  });
});
