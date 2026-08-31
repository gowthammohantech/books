// lib/ledger/money.ts
import { Prisma } from '@prisma/client';

export type DecimalInput = Prisma.Decimal | number | string;

export const ZERO = new Prisma.Decimal(0);

export function toDecimal(value: DecimalInput): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function sumDecimals(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

export function decEq(a: Prisma.Decimal, b: Prisma.Decimal): boolean {
  return a.equals(b);
}

/**
 * Convert a document/transaction-currency amount to the functional (base)
 * currency register value. Rate direction is foreign → base (multiply), matching
 * exchangeRates.ts. `rate` null/undefined (or the base-currency path) is a no-op.
 * Rounds to 2dp — the precision bankDetail/pettyCash.currentBalance is kept at.
 *
 * Used so the base-currency cash register moves by the SAME base amount the GL
 * posts, and so every reversal (void/delete) refunds the exact base amount the
 * create deducted — provided both sides pass the document's own persisted rate.
 */
export function toBaseAmount(amount: DecimalInput, rate?: DecimalInput | null): number {
  const base = rate == null ? toDecimal(amount) : toDecimal(amount).times(toDecimal(rate));
  return Number(base.toFixed(2));
}
