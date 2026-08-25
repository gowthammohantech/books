// lib/contacts/accountCreditBalance.ts
import { Prisma } from '@prisma/client';
import { toDecimal, ZERO } from '../ledger/money';

/** Minimal structural slice of Prisma (or a `$transaction` tx) this helper needs —
 *  keeps it unit-testable with a fake db and avoids a hard dependency on the
 *  generated client shape in tests. */
export interface AccountCreditBalanceDb {
  accountCreditEntry: {
    aggregate: (args: unknown) => Promise<{ _sum: { amount: Prisma.Decimal | number | string | null } }>;
  };
}

export interface AccountCreditBalanceParams {
  userId: string;
  contactId: string;
}

/**
 * Computes a contact's live Account Credit balance — ALWAYS derived, never stored
 * (matches this codebase's Statement-of-Account convention: no denormalized
 * balance column on Contact).
 *
 *   balance = SUM(amount WHERE type='GRANT' AND isVoided=false)
 *           - SUM(amount WHERE type='REDEMPTION' AND isVoided=false)
 *
 * scoped to (userId, contactId) — voided grants/redemptions are excluded entirely.
 * Both the grant/void endpoints in this slice AND the (separate) invoice-payment
 * redemption flow call this so the computed balance is always consistent.
 */
export async function getAccountCreditBalance(
  db: AccountCreditBalanceDb,
  { userId, contactId }: AccountCreditBalanceParams,
): Promise<Prisma.Decimal> {
  const [grants, redemptions] = await Promise.all([
    db.accountCreditEntry.aggregate({
      where: { userId, contactId, type: 'GRANT', isVoided: false },
      _sum: { amount: true },
    }),
    db.accountCreditEntry.aggregate({
      where: { userId, contactId, type: 'REDEMPTION', isVoided: false },
      _sum: { amount: true },
    }),
  ]);

  const grantTotal = grants._sum.amount != null ? toDecimal(grants._sum.amount) : ZERO;
  const redemptionTotal = redemptions._sum.amount != null ? toDecimal(redemptions._sum.amount) : ZERO;
  return grantTotal.minus(redemptionTotal);
}
