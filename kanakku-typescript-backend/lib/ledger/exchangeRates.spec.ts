// lib/ledger/exchangeRates.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { resolveRate, loadRate, type ExchangeRateRow, type RateTx } from './exchangeRates';

function row(from: string, to: string, rate: string, dateStr: string): ExchangeRateRow {
  return {
    fromCurrency: from,
    toCurrency: to,
    rate: new Prisma.Decimal(rate),
    asOfDate: new Date(dateStr),
  };
}

describe('resolveRate (pure)', () => {
  it('returns Decimal(1) when from === to', () => {
    const result = resolveRate([], 'USD', 'USD', new Date('2026-06-01'));
    expect(result?.equals(new Prisma.Decimal(1))).toBe(true);
  });

  it('returns null when no rows match the pair', () => {
    const rows = [row('EUR', 'INR', '90', '2026-05-01')];
    expect(resolveRate(rows, 'USD', 'INR', new Date('2026-06-01'))).toBeNull();
  });

  it('returns null when all rows are after asOf', () => {
    const rows = [row('USD', 'INR', '83', '2026-07-01')];
    expect(resolveRate(rows, 'USD', 'INR', new Date('2026-06-01'))).toBeNull();
  });

  it('returns the rate from the latest row at or before asOf', () => {
    const rows = [
      row('USD', 'INR', '80', '2026-04-01'),
      row('USD', 'INR', '83', '2026-06-01'), // exactly on asOf date
      row('USD', 'INR', '85', '2026-07-01'), // after asOf — excluded
    ];
    const result = resolveRate(rows, 'USD', 'INR', new Date('2026-06-01'));
    expect(result?.toString()).toBe('83');
  });

  it('picks the latest row when multiple qualify', () => {
    const rows = [
      row('USD', 'INR', '80', '2026-03-15'),
      row('USD', 'INR', '82', '2026-05-20'),
      row('USD', 'INR', '83.5', '2026-05-31'),
    ];
    const result = resolveRate(rows, 'USD', 'INR', new Date('2026-06-01'));
    expect(result?.toString()).toBe('83.5');
  });

  it('ignores rows for different pairs', () => {
    const rows = [
      row('EUR', 'INR', '90', '2026-05-01'),
      row('USD', 'INR', '83', '2026-05-01'),
    ];
    const result = resolveRate(rows, 'EUR', 'INR', new Date('2026-06-01'));
    expect(result?.toString()).toBe('90');
  });

  it('returns exact asOfDate match when it equals asOf', () => {
    const asOf = new Date('2026-06-07T00:00:00.000Z');
    const rows = [row('GBP', 'USD', '1.27', '2026-06-07T00:00:00.000Z')];
    const result = resolveRate(rows, 'GBP', 'USD', asOf);
    expect(result?.toString()).toBe('1.27');
  });
});

describe('loadRate (DB-backed)', () => {
  function fakeTx(returnedRows: ExchangeRateRow[]): RateTx {
    return {
      exchangeRate: {
        findMany: vi.fn().mockResolvedValue(returnedRows),
      },
    };
  }

  it('returns Decimal(1) for same-currency without querying DB', async () => {
    const tx = fakeTx([]);
    const result = await loadRate(tx, 'u1', 'USD', 'USD', new Date('2026-06-01'));
    expect(result?.equals(new Prisma.Decimal(1))).toBe(true);
    expect((tx.exchangeRate.findMany as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('returns null when DB returns no rows', async () => {
    const tx = fakeTx([]);
    const result = await loadRate(tx, 'u1', 'USD', 'INR', new Date('2026-06-01'));
    expect(result).toBeNull();
  });

  it('returns rate from DB row', async () => {
    const tx = fakeTx([row('USD', 'INR', '83.25', '2026-06-01')]);
    const result = await loadRate(tx, 'u1', 'USD', 'INR', new Date('2026-06-01'));
    expect(result?.toString()).toBe('83.25');
  });

  it('passes correct query args (userId, pair, lte asOf, take 1)', async () => {
    const tx = fakeTx([row('USD', 'INR', '83', '2026-06-01')]);
    const asOf = new Date('2026-06-07');
    await loadRate(tx, 'user-42', 'USD', 'INR', asOf);
    const spy = tx.exchangeRate.findMany as ReturnType<typeof vi.fn>;
    expect(spy).toHaveBeenCalledWith({
      where: {
        userId: 'user-42',
        fromCurrency: 'USD',
        toCurrency: 'INR',
        asOfDate: { lte: asOf },
      },
      orderBy: { asOfDate: 'desc' },
      take: 1,
    });
  });
});
