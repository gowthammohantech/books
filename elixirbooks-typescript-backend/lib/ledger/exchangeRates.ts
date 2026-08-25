// lib/ledger/exchangeRates.ts
import { Prisma } from '@prisma/client';
import { toDecimal } from './money';

/** A row from the ExchangeRate table (only the fields we need here). */
export interface ExchangeRateRow {
  fromCurrency: string;
  toCurrency: string;
  rate: Prisma.Decimal;
  asOfDate: Date;
}

/**
 * Pure rate resolver — no I/O. Picks the latest row at or before `asOf` for
 * the requested currency pair. Returns `Decimal(1)` when `from === to`.
 * Returns `null` when no row matches.
 */
export function resolveRate(
  rows: ExchangeRateRow[],
  from: string,
  to: string,
  asOf: Date,
): Prisma.Decimal | null {
  if (from === to) return new Prisma.Decimal(1);

  // Filter to rows for this pair at/before asOf, then pick the latest.
  const candidates = rows.filter(
    (r) =>
      r.fromCurrency === from &&
      r.toCurrency === to &&
      r.asOfDate <= asOf,
  );

  if (candidates.length === 0) return null;

  // Sort descending by asOfDate and take the first.
  candidates.sort((a, b) => b.asOfDate.getTime() - a.asOfDate.getTime());
  return toDecimal(candidates[0].rate);
}

/** Minimal slice of the Prisma tx/client needed for rate lookup. */
export interface RateTx {
  exchangeRate: {
    findMany: (args: {
      where: {
        userId: string;
        fromCurrency: string;
        toCurrency: string;
        asOfDate: { lte: Date };
      };
      orderBy: { asOfDate: 'desc' };
      take: number;
    }) => Promise<ExchangeRateRow[]>;
  };
}

/**
 * DB-backed loader. Queries the ExchangeRate table for the pair, then calls
 * resolveRate. Returns null when no rate is found.
 */
export async function loadRate(
  tx: RateTx,
  userId: string,
  from: string,
  to: string,
  asOf: Date,
): Promise<Prisma.Decimal | null> {
  if (from === to) return new Prisma.Decimal(1);

  const rows = await tx.exchangeRate.findMany({
    where: { userId, fromCurrency: from, toCurrency: to, asOfDate: { lte: asOf } },
    orderBy: { asOfDate: 'desc' },
    take: 1,
  });

  return resolveRate(rows, from, to, asOf);
}
