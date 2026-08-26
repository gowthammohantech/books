// lib/ledger/expenseFxGuard.spec.ts
//
// Tests for the expense FX rate resolution ladder:
//   1. Base-currency path (no code / same code as base) → rate undefined, no DB hit
//   2. Explicit rate supplied → used as-is, no DB hit
//   3. loadRate hit → DB rate returned, persisted
//   4. loadRate miss → error string for 422

import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { resolveExpenseFxRate, type FxGuardDb } from './expenseFxGuard';
import type { ExchangeRateRow } from './exchangeRates';

const DATE = new Date('2026-06-01');
const USER = 'u-test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(opts: {
  baseCurrencyCode?: string | null;
  rateRows?: ExchangeRateRow[];
}): FxGuardDb & { findManySpy: ReturnType<typeof vi.fn> } {
  const findManySpy = vi.fn().mockResolvedValue(
    (opts.rateRows ?? []).map((r) => ({
      fromCurrency: r.fromCurrency,
      toCurrency: r.toCurrency,
      rate: new Prisma.Decimal(r.rate.toString()),
      asOfDate: r.asOfDate,
    })),
  );

  const baseCurrencyCode = opts.baseCurrencyCode;

  return {
    currency: {
      findFirst: vi.fn().mockResolvedValue(
        baseCurrencyCode != null ? { code: baseCurrencyCode } : null,
      ),
    },
    exchangeRate: { findMany: findManySpy },
    findManySpy,
  };
}

function rateRow(
  from: string,
  to: string,
  rate: string,
  dateStr: string,
): ExchangeRateRow {
  return {
    fromCurrency: from,
    toCurrency: to,
    rate: new Prisma.Decimal(rate),
    asOfDate: new Date(dateStr),
  };
}

// ---------------------------------------------------------------------------
// 1. Base-currency path
// ---------------------------------------------------------------------------

describe('resolveExpenseFxRate — base-currency path', () => {
  it('returns rate:undefined when currencyCode is undefined', async () => {
    const db = makeDb({ baseCurrencyCode: 'INR' });
    const result = await resolveExpenseFxRate(db, USER, undefined, undefined, DATE);
    expect(result).toEqual({ rate: undefined });
    expect(db.findManySpy).not.toHaveBeenCalled();
  });

  it('returns rate:undefined when currencyCode is empty string', async () => {
    const db = makeDb({ baseCurrencyCode: 'INR' });
    // Empty string coerced to falsy by the guard
    const result = await resolveExpenseFxRate(db, USER, '', undefined, DATE);
    expect(result).toEqual({ rate: undefined });
    expect(db.findManySpy).not.toHaveBeenCalled();
  });

  it('returns rate:undefined when currencyCode equals the base currency', async () => {
    const db = makeDb({ baseCurrencyCode: 'INR' });
    const result = await resolveExpenseFxRate(db, USER, 'INR', undefined, DATE);
    expect(result).toEqual({ rate: undefined });
    expect(db.findManySpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Explicit rate supplied
// ---------------------------------------------------------------------------

describe('resolveExpenseFxRate — explicit rate supplied', () => {
  it('returns the supplied rate without querying ExchangeRate table', async () => {
    const db = makeDb({ baseCurrencyCode: 'INR' });
    const supplied = new Prisma.Decimal('83.5');
    const result = await resolveExpenseFxRate(db, USER, 'USD', supplied, DATE);
    expect(result.rate?.equals(supplied)).toBe(true);
    expect(result.error).toBeUndefined();
    expect(db.findManySpy).not.toHaveBeenCalled();
  });

  it('works when base currency row is missing (unconfigured tenant)', async () => {
    const db = makeDb({ baseCurrencyCode: null });
    const supplied = new Prisma.Decimal('90');
    const result = await resolveExpenseFxRate(db, USER, 'EUR', supplied, DATE);
    expect(result.rate?.equals(supplied)).toBe(true);
    expect(db.findManySpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. loadRate hit → DB rate used and returned
// ---------------------------------------------------------------------------

describe('resolveExpenseFxRate — loadRate hit', () => {
  it('returns the DB rate when no explicit rate is supplied', async () => {
    const db = makeDb({
      baseCurrencyCode: 'INR',
      rateRows: [rateRow('EUR', 'INR', '90.25', '2026-05-15')],
    });
    const result = await resolveExpenseFxRate(db, USER, 'EUR', undefined, DATE);
    expect(result.error).toBeUndefined();
    expect(result.rate?.toString()).toBe('90.25');
    // Verify the DB was queried with the right pair
    expect(db.findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER,
          fromCurrency: 'EUR',
          toCurrency: 'INR',
        }),
      }),
    );
  });

  it('uses "BASE" as toCurrency when no base currency is configured', async () => {
    const db = makeDb({
      baseCurrencyCode: null,
      rateRows: [rateRow('USD', 'BASE', '83', '2026-06-01')],
    });
    const result = await resolveExpenseFxRate(db, USER, 'USD', undefined, DATE);
    expect(result.error).toBeUndefined();
    expect(result.rate?.toString()).toBe('83');
    expect(db.findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ toCurrency: 'BASE' }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. loadRate miss → 422 error
// ---------------------------------------------------------------------------

describe('resolveExpenseFxRate — loadRate miss (422)', () => {
  it('returns an error string when no rate row exists for the currency', async () => {
    const db = makeDb({ baseCurrencyCode: 'INR', rateRows: [] });
    const result = await resolveExpenseFxRate(db, USER, 'GBP', undefined, DATE);
    expect(result.rate).toBeUndefined();
    expect(result.error).toMatch(/GBP/);
    expect(result.error).toMatch(/Exchange Rates/);
  });

  it('returns an error string when all DB rows are after the expense date', async () => {
    const db = makeDb({
      baseCurrencyCode: 'INR',
      rateRows: [rateRow('GBP', 'INR', '105', '2026-07-01')], // future — excluded by loadRate
    });
    const result = await resolveExpenseFxRate(db, USER, 'GBP', undefined, DATE);
    expect(result.rate).toBeUndefined();
    expect(result.error).toMatch(/GBP/);
  });
});
