// lib/ledger/expenseFxGuard.ts
//
// FX rate guard for foreign-currency expenses.
//
// Resolution ladder:
//   1. No currencyCode, or currencyCode equals the company base currency
//      → base path; return rate: undefined (no conversion needed).
//   2. exchangeRate was explicitly supplied by the caller
//      → use it as-is (existing behavior unchanged).
//   3. Neither: query the ExchangeRate table via loadRate.
//      - Rate found  → return it (caller should also persist it on the expense row).
//      - Rate missing → return an error string; caller must reject with 422.
//
import { Prisma } from '@prisma/client';
import { loadRate, type RateTx } from './exchangeRates';

/** Minimal DB slice we need beyond RateTx. */
export interface FxGuardDb extends RateTx {
  currency: {
    findFirst: (args: {
      where: { isDefault: boolean; isDeleted: boolean };
      select: { code: boolean };
    }) => Promise<{ code: string } | null>;
  };
}

export interface FxResolution {
  /** Resolved rate to use, or undefined for the base-currency path. */
  rate: Prisma.Decimal | undefined;
  /** When set, the caller must respond 422 with this message. */
  error?: string;
}

/**
 * Resolves the effective exchange rate for an expense.
 *
 * @param db         - A Prisma tx/client that satisfies FxGuardDb.
 * @param userId     - Tenant user ID (used to scope ExchangeRate rows).
 * @param currencyCode - The expense's document currency (undefined / empty = base).
 * @param suppliedRate - Exchange rate explicitly provided in the request body.
 * @param date       - The expense date (used to pick the most recent rate ≤ date).
 */
export async function resolveExpenseFxRate(
  db: FxGuardDb,
  userId: string,
  currencyCode: string | undefined,
  suppliedRate: Prisma.Decimal | undefined,
  date: Date,
): Promise<FxResolution> {
  // Rule 1a: no currency code → base path (rate 1 implicitly)
  if (!currencyCode) return { rate: undefined };

  // Resolve the company base currency (first active default currency row)
  const baseCurrencyRow = await db.currency.findFirst({
    where: { isDefault: true, isDeleted: false },
    select: { code: true },
  });
  const baseCurrencyCode = baseCurrencyRow?.code ?? null;

  // Rule 1b: same currency as the company base → no conversion needed
  if (baseCurrencyCode && currencyCode === baseCurrencyCode) return { rate: undefined };

  // Rule 2: caller supplied an explicit rate → use it directly
  if (suppliedRate !== undefined) return { rate: suppliedRate };

  // Rule 3: look up the ExchangeRate table
  // Rate direction: foreign → base. When base currency is unknown (unconfigured
  // tenant) we fall back to 'BASE' which matches the sentinel used in postExpense.
  const toCurrency = baseCurrencyCode ?? 'BASE';
  const dbRate = await loadRate(db, userId, currencyCode, toCurrency, date);
  if (dbRate !== null) return { rate: dbRate };

  // No rate found → caller must reject
  return {
    rate: undefined,
    error:
      `No exchange rate configured for ${currencyCode}. ` +
      `Add one under Exchange Rates before recording foreign-currency expenses.`,
  };
}
